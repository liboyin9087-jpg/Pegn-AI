import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AuditLogList from '../AuditLogList';

describe('AuditLogList', () => {
  it('renders audit items and load more button', () => {
    const onLoadMore = vi.fn();
    render(
      <AuditLogList
        items={[{
          id: 'audit-1',
          actorId: 'user-1',
          actorDisplay: 'admin@example.com',
          eventType: 'workspace_updated',
          targetType: 'workspace',
          targetId: 'ws-1',
          summary: 'Workspace updated',
          metadata: {},
          createdAt: '2026-03-07T00:00:00.000Z',
        }]}
        hasMore
        onLoadMore={onLoadMore}
      />
    );

    expect(screen.getByText('Workspace updated')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Load more'));
    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
