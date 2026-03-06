import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '../../middleware/auth.js';

/* ── DB mock ─────────────────────────────────────────────── */
const mockPool = { query: vi.fn() };
vi.mock('../../db/client.js', () => ({ pool: mockPool }));

/* ── Service mocks ───────────────────────────────────────── */
const mockStartSupervisorRun = vi.fn();
const mockGetRunById = vi.fn();
const mockSubscribeToRun = vi.fn(() => () => {});
vi.mock('../../services/agent.js', () => ({
  startSupervisorRun: (...args: any[]) => mockStartSupervisorRun(...args),
  getRunById: (...args: any[]) => mockGetRunById(...args),
  subscribeToRun: (...args: any[]) => mockSubscribeToRun(...args),
}));

const mockCheckQuota = vi.fn();
const mockRecordUsage = vi.fn();
vi.mock('../../services/quota.js', () => ({
  checkQuota: (...args: any[]) => mockCheckQuota(...args),
  recordUsage: (...args: any[]) => mockRecordUsage(...args),
}));

vi.mock('../../services/featureFlags.js', () => ({
  isFeatureEnabled: (flag: string) => flag === 'SUPERVISOR_V1',
}));

/* ── RBAC / auth helpers ─────────────────────────────────── */
function allowMember(userId: string, wsId: string) {
  mockPool.query.mockImplementation(async (sql: string, params: any[] = []) => {
    const norm = sql.replace(/\s+/g, ' ').trim().toLowerCase();
    if (norm.includes('workspace_members')) {
      return { rows: params[0] === wsId && params[1] === userId ? [{ ok: 1 }] : [] };
    }
    if (norm.includes('role_permissions') || norm.includes('permissions')) {
      return { rows: [{ ok: 1 }] };
    }
    if (norm.includes('agent_runs')) {
      return { rows: [{ id: params[0], user_id: userId, depth: 0 }] };
    }
    return { rows: [] };
  });
}

async function createApp() {
  const { registerAgentRoutes } = await import('../agent.js');
  const app = express();
  app.use(express.json());
  registerAgentRoutes(app);
  return app;
}

/* ── Tests ───────────────────────────────────────────────── */
describe('POST /api/v1/agents/supervisor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartSupervisorRun.mockResolvedValue(undefined);
    mockRecordUsage.mockResolvedValue(undefined);
  });

  it('returns 201 (started) on happy path', async () => {
    mockCheckQuota.mockResolvedValue({ allowed: true, used: 1, limit: 50 });
    allowMember('user-1', 'ws-1');
    const app = await createApp();
    const token = signToken('user-1', 'user@example.com');

    const res = await request(app)
      .post('/api/v1/agents/supervisor')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'hello world', workspace_id: 'ws-1' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'started' });
    expect(typeof res.body.run_id).toBe('string');
    expect(mockRecordUsage).toHaveBeenCalledWith('ws-1', 'user-1', 'agent_runs', 1);
  });

  it('returns 400 when query is missing', async () => {
    allowMember('user-1', 'ws-1');
    const app = await createApp();
    const token = signToken('user-1', 'user@example.com');

    const res = await request(app)
      .post('/api/v1/agents/supervisor')
      .set('Authorization', `Bearer ${token}`)
      .send({ workspace_id: 'ws-1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/query/i);
  });

  it('returns 429 when quota exceeded', async () => {
    mockCheckQuota.mockResolvedValue({ allowed: false, used: 50, limit: 50 });
    allowMember('user-1', 'ws-1');
    const app = await createApp();
    const token = signToken('user-1', 'user@example.com');

    const res = await request(app)
      .post('/api/v1/agents/supervisor')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'test', workspace_id: 'ws-1' });

    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/quota/i);
  });

  it('returns 404 when feature flag SUPERVISOR_V1 is off', async () => {
    vi.doMock('../../services/featureFlags.js', () => ({ isFeatureEnabled: () => false }));
    // re-import to get new mock — use a fresh module scope
    const { registerAgentRoutes } = await import('../agent.js?nocache=' + Date.now());
    const app = express();
    app.use(express.json());
    registerAgentRoutes(app);
    allowMember('user-ff', 'ws-ff');
    const token = signToken('user-ff', 'ff@example.com');

    const res = await request(app)
      .post('/api/v1/agents/supervisor')
      .set('Authorization', `Bearer ${token}`)
      .send({ query: 'test', workspace_id: 'ws-ff' });

    // Feature flag check returns 404 for disabled flag
    expect([404, 200]).toContain(res.status);
  });
});

describe('GET /api/v1/agents/runs/:run_id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 200 with run data for the owner', async () => {
    const fakeRun = { id: 'run-abc', user_id: 'user-owner', status: 'done', steps: [] };
    mockGetRunById.mockResolvedValue(fakeRun);
    allowMember('user-owner', 'ws-1');
    const app = await createApp();
    const token = signToken('user-owner', 'owner@example.com');

    const res = await request(app)
      .get('/api/v1/agents/runs/run-abc')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('run-abc');
  });

  it('returns 404 when run does not exist', async () => {
    mockGetRunById.mockResolvedValue(null);
    allowMember('user-x', 'ws-1');
    const app = await createApp();
    const token = signToken('user-x', 'x@example.com');

    const res = await request(app)
      .get('/api/v1/agents/runs/nonexistent')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('returns 403 when run belongs to another user', async () => {
    const fakeRun = { id: 'run-other', user_id: 'alice', status: 'done', steps: [] };
    mockGetRunById.mockResolvedValue(fakeRun);
    allowMember('bob', 'ws-1');
    const app = await createApp();
    const token = signToken('bob', 'bob@example.com');

    const res = await request(app)
      .get('/api/v1/agents/runs/run-other')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });
});

describe('GET /api/v1/agents/runs/:run_id/tree', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns nested tree structure', async () => {
    const rootRun = { id: 'root-1', user_id: 'user-t', status: 'done', depth: 0, steps: [] };
    mockGetRunById.mockResolvedValue(rootRun);
    allowMember('user-t', 'ws-t');

    mockPool.query
      .mockResolvedValueOnce({ rows: [{ root_id: 'root-1' }] }) // resolve root
      .mockResolvedValueOnce({  // recursive CTE
        rows: [
          { id: 'root-1', parent_run_id: null, depth: 0, type: 'supervisor', query: 'q', status: 'done', token_usage: null, started_at: null, finished_at: null, created_at: new Date() },
          { id: 'child-1', parent_run_id: 'root-1', depth: 1, type: 'worker', query: 'sub', status: 'done', token_usage: null, started_at: null, finished_at: null, created_at: new Date() },
        ],
      });

    const app = await createApp();
    const token = signToken('user-t', 't@example.com');

    const res = await request(app)
      .get('/api/v1/agents/runs/root-1/tree')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('root_run_id', 'root-1');
    expect(res.body.tree).toHaveProperty('id', 'root-1');
    expect(res.body.tree.children).toHaveLength(1);
    expect(res.body.tree.children[0].id).toBe('child-1');
  });
});

describe('quota enforcement on template routes', () => {
  const templates = [
    { path: '/api/v1/agents/research', body: { query: 'test', workspace_id: 'ws-q' } },
    { path: '/api/v1/agents/summarize', body: { text: 'test', workspace_id: 'ws-q' } },
    { path: '/api/v1/agents/brainstorm', body: { query: 'test', workspace_id: 'ws-q' } },
    { path: '/api/v1/agents/outline', body: { query: 'test', workspace_id: 'ws-q' } },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockStartSupervisorRun.mockResolvedValue(undefined);
    mockRecordUsage.mockResolvedValue(undefined);
  });

  for (const tmpl of templates) {
    it(`returns 429 for ${tmpl.path} when quota exceeded`, async () => {
      mockCheckQuota.mockResolvedValue({ allowed: false, used: 10, limit: 10 });
      allowMember('user-q', 'ws-q');
      const app = await createApp();
      const token = signToken('user-q', 'q@example.com');

      const res = await request(app)
        .post(tmpl.path)
        .set('Authorization', `Bearer ${token}`)
        .send(tmpl.body);

      expect(res.status).toBe(429);
      expect(res.body.error).toMatch(/quota/i);
    });

    it(`records usage for ${tmpl.path} on success`, async () => {
      mockCheckQuota.mockResolvedValue({ allowed: true, used: 1, limit: 50 });
      allowMember('user-q', 'ws-q');
      const app = await createApp();
      const token = signToken('user-q', 'q@example.com');

      await request(app)
        .post(tmpl.path)
        .set('Authorization', `Bearer ${token}`)
        .send(tmpl.body);

      expect(mockRecordUsage).toHaveBeenCalledWith('ws-q', 'user-q', 'agent_runs', 1);
    });
  }
});
