import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AdminAlertsPanel from '../AdminAlertsPanel';

describe('AdminAlertsPanel', () => {
  it('renders alerts and deep-links to related surfaces', () => {
    const onOpenOperations = vi.fn();
    const onOpenSearch = vi.fn();
    const onFocusUsage = vi.fn();
    render(
      <AdminAlertsPanel
        items={[
          {
            id: 'alert-1',
            type: 'recent_failed_jobs_spike',
            severity: 'critical',
            title: 'Recent failed jobs spike',
            description: 'There are many failed jobs.',
            relatedTargetType: 'job',
            relatedTargetId: 'job-1',
            createdAt: '2026-03-07T00:00:00.000Z',
          },
          {
            id: 'alert-2',
            type: 'quota_threshold_reached',
            severity: 'warning',
            title: 'Quota threshold reached',
            description: 'Usage is high.',
            relatedTargetType: 'quota',
            relatedTargetId: 'ws-1',
            createdAt: '2026-03-07T00:00:00.000Z',
          },
        ]}
        onOpenOperations={onOpenOperations}
        onOpenSearch={onOpenSearch}
        onFocusUsage={onFocusUsage}
      />
    );

    fireEvent.click(screen.getByText('Recent failed jobs spike'));
    expect(onOpenOperations).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Quota threshold reached'));
    expect(onFocusUsage).toHaveBeenCalledTimes(1);
    expect(onOpenSearch).not.toHaveBeenCalled();
  });
});
