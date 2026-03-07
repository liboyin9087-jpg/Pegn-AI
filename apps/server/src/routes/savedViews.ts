import type { Express, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkWorkspaceCapability, type RBACRequest } from '../middleware/rbac.js';
import {
  createSavedView,
  deleteSavedView,
  getSavedView,
  listSavedViews,
  updateSavedView,
  type SavedViewScope,
  type SavedViewSurface,
} from '../services/savedViews.js';

function sendApiError(res: Response, status: number, code: string, message: string, details: unknown = null) {
  res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

export function registerSavedViewRoutes(app: Express): void {
  app.get(
    '/api/v1/workspaces/:workspaceId/saved-views',
    authMiddleware,
    checkWorkspaceCapability('canViewWorkspace'),
    async (req: RBACRequest, res: Response) => {
      try {
        const result = await listSavedViews({
          workspaceId: req.params.workspaceId,
          userId: req.userId!,
          surface: typeof req.query.surface === 'string' ? req.query.surface as SavedViewSurface : null,
          scope: typeof req.query.scope === 'string' ? req.query.scope as SavedViewScope : null,
          includePinned: req.query.includePinned === 'true',
        });
        res.json(result);
      } catch (error) {
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to load saved views', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.get(
    '/api/v1/workspaces/:workspaceId/saved-views/:viewId',
    authMiddleware,
    checkWorkspaceCapability('canViewWorkspace'),
    async (req: RBACRequest, res: Response) => {
      try {
        const view = await getSavedView(req.params.workspaceId, req.params.viewId, req.userId!);
        if (!view) {
          sendApiError(res, 404, 'NOT_FOUND', 'Saved view not found');
          return;
        }
        res.json(view);
      } catch (error) {
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to load saved view', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.post(
    '/api/v1/workspaces/:workspaceId/saved-views',
    authMiddleware,
    checkWorkspaceCapability('canViewWorkspace'),
    async (req: RBACRequest, res: Response) => {
      try {
        const scope = req.body?.scope as SavedViewScope;
        const created = await createSavedView({
          workspaceId: req.params.workspaceId,
          ownerUserId: req.userId!,
          scope,
          surface: req.body?.surface as SavedViewSurface,
          name: req.body?.name,
          description: req.body?.description,
          payload: req.body?.payload,
          isPinned: req.body?.isPinned,
          isDefault: req.body?.isDefault,
          canManageWorkspaceViews: Boolean(req.workspacePermissions?.canManageSettings),
        });
        res.status(201).json(created);
      } catch (error) {
        if (error instanceof Error && error.message === 'FORBIDDEN') {
          sendApiError(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action');
          return;
        }
        if (error instanceof Error && error.message.toLowerCase().includes('invalid')) {
          sendApiError(res, 400, 'BAD_REQUEST', error.message);
          return;
        }
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to create saved view', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.put(
    '/api/v1/workspaces/:workspaceId/saved-views/:viewId',
    authMiddleware,
    checkWorkspaceCapability('canViewWorkspace'),
    async (req: RBACRequest, res: Response) => {
      try {
        const updated = await updateSavedView({
          workspaceId: req.params.workspaceId,
          viewId: req.params.viewId,
          userId: req.userId!,
          name: req.body?.name,
          description: req.body?.description,
          payload: req.body?.payload,
          isPinned: req.body?.isPinned,
          isDefault: req.body?.isDefault,
          canManageWorkspaceViews: Boolean(req.workspacePermissions?.canManageSettings),
        });
        if (!updated) {
          sendApiError(res, 404, 'NOT_FOUND', 'Saved view not found');
          return;
        }
        res.json(updated);
      } catch (error) {
        if (error instanceof Error && error.message === 'FORBIDDEN') {
          sendApiError(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action');
          return;
        }
        if (error instanceof Error && error.message.toLowerCase().includes('invalid')) {
          sendApiError(res, 400, 'BAD_REQUEST', error.message);
          return;
        }
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to update saved view', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.delete(
    '/api/v1/workspaces/:workspaceId/saved-views/:viewId',
    authMiddleware,
    checkWorkspaceCapability('canViewWorkspace'),
    async (req: RBACRequest, res: Response) => {
      try {
        const deleted = await deleteSavedView({
          workspaceId: req.params.workspaceId,
          viewId: req.params.viewId,
          userId: req.userId!,
          canManageWorkspaceViews: Boolean(req.workspacePermissions?.canManageSettings),
        });
        if (!deleted) {
          sendApiError(res, 404, 'NOT_FOUND', 'Saved view not found');
          return;
        }
        res.status(204).send();
      } catch (error) {
        if (error instanceof Error && error.message === 'FORBIDDEN') {
          sendApiError(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action');
          return;
        }
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to delete saved view', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );
}
