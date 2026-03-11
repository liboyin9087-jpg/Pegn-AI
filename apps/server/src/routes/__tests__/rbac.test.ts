import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPool = { query: vi.fn() };
const mockWorkspaceModel = {
  findById: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  create: vi.fn(),
};
const mockDocumentModel = {
  findById: vi.fn(),
  findByWorkspace: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
};
const mockBlockModel = {
  findByDocument: vi.fn(),
};
const mockCreateAndStartAgentRun = vi.fn();
const mockStartSupervisorRun = vi.fn();
const mockGetAgentRunById = vi.fn();
const mockListAgentRuns = vi.fn();
const mockSubscribeToRun = vi.fn(() => () => {});
const mockCheckQuota = vi.fn();
const mockRecordUsage = vi.fn();
const mockExecuteAutomation = vi.fn();

const roleByUser = new Map<string, 'owner' | 'admin' | 'editor' | 'viewer'>();

vi.mock('../../db/client.js', () => ({ pool: mockPool }));
vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: unknown, next: () => void) => {
    req.userId = String(req.headers['x-user-id'] ?? 'viewer-user');
    req.userEmail = `${req.userId}@example.com`;
    next();
  },
}));
vi.mock('../../models/workspace.js', () => ({ WorkspaceModel: mockWorkspaceModel }));
vi.mock('../../models/document.js', () => ({ DocumentModel: mockDocumentModel }));
vi.mock('../../models/block.js', () => ({ BlockModel: mockBlockModel }));
vi.mock('../../services/search.js', () => ({
  searchService: {
    enqueueDocumentReindex: vi.fn().mockResolvedValue(undefined),
    markDocumentIndexStale: vi.fn().mockResolvedValue(undefined),
    cleanupDocumentIndex: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('../../services/automation.js', () => ({
  emitAutomationEvent: vi.fn(),
  dispatchAutomationExecution: (...args: any[]) => mockExecuteAutomation(...args),
}));
vi.mock('../../services/agent.js', () => ({
  createAndStartAgentRun: (...args: any[]) => mockCreateAndStartAgentRun(...args),
  startSupervisorRun: (...args: any[]) => mockStartSupervisorRun(...args),
  getAgentRunById: (...args: any[]) => mockGetAgentRunById(...args),
  listAgentRuns: (...args: any[]) => mockListAgentRuns(...args),
  subscribeToRun: (...args: any[]) => mockSubscribeToRun(...args),
}));
vi.mock('../../services/quota.js', () => ({
  checkQuota: (...args: any[]) => mockCheckQuota(...args),
  recordUsage: (...args: any[]) => mockRecordUsage(...args),
}));
vi.mock('../../services/featureFlags.js', () => ({
  isFeatureEnabled: () => true,
}));
vi.mock('../../services/idempotency.js', () => ({
  getIdempotencyKeyFromRequest: () => null,
  getIdempotentReplay: vi.fn().mockResolvedValue(null),
  storeIdempotentReplay: vi.fn().mockResolvedValue(undefined),
}));

function normalizeSql(sql: string) {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function membershipRow(userId: string, workspaceId: string) {
  const role = roleByUser.get(userId);
  if (!role) return null;
  return {
    user_id: userId,
    workspace_id: workspaceId,
    legacy_role: role,
    role_name: role,
    permissions: '[]',
  };
}

async function createApp() {
  const { registerWorkspaceRoutes } = await import('../workspaces.js');
  const { registerInviteRoutes } = await import('../invites.js');
  const { registerDocumentRoutes } = await import('../documents.js');
  const { registerAgentRoutes } = await import('../agent.js');
  const { registerAutomationRoutes } = await import('../automations.js');

  const app = express();
  app.use(express.json());
  registerWorkspaceRoutes(app);
  registerInviteRoutes(app);
  registerDocumentRoutes(app);
  registerAgentRoutes(app);
  registerAutomationRoutes(app);
  return app;
}

describe('workspace governance routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    roleByUser.clear();
    roleByUser.set('owner-user', 'owner');
    roleByUser.set('admin-user', 'admin');
    roleByUser.set('editor-user', 'editor');
    roleByUser.set('viewer-user', 'viewer');

    mockWorkspaceModel.findById.mockResolvedValue({ id: 'ws-1', name: 'Alpha', settings: {} });
    mockWorkspaceModel.update.mockResolvedValue({ id: 'ws-1', name: 'Alpha', settings: {} });
    mockWorkspaceModel.delete.mockResolvedValue(true);
    mockDocumentModel.findById.mockResolvedValue({ id: 'doc-1', workspace_id: 'ws-1', title: 'Roadmap', metadata: {} });
    mockDocumentModel.findByWorkspace.mockResolvedValue([{ id: 'doc-1', title: 'Roadmap', metadata: {} }]);
    mockDocumentModel.delete.mockResolvedValue(true);
    mockBlockModel.findByDocument.mockResolvedValue([]);
    mockCheckQuota.mockResolvedValue({ allowed: true, used: 0, limit: 10 });
    mockRecordUsage.mockResolvedValue(undefined);
    mockCreateAndStartAgentRun.mockResolvedValue({
      id: 'run-1',
      workspaceId: 'ws-1',
      userId: 'editor-user',
      type: 'research',
      mode: 'auto',
      status: 'queued',
      inputSummary: 'Investigate roadmap',
      createdAt: '2026-03-07T10:00:00.000Z',
      steps: [],
    });
    mockListAgentRuns.mockResolvedValue([]);
    mockGetAgentRunById.mockResolvedValue({
      id: 'run-1',
      workspaceId: 'ws-1',
      userId: 'viewer-user',
      type: 'research',
      mode: 'auto',
      status: 'completed',
      inputSummary: 'Investigate roadmap',
      createdAt: '2026-03-07T10:00:00.000Z',
      steps: [],
    });
    mockExecuteAutomation.mockResolvedValue({ jobId: 'job-1', status: 'queued' });

    mockPool.query.mockImplementation(async (sql: string, params: any[] = []) => {
      const normalized = normalizeSql(sql);

      if (normalized.includes('from workspace_members m left join roles r')) {
        const row = membershipRow(String(params[0]), String(params[1]));
        return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
      }

      if (normalized.startsWith('select w.*, m.role as legacy_role')) {
        const row = membershipRow(String(params[0]), 'ws-1');
        return {
          rowCount: row ? 1 : 0,
          rows: row ? [{ id: 'ws-1', name: 'Alpha', settings: {}, ...row }] : [],
        };
      }

      if (normalized.includes('select 1 from workspace_members where workspace_id = $1 and user_id = $2')) {
        const row = membershipRow(String(params[1]), String(params[0]));
        return { rowCount: row ? 1 : 0, rows: row ? [{ ok: 1 }] : [] };
      }

      if (normalized.includes('coalesce(r.name, m.role) as role')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'member-1',
            workspace_id: 'ws-1',
            user_id: 'viewer-user',
            name: 'Viewer',
            email: 'viewer@example.com',
            role: 'viewer',
            joined_at: '2026-03-07T09:00:00.000Z',
          }],
        };
      }

      if (normalized.includes('select 1 from workspace_members m join users u where m.workspace_id = $1 and lower(u.email) = lower($2)')) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized === 'select workspace_id from documents where id = $1') {
        return { rowCount: 1, rows: [{ workspace_id: 'ws-1' }] };
      }

      if (normalized === 'select workspace_id from automations where id = $1') {
        return { rowCount: 1, rows: [{ workspace_id: 'ws-1' }] };
      }

      if (normalized.startsWith('update workspace_invites set status = \'revoked\'')) {
        return { rowCount: 1, rows: [] };
      }

      if (normalized.startsWith('insert into workspace_invites')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'invite-1',
            workspace_id: 'ws-1',
            email: 'new@example.com',
            role: 'viewer',
            status: 'pending',
            expires_at: '2026-03-14T00:00:00.000Z',
            created_at: '2026-03-07T00:00:00.000Z',
          }],
        };
      }

      if (normalized.startsWith('select i.id, i.workspace_id')) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized === 'select * from automations where id = $1') {
        return {
          rowCount: 1,
          rows: [{
            id: params[0],
            workspace_id: 'ws-1',
            trigger_type: 'doc_created',
            name: 'Auto',
            description: null,
            enabled: true,
            trigger_config: {},
            conditions: [],
            actions: [],
            schedule_cron: null,
          }],
        };
      }

      if (normalized.startsWith('select * from automations where workspace_id = $1')) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.startsWith('insert into automations')) {
        return { rowCount: 1, rows: [{ id: 'automation-1', workspace_id: 'ws-1', name: 'Auto' }] };
      }

      if (normalized.startsWith('update automations set')) {
        return { rowCount: 1, rows: [{ id: 'automation-1', workspace_id: 'ws-1', name: 'Auto' }] };
      }

      if (normalized.startsWith('delete from automations where id = $1')) {
        return { rowCount: 1, rows: [{ id: 'automation-1' }] };
      }

      if (normalized.startsWith('select * from automation_runs')) {
        return { rowCount: 0, rows: [] };
      }

      if (normalized.startsWith('select count(*) from automation_runs')) {
        return { rowCount: 1, rows: [{ count: '0' }] };
      }

      return { rowCount: 0, rows: [] };
    });
  });

  it('returns governance summary on workspace list and detail', async () => {
    const app = await createApp();

    const listResponse = await request(app)
      .get('/api/v1/workspaces')
      .set('x-user-id', 'editor-user');
    expect(listResponse.status).toBe(200);
    expect(listResponse.body.workspaces[0].effectiveRole).toBe('editor');
    expect(listResponse.body.workspaces[0].permissionSummary.canRunAutomation).toBe(true);

    const detailResponse = await request(app)
      .get('/api/v1/workspaces/ws-1')
      .set('x-user-id', 'viewer-user');
    expect(detailResponse.status).toBe(200);
    expect(detailResponse.body.effectiveRole).toBe('viewer');
    expect(detailResponse.body.permissionSummary.canEditDocuments).toBe(false);
  });

  it('returns consistent forbidden shape for blocked capability routes', async () => {
    const app = await createApp();

    const response = await request(app)
      .put('/api/v1/workspaces/ws-1')
      .set('x-user-id', 'viewer-user')
      .send({ name: 'Beta' });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      },
    });
  });

  it('allows viewers to read members but denies invite creation', async () => {
    const app = await createApp();

    const membersResponse = await request(app)
      .get('/api/v1/workspaces/ws-1/members')
      .set('x-user-id', 'viewer-user');
    expect(membersResponse.status).toBe(200);

    const inviteResponse = await request(app)
      .post('/api/v1/workspaces/ws-1/invites')
      .set('x-user-id', 'viewer-user')
      .send({ email: 'new@example.com', role: 'viewer' });
    expect(inviteResponse.status).toBe(403);
  });

  it('allows admins to create invites', async () => {
    const app = await createApp();

    const response = await request(app)
      .post('/api/v1/workspaces/ws-1/invites')
      .set('x-user-id', 'admin-user')
      .send({ email: 'new@example.com', role: 'viewer' });

    expect(response.status).toBe(201);
    expect(response.body.invite.email).toBe('new@example.com');
  });

  it('allows editors to delete documents but denies viewers', async () => {
    const app = await createApp();

    const viewerDelete = await request(app)
      .delete('/api/v1/documents/doc-1')
      .set('x-user-id', 'viewer-user');
    expect(viewerDelete.status).toBe(403);

    const editorDelete = await request(app)
      .delete('/api/v1/documents/doc-1')
      .set('x-user-id', 'editor-user');
    expect(editorDelete.status).toBe(200);
  });

  it('allows only editor/admin roles to start agent runs and automation triggers', async () => {
    const app = await createApp();

    const viewerRun = await request(app)
      .post('/api/v1/agents/runs')
      .set('x-user-id', 'viewer-user')
      .send({ workspace_id: 'ws-1', input: 'Investigate roadmap' });
    expect(viewerRun.status).toBe(403);

    const editorRun = await request(app)
      .post('/api/v1/agents/runs')
      .set('x-user-id', 'editor-user')
      .send({ workspace_id: 'ws-1', input: 'Investigate roadmap' });
    expect(editorRun.status).toBe(201);

    const viewerTrigger = await request(app)
      .post('/api/v1/automations/automation-1/trigger')
      .set('x-user-id', 'viewer-user')
      .send({ payload: {} });
    expect(viewerTrigger.status).toBe(403);

    const editorTrigger = await request(app)
      .post('/api/v1/automations/automation-1/trigger')
      .set('x-user-id', 'editor-user')
      .send({ payload: {} });
    expect(editorTrigger.status).toBe(200);
  });
});
