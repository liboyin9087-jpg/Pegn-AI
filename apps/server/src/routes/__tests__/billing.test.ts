import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// P2-3: billing route 回歸測試矩陣

const mockGetAvailablePlans = vi.fn();
const mockGetWorkspacePlan = vi.fn();
const mockSetWorkspacePlan = vi.fn();
const mockGetWorkspaceUsage = vi.fn();
const mockCheckQuota = vi.fn();
const mockCheckCostAlert = vi.fn();

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = 'user-1';
    req.workspaceId = 'ws-1';
    next();
  },
}));

vi.mock('../../middleware/rbac.js', () => ({
  checkPermission: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/request.js', () => ({
  getWorkspaceIdFromRequest: (req: any) => req.workspaceId ?? req.query?.workspace_id ?? null,
}));

vi.mock('../../services/quota.js', () => ({
  getAvailablePlans: mockGetAvailablePlans,
  getWorkspacePlan: mockGetWorkspacePlan,
  setWorkspacePlan: mockSetWorkspacePlan,
  getWorkspaceUsage: mockGetWorkspaceUsage,
  checkQuota: mockCheckQuota,
  checkCostAlert: mockCheckCostAlert,
}));

async function createApp() {
  const { registerBillingRoutes } = await import('../billing.js');
  const app = express();
  app.use(express.json());
  registerBillingRoutes(app);
  return app;
}

describe('billing routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/v1/billing/plans', () => {
    it('returns available plans', async () => {
      mockGetAvailablePlans.mockReturnValue({
        free: { ai_tokens_per_month: 100000 },
        pro: { ai_tokens_per_month: 1000000 },
      });

      const app = await createApp();
      const res = await request(app).get('/api/v1/billing/plans');

      expect(res.status).toBe(200);
      expect(res.body.plans).toBeDefined();
      expect(res.body.plans.free).toBeDefined();
    });
  });

  describe('GET /api/v1/billing/plan', () => {
    it('returns current workspace plan', async () => {
      mockGetWorkspacePlan.mockResolvedValue({
        plan: 'pro',
        quotas: { ai_tokens_per_month: 1000000, ai_calls_per_day: 2000, agent_runs_per_day: 200 },
      });

      const app = await createApp();
      const res = await request(app).get('/api/v1/billing/plan');

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('pro');
      expect(mockGetWorkspacePlan).toHaveBeenCalledWith('ws-1');
    });

    it('returns 500 when service throws', async () => {
      mockGetWorkspacePlan.mockRejectedValue(new Error('DB connection failed'));

      const app = await createApp();
      const res = await request(app).get('/api/v1/billing/plan');

      expect(res.status).toBe(500);
      expect(res.body.error).toContain('Failed to fetch current plan');
    });
  });

  describe('GET /api/v1/billing/usage', () => {
    it('returns workspace quota usage including cost_estimate_usd', async () => {
      mockGetWorkspaceUsage.mockResolvedValue({
        plan: 'free',
        quotas: {
          ai_tokens: { limit: 100000, used: 10000, remaining: 90000, period: '2025-01', cost_estimate_usd: 0.001 },
          ai_calls: { limit: 200, used: 5, remaining: 195, period: '2025-01-15' },
          agent_runs: { limit: 20, used: 2, remaining: 18, period: '2025-01-15' },
        },
      });

      const app = await createApp();
      const res = await request(app).get('/api/v1/billing/usage');

      expect(res.status).toBe(200);
      expect(res.body.plan).toBe('free');
      expect(res.body.quotas.ai_tokens.cost_estimate_usd).toBeDefined();
      expect(mockGetWorkspaceUsage).toHaveBeenCalledWith('ws-1');
    });
  });

  describe('GET /api/v1/billing/quota', () => {
    it('returns quota status for valid resource', async () => {
      mockCheckQuota.mockResolvedValue({ allowed: true, used: 10, limit: 200, remaining: 190 });

      const app = await createApp();
      const res = await request(app).get('/api/v1/billing/quota?resource=ai_calls');

      expect(res.status).toBe(200);
      expect(res.body.allowed).toBe(true);
    });

    it('returns 400 for invalid resource type', async () => {
      const app = await createApp();
      const res = await request(app).get('/api/v1/billing/quota?resource=magic_credits');

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('resource must be one of');
    });

    it('returns 400 when resource param is missing', async () => {
      const app = await createApp();
      const res = await request(app).get('/api/v1/billing/quota');

      expect(res.status).toBe(400);
    });
  });

  // P2-2: cost-alert endpoint 回歸測試
  describe('GET /api/v1/billing/cost-alert', () => {
    it('returns cost alert data with warning=false when below threshold', async () => {
      mockCheckCostAlert.mockResolvedValue({
        workspace_id: 'ws-1',
        pct: 0.45,
        warning: false,
        cost_usd: 0.0045,
        budget_usd: 0.01,
        remaining_usd: 0.0055,
        period: '2025-01',
      });

      const app = await createApp();
      const res = await request(app).get('/api/v1/billing/cost-alert');

      expect(res.status).toBe(200);
      expect(res.body.warning).toBe(false);
      expect(res.body.pct).toBe(0.45);
      expect(res.body.cost_usd).toBeGreaterThanOrEqual(0);
      expect(mockCheckCostAlert).toHaveBeenCalledWith('ws-1');
    });

    it('returns warning=true when cost exceeds 80% of budget', async () => {
      mockCheckCostAlert.mockResolvedValue({
        workspace_id: 'ws-1',
        pct: 0.87,
        warning: true,
        cost_usd: 0.0087,
        budget_usd: 0.01,
        remaining_usd: 0.0013,
        period: '2025-01',
      });

      const app = await createApp();
      const res = await request(app).get('/api/v1/billing/cost-alert');

      expect(res.status).toBe(200);
      expect(res.body.warning).toBe(true);
      expect(res.body.pct).toBeGreaterThanOrEqual(0.8);
    });

    it('returns 500 when service throws', async () => {
      mockCheckCostAlert.mockRejectedValue(new Error('Query failed'));

      const app = await createApp();
      const res = await request(app).get('/api/v1/billing/cost-alert');

      expect(res.status).toBe(500);
    });
  });
});
