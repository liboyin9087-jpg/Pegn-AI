import type { Express, Response } from 'express';
import { WorkspaceModel } from '../models/workspace.js';
import { observability } from '../services/observability.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';

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
      observability.info('Workspace created', { workspaceId: workspace.id, duration: Date.now() - startTime });
      res.status(201).json(workspace);
    } catch (error) {
      observability.error('Workspace creation failed', { error: String(error) });
      res.status(500).json({ error: 'Failed to create workspace' });
    }
  });

  // Get workspace by ID (owner check)
  app.get('/api/v1/workspaces/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const workspace = await WorkspaceModel.findById(req.params.id);
      if (!workspace) { res.status(404).json({ error: 'Workspace not found' }); return; }
      if (workspace.created_by !== req.userId) { res.status(403).json({ error: 'Forbidden' }); return; }
      res.json(workspace);
    } catch {
      res.status(500).json({ error: 'Failed to get workspace' });
    }
  });

  // List workspaces (only mine)
  app.get('/api/v1/workspaces', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const { limit = 50, offset = 0 } = req.query;
      const all = await WorkspaceModel.findAll(parseInt(limit as string), parseInt(offset as string));
      const mine = all.filter((w: any) => w.created_by === req.userId);
      res.json({ workspaces: mine });
    } catch {
      res.status(500).json({ error: 'Failed to list workspaces' });
    }
  });

  // Update workspace (owner only)
  app.put('/api/v1/workspaces/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const existing = await WorkspaceModel.findById(req.params.id);
      if (!existing) { res.status(404).json({ error: 'Workspace not found' }); return; }
      if (existing.created_by !== req.userId) { res.status(403).json({ error: 'Forbidden' }); return; }
      const { name, description, settings } = req.body;
      const workspace = await WorkspaceModel.update(req.params.id, { name, description, settings });
      res.json(workspace);
    } catch {
      res.status(500).json({ error: 'Failed to update workspace' });
    }
  });

  // Delete workspace (owner only)
  app.delete('/api/v1/workspaces/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const existing = await WorkspaceModel.findById(req.params.id);
      if (!existing) { res.status(404).json({ error: 'Workspace not found' }); return; }
      if (existing.created_by !== req.userId) { res.status(403).json({ error: 'Forbidden' }); return; }
      await WorkspaceModel.delete(req.params.id);
      res.json({ message: 'Workspace deleted', workspaceId: req.params.id });
    } catch {
      res.status(500).json({ error: 'Failed to delete workspace' });
    }
  });
}
