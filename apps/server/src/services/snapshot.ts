import * as Y from 'yjs';
import { pool } from '../db/client.js';
import { DocumentModel } from '../models/document.js';
import { getLatestStoredSnapshot } from '../db/snapshots.js';

export interface SnapshotOptions {
  intervalMs?: number;
  maxSnapshots?: number;
}

export interface SnapshotRecoveryDrillReport {
  document_id: string;
  created_at: string;
  checks: {
    document_exists: boolean;
    document_snapshots_count: number;
    yjs_snapshot_exists: boolean;
    restore_success: boolean;
    restore_source: 'document_snapshots' | 'yjs_snapshots' | 'none';
    restored_blocks_count: number;
  };
  timing_ms: {
    restore_from_document_snapshots: number;
    restore_from_yjs_snapshots: number;
    total: number;
  };
  warnings: string[];
}

function normalizeBinaryPayload(value: unknown): Uint8Array | null {
  if (!value) return null;
  if (value instanceof Uint8Array) return value;
  if (Buffer.isBuffer(value)) return new Uint8Array(value);
  return null;
}

function countBlocks(ydoc: Y.Doc): number {
  return ydoc.getMap('blocks').size;
}

function replaceBlocks(target: Y.Doc, source: Y.Doc): void {
  const targetBlocks = target.getMap('blocks');
  const sourceBlocks = source.getMap('blocks');

  targetBlocks.clear();
  for (const [key, value] of sourceBlocks.entries()) {
    targetBlocks.set(key, value);
  }
}

export class SnapshotService {
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private defaultInterval = 60 * 1000;
  private maxSnapshots = 50;

  constructor(private options: SnapshotOptions = {}) {
    this.defaultInterval = options.intervalMs || this.defaultInterval;
    this.maxSnapshots = options.maxSnapshots || this.maxSnapshots;
  }

  startSnapshotting(documentId: string, ydoc: Y.Doc): void {
    this.stopSnapshotting(documentId);

    const interval = setInterval(async () => {
      try {
        await this.createSnapshot(documentId, ydoc);
      } catch (error) {
        console.error(`[snapshot] Failed to create snapshot for document ${documentId}:`, error);
      }
    }, this.defaultInterval);

    this.intervals.set(documentId, interval);
    console.log(`[snapshot] Started snapshotting document ${documentId} every ${this.defaultInterval}ms`);
  }

  stopSnapshotting(documentId: string): void {
    const interval = this.intervals.get(documentId);
    if (!interval) return;
    clearInterval(interval);
    this.intervals.delete(documentId);
    console.log(`[snapshot] Stopped snapshotting document ${documentId}`);
  }

  async createSnapshot(documentId: string, ydoc: Y.Doc): Promise<void> {
    if (!pool) {
      console.warn('[snapshot] Database not available, skipping snapshot');
      return;
    }

    const document = await DocumentModel.findById(documentId);
    if (!document) {
      console.warn(`[snapshot] Document ${documentId} not found`);
      return;
    }

    // Use Yjs update format to ensure snapshots can be restored without extra context.
    const snapshotUpdate = Buffer.from(Y.encodeStateAsUpdate(ydoc));
    await pool.query(
      `INSERT INTO document_snapshots (document_id, yjs_snapshot, version, metadata)
       VALUES ($1, $2, $3, $4)`,
      [
        documentId,
        snapshotUpdate,
        document.version + 1,
        {
          format: 'yjs_update_v1',
          created_at: new Date().toISOString(),
        },
      ]
    );

    await this.cleanupOldSnapshots(documentId);
    console.log(`[snapshot] Created snapshot for document ${documentId}, version ${document.version + 1}`);
  }

  async cleanupOldSnapshots(documentId: string): Promise<void> {
    if (!pool) return;

    try {
      await pool.query(
        `DELETE FROM document_snapshots
         WHERE document_id = $1
           AND id NOT IN (
             SELECT id FROM (
               SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) AS rn
               FROM document_snapshots
               WHERE document_id = $1
             ) t
             WHERE rn <= $2
           )`,
        [documentId, this.maxSnapshots]
      );
    } catch (error) {
      console.error(`[snapshot] Error cleaning up old snapshots for document ${documentId}:`, error);
    }
  }

  async getLatestSnapshot(documentId: string): Promise<Buffer | null> {
    if (!pool) return null;
    try {
      const result = await pool.query(
        'SELECT yjs_snapshot FROM document_snapshots WHERE document_id = $1 ORDER BY created_at DESC LIMIT 1',
        [documentId]
      );
      return result.rows[0]?.yjs_snapshot ?? null;
    } catch (error) {
      console.error(`[snapshot] Error retrieving latest snapshot for document ${documentId}:`, error);
      return null;
    }
  }

  private tryApplyUpdate(snapshotBinary: Uint8Array, targetDoc: Y.Doc): boolean {
    try {
      const restoredDoc = new Y.Doc();
      Y.applyUpdate(restoredDoc, snapshotBinary);
      replaceBlocks(targetDoc, restoredDoc);
      return true;
    } catch {
      return false;
    }
  }

  async restoreFromSnapshot(documentId: string, ydoc: Y.Doc, snapshotVersion?: number): Promise<boolean> {
    if (!pool) return false;

    try {
      let query = 'SELECT yjs_snapshot, metadata FROM document_snapshots WHERE document_id = $1';
      const params: Array<string | number> = [documentId];

      if (snapshotVersion != null) {
        query += ' AND version = $2 ORDER BY created_at DESC LIMIT 1';
        params.push(snapshotVersion);
      } else {
        query += ' ORDER BY created_at DESC LIMIT 1';
      }

      const result = await pool.query(query, params);
      if ((result.rowCount ?? 0) === 0) {
        console.warn(`[snapshot] No snapshot found for document ${documentId}`);
        return false;
      }

      const snapshotBinary = normalizeBinaryPayload(result.rows[0].yjs_snapshot);
      if (!snapshotBinary) return false;

      if (this.tryApplyUpdate(snapshotBinary, ydoc)) {
        console.log(`[snapshot] Restored document ${documentId} from update snapshot`);
        return true;
      }

      // Legacy fallback: older builds stored encoded snapshot instead of update.
      try {
        const decodeSnapshot = (Y as any).decodeSnapshot;
        const createDocFromSnapshot = (Y as any).createDocFromSnapshot;
        if (typeof decodeSnapshot === 'function' && typeof createDocFromSnapshot === 'function') {
          const snapshot = decodeSnapshot(snapshotBinary);
          const base = new Y.Doc();
          const restored = createDocFromSnapshot(base, snapshot);
          replaceBlocks(ydoc, restored);
          console.log(`[snapshot] Restored document ${documentId} from legacy snapshot`);
          return true;
        }
      } catch (legacyError) {
        console.warn(`[snapshot] Legacy snapshot restore failed for ${documentId}:`, legacyError);
      }

      return false;
    } catch (error) {
      console.error(`[snapshot] Error restoring snapshot for document ${documentId}:`, error);
      return false;
    }
  }

  async getSnapshotHistory(documentId: string, limit = 10): Promise<any[]> {
    if (!pool) return [];
    try {
      const result = await pool.query(
        `SELECT id, version, created_at, metadata
         FROM document_snapshots
         WHERE document_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [documentId, limit]
      );
      return result.rows;
    } catch (error) {
      console.error(`[snapshot] Error retrieving snapshot history for document ${documentId}:`, error);
      return [];
    }
  }

  async compactSnapshots(documentId: string, keepRecent = 5): Promise<void> {
    if (!pool) return;

    try {
      const result = await pool.query(
        `SELECT id, yjs_snapshot
         FROM document_snapshots
         WHERE document_id = $1
         ORDER BY created_at ASC`,
        [documentId]
      );

      const rows = result.rows;
      if (rows.length <= keepRecent) return;

      const toCompact = rows.slice(0, rows.length - keepRecent);
      const mergedDoc = new Y.Doc();
      let applied = 0;

      for (const row of toCompact) {
        const binary = normalizeBinaryPayload(row.yjs_snapshot);
        if (!binary) continue;
        try {
          Y.applyUpdate(mergedDoc, binary);
          applied += 1;
        } catch {
          // Skip malformed historical row and continue compaction.
        }
      }

      if (applied === 0) return;

      const compactedUpdate = Buffer.from(Y.encodeStateAsUpdate(mergedDoc));
      const idsToDelete = toCompact.map((row: any) => row.id);

      await pool.query(
        `DELETE FROM document_snapshots WHERE id = ANY($1)`,
        [idsToDelete]
      );
      await pool.query(
        `INSERT INTO document_snapshots (document_id, yjs_snapshot, version, metadata)
         VALUES ($1, $2, $3, $4)`,
        [
          documentId,
          compactedUpdate,
          0,
          { compacted: true, compacted_at: new Date().toISOString(), format: 'yjs_update_v1' }
        ]
      );

      console.log(`[snapshot] Compacted ${toCompact.length} snapshots for document ${documentId}`);
    } catch (error) {
      console.error(`[snapshot] Compaction failed for ${documentId}:`, error);
    }
  }

  async runRecoveryDrill(documentId: string): Promise<SnapshotRecoveryDrillReport> {
    const start = Date.now();
    const warnings: string[] = [];

    if (!pool) {
      return {
        document_id: documentId,
        created_at: new Date().toISOString(),
        checks: {
          document_exists: false,
          document_snapshots_count: 0,
          yjs_snapshot_exists: false,
          restore_success: false,
          restore_source: 'none',
          restored_blocks_count: 0,
        },
        timing_ms: {
          restore_from_document_snapshots: 0,
          restore_from_yjs_snapshots: 0,
          total: Date.now() - start,
        },
        warnings: ['Database not available'],
      };
    }

    const document = await DocumentModel.findById(documentId);
    if (!document) {
      return {
        document_id: documentId,
        created_at: new Date().toISOString(),
        checks: {
          document_exists: false,
          document_snapshots_count: 0,
          yjs_snapshot_exists: false,
          restore_success: false,
          restore_source: 'none',
          restored_blocks_count: 0,
        },
        timing_ms: {
          restore_from_document_snapshots: 0,
          restore_from_yjs_snapshots: 0,
          total: Date.now() - start,
        },
        warnings: ['Document not found'],
      };
    }

    let documentSnapshotsCount = 0;
    if (pool) {
      try {
        const countResult = await pool.query(
          `SELECT COUNT(*)::int AS count
           FROM document_snapshots
           WHERE document_id = $1`,
          [documentId]
        );
        documentSnapshotsCount = Number(countResult.rows[0]?.count ?? 0);
      } catch (error) {
        warnings.push(`Failed to read document_snapshots count: ${String(error)}`);
      }
    }

    const drillDoc = new Y.Doc();
    const restoreFromDocumentStart = Date.now();
    let restoreSuccess = await this.restoreFromSnapshot(documentId, drillDoc);
    const restoreFromDocumentMs = Date.now() - restoreFromDocumentStart;
    let restoreSource: 'document_snapshots' | 'yjs_snapshots' | 'none' = restoreSuccess ? 'document_snapshots' : 'none';

    const restoreFromYjsStart = Date.now();
    let latestYjsSnapshot: Uint8Array | null = null;
    let hasYjsSnapshot = false;
    try {
      latestYjsSnapshot = await getLatestStoredSnapshot(documentId);
      hasYjsSnapshot = Boolean(latestYjsSnapshot);
    } catch (error) {
      warnings.push(`Failed to read yjs_snapshots: ${String(error)}`);
    }
    if (!restoreSuccess && latestYjsSnapshot) {
      try {
        const restored = new Y.Doc();
        Y.applyUpdate(restored, latestYjsSnapshot);
        replaceBlocks(drillDoc, restored);
        restoreSuccess = true;
        restoreSource = 'yjs_snapshots';
      } catch (error) {
        warnings.push(`Failed to restore from yjs_snapshots: ${String(error)}`);
      }
    }
    const restoreFromYjsMs = Date.now() - restoreFromYjsStart;

    if (documentSnapshotsCount === 0) {
      warnings.push('No rows in document_snapshots');
    }
    if (!hasYjsSnapshot) {
      warnings.push('No row in yjs_snapshots');
    }
    if (!restoreSuccess) {
      warnings.push('Restore failed from all snapshot sources');
    }

    return {
      document_id: documentId,
      created_at: new Date().toISOString(),
      checks: {
        document_exists: true,
        document_snapshots_count: documentSnapshotsCount,
        yjs_snapshot_exists: hasYjsSnapshot,
        restore_success: restoreSuccess,
        restore_source: restoreSource,
        restored_blocks_count: countBlocks(drillDoc),
      },
      timing_ms: {
        restore_from_document_snapshots: restoreFromDocumentMs,
        restore_from_yjs_snapshots: restoreFromYjsMs,
        total: Date.now() - start,
      },
      warnings,
    };
  }

  stopAll(): void {
    for (const [documentId, interval] of this.intervals.entries()) {
      clearInterval(interval);
      console.log(`[snapshot] Stopped snapshotting document ${documentId}`);
    }
    this.intervals.clear();
  }
}

export const snapshotService = new SnapshotService();
