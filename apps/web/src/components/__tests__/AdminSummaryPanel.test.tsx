import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import AdminSummaryPanel from '../AdminSummaryPanel';

describe('AdminSummaryPanel', () => {
  it('renders key governance metrics', () => {
    render(
      <AdminSummaryPanel
        summary={{
          workspace: { id: 'ws-1', name: 'Alpha', description: null, updatedAt: null },
          memberCounts: { membersTotal: 4 },
          documentsSummary: { documentsTotal: 12, indexedDocumentsTotal: 9, staleDocumentsTotal: 2 },
          searchSummary: { totalDocuments: 12, pendingDocuments: 0, indexedDocuments: 9, staleDocuments: 2, failedDocuments: 1, lastIndexedAt: null },
          agentSummary: { agentRunsLast7d: 5, agentRunsLast30d: 11 },
          jobsSummary: { total: 8, queued: 0, running: 1, succeeded: 5, failed: 1, cancelled: 0, timeout: 1, byType: { document_index: 1, document_reindex: 1, agent_run: 4, automation_trigger: 2 }, latestFailedAt: null },
          usageSummary: {
            documentsCount: 12,
            indexedDocumentsCount: 9,
            agentRunsLast7d: 5,
            agentRunsLast30d: 11,
            failedJobsLast7d: 1,
            failedJobsLast30d: 2,
            artifactsBytes: 100,
            quota: { percentUsed: 25, thresholdReached: false },
            quotaStatus: 'ok',
          },
          alertsSummary: { total: 1, critical: 0, warning: 1 },
        }}
      />
    );

    expect(screen.getByText('Admin summary')).toBeInTheDocument();
    expect(screen.getByText('Members')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });
});
