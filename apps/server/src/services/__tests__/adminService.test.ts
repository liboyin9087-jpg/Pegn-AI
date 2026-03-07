import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPool = { query: vi.fn() };
const mockGetWorkspaceJobSummary = vi.fn();
const mockGetIndexStatusSummary = vi.fn();

vi.mock('../../db/client.js', () => ({ pool: mockPool }));
vi.mock('../jobService.js', () => ({
  getWorkspaceJobSummary: (...args: any[]) => mockGetWorkspaceJobSummary(...args),
}));
vi.mock('../search.js', () => ({
  searchService: {
    getIndexStatusSummary: (...args: any[]) => mockGetIndexStatusSummary(...args),
  },
}));

describe('adminService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetWorkspaceJobSummary.mockResolvedValue({
      total: 4,
      queued: 0,
      running: 1,
      succeeded: 1,
      failed: 1,
      cancelled: 0,
      timeout: 1,
      byType: {
        document_index: 1,
        document_reindex: 1,
        agent_run: 1,
        automation_trigger: 1,
      },
      latestFailedAt: '2026-03-07T00:00:00.000Z',
    });
    mockGetIndexStatusSummary.mockResolvedValue({
      totalDocuments: 10,
      pendingDocuments: 0,
      indexedDocuments: 8,
      staleDocuments: 2,
      failedDocuments: 1,
      lastIndexedAt: '2026-03-07T00:00:00.000Z',
    });
  });

  it('records append-only audit logs', async () => {
    const { recordAuditLog } = await import('../admin.js');
    mockPool.query.mockResolvedValue({ rows: [], rowCount: 1 });

    await recordAuditLog({
      workspaceId: 'ws-1',
      actorId: 'user-1',
      actorDisplay: 'admin@example.com',
      eventType: 'workspace_updated',
      targetType: 'workspace',
      targetId: 'ws-1',
      summary: 'Workspace updated',
      metadata: { changed: true },
    });

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO audit_logs'),
      expect.arrayContaining(['ws-1', 'user-1', 'admin@example.com', 'workspace_updated'])
    );
  });

  it('builds usage summary from aggregation queries', async () => {
    const { getWorkspaceUsageSummary } = await import('../admin.js');
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ documents_count: 12, indexed_documents_count: 9 }] })
      .mockResolvedValueOnce({ rows: [{ artifacts_bytes: 4096 }] })
      .mockResolvedValueOnce({ rows: [{ runs_7d: 3, runs_30d: 11 }] })
      .mockResolvedValueOnce({ rows: [{ failed_7d: 2, failed_30d: 4 }] })
      .mockResolvedValueOnce({ rows: [{ agent_runs_per_day: 20 }] })
      .mockResolvedValueOnce({ rows: [{ agent_runs_last_30d: 8 }] });

    const summary = await getWorkspaceUsageSummary('ws-1');

    expect(summary.documentsCount).toBe(12);
    expect(summary.indexedDocumentsCount).toBe(9);
    expect(summary.artifactsBytes).toBe(4096);
    expect(summary.agentRunsLast7d).toBe(3);
    expect(summary.failedJobsLast7d).toBe(2);
  });

  it('builds admin alerts from usage, jobs, and search state', async () => {
    const { getWorkspaceAdminAlerts } = await import('../admin.js');
    mockPool.query
      .mockResolvedValueOnce({ rows: [{ documents_count: 12, indexed_documents_count: 9 }] })
      .mockResolvedValueOnce({ rows: [{ artifacts_bytes: 4096 }] })
      .mockResolvedValueOnce({ rows: [{ runs_7d: 7, runs_30d: 11 }] })
      .mockResolvedValueOnce({ rows: [{ failed_7d: 6, failed_30d: 8 }] })
      .mockResolvedValueOnce({ rows: [{ agent_runs_per_day: 1 }] })
      .mockResolvedValueOnce({ rows: [{ agent_runs_last_30d: 40 }] });

    const alerts = await getWorkspaceAdminAlerts('ws-1');

    expect(alerts.items.map((item) => item.type)).toEqual(expect.arrayContaining([
      'recent_failed_jobs_spike',
      'stale_documents_present',
      'indexing_failures_present',
      'quota_threshold_reached',
    ]));
  });

  it('returns admin summary with counts and quota status', async () => {
    const { getWorkspaceAdminSummary } = await import('../admin.js');
    mockPool.query.mockImplementation(async (sql: string) => {
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();
      if (normalized.includes('from workspaces')) {
        return { rows: [{ id: 'ws-1', name: 'Workspace', description: null, updated_at: '2026-03-07T00:00:00.000Z' }] };
      }
      if (normalized.includes('from workspace_members')) {
        return { rows: [{ members_total: 5 }] };
      }
      if (normalized.includes('from documents')) {
        return { rows: [{ documents_count: 12, indexed_documents_count: 9 }] };
      }
      if (normalized.includes('from agent_artifacts')) {
        return { rows: [{ artifacts_bytes: 4096 }] };
      }
      if (normalized.includes('from agent_runs')) {
        return { rows: [{ runs_7d: 3, runs_30d: 11 }] };
      }
      if (normalized.includes('from jobs')) {
        return { rows: [{ failed_7d: 2, failed_30d: 4 }] };
      }
      if (normalized.includes('from quota_limits')) {
        return { rows: [{ agent_runs_per_day: 20 }] };
      }
      if (normalized.includes('from usage_records')) {
        return { rows: [{ agent_runs_last_30d: 8 }] };
      }
      return { rows: [] };
    });

    const summary = await getWorkspaceAdminSummary('ws-1');

    expect(summary.memberCounts.membersTotal).toBe(5);
    expect(summary.documentsSummary.documentsTotal).toBe(12);
    expect(summary.usageSummary.quotaStatus).toBeDefined();
    expect(summary.alertsSummary.total).toBeGreaterThanOrEqual(0);
  });
});
