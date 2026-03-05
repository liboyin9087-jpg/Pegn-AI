import type { Express, Response } from 'express';
import { WorkspaceModel } from '../models/workspace.js';
import { observability } from '../services/observability.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { auditLog } from '../services/audit.js';
import { queryAuditLogs } from '../services/audit.js';

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
      await auditLog({ workspaceId: workspace.id, actorUserId: req.userId, action: 'workspace.created', resourceType: 'workspace', resourceId: workspace.id, newValue: { name }, req });
      res.status(201).json(workspace);
    } catch (error) {
      observability.error('Workspace creation failed', { error: String(error) });
      res.status(500).json({ error: 'Failed to create workspace' });
    }
  });

  // Get workspace by ID (owner check via RBAC)
  app.get('/api/v1/workspaces/:workspaceId', authMiddleware, checkPermission('workspace:admin'), async (req: AuthRequest, res: Response) => {
    try {
      const workspace = await WorkspaceModel.findById(req.params.workspaceId);
      if (!workspace) { res.status(404).json({ error: 'Workspace not found' }); return; }
      res.json(workspace);
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
        `SELECT w.* FROM workspaces w
         JOIN workspace_members m ON w.id = m.workspace_id
         WHERE m.user_id = $1
         ORDER BY w.updated_at DESC
         LIMIT $2 OFFSET $3`,
        [req.userId, parseInt(limit as string), parseInt(offset as string)]
      );
      res.json({ workspaces: result.rows });
    } catch {
      res.status(500).json({ error: 'Failed to list workspaces' });
    }
  });

  // Update workspace (admin only)
  app.put('/api/v1/workspaces/:workspaceId', authMiddleware, checkPermission('workspace:admin'), async (req: AuthRequest, res: Response) => {
    try {
      const { name, description, settings } = req.body;
      const workspace = await WorkspaceModel.update(req.params.workspaceId, { name, description, settings });
      res.json(workspace);
    } catch {
      res.status(500).json({ error: 'Failed to update workspace' });
    }
  });

  // Delete workspace (admin only)
  app.delete('/api/v1/workspaces/:workspaceId', authMiddleware, checkPermission('workspace:admin'), async (req: AuthRequest, res: Response) => {
    try {
      await auditLog({ workspaceId: req.params.workspaceId, actorUserId: req.userId, action: 'workspace.deleted', resourceType: 'workspace', resourceId: req.params.workspaceId, req });
      await WorkspaceModel.delete(req.params.workspaceId);
      res.json({ message: 'Workspace deleted', workspaceId: req.params.workspaceId });
    } catch {
      res.status(500).json({ error: 'Failed to delete workspace' });
    }
  });

  // Get audit logs for workspace (admin only) — supports ?format=json|csv download
  app.get('/api/v1/workspaces/:workspaceId/audit-logs', authMiddleware, checkPermission('workspace:admin'), async (req: AuthRequest, res: Response) => {
    try {
      const { action, limit, before, format } = req.query as Record<string, string>;
      const logs = await queryAuditLogs(req.params.workspaceId, {
        action,
        limit: limit ? Math.min(parseInt(limit), 500) : 100,
        before,
      });

      if (format === 'csv') {
        const headers = ['id', 'action', 'actor_user_id', 'resource_type', 'resource_id', 'ip_address', 'created_at'];
        const escape = (v: any) => {
          const s = String(v ?? '');
          return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const csv = [
          headers.join(','),
          ...logs.map(r => headers.map(h => escape(r[h])).join(',')),
        ].join('\n');
        const filename = `audit-logs-${req.params.workspaceId}-${new Date().toISOString().slice(0,10)}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
        return;
      }

      if (format === 'json') {
        const filename = `audit-logs-${req.params.workspaceId}-${new Date().toISOString().slice(0,10)}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.json({ workspace_id: req.params.workspaceId, exported_at: new Date().toISOString(), total: logs.length, logs });
        return;
      }

      res.json({ logs });
    } catch {
      res.status(500).json({ error: 'Failed to fetch audit logs' });
    }
  });

  // Track onboarding progress
  app.post('/api/v1/workspaces/:workspaceId/onboarding', authMiddleware, async (req: AuthRequest, res: Response) => {
    const { step, completed } = req.body as { step?: number; completed?: boolean };
    if (step === undefined || typeof step !== 'number') {
      res.status(400).json({ error: 'step (number) required' });
      return;
    }
    try {
      const { pool } = await import('../db/client.js');
      if (!pool) { res.status(503).json({ error: 'DB not available' }); return; }
      const result = await pool.query(
        `INSERT INTO onboarding_progress (workspace_id, user_id, last_step, completed_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (workspace_id, user_id)
         DO UPDATE SET last_step = GREATEST(onboarding_progress.last_step, EXCLUDED.last_step),
                       completed_at = COALESCE(onboarding_progress.completed_at, EXCLUDED.completed_at),
                       updated_at = NOW()
         RETURNING *`,
        [req.params.workspaceId, req.userId, step, completed ? new Date() : null]
      );
      res.json(result.rows[0]);
    } catch {
      res.status(500).json({ error: 'Failed to update onboarding progress' });
    }
  });

  // Get onboarding progress for workspace
  app.get('/api/v1/workspaces/:workspaceId/onboarding', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { pool } = await import('../db/client.js');
      if (!pool) { res.json({ last_step: 0, completed: false }); return; }
      const result = await pool.query(
        'SELECT * FROM onboarding_progress WHERE workspace_id = $1 AND user_id = $2',
        [req.params.workspaceId, req.userId]
      );
      if (!result.rows[0]) { res.json({ last_step: 0, completed: false }); return; }
      res.json({ last_step: result.rows[0].last_step, completed: !!result.rows[0].completed_at });
    } catch {
      res.status(500).json({ error: 'Failed to get onboarding progress' });
    }
  });
}
