import * as Y from 'yjs';
import { pool } from '../db/client.js';
import { DocumentModel } from '../models/document.js';

export interface SnapshotOptions {
  intervalMs?: number;
  maxSnapshots?: number;
}

export class SnapshotService {
  private intervals: Map<string, NodeJS.Timeout> = new Map();
  private defaultInterval = 60 * 1000; // 60 seconds
  private maxSnapshots = 50; // Keep last 50 snapshots per document

  constructor(private options: SnapshotOptions = {}) {
    this.defaultInterval = options.intervalMs || this.defaultInterval;
    this.maxSnapshots = options.maxSnapshots || this.maxSnapshots;
  }

  startSnapshotting(documentId: string, ydoc: Y.Doc): void {
    // Clear existing interval for this document
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
    if (interval) {
      clearInterval(interval);
      this.intervals.delete(documentId);
      console.log(`[snapshot] Stopped snapshotting document ${documentId}`);
    }
  }

  async createSnapshot(documentId: string, ydoc: Y.Doc): Promise<void> {
    if (!pool) {
      console.warn('[snapshot] Database not available, skipping snapshot');
      return;
    }

    try {
      // Get current document version
      const document = await DocumentModel.findById(documentId);
      if (!document) {
        console.warn(`[snapshot] Document ${documentId} not found`);
        return;
      }

      // Create Yjs snapshot
      const snapshot = Y.snapshot(ydoc);
      const snapshotState = Y.encodeSnapshot(snapshot);

      // Insert snapshot into database
      await pool.query(
        `INSERT INTO document_snapshots (document_id, yjs_snapshot, version, metadata)
         VALUES ($1, $2, $3, $4)`,
        [
          documentId,
          snapshotState,
          document.version + 1,
          { created_at: new Date().toISOString() }
        ]
      );

      // Clean up old snapshots
      await this.cleanupOldSnapshots(documentId);

      console.log(`[snapshot] Created snapshot for document ${documentId}, version ${document.version + 1}`);
    } catch (error) {
      console.error(`[snapshot] Error creating snapshot for document ${documentId}:`, error);
      throw error;
    }
  }

  async cleanupOldSnapshots(documentId: string): Promise<void> {
    if (!pool) return;

    try {
      // Delete old snapshots, keeping only the most recent ones
      await pool.query(
        `DELETE FROM document_snapshots 
         WHERE document_id = $1 
         AND id NOT IN (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (ORDER BY created_at DESC) as rn
             FROM document_snapshots 
             WHERE document_id = $1
           ) t 
           WHERE rn <= $2
         )`,
        [documentId, this.maxSnapshots.toString()]
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

      return result.rows[0]?.yjs_snapshot || null;
    } catch (error) {
      console.error(`[snapshot] Error retrieving latest snapshot for document ${documentId}:`, error);
      return null;
    }
  }

  async restoreFromSnapshot(documentId: string, ydoc: Y.Doc, snapshotVersion?: number): Promise<boolean> {
    if (!pool) return false;

    try {
      let query = 'SELECT yjs_snapshot FROM document_snapshots WHERE document_id = $1';
      const params = [documentId];

      if (snapshotVersion) {
        query += ' AND version = $2 ORDER BY created_at DESC LIMIT 1';
        params.push(snapshotVersion.toString());
      } else {
        query += ' ORDER BY created_at DESC LIMIT 1';
      }

      const result = await pool.query(query, params);
      
      if (result.rows.length === 0) {
        console.warn(`[snapshot] No snapshot found for document ${documentId}`);
        return false;
      }

      const snapshotState = result.rows[0].yjs_snapshot;
      const snapshot = Y.decodeSnapshot(snapshotState);
      
      // Apply snapshot to document using proper Yjs API
      const newDoc = new Y.Doc();
      Y.applyUpdate(newDoc, Y.encodeSnapshot(snapshot));
      
      // Clear current document and apply snapshot state
      const currentMap = ydoc.getMap('blocks');
      const snapshotMap = newDoc.getMap('blocks');
      
      // Clear current blocks
      currentMap.clear();
      
      // Copy blocks from snapshot
      for (const [key, value] of snapshotMap) {
        currentMap.set(key, value);
      }

      console.log(`[snapshot] Restored document ${documentId} from snapshot`);
      return true;
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

  // M7: Snapshot Compaction — 將多個舊 snapshot 合併成一個基底
  async compactSnapshots(documentId: string, keepRecent = 5): Promise<void> {
    if (!pool) return;

    try {
      // 取所有 snapshot（由舊到新）
      const result = await pool.query(
        `SELECT id, yjs_snapshot, version FROM document_snapshots
         WHERE document_id = $1 ORDER BY created_at ASC`,
        [documentId]
      );

      const rows = result.rows;
      if (rows.length <= keepRecent) return; // 不需要 compact

      // 合併前段所有 snapshot 成一個基底 update
      const toCompact = rows.slice(0, rows.length - keepRecent);
      const baseDoc = new Y.Doc();
      for (const row of toCompact) {
        Y.applyUpdate(baseDoc, Y.encodeStateAsUpdate(baseDoc));
      }
      const compactedState = Y.encodeStateAsUpdate(baseDoc);

      // 刪除舊的，插入 compacted 基底
      const idsToDelete = toCompact.map((r: any) => r.id);
      await pool.query(
        `DELETE FROM document_snapshots WHERE id = ANY($1)`,
        [idsToDelete]
      );
      await pool.query(
        `INSERT INTO document_snapshots (document_id, yjs_snapshot, version, metadata)
         VALUES ($1, $2, $3, $4)`,
        [documentId, compactedState, 0, { compacted: true, compacted_at: new Date().toISOString() }]
      );

      console.log(`[snapshot] Compacted ${toCompact.length} snapshots for document ${documentId}`);
    } catch (error) {
      console.error(`[snapshot] Compaction failed for ${documentId}:`, error);
    }
  }

  stopAll(): void {
    for (const [documentId, interval] of this.intervals) {
      clearInterval(interval);
      console.log(`[snapshot] Stopped snapshotting document ${documentId}`);
    }
    this.intervals.clear();
  }
}

// Global snapshot service instance
export const snapshotService = new SnapshotService();
