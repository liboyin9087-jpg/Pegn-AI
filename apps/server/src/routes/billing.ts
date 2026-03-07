import type { Express, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { getWorkspaceIdFromRequest } from '../services/request.js';
import { checkQuota, updateQuotaLimits, type ResourceType } from '../services/quota.js';
import { getWorkspaceUsageSummary } from '../services/admin.js';

function sendApiError(res: Response, status: number, code: string, message: string, details: unknown = null) {
  res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

export function registerBillingRoutes(app: Express): void {
  // Get workspace usage & quota status
  app.get('/api/v1/billing/usage', authMiddleware, checkPermission('workspace:admin'), async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    if (!workspaceId) { sendApiError(res, 400, 'BAD_REQUEST', 'workspace_id required'); return; }

    try {
      const usage = await getWorkspaceUsageSummary(workspaceId);
      res.json(usage);
    } catch (error) {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to fetch usage data', error instanceof Error ? error.message : 'Unknown error');
    }
  });

  // Check quota for a specific resource (used by client before heavy operations)
  app.get('/api/v1/billing/quota', authMiddleware, async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    const { resource } = req.query as { resource?: string };
    if (!workspaceId || !resource) { sendApiError(res, 400, 'BAD_REQUEST', 'workspace_id and resource required'); return; }

    const validResources: ResourceType[] = ['ai_tokens', 'ai_calls', 'agent_runs'];
    if (!validResources.includes(resource as ResourceType)) {
      sendApiError(res, 400, 'BAD_REQUEST', `resource must be one of: ${validResources.join(', ')}`);
      return;
    }

    try {
      const quota = await checkQuota(workspaceId, resource as ResourceType);
      res.json(quota);
    } catch (error) {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to check quota', error instanceof Error ? error.message : 'Unknown error');
    }
  });

  /**
   * PUT /api/v1/billing/quota — P2-2: Admin updates quota limits for a workspace.
   * Body: { ai_tokens_per_month?, ai_calls_per_day?, agent_runs_per_day?, cost_usd_ceiling? }
   */
  app.put('/api/v1/billing/quota', authMiddleware, checkPermission('workspace:admin'), async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    if (!workspaceId) { sendApiError(res, 400, 'BAD_REQUEST', 'workspace_id required'); return; }

    const { ai_tokens_per_month, ai_calls_per_day, agent_runs_per_day, cost_usd_ceiling } = req.body ?? {};

    // Validate: all present values must be non-negative numbers (cost_usd_ceiling may be null)
    const numFields = { ai_tokens_per_month, ai_calls_per_day, agent_runs_per_day };
    for (const [key, val] of Object.entries(numFields)) {
      if (val !== undefined && (typeof val !== 'number' || !Number.isFinite(val) || val < 0)) {
        sendApiError(res, 400, 'BAD_REQUEST', `${key} must be a non-negative number`);
        return;
      }
    }
    if (cost_usd_ceiling !== undefined && cost_usd_ceiling !== null) {
      if (typeof cost_usd_ceiling !== 'number' || !Number.isFinite(cost_usd_ceiling) || cost_usd_ceiling < 0) {
        sendApiError(res, 400, 'BAD_REQUEST', 'cost_usd_ceiling must be a non-negative number or null');
        return;
      }
    }

    if (
      ai_tokens_per_month === undefined &&
      ai_calls_per_day === undefined &&
      agent_runs_per_day === undefined &&
      cost_usd_ceiling === undefined
    ) {
      sendApiError(res, 400, 'BAD_REQUEST', 'No valid fields provided');
      return;
    }

    try {
      await updateQuotaLimits(workspaceId, { ai_tokens_per_month, ai_calls_per_day, agent_runs_per_day, cost_usd_ceiling });
      const updated = await getWorkspaceUsageSummary(workspaceId);
      res.json({ updated: true, ...updated });
    } catch (error) {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to update quota limits', error instanceof Error ? error.message : 'Unknown error');
    }
  });
}
