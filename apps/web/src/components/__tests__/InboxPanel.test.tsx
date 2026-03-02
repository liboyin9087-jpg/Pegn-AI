import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import InboxPanel from '../InboxPanel';

describe('InboxPanel', () => {
  it('renders unread notification and handles actions', () => {
    const onClose = vi.fn();
    const onOpenNotification = vi.fn();
    const onMarkRead = vi.fn();
    const onMarkAllRead = vi.fn();

    render(
      <InboxPanel
        open
        notifications={[
          {
            id: 'n1',
            workspace_id: 'ws1',
            user_id: 'u1',
            type: 'mention',
            payload: {
              workspace_id: 'ws1',
              document_id: 'doc1',
              thread_id: 't1',
              comment_id: 'c1',
              mentioned_by: 'u2',
              preview: 'Hello @you',
            },
            status: 'unread',
            created_at: new Date().toISOString(),
          },
        ]}
        unreadCount={1}
        onClose={onClose}
        onOpenNotification={onOpenNotification}
        onMarkRead={onMarkRead}
        onMarkAllRead={onMarkAllRead}
      />
    );

    expect(screen.getByText('Inbox')).toBeInTheDocument();
    fireEvent.click(screen.getByText('全部已讀'));
    expect(onMarkAllRead).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('提及你於留言串'));
    expect(onOpenNotification).toHaveBeenCalledTimes(1);
  });
});
