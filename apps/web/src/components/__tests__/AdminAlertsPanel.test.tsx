import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AdminAlertsPanel from '../AdminAlertsPanel';

describe('AdminAlertsPanel', () => {
  it('renders alerts and deep-links to related surfaces', () => {
    const onOpenTarget = vi.fn();
    render(
      <AdminAlertsPanel
        items={[
          {
            id: 'alert-1',
            type: 'recent_failed_jobs_spike',
            severity: 'critical',
            title: 'Recent failed jobs spike',
            description: 'There are many failed jobs.',
            target: { surface: 'operations', payload: { jobId: 'job-1', jobType: 'all' } },
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
            target: { surface: 'admin', payload: { section: 'usage' } },
            relatedTargetType: 'quota',
            relatedTargetId: 'ws-1',
            createdAt: '2026-03-07T00:00:00.000Z',
          },
        ]}
        onOpenTarget={onOpenTarget}
      />
    );

    fireEvent.click(screen.getByText('Recent failed jobs spike'));
    expect(onOpenTarget).toHaveBeenCalledWith(expect.objectContaining({ surface: 'operations' }));

    fireEvent.click(screen.getByText('Quota threshold reached'));
    expect(onOpenTarget).toHaveBeenCalledWith(expect.objectContaining({ surface: 'admin' }));
  });
});
