import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '../../middleware/auth.js';
import { observability } from '../../services/observability.js';

const mockPool = {
  query: vi.fn(),
};

vi.mock('../../db/client.js', () => ({
  pool: mockPool,
}));

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function result(rows: any[]) {
  return { rows, rowCount: rows.length };
}

function setupMemberships(allowedMemberships: Set<string>): void {
  mockPool.query.mockImplementation(async (sqlText: string, params: any[] = []) => {
    const sql = normalizeSql(sqlText);
    if (sql.includes('from workspace_members')) {
      const workspaceId = String(params[0]);
      const userId = String(params[1]);
      return result(allowedMemberships.has(`${userId}|${workspaceId}`) ? [{ ok: 1 }] : []);
    }
    throw new Error(`Unhandled SQL in offline observability test: ${sql}`);
  });
}

async function createApp() {
  const { registerOfflineObservabilityRoutes } = await import('../offline_observability.js');
  const app = express();
  app.use(express.json());
  registerOfflineObservabilityRoutes(app);
  return app;
}

describe('offline observability routes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('accepts valid payload and records metrics/logs', async () => {
    setupMemberships(new Set(['user-member|ws-1']));
    const app = await createApp();
    const token = signToken('user-member', 'member@example.com');
    const metricSpy = vi.spyOn(observability, 'recordMetric');
    const infoSpy = vi.spyOn(observability, 'info');

    const response = await request(app)
      .post('/api/v1/observability/offline_queue')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workspace_id: 'ws-1',
        queue_depth: 3,
        replay_processed: 2,
        replay_failed: 1,
        source: 'online',
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: true });
    expect(metricSpy).toHaveBeenCalledWith(
      'offline_queue_depth',
      3,
      expect.objectContaining({ workspace_id: 'ws-1', user_id: 'user-member' }),
    );
    expect(metricSpy).toHaveBeenCalledWith(
      'offline_replay_success_total',
      2,
      expect.objectContaining({ workspace_id: 'ws-1', user_id: 'user-member' }),
    );
    expect(metricSpy).toHaveBeenCalledWith(
      'offline_replay_failure_total',
      1,
      expect.objectContaining({ workspace_id: 'ws-1', user_id: 'user-member' }),
    );
    expect(infoSpy).toHaveBeenCalledWith(
      'Offline queue observability reported',
      expect.objectContaining({
        workspace_id: 'ws-1',
        user_id: 'user-member',
        source: 'online',
      }),
    );
  });

  it('records only offline_queue_depth when replay counters are zero', async () => {
    setupMemberships(new Set(['user-member|ws-1']));
    const app = await createApp();
    const token = signToken('user-member', 'member@example.com');
    const metricSpy = vi.spyOn(observability, 'recordMetric');

    const response = await request(app)
      .post('/api/v1/observability/offline_queue')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workspace_id: 'ws-1',
        queue_depth: 4,
        replay_processed: 0,
        replay_failed: 0,
      });

    expect(response.status).toBe(202);
    const metricNames = metricSpy.mock.calls.map((call) => call[0]);
    expect(metricNames).toEqual(['offline_queue_depth']);
  });

  it('rejects non-workspace member', async () => {
    setupMemberships(new Set(['user-member|ws-1']));
    const app = await createApp();
    const token = signToken('user-other', 'other@example.com');
    const metricSpy = vi.spyOn(observability, 'recordMetric');

    const response = await request(app)
      .post('/api/v1/observability/offline_queue')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workspace_id: 'ws-1',
        queue_depth: 1,
      });

    expect(response.status).toBe(403);
    expect(metricSpy).not.toHaveBeenCalled();
  });

  it('rejects invalid payload values', async () => {
    setupMemberships(new Set(['user-member|ws-1']));
    const app = await createApp();
    const token = signToken('user-member', 'member@example.com');

    const response = await request(app)
      .post('/api/v1/observability/offline_queue')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workspace_id: 'ws-1',
        queue_depth: -1,
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain('queue_depth');
  });

  it('accepts camelCase payload compatibility', async () => {
    setupMemberships(new Set(['user-member|ws-1']));
    const app = await createApp();
    const token = signToken('user-member', 'member@example.com');

    const response = await request(app)
      .post('/api/v1/observability/offline_queue')
      .set('Authorization', `Bearer ${token}`)
      .send({
        workspaceId: 'ws-1',
        queueDepth: 2,
        replayProcessed: 1,
        replayFailed: 0,
        source: 'interval',
      });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({ accepted: true });
  });
});
