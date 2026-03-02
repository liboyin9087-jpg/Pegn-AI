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

describe('agent artifacts routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns immutable artifacts timeline for run owner', async () => {
    mockGetRunById.mockResolvedValue({
      id: 'run-1',
      user_id: 'user-1',
      mode: 'auto',
      type: 'supervisor',
      status: 'done',
      steps: [],
    });
    mockGetRunArtifacts.mockResolvedValue({
      timeline: [
        {
          id: '1',
          run_id: 'run-1',
          step_id: 'step-1',
          step_key: 'planner',
          artifact_type: 'input',
          payload: { query: 'hello' },
          created_at: '2026-03-02T00:00:00.000Z',
        },
      ],
      by_step: {
        planner: [
          {
            id: '1',
            run_id: 'run-1',
            step_id: 'step-1',
            step_key: 'planner',
            artifact_type: 'input',
            payload: { query: 'hello' },
            created_at: '2026-03-02T00:00:00.000Z',
          },
        ],
      },
    });

    const app = await createApp();
    const token = signToken('user-1', 'user1@example.com');
    const response = await request(app)
      .get('/api/v1/agents/runs/run-1/artifacts?limit=50&offset=0')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.run_id).toBe('run-1');
    expect(response.body.limit).toBe(50);
    expect(response.body.offset).toBe(0);
    expect(response.body.timeline).toHaveLength(1);
    expect(response.body.by_step.planner).toHaveLength(1);
    expect(mockGetRunArtifacts).toHaveBeenCalledWith('run-1', { limit: 50, offset: 0 });
  });

  it('rejects artifacts access for non-owner', async () => {
    mockGetRunById.mockResolvedValue({
      id: 'run-2',
      user_id: 'owner-user',
      mode: 'auto',
      type: 'supervisor',
      status: 'running',
      steps: [],
    });

    const app = await createApp();
    const token = signToken('viewer-user', 'viewer@example.com');
    const response = await request(app)
      .get('/api/v1/agents/runs/run-2/artifacts')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: 'Forbidden' });
    expect(mockGetRunArtifacts).not.toHaveBeenCalled();
  });
});
