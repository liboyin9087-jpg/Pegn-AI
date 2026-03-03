import type { Express } from 'express';
import { snapshotService } from '../services/snapshot.js';

export function registerHealthRoutes(app: Express): void {
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // P1-1: Snapshot 回放驗證 drill 端點—運維可呈請驗證澥容復原能力
  // GET /health/snapshot-drill?document_id=xxx
  app.get('/health/snapshot-drill', async (req, res) => {
    const documentId = String(req.query.document_id ?? '').trim();
    if (!documentId) {
      res.status(400).json({ error: 'document_id query param required' });
      return;
    }
    const result = await snapshotService.validateSnapshotRecovery(documentId);
    res.status(result.ok ? 200 : 503).json(result);
  });
}
