import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '../../middleware/auth.js';

const mockGetRunById = vi.fn();
const mockStartSupervisorRun = vi.fn();
const mockSubscribeToRun = vi.fn();
const mockGetRunArtifacts = vi.fn();

vi.mock('../../services/agent.js', () => ({
  getRunById: mockGetRunById,
  startSupervisorRun: mockStartSupervisorRun,
  subscribeToRun: mockSubscribeToRun,
  getRunArtifacts: mockGetRunArtifacts,
}));

async function createApp() {
  const { registerAgentRoutes } = await import('../agent.js');
  const app = express();
  app.use(express.json());
  registerAgentRoutes(app);
  return app;
}

describe('agent stream routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('replays done run state and closes stream', async () => {
    mockGetRunById.mockResolvedValue({
      id: 'run-1',
      user_id: 'user-1',
      mode: 'auto',
      type: 'research',
      status: 'done',
      steps: [
        { id: 'step-1', name: 'planner', status: 'done' },
      ],
    });
    mockSubscribeToRun.mockReturnValue(() => {});

    const app = await createApp();
    const token = signToken('user-1', 'user1@example.com');
    const response = await request(app)
      .get('/api/v1/agents/runs/run-1/stream')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('text/event-stream');
    expect(response.text).toContain('"schema_version":"v1"');
    expect(response.text).toContain('"type":"meta"');
    expect(response.text).toContain('"type":"step"');
    expect(response.text).toContain('"type":"run"');
    expect(response.text).toContain('"type":"done"');
    expect(response.text).toContain('event: done');
    expect(mockSubscribeToRun).not.toHaveBeenCalled();
  });

  it('streams live events for running run and unsubscribes on done', async () => {
    mockGetRunById.mockResolvedValue({
      id: 'run-2',
      user_id: 'user-2',
      mode: 'hybrid',
      type: 'supervisor',
      status: 'running',
      steps: [],
    });

    const unsubscribe = vi.fn();
    mockSubscribeToRun.mockImplementation((_runId: string, cb: (event: any) => void) => {
      setTimeout(() => {
        cb({ type: 'step', step: { id: 'step-a', name: 'planner', status: 'running' } });
        cb({ type: 'done' });
      }, 0);
      return unsubscribe;
    });

    const app = await createApp();
    const token = signToken('user-2', 'user2@example.com');
    const response = await request(app)
      .get('/api/v1/agents/runs/run-2/stream')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.text).toContain('"schema_version":"v1"');
    expect(response.text).toContain('"type":"meta"');
    expect(response.text).toContain('"type":"step"');
    expect(response.text).toContain('"type":"done"');
    expect(response.text).toContain('event: done');
    expect(mockSubscribeToRun).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('rejects stream access from another user', async () => {
    mockGetRunById.mockResolvedValue({
      id: 'run-3',
      user_id: 'owner-user',
      mode: 'auto',
      type: 'research',
      status: 'running',
      steps: [],
    });

    const app = await createApp();
    const token = signToken('viewer-user', 'viewer@example.com');
    const response = await request(app)
      .get('/api/v1/agents/runs/run-3/stream')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Forbidden' });
  });
});
