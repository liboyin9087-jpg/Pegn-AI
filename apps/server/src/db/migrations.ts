import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function runMigrations(): Promise<void> {
  if (!pool) {
    console.warn('[migrations] No database connection, skipping migrations');
    return;
  }

  try {
    const schemaSql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    await pool.query(schemaSql);
    console.log('[migrations] Database schema initialized successfully');
    await runColumnMigrations();
    await initDefaultRoles();
  } catch (error) {
    console.error('[migrations] Failed to run migrations:', error);
    throw error;
  }
}

export async function initDefaultRoles(): Promise<void> {
  if (!pool) return;

  const defaultRoles = [
    {
      name: 'admin',
      description: 'Full access to the workspace and members',
      permissions: JSON.stringify([
        'workspace:admin',
        'collection:create', 'collection:edit', 'collection:delete', 'collection:view',
        'document:create', 'document:edit', 'document:delete', 'document:view',
        'comment:view', 'comment:create', 'comment:resolve'
      ])
    },
    {
      name: 'editor',
      description: 'Can create and edit content',
      permissions: JSON.stringify([
        'collection:create', 'collection:edit', 'collection:view',
        'document:create', 'document:edit', 'document:view',
        'comment:view', 'comment:create', 'comment:resolve'
      ])
    },
    {
      name: 'viewer',
      description: 'Read-only access',
      permissions: JSON.stringify(['collection:view', 'document:view', 'comment:view', 'comment:create'])
    }
  ];

  try {
    for (const role of defaultRoles) {
      await pool.query(`
        INSERT INTO roles (workspace_id, name, description, permissions)
        VALUES (NULL, $1, $2, $3)
        ON CONFLICT (workspace_id, name) WHERE workspace_id IS NULL
        DO UPDATE SET description = EXCLUDED.description, permissions = EXCLUDED.permissions
      `, [role.name, role.description, role.permissions]);
    }
    console.log('[migrations] Default system roles initialized');
  } catch (error) {
    console.error('[migrations] Failed to initialize default roles:', error);
  }
}

/**
 * P2 column migrations — safe ALTER TABLE ADD COLUMN IF NOT EXISTS for existing live DBs.
 * runMigrations() calls this after schema.sql (which uses CREATE TABLE IF NOT EXISTS).
 */
export async function runColumnMigrations(): Promise<void> {
  if (!pool) return;
  const alterations = [
    // P2-1: Recursive sub-run linkage on agent_runs
    `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS parent_run_id UUID REFERENCES agent_runs(id) ON DELETE CASCADE`,
    `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS root_run_id UUID`,
    `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS depth INTEGER NOT NULL DEFAULT 0`,
    // P2-1: depth on agent_steps
    `ALTER TABLE agent_steps ADD COLUMN IF NOT EXISTS depth INTEGER NOT NULL DEFAULT 0`,
    // P2-2: cost ceiling on quota_limits
    `ALTER TABLE quota_limits ADD COLUMN IF NOT EXISTS cost_usd_ceiling DECIMAL(10,4) DEFAULT NULL`,
    // P2-2: cost tracking on usage_records
    `ALTER TABLE usage_records ADD COLUMN IF NOT EXISTS cost_usd DECIMAL(10,6) NOT NULL DEFAULT 0`,
    // P1-1: document search lifecycle columns
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS index_status TEXT`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS last_indexed_at TIMESTAMP WITH TIME ZONE`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS index_error TEXT`,
    `UPDATE documents d
     SET index_status = CASE
       WHEN EXISTS (
         SELECT 1
         FROM search_index si
         WHERE si.document_id = d.id
           AND si.content_vector IS NOT NULL
       ) THEN 'indexed'
       ELSE 'stale'
     END
     WHERE d.index_status IS NULL`,
    `ALTER TABLE documents ALTER COLUMN index_status SET DEFAULT 'pending'`,
    `UPDATE documents SET index_status = 'pending' WHERE index_status IS NULL`,
    `ALTER TABLE documents ALTER COLUMN index_status SET NOT NULL`,
    `ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_index_status_check`,
    `ALTER TABLE documents ADD CONSTRAINT documents_index_status_check CHECK (index_status IN ('pending', 'indexed', 'stale', 'failed'))`,
    // P1-C: agent run lifecycle columns and status contract
    `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS input_summary TEXT`,
    `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS output_summary TEXT`,
    `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS error_summary TEXT`,
    `UPDATE agent_runs
     SET input_summary = LEFT(COALESCE(NULLIF(input_summary, ''), query), 500)
     WHERE input_summary IS NULL`,
    `UPDATE agent_runs
     SET output_summary = LEFT(COALESCE(output_summary, result->>'answer', result::text), 500)
     WHERE status IN ('done', 'completed')
       AND output_summary IS NULL`,
    `UPDATE agent_runs
     SET error_summary = LEFT(
       COALESCE(
         error_summary,
         NULLIF(error, ''),
         CASE
           WHEN status = 'aborted' THEN 'Run interrupted by server restart'
           ELSE 'Agent run failed'
         END
       ),
       500
     )
     WHERE status IN ('error', 'aborted', 'failed')
       AND error_summary IS NULL`,
    `UPDATE agent_runs SET status = 'completed' WHERE status = 'done'`,
    `UPDATE agent_runs SET status = 'failed' WHERE status IN ('error', 'aborted')`,
    `ALTER TABLE agent_runs ALTER COLUMN started_at DROP DEFAULT`,
    `ALTER TABLE agent_runs ALTER COLUMN status SET DEFAULT 'queued'`,
    `ALTER TABLE agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_check`,
    `ALTER TABLE agent_runs ADD CONSTRAINT agent_runs_status_check CHECK (status IN ('queued', 'running', 'completed', 'failed'))`,
    // P0: inbox notification type contract for existing databases
    `ALTER TABLE inbox_notifications DROP CONSTRAINT IF EXISTS inbox_notifications_type_check`,
    `ALTER TABLE inbox_notifications ADD CONSTRAINT inbox_notifications_type_check CHECK (type IN ('mention', 'quota_alert', 'automation'))`,
  ];
  for (const sql of alterations) {
    try {
      await pool.query(sql);
    } catch (err: any) {
      // Ignore "already exists" errors on repeated startup
      if (!String(err?.message).includes('already exists')) {
        console.warn(`[migrations] column migration warning: ${err?.message}`);
      }
    }
  }
  console.log('[migrations] P2 column migrations applied');
}

export async function checkSchema(): Promise<boolean> {
  if (!pool) return false;

  try {
    const result = await pool.query(`
      SELECT COUNT(*) as count FROM information_schema.tables
      WHERE table_name IN ('workspaces', 'documents', 'blocks', 'document_snapshots', 'search_index', 'collections', 'collection_views', 'roles', 'quota_limits', 'usage_records')
    `);
    return parseInt(result.rows[0].count) >= 10;
  } catch (error) {
    console.error('[migrations] Failed to check schema:', error);
    return false;
  }
}
