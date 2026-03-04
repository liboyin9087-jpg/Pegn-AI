import type { Express, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { verifySnapshotRecovery, verifyWorkspaceSnapshots } from '../services/snapshot.js';
import { getWorkspaceIdFromRequest } from '../services/request.js';

export function registerHealthRoutes(app: Express): void {
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // ── GET /api/v1/health/snapshot ─────────────────────────────────────────
  // Workspace-level snapshot health check (all docs) — nightly CI smoke target
  app.get('/api/v1/health/snapshot', authMiddleware, async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    const docId       = req.query.document_id as string | undefined;

    if (!workspaceId && !docId) {
      res.status(400).json({ error: 'workspace_id or document_id required' });
      return;
    }

    try {
      if (docId) {
        // Single-document check
        const report = await verifySnapshotRecovery(docId);
        res.status(report.healthy ? 200 : 207).json(report);
      } else {
        // Workspace-wide check
        const summary = await verifyWorkspaceSnapshots(workspaceId!);
        const status  = summary.unhealthy > 0 ? 207 : 200;
        res.status(status).json(summary);
      }
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });
}
