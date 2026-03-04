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
