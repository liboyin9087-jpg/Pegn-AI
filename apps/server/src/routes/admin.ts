import type { Express, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkWorkspaceCapability } from '../middleware/rbac.js';
import {
  getWorkspaceAdminAlerts,
  getWorkspaceAdminSummary,
  getWorkspaceUsageSummary,
  listWorkspaceAuditLogs,
  type AuditEventType,
} from '../services/admin.js';

function sendApiError(res: Response, status: number, code: string, message: string, details: unknown = null) {
  res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

export function registerAdminRoutes(app: Express): void {
  app.get(
    '/api/v1/workspaces/:workspaceId/admin/summary',
    authMiddleware,
    checkWorkspaceCapability('canManageSettings'),
    async (req: AuthRequest, res: Response) => {
      try {
        const summary = await getWorkspaceAdminSummary(req.params.workspaceId);
        res.json(summary);
      } catch (error) {
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to load admin summary', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.get(
    '/api/v1/workspaces/:workspaceId/audit-logs',
    authMiddleware,
    checkWorkspaceCapability('canManageSettings'),
    async (req: AuthRequest, res: Response) => {
      try {
        const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
        const result = await listWorkspaceAuditLogs({
          workspaceId: req.params.workspaceId,
          eventType: typeof req.query.eventType === 'string' ? req.query.eventType as AuditEventType : null,
          targetType: typeof req.query.targetType === 'string' ? req.query.targetType : null,
          cursor: typeof req.query.cursor === 'string' ? req.query.cursor : null,
          limit: Number.isFinite(limit) ? limit : undefined,
        });
        res.json(result);
      } catch (error) {
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to load audit logs', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.get(
    '/api/v1/workspaces/:workspaceId/usage',
    authMiddleware,
    checkWorkspaceCapability('canManageSettings'),
    async (req: AuthRequest, res: Response) => {
      try {
        const usage = await getWorkspaceUsageSummary(req.params.workspaceId);
        res.json(usage);
      } catch (error) {
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to load usage summary', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.get(
    '/api/v1/workspaces/:workspaceId/admin/alerts',
    authMiddleware,
    checkWorkspaceCapability('canManageSettings'),
    async (req: AuthRequest, res: Response) => {
      try {
        const alerts = await getWorkspaceAdminAlerts(req.params.workspaceId);
        res.json(alerts);
      } catch (error) {
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to load admin alerts', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );
}
