/**
 * retention.ts — Data retention TTL cleanup service
 *
 * Deletes old records according to per-table retention policies.
 * For document_snapshots, keeps the latest N per document to prevent
 * accidental data loss while still bounding storage growth.
 *
 * Called daily at 02:00 UTC by the automation scheduler.
 */

import type { Pool } from 'pg';

export interface RetentionResult {
  ran_at: string;
  deleted: Record<string, number>;
  errors: Record<string, string>;
}

/**
 * Retention policies per table.
 * - ttl_days: delete records older than this many days
 * - keep_latest: (document_snapshots only) keep the N newest per document
 */
const RETENTION_POLICIES = {
  document_snapshots: { ttl_days: 30,  keep_latest: 5 },
  audit_logs:         { ttl_days: 90,  keep_latest: null },
  usage_records:      { ttl_days: 365, keep_latest: null },
} as const;

export async function runRetentionCleanup(pool: Pool): Promise<RetentionResult> {
  const result: RetentionResult = {
    ran_at: new Date().toISOString(),
    deleted: {},
    errors:  {},
  };

  // ── document_snapshots ────────────────────────────────────────────────────
  // Delete snapshots older than ttl_days, but always keep the latest N per doc.
  try {
    const { ttl_days, keep_latest } = RETENTION_POLICIES.document_snapshots;
    const cutoff = new Date(Date.now() - ttl_days * 24 * 60 * 60 * 1000).toISOString();
    const { rowCount } = await pool.query(
      `DELETE FROM document_snapshots
       WHERE created_at < $1
         AND id NOT IN (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (
               PARTITION BY document_id ORDER BY created_at DESC
             ) AS rn
             FROM document_snapshots
           ) ranked
           WHERE rn <= $2
         )`,
      [cutoff, keep_latest],
    );
    result.deleted.document_snapshots = rowCount ?? 0;
  } catch (err) {
    result.errors.document_snapshots = err instanceof Error ? err.message : String(err);
  }

  // ── audit_logs ────────────────────────────────────────────────────────────
  try {
    const { ttl_days } = RETENTION_POLICIES.audit_logs;
    const cutoff = new Date(Date.now() - ttl_days * 24 * 60 * 60 * 1000).toISOString();
    const { rowCount } = await pool.query(
      'DELETE FROM audit_logs WHERE created_at < $1',
      [cutoff],
    );
    result.deleted.audit_logs = rowCount ?? 0;
  } catch (err) {
    result.errors.audit_logs = err instanceof Error ? err.message : String(err);
  }

  // ── usage_records ─────────────────────────────────────────────────────────
  try {
    const { ttl_days } = RETENTION_POLICIES.usage_records;
    const cutoff = new Date(Date.now() - ttl_days * 24 * 60 * 60 * 1000).toISOString();
    const { rowCount } = await pool.query(
      'DELETE FROM usage_records WHERE updated_at < $1',
      [cutoff],
    );
    result.deleted.usage_records = rowCount ?? 0;
  } catch (err) {
    result.errors.usage_records = err instanceof Error ? err.message : String(err);
  }

  return result;
}
