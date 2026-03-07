import type { Express, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkWorkspaceCapability } from '../middleware/rbac.js';
import { observability } from '../services/observability.js';
import {
  getInboxWorkspaceScope,
  listInboxNotifications,
  markAllInboxNotificationsRead,
  markInboxNotificationRead,
} from '../services/inboxService.js';

function sendApiError(res: Response, status: number, code: string, message: string, details: unknown = null) {
  res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

export function registerInboxRoutes(app: Express): void {
  app.get('/api/v1/inbox/notifications', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!req.userId) {
      sendApiError(res, 401, 'FORBIDDEN', 'Unauthorized');
      return;
    }

    try {
      const status = req.query.status === 'all' ? 'all' : 'unread';
      const workspaceId = getInboxWorkspaceScope(req);
      const response = await listInboxNotifications({
        userId: req.userId,
        workspaceId,
        status,
      });
      res.json(response);
    } catch (error) {
      observability.error('List inbox notifications failed', { error, user_id: req.userId });
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to list inbox notifications', error instanceof Error ? error.message : 'Unknown error');
    }
  });

  app.patch(
    '/api/v1/inbox/notifications/:notification_id/read',
    authMiddleware,
    checkWorkspaceCapability('canViewWorkspace', 'inbox_notification'),
    async (req: AuthRequest, res: Response) => {
      if (!req.userId) {
        sendApiError(res, 401, 'FORBIDDEN', 'Unauthorized');
        return;
      }

      try {
        const notification = await markInboxNotificationRead(req.params.notification_id, req.userId);
        if (!notification) {
          sendApiError(res, 404, 'NOT_FOUND', 'Notification not found');
          return;
        }
        res.json({ notification });
      } catch (error) {
        observability.error('Mark inbox notification read failed', {
          error,
          user_id: req.userId,
          notification_id: req.params.notification_id,
        });
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to mark notification as read', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.patch('/api/v1/inbox/notifications/read_all', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!req.userId) {
      sendApiError(res, 401, 'FORBIDDEN', 'Unauthorized');
      return;
    }

    try {
      const workspaceId = typeof req.body?.workspace_id === 'string'
        ? req.body.workspace_id
        : typeof req.query.workspace_id === 'string'
          ? req.query.workspace_id
          : null;
      const updated = await markAllInboxNotificationsRead(req.userId, workspaceId);
      res.json({ updated });
    } catch (error) {
      observability.error('Mark all notifications read failed', { error, user_id: req.userId });
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to mark all notifications as read', error instanceof Error ? error.message : 'Unknown error');
    }
  });
}
