import type { Express, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { recordProductTelemetryEvent, type ProductTelemetryEventName } from '../services/productTelemetry.js';

function sendApiError(res: Response, status: number, code: string, message: string, details: unknown = null) {
  res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

const EVENT_NAMES: ProductTelemetryEventName[] = [
  'search_performed',
  'search_no_result',
  'reindex_triggered',
  'agent_run_created',
  'agent_rerun_clicked',
  'job_retry_clicked',
  'alert_opened',
  'notification_opened',
];

export function registerTelemetryRoutes(app: Express): void {
  app.post('/api/v1/telemetry/events', authMiddleware, async (req: AuthRequest, res: Response) => {
    const eventName = req.body?.event_name;
    const workspaceId = req.body?.workspace_id;
    const surface = req.body?.surface;

    if (!req.userId || typeof eventName !== 'string' || !EVENT_NAMES.includes(eventName as ProductTelemetryEventName)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'event_name is invalid');
      return;
    }
    if (typeof workspaceId !== 'string' || !workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'workspace_id is required');
      return;
    }
    if (!['search', 'agent', 'operations', 'admin', 'document', 'inbox'].includes(surface)) {
      sendApiError(res, 400, 'BAD_REQUEST', 'surface is invalid');
      return;
    }

    try {
      await recordProductTelemetryEvent({
        eventName: eventName as ProductTelemetryEventName,
        workspaceId,
        userId: req.userId,
        surface,
        targetType: typeof req.body?.target_type === 'string' ? req.body.target_type : null,
        targetId: typeof req.body?.target_id === 'string' ? req.body.target_id : null,
        metadata: req.body?.metadata && typeof req.body.metadata === 'object'
          ? req.body.metadata as Record<string, unknown>
          : {},
      });
      res.status(202).json({ accepted: true });
    } catch (error) {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to record telemetry event', error instanceof Error ? error.message : 'Unknown error');
    }
  });
}
