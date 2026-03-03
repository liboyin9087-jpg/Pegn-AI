import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockStartSupervisorRun = vi.fn();
const mockGetRunById = vi.fn();
const mockSubscribeToRun = vi.fn();
const mockIsFeatureEnabled = vi.fn();
const mockCheckQuota = vi.fn();
const mockRecordUsage = vi.fn();

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = 'user-1';
    next();
  },
}));

vi.mock('../../middleware/rbac.js', () => ({
  checkPermission: () => (_req: any, _res: any, next: any) => next(),
}));

vi.mock('../../services/request.js', () => ({
  getWorkspaceIdFromBody: (body: any) => body?.workspace_id ?? body?.workspaceId ?? null,
}));

vi.mock('../../services/featureFlags.js', () => ({
  isFeatureEnabled: mockIsFeatureEnabled,
}));

vi.mock('../../services/quota.js', () => ({
  checkQuota: mockCheckQuota,
  recordUsage: mockRecordUsage,
}));

vi.mock('../../services/agent.js', () => ({
  startSupervisorRun: mockStartSupervisorRun,
  getRunById: mockGetRunById,
  subscribeToRun: mockSubscribeToRun,
}));

async function createApp() {
  const { registerAgentRoutes } = await import('../agent.js');
  const app = express();
  app.use(express.json());
  registerAgentRoutes(app);
  return app;
}

describe('agent routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsFeatureEnabled.mockReturnValue(true);
    mockCheckQuota.mockResolvedValue({ allowed: true, remaining: 99 });
    mockRecordUsage.mockResolvedValue(undefined);
    mockStartSupervisorRun.mockResolvedValue(undefined);
    mockSubscribeToRun.mockReturnValue(() => undefined);
  });

  it('returns 429 when supervisor quota is exceeded', async () => {
    mockCheckQuota.mockResolvedValue({ allowed: false, limit: 1, used: 1 });
    const app = await createApp();

    const response = await request(app)
      .post('/api/v1/agents/supervisor')
      .send({ query: 'analyze this', workspace_id: 'ws-1' });

    expect(response.status).toBe(429);
    expect(response.body.error).toContain('quota');
    expect(mockStartSupervisorRun).not.toHaveBeenCalled();
    expect(mockRecordUsage).not.toHaveBeenCalled();
  });

  it('starts supervisor run and records usage when quota allows', async () => {
    const app = await createApp();

    const response = await request(app)
      .post('/api/v1/agents/supervisor')
      .send({ query: 'analyze this', workspace_id: 'ws-1', mode: 'hybrid' });

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('started');
    expect(response.body.run_id).toBeTypeOf('string');
    expect(mockStartSupervisorRun).toHaveBeenCalledTimes(1);
    expect(mockStartSupervisorRun).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'analyze this',
        workspace_id: 'ws-1',
        user_id: 'user-1',
        mode: 'hybrid',
        template: 'supervisor',
      }),
    );
    expect(mockRecordUsage).toHaveBeenCalledWith('ws-1', 'user-1', 'agent_runs', 1);
  });

  it('streams completed run immediately with done event', async () => {
    mockGetRunById.mockResolvedValue({
      id: 'run-1',
      user_id: 'user-1',
      mode: 'auto',
      type: 'supervisor',
      status: 'completed',
      steps: [{ step_key: 'planner', status: 'completed' }],
    });

    const app = await createApp();

    const response = await request(app)
      .get('/api/v1/agents/runs/run-1/stream')
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => cb(null, data));
      });

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.body).toContain('"type":"meta"');
    expect(response.body).toContain('"type":"step"');
    expect(response.body).toContain('"type":"done"');
    expect(response.body).toContain('event: done');
    expect(mockSubscribeToRun).not.toHaveBeenCalled();
  });

  it('streams live events for running run and closes on done', async () => {
    mockGetRunById.mockResolvedValue({
      id: 'run-live',
      user_id: 'user-1',
      mode: 'auto',
      type: 'supervisor',
      status: 'running',
      steps: [],
    });

    mockSubscribeToRun.mockImplementation((_runId: string, callback: (event: any) => void) => {
      setTimeout(() => {
        callback({ type: 'step', step: { step_key: 'worker_1', status: 'completed' } });
        callback({ type: 'done' });
      }, 0);
      return () => undefined;
    });

    const app = await createApp();

    const response = await request(app)
      .get('/api/v1/agents/runs/run-live/stream')
      .buffer(true)
      .parse((res, cb) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', chunk => {
          data += chunk;
        });
        res.on('end', () => cb(null, data));
      });

    expect(response.status).toBe(200);
    expect(response.body).toContain('"type":"meta"');
    expect(response.body).toContain('"type":"step"');
    expect(response.body).toContain('"worker_1"');
    expect(response.body).toContain('event: done');
    expect(mockSubscribeToRun).toHaveBeenCalledTimes(1);
  });

  it('rejects stream access for non-owner', async () => {
    mockGetRunById.mockResolvedValue({
      id: 'run-2',
      user_id: 'other-user',
      mode: 'auto',
      type: 'research',
      status: 'running',
      steps: [],
    });

    const app = await createApp();

    const response = await request(app)
      .get('/api/v1/agents/runs/run-2/stream');

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Forbidden' });
    expect(mockSubscribeToRun).not.toHaveBeenCalled();
  });
});
