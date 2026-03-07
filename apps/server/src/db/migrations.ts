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
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS type TEXT`,
    `ALTER TABLE documents ADD COLUMN IF NOT EXISTS source TEXT`,
    `ALTER TABLE search_index ADD COLUMN IF NOT EXISTS indexed_at TIMESTAMP WITH TIME ZONE`,
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
    `UPDATE search_index si
     SET indexed_at = COALESCE(si.indexed_at, d.updated_at, d.created_at, NOW())
     FROM documents d
     WHERE si.document_id = d.id
       AND si.indexed_at IS NULL`,
    `ALTER TABLE documents ALTER COLUMN index_status SET DEFAULT 'pending'`,
    `UPDATE documents SET index_status = 'pending' WHERE index_status IS NULL`,
    `ALTER TABLE documents ALTER COLUMN index_status SET NOT NULL`,
    `ALTER TABLE documents DROP CONSTRAINT IF EXISTS documents_index_status_check`,
    `ALTER TABLE documents ADD CONSTRAINT documents_index_status_check CHECK (index_status IN ('pending', 'indexed', 'stale', 'failed'))`,
    // P1-C: agent run lifecycle columns and status contract
    `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS input_summary TEXT`,
    `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS output_summary TEXT`,
    `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS error_summary TEXT`,
    `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS thread_id TEXT`,
    `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS prompt_version TEXT`,
    `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS prompt_label TEXT`,
    `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS template_id TEXT`,
    `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS template_version TEXT`,
    `ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS rerun_of_run_id UUID REFERENCES agent_runs(id) ON DELETE SET NULL`,
    `UPDATE agent_runs
     SET input_summary = LEFT(COALESCE(NULLIF(input_summary, ''), query), 500)
     WHERE input_summary IS NULL`,
    `UPDATE agent_runs
     SET prompt_version = COALESCE(prompt_version, 'v1'),
         prompt_label = COALESCE(prompt_label, type),
         template_id = COALESCE(template_id, type),
         template_version = COALESCE(template_version, 'v1')
     WHERE prompt_version IS NULL
        OR prompt_label IS NULL
        OR template_id IS NULL
        OR template_version IS NULL`,
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
    `CREATE TABLE IF NOT EXISTS agent_artifacts (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
       workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
       type TEXT NOT NULL,
       title TEXT NOT NULL,
       mime_type TEXT,
       size BIGINT,
       metadata JSONB DEFAULT '{}'::jsonb,
       created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
     )`,
    `CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace_created ON agent_runs(workspace_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_runs_thread_created ON agent_runs(thread_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_runs_status_created ON agent_runs(status, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_runs_rerun_of ON agent_runs(rerun_of_run_id)`,
    `CREATE INDEX IF NOT EXISTS idx_agent_artifacts_run_created ON agent_artifacts(run_id, created_at DESC)`,
    // P2-A: jobs observability tables and contract
    `CREATE TABLE IF NOT EXISTS jobs (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
       job_type TEXT NOT NULL,
       resource_type TEXT,
       resource_id TEXT,
       source_domain TEXT NOT NULL,
       source_run_id TEXT,
       triggered_by TEXT,
       triggered_via TEXT,
       idempotency_key TEXT,
       correlation_id TEXT,
       retry_of_job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
       status TEXT NOT NULL DEFAULT 'queued',
       error_code TEXT,
       error_summary TEXT,
       metadata JSONB DEFAULT '{}'::jsonb,
       started_at TIMESTAMP WITH TIME ZONE,
       finished_at TIMESTAMP WITH TIME ZONE,
       cancel_requested_at TIMESTAMP WITH TIME ZONE,
       created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
       updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
     )`,
    `CREATE TABLE IF NOT EXISTS job_events (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
       sequence_no INTEGER NOT NULL,
       event_type TEXT NOT NULL,
       message TEXT,
       payload JSONB DEFAULT '{}'::jsonb,
       created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
       UNIQUE(job_id, sequence_no)
     )`,
    `ALTER TABLE jobs ALTER COLUMN status SET DEFAULT 'queued'`,
    `ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_status_check`,
    `ALTER TABLE jobs ADD CONSTRAINT jobs_status_check CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'timeout'))`,
    `ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_job_type_check`,
    `ALTER TABLE jobs ADD CONSTRAINT jobs_job_type_check CHECK (job_type IN ('document_index', 'document_reindex', 'agent_run', 'automation_trigger'))`,
    `ALTER TABLE job_events DROP CONSTRAINT IF EXISTS job_events_event_type_check`,
    `ALTER TABLE job_events ADD CONSTRAINT job_events_event_type_check CHECK (event_type IN ('queued', 'started', 'progress', 'retry_requested', 'retry_started', 'cancel_requested', 'cancelled', 'failed', 'completed', 'timed_out'))`,
    `CREATE INDEX IF NOT EXISTS idx_jobs_workspace_created_at ON jobs(workspace_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_jobs_workspace_status_created_at ON jobs(workspace_id, status, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_jobs_workspace_type_created_at ON jobs(workspace_id, job_type, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_jobs_resource_created_at ON jobs(resource_type, resource_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_jobs_correlation_id ON jobs(correlation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_job_events_job_sequence ON job_events(job_id, sequence_no)`,
    // P2-B: search retrieval experience indexes
    `CREATE INDEX IF NOT EXISTS idx_documents_workspace_updated_at ON documents(workspace_id, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_documents_workspace_type ON documents(workspace_id, type)`,
    `CREATE INDEX IF NOT EXISTS idx_documents_workspace_source ON documents(workspace_id, source)`,
    `CREATE INDEX IF NOT EXISTS idx_search_document_indexed_at ON search_index(document_id, indexed_at DESC)`,
    // P2-D: append-only admin audit logs
    `CREATE TABLE IF NOT EXISTS audit_logs (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
       actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
       actor_display TEXT NOT NULL,
       event_type TEXT NOT NULL,
       target_type TEXT NOT NULL,
       target_id TEXT,
       summary TEXT NOT NULL,
       metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
       created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
     )`,
    `ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_event_type_check`,
    `ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_event_type_check CHECK (
       event_type IN (
         'workspace_updated',
         'member_invited',
         'invite_revoked',
         'member_role_changed',
         'member_removed',
         'document_deleted',
         'document_reindexed',
         'agent_run_rerun',
         'automation_triggered',
         'quota_alert_raised'
       )
     )`,
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_created_at ON audit_logs(workspace_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_workspace_event_created_at ON audit_logs(workspace_id, event_type, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_logs_target_created_at ON audit_logs(target_type, target_id, created_at DESC)`,
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
      WHERE table_name IN ('workspaces', 'documents', 'blocks', 'document_snapshots', 'search_index', 'collections', 'collection_views', 'roles', 'quota_limits', 'usage_records', 'jobs', 'job_events', 'audit_logs')
    `);
    return parseInt(result.rows[0].count) >= 13;
  } catch (error) {
    console.error('[migrations] Failed to check schema:', error);
    return false;
  }
}
