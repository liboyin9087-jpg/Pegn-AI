import type { Express, Response } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { observability } from '../services/observability.js';

type OfflineMetricSource = 'bootstrap' | 'queue_changed' | 'online' | 'interval';

const VALID_SOURCES: Set<OfflineMetricSource> = new Set([
  'bootstrap',
  'queue_changed',
  'online',
  'interval',
]);

function parseNonNegativeInteger(value: unknown, field: string): { ok: true; value: number } | { ok: false; error: string } {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    return { ok: false, error: `${field} must be a non-negative integer` };
  }
  return { ok: true, value };
}

export function registerOfflineObservabilityRoutes(app: Express): void {
  app.post('/api/v1/observability/offline_queue', authMiddleware, async (req: AuthRequest, res: Response) => {
    const p = pool;
    if (!p || !req.userId) {
      res.status(503).json({ error: 'Database not available' });
      return;
    }

    const workspaceIdRaw = req.body.workspace_id ?? req.body.workspaceId;
    const queueDepthRaw = req.body.queue_depth ?? req.body.queueDepth;
    const replayProcessedRaw = req.body.replay_processed ?? req.body.replayProcessed;
    const replayFailedRaw = req.body.replay_failed ?? req.body.replayFailed;
    const sourceRaw = req.body.source;

    const workspaceId = typeof workspaceIdRaw === 'string' ? workspaceIdRaw.trim() : '';
    if (!workspaceId) {
      res.status(400).json({ error: 'workspace_id is required' });
      return;
    }

    const queueDepth = parseNonNegativeInteger(queueDepthRaw, 'queue_depth');
    if (!queueDepth.ok) {
      res.status(400).json({ error: queueDepth.error });
      return;
    }

    let replayProcessed: number | undefined;
    if (replayProcessedRaw !== undefined) {
      const parsed = parseNonNegativeInteger(replayProcessedRaw, 'replay_processed');
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      replayProcessed = parsed.value;
    }

    let replayFailed: number | undefined;
    if (replayFailedRaw !== undefined) {
      const parsed = parseNonNegativeInteger(replayFailedRaw, 'replay_failed');
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      replayFailed = parsed.value;
    }

    let source: OfflineMetricSource | undefined;
    if (sourceRaw !== undefined) {
      if (typeof sourceRaw !== 'string' || !VALID_SOURCES.has(sourceRaw as OfflineMetricSource)) {
        res.status(400).json({ error: 'source must be one of bootstrap|queue_changed|online|interval' });
        return;
      }
      source = sourceRaw as OfflineMetricSource;
    }

    try {
      const membership = await p.query(
        `SELECT 1
         FROM workspace_members
         WHERE workspace_id = $1
           AND user_id = $2
         LIMIT 1`,
        [workspaceId, req.userId],
      );

      if ((membership.rowCount ?? 0) === 0) {
        res.status(403).json({ error: 'Forbidden: You are not a member of this workspace' });
        return;
      }

      const tags = {
        workspace_id: workspaceId,
        user_id: req.userId,
      };
      const replayProcessedValue = replayProcessed ?? 0;
      const replayFailedValue = replayFailed ?? 0;

      observability.recordMetric('offline_queue_depth', queueDepth.value, tags);
      if (replayProcessedValue > 0) {
        observability.recordMetric('offline_replay_success_total', replayProcessedValue, tags);
      }
      if (replayFailedValue > 0) {
        observability.recordMetric('offline_replay_failure_total', replayFailedValue, tags);
      }

      observability.info('Offline queue observability reported', {
        workspace_id: workspaceId,
        user_id: req.userId,
        queue_depth: queueDepth.value,
        replay_processed: replayProcessedValue,
        replay_failed: replayFailedValue,
        source: source ?? 'unspecified',
      });

      res.status(202).json({ accepted: true });
    } catch (error) {
      observability.error('Report offline queue observability failed', {
        error,
        workspace_id: workspaceId,
        user_id: req.userId,
      });
      res.status(500).json({ error: 'Failed to report offline queue observability' });
    }
  });
}
