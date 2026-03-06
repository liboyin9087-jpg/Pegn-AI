import type { Express, Response } from 'express';
import { WorkspaceModel } from '../models/workspace.js';
import { observability } from '../services/observability.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkWorkspaceCapability } from '../middleware/rbac.js';
import { getWorkspaceMembershipSummary } from '../lib/workspaceRoles.js';

function withGovernanceSummary<T extends Record<string, any>>(workspace: T, membership: ReturnType<typeof getWorkspaceMembershipSummary>) {
  if (!membership) return workspace;
  return {
    ...workspace,
    effectiveRole: membership.effectiveRole,
    permissions: membership.permissions,
    permissionSummary: membership.permissionSummary,
  };
}

export function registerWorkspaceRoutes(app: Express): void {

  // Create workspace (auth required)
  app.post('/api/v1/workspaces', authMiddleware, async (req: AuthRequest, res: Response) => {
    const startTime = Date.now();
    try {
      const { name, description, settings } = req.body;
      if (!name || typeof name !== 'string') {
        res.status(400).json({ error: 'Workspace name is required' });
        return;
      }
      const workspace = await WorkspaceModel.create({
        name,
        description,
        created_by: req.userId,
        settings,
      });

      // Automatically add the creator as owner in workspace_members
      const { pool } = await import('../db/client.js');
      if (pool) {
        await pool.query(
          'INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)',
          [workspace.id, req.userId, 'owner']
        );
      }

      observability.info('Workspace created', { workspaceId: workspace.id, duration: Date.now() - startTime });
      res.status(201).json(withGovernanceSummary(workspace, getWorkspaceMembershipSummary({
        legacyWorkspaceRole: 'owner',
      })));
    } catch (error) {
      observability.error('Workspace creation failed', { error: String(error) });
      res.status(500).json({ error: 'Failed to create workspace' });
    }
  });

  app.get('/api/v1/workspaces/:workspaceId', authMiddleware, checkWorkspaceCapability('canViewWorkspace'), async (req: AuthRequest, res: Response) => {
    try {
      const workspace = await WorkspaceModel.findById(req.params.workspaceId);
      if (!workspace) { res.status(404).json({ error: 'Workspace not found' }); return; }
      res.json(withGovernanceSummary(workspace, req.workspaceMembershipSummary ?? null));
    } catch {
      res.status(500).json({ error: 'Failed to get workspace' });
    }
  });

  // List workspaces (only those I am a member of)
  app.get('/api/v1/workspaces', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { limit = 50, offset = 0 } = req.query;
      const { pool } = await import('../db/client.js');
      if (!pool) throw new Error('DB not available');

      // Query through workspace_members instead of scanning all workspaces
      const result = await pool.query(
        `SELECT
            w.*,
            m.role AS legacy_role,
            r.name AS role_name,
            r.permissions
         FROM workspaces w
         JOIN workspace_members m ON w.id = m.workspace_id
         LEFT JOIN roles r ON r.id = m.role_id
         WHERE m.user_id = $1
         ORDER BY w.updated_at DESC
         LIMIT $2 OFFSET $3`,
        [req.userId, parseInt(limit as string), parseInt(offset as string)]
      );
      res.json({
        workspaces: result.rows.map((workspace) => withGovernanceSummary(
          workspace,
          getWorkspaceMembershipSummary({
            roleName: workspace.role_name,
            legacyWorkspaceRole: workspace.legacy_role,
            permissions: workspace.permissions,
          })
        )),
      });
    } catch {
      res.status(500).json({ error: 'Failed to list workspaces' });
    }
  });

  app.put('/api/v1/workspaces/:workspaceId', authMiddleware, checkWorkspaceCapability('canManageSettings'), async (req: AuthRequest, res: Response) => {
    try {
      const { name, description, settings } = req.body;
      const workspace = await WorkspaceModel.update(req.params.workspaceId, { name, description, settings });
      if (!workspace) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }
      res.json(withGovernanceSummary(workspace, req.workspaceMembershipSummary ?? null));
    } catch {
      res.status(500).json({ error: 'Failed to update workspace' });
    }
  });

  app.delete('/api/v1/workspaces/:workspaceId', authMiddleware, checkWorkspaceCapability('canManageSettings'), async (req: AuthRequest, res: Response) => {
    try {
      await WorkspaceModel.delete(req.params.workspaceId);
      res.json({ message: 'Workspace deleted', workspaceId: req.params.workspaceId });
    } catch {
      res.status(500).json({ error: 'Failed to delete workspace' });
    }
  });
}
