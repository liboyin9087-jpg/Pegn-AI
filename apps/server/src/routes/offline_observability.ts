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
    // SLA fields (optional)
    const avgDwellRaw = req.body.avg_dwell_ms;
    const maxDwellRaw = req.body.max_dwell_ms;
    const p95DwellRaw = req.body.p95_dwell_ms;
    const successRateRaw = req.body.success_rate;

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

      // SLA metrics — only record when present (non-negative numbers)
      if (typeof avgDwellRaw === 'number' && avgDwellRaw >= 0) {
        observability.recordMetric('offline_queue_avg_dwell_ms', avgDwellRaw, tags);
      }
      if (typeof maxDwellRaw === 'number' && maxDwellRaw >= 0) {
        observability.recordMetric('offline_queue_max_dwell_ms', maxDwellRaw, tags);
      }
      if (typeof p95DwellRaw === 'number' && p95DwellRaw >= 0) {
        observability.recordMetric('offline_queue_p95_dwell_ms', p95DwellRaw, tags);
      }
      if (typeof successRateRaw === 'number' && successRateRaw >= 0 && successRateRaw <= 1) {
        observability.recordMetric('offline_replay_success_rate', successRateRaw, tags);
      }

      observability.info('Offline queue observability reported', {
        workspace_id: workspaceId,
        user_id: req.userId,
        queue_depth: queueDepth.value,
        replay_processed: replayProcessedValue,
        replay_failed: replayFailedValue,
        avg_dwell_ms: avgDwellRaw ?? null,
        max_dwell_ms: maxDwellRaw ?? null,
        p95_dwell_ms: p95DwellRaw ?? null,
        success_rate: successRateRaw ?? null,
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

  /**
   * GET /api/v1/observability/offline_queue/sla?workspace_id=...&window_minutes=60
   * Returns aggregated SLA metrics (avg/p95/max dwell time, success rate) for the
   * rolling window, based on in-memory observability records.
   */
  app.get('/api/v1/observability/offline_queue/sla', authMiddleware, async (req: AuthRequest, res: Response) => {
    const p = pool;
    if (!p || !req.userId) {
      res.status(503).json({ error: 'Database not available' });
      return;
    }

    const workspaceId = typeof req.query.workspace_id === 'string' ? req.query.workspace_id.trim() : '';
    if (!workspaceId) {
      res.status(400).json({ error: 'workspace_id is required' });
      return;
    }

    const windowMinutes = Math.min(
      1440,
      Math.max(1, Number.isFinite(Number(req.query.window_minutes)) ? Number(req.query.window_minutes) : 60)
    );
    const since = new Date(Date.now() - windowMinutes * 60 * 1000);

    try {
      const membership = await p.query(
        `SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1`,
        [workspaceId, req.userId]
      );
      if ((membership.rowCount ?? 0) === 0) {
        res.status(403).json({ error: 'Forbidden: You are not a member of this workspace' });
        return;
      }

      // Pull recent data points from the in-memory observability store
      const filterByWorkspace = (m: import('../services/observability.js').MetricData) =>
        m.tags?.workspace_id === workspaceId && m.timestamp >= since;

      const avgDwellPoints    = observability.getMetrics('offline_queue_avg_dwell_ms', since).filter(filterByWorkspace);
      const maxDwellPoints    = observability.getMetrics('offline_queue_max_dwell_ms', since).filter(filterByWorkspace);
      const p95DwellPoints    = observability.getMetrics('offline_queue_p95_dwell_ms', since).filter(filterByWorkspace);
      const successRatePoints = observability.getMetrics('offline_replay_success_rate', since).filter(filterByWorkspace);
      const depthPoints       = observability.getMetrics('offline_queue_depth', since).filter(filterByWorkspace);

      function avgOf(nums: number[]): number | null {
        if (nums.length === 0) return null;
        return Math.round(nums.reduce((s, v) => s + v, 0) / nums.length);
      }

      res.json({
        workspace_id: workspaceId,
        window_minutes: windowMinutes,
        since: since.toISOString(),
        sample_count: avgDwellPoints.length,
        avg_dwell_ms:  avgOf(avgDwellPoints.map((m) => m.value)),
        max_dwell_ms:  maxDwellPoints.length > 0 ? Math.max(...maxDwellPoints.map((m) => m.value)) : null,
        p95_dwell_ms:  avgOf(p95DwellPoints.map((m) => m.value)),
        success_rate:  successRatePoints.length > 0
          ? Math.round((successRatePoints.reduce((s, m) => s + m.value, 0) / successRatePoints.length) * 1000) / 1000
          : null,
        latest_queue_depth: depthPoints.length > 0
          ? depthPoints[depthPoints.length - 1]!.value
          : null,
      });
    } catch (error) {
      observability.error('SLA query failed', { error, workspace_id: workspaceId });
      res.status(500).json({ error: 'Failed to retrieve SLA metrics' });
    }
  });
}
