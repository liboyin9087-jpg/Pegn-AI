import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPool = {
  query: vi.fn(),
};

const listWorkspaceAdmins = vi.fn();

vi.mock('../../db/client.js', () => ({
  pool: mockPool,
}));

vi.mock('../../lib/workspaceRoles.js', () => ({
  listWorkspaceAdmins,
}));

describe('notifyQuotaAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listWorkspaceAdmins.mockResolvedValue(['admin-1']);
    mockPool.query.mockImplementation(async (sql: string) => {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.startsWith('select 1 from system_metrics')) {
        return { rows: [], rowCount: 0 };
      }
      if (normalized.startsWith('insert into inbox_notifications')) {
        return { rows: [], rowCount: 1 };
      }
      if (normalized.startsWith('insert into system_metrics')) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unhandled SQL: ${normalized}`);
    });
  });

  it('writes quota_alert inbox rows with payload JSON and no user_roles dependency', async () => {
    const { notifyQuotaAlert } = await import('../quota.js');

    await notifyQuotaAlert('ws-1', 'agent_runs', 80, 8, 10, '2026-03-07');

    expect(listWorkspaceAdmins).toHaveBeenCalledWith('ws-1');

    const queryTexts = mockPool.query.mock.calls.map(([sql]) => String(sql));
    expect(queryTexts.some((sql) => sql.includes('user_roles'))).toBe(false);

    const inboxInsert = mockPool.query.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO inbox_notifications')
    );
    expect(inboxInsert).toBeTruthy();
    expect(inboxInsert?.[1]?.[0]).toBe('admin-1');
    expect(inboxInsert?.[1]?.[1]).toBe('ws-1');

    const payload = JSON.parse(String(inboxInsert?.[1]?.[2]));
    expect(payload).toEqual({
      title: 'Quota 警告',
      message: 'Quota 警告：agent_runs 用量已達 80%（8/10，週期 2026-03-07）',
      resource_type: 'agent_runs',
      used: 8,
      limit: 10,
      period: '2026-03-07',
      threshold_pct: 80,
    });
  });
});
