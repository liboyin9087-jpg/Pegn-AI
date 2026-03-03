import type { Express, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { getWorkspaceIdFromRequest } from '../services/request.js';
import { getWorkspaceUsage, checkQuota, getAvailablePlans, getWorkspacePlan, setWorkspacePlan, checkCostAlert } from '../services/quota.js';

export function registerBillingRoutes(app: Express): void {
  // Get available billing plans and quotas
  app.get('/api/v1/billing/plans', authMiddleware, (_req: Request, res: Response) => {
    res.json({ plans: getAvailablePlans() });
  });

  // Get current workspace plan
  app.get('/api/v1/billing/plan', authMiddleware, checkPermission('workspace:admin'), async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    if (!workspaceId) { res.status(400).json({ error: 'workspace_id required' }); return; }

    try {
      const plan = await getWorkspacePlan(workspaceId);
      res.json(plan);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch current plan' });
    }
  });

  // Set workspace billing plan
  app.post('/api/v1/billing/plan', authMiddleware, checkPermission('workspace:admin'), async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    const { plan } = req.body as { plan?: string };
    if (!workspaceId || !plan) {
      res.status(400).json({ error: 'workspace_id and plan required' });
      return;
    }

    try {
      const updated = await setWorkspacePlan(workspaceId, plan);
      res.json(updated);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid plan')) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to update billing plan' });
    }
  });

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

  // P2-2: 成本告警 — 查詢當月 token 花費占比，超過 80% 回傳 warning:true
  app.get('/api/v1/billing/cost-alert', authMiddleware, async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    if (!workspaceId) { res.status(400).json({ error: 'workspace_id required' }); return; }

    try {
      const alert = await checkCostAlert(workspaceId);
      res.json(alert);
    } catch (error) {
      res.status(500).json({ error: 'Failed to check cost alert' });
    }
  });
}
