import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { runMigrations } from './migrations.js';
import { getDbRequestContext, runWithDbRequestContext } from './context.js';
import { observability } from '../services/observability.js';

const connectionString = process.env.DATABASE_URL;

function getIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

const rawPool = connectionString ? new Pool({
  connectionString,
  max: getIntEnv('PG_POOL_MAX', 20),
  min: getIntEnv('PG_POOL_MIN', 2),
  idleTimeoutMillis: getIntEnv('PG_IDLE_TIMEOUT_MS', 30000),
  connectionTimeoutMillis: getIntEnv('PG_CONNECTION_TIMEOUT_MS', 10000),
  maxUses: getIntEnv('PG_MAX_USES', 7500),
}) : null;

function startPoolMetricsReporter(pool: Pool) {
  const timer = setInterval(() => {
    observability.recordMetric('db_pool_total_connections', pool.totalCount);
    observability.recordMetric('db_pool_idle_connections', pool.idleCount);
    observability.recordMetric('db_pool_waiting_clients', pool.waitingCount);
  }, 15000);
  timer.unref();
}

async function withQueryContext<T>(
  pool: Pool,
  queryFn: (textOrConfig: string | { text: string; values?: unknown[] }, values?: unknown[]) => Promise<T>,
  textOrConfig: string | { text: string; values?: unknown[] },
  values?: unknown[]
): Promise<T> {
  const startedAt = Date.now();
  const requestContext = getDbRequestContext();
  const text = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text;
  const params = typeof textOrConfig === 'string'
    ? values
    : (textOrConfig.values ?? values);

  if (!requestContext) {
    try {
      const result = await queryFn(textOrConfig, params);
      observability.recordDatabaseQuery(text, Date.now() - startedAt, true);
      return result;
    } catch (error) {
      observability.recordDatabaseQuery(text, Date.now() - startedAt, false);
      throw error;
    }
  }

  const client = await pool.connect();
  try {
    await client.query(
      `SELECT
         set_config('app.request_id', $1, true),
         set_config('app.user_id', $2, true),
         set_config('app.workspace_id', $3, true),
         set_config('app.bypass_rls', $4, true)`,
      [
        requestContext.requestId ?? randomUUID(),
        requestContext.userId ?? '',
        requestContext.workspaceId ?? '',
        requestContext.bypassRls ? 'true' : 'false',
      ]
    );
    const result = await client.query(textOrConfig as never, params as never);
    observability.recordDatabaseQuery(text, Date.now() - startedAt, true);
    return result as T;
  } catch (error) {
    observability.recordDatabaseQuery(text, Date.now() - startedAt, false);
    throw error;
  } finally {
    client.release();
  }
}

if (rawPool) {
  const originalQuery = rawPool.query.bind(rawPool);
  rawPool.query = ((textOrConfig: string | { text: string; values?: unknown[] }, values?: unknown[]) =>
    withQueryContext(rawPool, originalQuery as unknown as (textOrConfig: string | { text: string; values?: unknown[] }, values?: unknown[]) => Promise<unknown>, textOrConfig, values)) as typeof rawPool.query;

  const originalConnect = rawPool.connect.bind(rawPool);
  rawPool.connect = (async () => {
    const client = await originalConnect();
    const originalClientQuery = client.query.bind(client);
    client.query = (async (textOrConfig: string | { text: string; values?: unknown[] }, values?: unknown[]) => {
      const requestContext = getDbRequestContext();
      const text = typeof textOrConfig === 'string' ? textOrConfig : textOrConfig.text;
      const params = typeof textOrConfig === 'string'
        ? values
        : (textOrConfig.values ?? values);
      const startedAt = Date.now();

      try {
        if (requestContext) {
          await originalClientQuery(
            `SELECT
               set_config('app.request_id', $1, true),
               set_config('app.user_id', $2, true),
               set_config('app.workspace_id', $3, true),
               set_config('app.bypass_rls', $4, true)`,
            [
              requestContext.requestId ?? randomUUID(),
              requestContext.userId ?? '',
              requestContext.workspaceId ?? '',
              requestContext.bypassRls ? 'true' : 'false',
            ]
          );
        }
        const result = await originalClientQuery(textOrConfig as never, params as never);
        observability.recordDatabaseQuery(text, Date.now() - startedAt, true);
        return result;
      } catch (error) {
        observability.recordDatabaseQuery(text, Date.now() - startedAt, false);
        throw error;
      }
    }) as typeof client.query;

    return client;
  }) as typeof rawPool.connect;

  rawPool.on('error', (error) => {
    observability.error('Unexpected PostgreSQL pool error', {
      error: error.message,
    });
  });

  startPoolMetricsReporter(rawPool);
}

export const pool = rawPool;

function shouldAutoRunMigrations(): boolean {
  if (process.env.DATABASE_AUTO_MIGRATE) {
    return process.env.DATABASE_AUTO_MIGRATE === 'true';
  }
  return process.env.NODE_ENV !== 'production';
}

export async function initDb(): Promise<void> {
  if (!pool) {
    console.warn('[db] DATABASE_URL 未設定，將以無資料庫模式啟動');
    return;
  }

  try {
    await pool.query('SELECT 1');
    console.log('[db] connected');

    if (shouldAutoRunMigrations()) {
      console.log('[db] Running database migrations...');
      await runWithDbRequestContext({ bypassRls: true }, () => runMigrations());
    } else {
      console.log('[db] Skipping auto-migrations; run migration command during deploy');
    }
  } catch (error) {
    console.error('[db] connection failed', error);
    throw error;
  }
}
