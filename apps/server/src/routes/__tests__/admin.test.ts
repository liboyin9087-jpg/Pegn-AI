import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '../../middleware/auth.js';

const mockPool = { query: vi.fn() };
const mockGetWorkspaceAdminSummary = vi.fn();
const mockListWorkspaceAuditLogs = vi.fn();
const mockGetWorkspaceUsageSummary = vi.fn();
const mockGetWorkspaceAdminAlerts = vi.fn();

vi.mock('../../db/client.js', () => ({ pool: mockPool }));
vi.mock('../../services/admin.js', () => ({
  getWorkspaceAdminSummary: (...args: any[]) => mockGetWorkspaceAdminSummary(...args),
  listWorkspaceAuditLogs: (...args: any[]) => mockListWorkspaceAuditLogs(...args),
  getWorkspaceUsageSummary: (...args: any[]) => mockGetWorkspaceUsageSummary(...args),
  getWorkspaceAdminAlerts: (...args: any[]) => mockGetWorkspaceAdminAlerts(...args),
}));

type Role = 'admin' | 'editor' | 'viewer';

function setupMembership(role: Role) {
  mockPool.query.mockImplementation(async (sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (normalized.includes('from workspace_members m') && normalized.includes('left join roles r')) {
      return {
        rows: [{
          user_id: 'user-1',
          workspace_id: 'ws-1',
          legacy_role: role === 'admin' ? 'owner' : role,
          role_name: role === 'admin' ? 'admin' : role,
          permissions: JSON.stringify([]),
        }],
        rowCount: 1,
      };
    }
    return { rows: [], rowCount: 0 };
  });
}

async function createApp() {
  const { registerAdminRoutes } = await import('../admin.js');
  const app = express();
  app.use(express.json());
  registerAdminRoutes(app);
  return app;
}

describe('admin routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkspaceAdminSummary.mockResolvedValue({ memberCounts: { membersTotal: 3 } });
    mockListWorkspaceAuditLogs.mockResolvedValue({ items: [], nextCursor: null });
    mockGetWorkspaceUsageSummary.mockResolvedValue({
      documentsCount: 10,
      indexedDocumentsCount: 8,
      agentRunsLast7d: 4,
      agentRunsLast30d: 12,
      failedJobsLast7d: 1,
      failedJobsLast30d: 2,
      artifactsBytes: 2048,
      quota: { documentsLimit: null, storageBytesLimit: null, agentRunsMonthlyLimit: 600, percentUsed: 25, thresholdReached: false },
      quotaStatus: 'ok',
    });
    mockGetWorkspaceAdminAlerts.mockResolvedValue({ items: [] });
  });

  it('allows admin to read admin summary', async () => {
    setupMembership('admin');
    const app = await createApp();
    const token = signToken('user-1', 'admin@example.com');

    const response = await request(app)
      .get('/api/v1/workspaces/ws-1/admin/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(mockGetWorkspaceAdminSummary).toHaveBeenCalledWith('ws-1');
  });

  it('blocks editor from admin summary', async () => {
    setupMembership('editor');
    const app = await createApp();
    const token = signToken('user-1', 'editor@example.com');

    const response = await request(app)
      .get('/api/v1/workspaces/ws-1/admin/summary')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      },
    });
  });

  it('blocks viewer from audit logs', async () => {
    setupMembership('viewer');
    const app = await createApp();
    const token = signToken('user-1', 'viewer@example.com');

    const response = await request(app)
      .get('/api/v1/workspaces/ws-1/audit-logs')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });

  it('allows admin to read usage summary', async () => {
    setupMembership('admin');
    const app = await createApp();
    const token = signToken('user-1', 'admin@example.com');

    const response = await request(app)
      .get('/api/v1/workspaces/ws-1/usage')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.documentsCount).toBe(10);
  });

  it('allows admin to read alerts', async () => {
    setupMembership('admin');
    mockGetWorkspaceAdminAlerts.mockResolvedValue({
      items: [{
        id: 'alert-1',
        type: 'quota_threshold_reached',
        severity: 'warning',
        title: 'Quota threshold reached',
        description: 'Usage is high.',
        relatedTargetType: 'quota',
        relatedTargetId: 'ws-1',
        createdAt: '2026-03-07T00:00:00.000Z',
      }],
    });
    const app = await createApp();
    const token = signToken('user-1', 'admin@example.com');

    const response = await request(app)
      .get('/api/v1/workspaces/ws-1/admin/alerts')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.items).toHaveLength(1);
  });
});
