import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPool = { query: vi.fn() };
const mockCreateAndStartAgentRun = vi.fn();
const mockStartSupervisorRun = vi.fn();
const mockGetAgentRunById = vi.fn();
const mockListAgentRuns = vi.fn();
const mockSubscribeToRun = vi.fn(() => () => {});
const mockCheckQuota = vi.fn();
const mockRecordUsage = vi.fn();

vi.mock('../../db/client.js', () => ({ pool: mockPool }));

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: unknown, next: () => void) => {
    req.userId = 'user-1';
    req.userEmail = 'user@example.com';
    next();
  },
}));

vi.mock('../../middleware/rbac.js', () => ({
  checkPermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
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

async function createApp() {
  const { registerAgentRoutes } = await import('../agent.js');
  const app = express();
  app.use(express.json());
  registerAgentRoutes(app);
  return app;
}

function makeRun(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'run-1',
    workspaceId: 'ws-1',
    userId: 'user-1',
    type: 'research',
    mode: 'auto',
    status: 'queued',
    inputSummary: 'Investigate roadmap',
    outputSummary: null,
    errorSummary: null,
    createdAt: '2026-03-07T10:00:00.000Z',
    startedAt: null,
    finishedAt: null,
    depth: 0,
    result: null,
    steps: [],
    ...overrides,
  };
}

describe('agent runtime routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckQuota.mockResolvedValue({ allowed: true, used: 1, limit: 10 });
    mockRecordUsage.mockResolvedValue(undefined);
    mockPool.query.mockReset();
  });

  it('creates a formal run via POST /api/v1/agents/runs', async () => {
    mockCreateAndStartAgentRun.mockResolvedValue(makeRun());
    const app = await createApp();

    const response = await request(app)
      .post('/api/v1/agents/runs')
      .send({ workspace_id: 'ws-1', input: 'Investigate roadmap', template: 'research' });

    expect(response.status).toBe(201);
    expect(mockCreateAndStartAgentRun).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws-1',
      userId: 'user-1',
      input: 'Investigate roadmap',
      template: 'research',
    }));
    expect(response.body.id).toBe('run-1');
  });

  it('reads one run with workspace scope', async () => {
    mockGetAgentRunById.mockResolvedValue(makeRun({ status: 'completed' }));
    const app = await createApp();

    const response = await request(app)
      .get('/api/v1/agents/runs/run-1?workspace_id=ws-1');

    expect(response.status).toBe(200);
    expect(mockGetAgentRunById).toHaveBeenCalledWith('run-1', 'ws-1', 'user-1');
    expect(response.body.status).toBe('completed');
  });

  it('lists recent runs with workspace scope', async () => {
    mockListAgentRuns.mockResolvedValue([makeRun(), makeRun({ id: 'run-2' })]);
    const app = await createApp();

    const response = await request(app)
      .get('/api/v1/agents/runs?workspace_id=ws-1&limit=5');

    expect(response.status).toBe(200);
    expect(mockListAgentRuns).toHaveBeenCalledWith('ws-1', 'user-1', 5);
    expect(response.body.runs).toHaveLength(2);
  });

  it('attaches stream only to an existing run', async () => {
    const runningRun = makeRun({ status: 'running' });
    const completedRun = makeRun({ status: 'completed', outputSummary: 'Final answer', result: { answer: 'Final answer' } });
    mockGetAgentRunById.mockResolvedValue(runningRun);
    mockSubscribeToRun.mockImplementation((_runId: string, cb: (event: unknown) => void) => {
      setTimeout(() => {
        cb({ type: 'run', run: completedRun });
        cb({ type: 'done' });
      }, 0);
      return () => {};
    });

    const app = await createApp();
    const response = await request(app)
      .get('/api/v1/agents/runs/run-1/stream?workspace_id=ws-1');

    expect(response.status).toBe(200);
    expect(mockSubscribeToRun).toHaveBeenCalledWith('run-1', expect.any(Function));
    expect(response.text).toContain('"run_id":"run-1"');
    expect(response.text).toContain('"status":"completed"');
  });

  it('legacy wrapper routes surface run_id and delegate to unified lifecycle', async () => {
    mockStartSupervisorRun.mockResolvedValue(makeRun({ id: 'run-legacy' }));
    const app = await createApp();

    const response = await request(app)
      .post('/api/v1/agents/research')
      .send({ workspace_id: 'ws-1', query: 'Legacy path' });

    expect(response.status).toBe(200);
    expect(mockStartSupervisorRun).toHaveBeenCalledWith(expect.objectContaining({
      workspace_id: 'ws-1',
      user_id: 'user-1',
      query: 'Legacy path',
      template: 'research',
    }));
    expect(response.body).toEqual({ run_id: 'run-legacy', status: 'started' });
  });
});
