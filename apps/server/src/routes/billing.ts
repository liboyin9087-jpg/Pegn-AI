import type { Express, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { getWorkspaceIdFromRequest } from '../services/request.js';
import { getWorkspaceUsage, checkQuota } from '../services/quota.js';

export function registerBillingRoutes(app: Express): void {
  // Get workspace usage & quota status
  app.get('/api/v1/billing/usage', authMiddleware, checkPermission('workspace:admin'), async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    if (!workspaceId) { res.status(400).json({ error: 'workspace_id required' }); return; }

    try {
      const usage = await getWorkspaceUsage(workspaceId);
      res.json(usage);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch usage data' });
    }
  });

  // Check quota for a specific resource (used by client before heavy operations)
  app.get('/api/v1/billing/quota', authMiddleware, async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    const { resource } = req.query as { resource?: string };
    if (!workspaceId || !resource) { res.status(400).json({ error: 'workspace_id and resource required' }); return; }

    const validResources = ['ai_tokens', 'ai_calls', 'agent_runs'];
    if (!validResources.includes(resource)) {
      res.status(400).json({ error: `resource must be one of: ${validResources.join(', ')}` });
      return;
    }

    try {
      const quota = await checkQuota(workspaceId, resource as any);
      res.json(quota);
    } catch (error) {
      res.status(500).json({ error: 'Failed to check quota' });
    }
  });
}
