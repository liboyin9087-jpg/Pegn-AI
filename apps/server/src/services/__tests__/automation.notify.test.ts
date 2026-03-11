import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPool = {
  query: vi.fn(),
};

vi.mock('../../db/client.js', () => ({
  pool: mockPool,
}));

vi.mock('../jobService.js', () => ({
  appendJobEvent: vi.fn().mockResolvedValue(undefined),
  createJob: vi.fn().mockResolvedValue(undefined),
  failJob: vi.fn().mockResolvedValue(undefined),
  isCancelRequested: vi.fn().mockResolvedValue(false),
  markCancelled: vi.fn().mockResolvedValue(undefined),
  markTimeout: vi.fn().mockResolvedValue(undefined),
  startJob: vi.fn().mockResolvedValue(undefined),
  succeedJob: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../agent.js', () => ({
  startSupervisorRun: vi.fn(),
}));

describe('executeAutomation notify action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (normalized.startsWith('select user_id from workspace_members')) {
        return { rows: [{ user_id: 'user-1' }], rowCount: 1 };
      }
      if (normalized.startsWith('insert into inbox_notifications')) {
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith('insert into automation_runs')) {
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith('update automations')) {
        return { rows: [], rowCount: 1 };
      }

      throw new Error(`Unhandled SQL: ${normalized} -- ${JSON.stringify(params)}`);
    });
  });

  it('writes automation notifications with payload JSON and unread status', async () => {
    const { executeAutomation } = await import('../automation.js');

    await executeAutomation(
      {
        id: 'auto-1',
        workspace_id: 'ws-1',
        created_by: 'creator-1',
        name: 'Notify',
        description: null,
        enabled: true,
        trigger_type: 'comment_created',
        trigger_config: {},
        conditions: [],
        actions: [
          {
            type: 'notify',
            config: {
              title: 'Automation',
              message: 'Workflow completed',
            },
          },
        ],
        schedule_cron: null,
        last_triggered_at: null,
        run_count: 0,
        created_at: new Date(),
        updated_at: new Date(),
      },
      {
        type: 'comment_created',
        workspaceId: 'ws-1',
        entityType: 'comment',
        entityId: 'comment-1',
        payload: { thread_id: 'thread-1' },
        triggeredBy: 'user-99',
      },
      'event',
      {
        id: 'job-1',
        workspaceId: 'ws-1',
        jobType: 'automation_trigger',
        sourceDomain: 'automation',
        status: 'queued',
        metadata: {},
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
    );

    const inboxInsert = mockPool.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inbox_notifications')
    );

    expect(inboxInsert).toBeTruthy();
    expect(String(inboxInsert?.[0])).toContain('payload');
    expect(String(inboxInsert?.[0])).toContain("'unread'");

    const payload = JSON.parse(String(inboxInsert?.[1]?.[2]));
    expect(payload).toMatchObject({
      title: 'Automation',
      message: 'Workflow completed',
      entity_type: 'comment',
      entity_id: 'comment-1',
    });
    expect(payload.context).toMatchObject({
      workspaceId: 'ws-1',
      entityType: 'comment',
      entityId: 'comment-1',
    });
  });
});
