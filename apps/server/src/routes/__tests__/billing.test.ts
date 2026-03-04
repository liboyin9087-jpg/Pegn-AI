import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '../../middleware/auth.js';

/* ── DB mock ─────────────────────────────────────────────── */
const mockPool = { query: vi.fn() };
vi.mock('../../db/client.js', () => ({ pool: mockPool }));

/* ── Service mocks ───────────────────────────────────────── */
const mockGetWorkspaceUsage = vi.fn();
const mockCheckQuota = vi.fn();
const mockUpdateQuotaLimits = vi.fn();
vi.mock('../../services/quota.js', () => ({
  getWorkspaceUsage: (...args: any[]) => mockGetWorkspaceUsage(...args),
  checkQuota: (...args: any[]) => mockCheckQuota(...args),
  updateQuotaLimits: (...args: any[]) => mockUpdateQuotaLimits(...args),
}));

/* ── Helpers ─────────────────────────────────────────────── */
type Role = 'admin' | 'member';

function setupMember(userId: string, wsId: string, role: Role = 'member') {
  mockPool.query.mockImplementation(async (sql: string, params: any[] = []) => {
    const norm = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (norm.includes('workspace_members')) {
      return { rows: [{ ok: 1 }] };
    }
    if (norm.includes('role_permissions') || norm.includes('permissions')) {
      // allow workspace:admin permission only for admin role
      if (role === 'admin') return { rows: [{ ok: 1 }] };
      return { rows: [] };
    }
    return { rows: [] };
  });
}

async function createApp() {
  const { registerBillingRoutes } = await import('../billing.js');
  const app = express();
  app.use(express.json());
  registerBillingRoutes(app);
  return app;
}

/* ── GET /api/v1/billing/usage ───────────────────────────── */
describe('GET /api/v1/billing/usage', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with usage data for admin', async () => {
    setupMember('admin-user', 'ws-1', 'admin');
    mockGetWorkspaceUsage.mockResolvedValue({
      ai_tokens: { used: 1000, limit: 100000 },
      ai_calls: { used: 5, limit: 500 },
      agent_runs: { used: 2, limit: 50 },
      cost_usd: 0.01,
      cost_usd_ceiling: null,
    });
    const app = await createApp();
    const token = signToken('admin-user', 'admin@example.com');

    const res = await request(app)
      .get('/api/v1/billing/usage?workspace_id=ws-1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ai_tokens');
    expect(mockGetWorkspaceUsage).toHaveBeenCalledWith('ws-1');
  });

  it('returns 403 for non-admin member', async () => {
    setupMember('plain-user', 'ws-1', 'member');
    const app = await createApp();
    const token = signToken('plain-user', 'plain@example.com');

    const res = await request(app)
      .get('/api/v1/billing/usage?workspace_id=ws-1')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('returns 400 when workspace_id is missing', async () => {
    setupMember('admin-user', 'ws-1', 'admin');
    const app = await createApp();
    const token = signToken('admin-user', 'admin@example.com');

    const res = await request(app)
      .get('/api/v1/billing/usage')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});

/* ── GET /api/v1/billing/quota ───────────────────────────── */
describe('GET /api/v1/billing/quota', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with quota status for valid resource', async () => {
    setupMember('user-q', 'ws-2');
    mockCheckQuota.mockResolvedValue({ allowed: true, used: 3, limit: 50, resource: 'agent_runs' });
    const app = await createApp();
    const token = signToken('user-q', 'q@example.com');

    const res = await request(app)
      .get('/api/v1/billing/quota?workspace_id=ws-2&resource=agent_runs')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ allowed: true, resource: 'agent_runs' });
  });

  it('returns 400 for invalid resource type', async () => {
    setupMember('user-q', 'ws-2');
    const app = await createApp();
    const token = signToken('user-q', 'q@example.com');

    const res = await request(app)
      .get('/api/v1/billing/quota?workspace_id=ws-2&resource=invalid_resource')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/resource must be one of/i);
  });

  it('returns 400 when resource param is missing', async () => {
    setupMember('user-q', 'ws-2');
    const app = await createApp();
    const token = signToken('user-q', 'q@example.com');

    const res = await request(app)
      .get('/api/v1/billing/quota?workspace_id=ws-2')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });
});

/* ── PUT /api/v1/billing/quota ───────────────────────────── */
describe('PUT /api/v1/billing/quota', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 after updating quota limits (admin)', async () => {
    setupMember('admin-user', 'ws-3', 'admin');
    mockUpdateQuotaLimits.mockResolvedValue(undefined);
    mockGetWorkspaceUsage.mockResolvedValue({
      ai_tokens: { used: 0, limit: 200000 },
      cost_usd_ceiling: 5.0,
    });
    const app = await createApp();
    const token = signToken('admin-user', 'admin@example.com');

    const res = await request(app)
      .put('/api/v1/billing/quota')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workspace_id: 'ws-3',
        ai_tokens_per_month: 200000,
        cost_usd_ceiling: 5.0,
      });

    expect(res.status).toBe(200);
    expect(mockUpdateQuotaLimits).toHaveBeenCalledWith(
      'ws-3',
      expect.objectContaining({ ai_tokens_per_month: 200000, cost_usd_ceiling: 5.0 }),
    );
  });

  it('returns 400 if no valid fields are provided', async () => {
    setupMember('admin-user', 'ws-3', 'admin');
    const app = await createApp();
    const token = signToken('admin-user', 'admin@example.com');

    const res = await request(app)
      .put('/api/v1/billing/quota')
      .set('Authorization', `Bearer ${token}`)
      .send({ workspace_id: 'ws-3' }); // no quota fields

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no valid fields/i);
  });

  it('returns 403 for non-admin user', async () => {
    setupMember('plain-user', 'ws-3', 'member');
    const app = await createApp();
    const token = signToken('plain-user', 'plain@example.com');

    const res = await request(app)
      .put('/api/v1/billing/quota')
      .set('Authorization', `Bearer ${token}`)
      .send({ workspace_id: 'ws-3', ai_tokens_per_month: 5000 });

    expect(res.status).toBe(403);
  });
});
