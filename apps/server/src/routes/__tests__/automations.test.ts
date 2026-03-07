import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPool = { query: vi.fn() };
const mockDispatchAutomationExecution = vi.fn();

vi.mock('../../db/client.js', () => ({
  pool: mockPool,
}));

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: unknown, next: () => void) => {
    req.userId = 'user-1';
    next();
  },
}));

vi.mock('../../middleware/rbac.js', () => ({
  checkWorkspaceCapability: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../services/observability.js', () => ({
  observability: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../services/automation.js', () => ({
  dispatchAutomationExecution: (...args: any[]) => mockDispatchAutomationExecution(...args),
}));

async function createApp() {
  const { registerAutomationRoutes } = await import('../automations.js');
  const app = express();
  app.use(express.json());
  registerAutomationRoutes(app);
  return app;
}

describe('automation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns jobId when manual trigger is dispatched', async () => {
    mockPool.query.mockResolvedValueOnce({
      rows: [{
        id: 'auto-1',
        workspace_id: 'ws-1',
        trigger_type: 'schedule',
      }],
    });
    mockDispatchAutomationExecution.mockResolvedValue({ jobId: 'job-auto-1', status: 'queued' });

    const app = await createApp();
    const response = await request(app)
      .post('/api/v1/automations/auto-1/trigger')
      .send({ payload: { hello: 'world' } });

    expect(response.status).toBe(200);
    expect(mockDispatchAutomationExecution).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'auto-1', workspace_id: 'ws-1' }),
      expect.objectContaining({
        workspaceId: 'ws-1',
        triggeredBy: 'user-1',
        payload: { hello: 'world' },
      }),
      'manual'
    );
    expect(response.body).toEqual({
      triggered: true,
      automation_id: 'auto-1',
      jobId: 'job-auto-1',
      status: 'queued',
      message: 'Automation triggered, running in background',
    });
  });
});
