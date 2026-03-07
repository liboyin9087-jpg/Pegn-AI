import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import UsageQuotaPanel from '../UsageQuotaPanel';

describe('UsageQuotaPanel', () => {
  it('renders usage summary and quota state', () => {
    render(
      <UsageQuotaPanel
        usage={{
          documentsCount: 12,
          indexedDocumentsCount: 9,
          agentRunsLast7d: 4,
          agentRunsLast30d: 10,
          failedJobsLast7d: 2,
          failedJobsLast30d: 4,
          artifactsBytes: 2048,
          quota: {
            documentsLimit: null,
            storageBytesLimit: null,
            agentRunsMonthlyLimit: 600,
            percentUsed: 80,
            thresholdReached: true,
          },
          quotaStatus: 'warning',
        }}
      />
    );

    expect(screen.getByText('Usage & quota')).toBeInTheDocument();
    expect(screen.getByText('80% used')).toBeInTheDocument();
    expect(screen.getByText('2048')).toBeInTheDocument();
  });
});
