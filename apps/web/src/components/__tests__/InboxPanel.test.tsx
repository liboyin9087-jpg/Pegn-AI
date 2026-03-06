import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import InboxPanel from '../InboxPanel';

describe('InboxPanel', () => {
  it('renders mention, quota_alert, automation, and unknown notifications', () => {
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
          {
            id: 'n2',
            workspace_id: 'ws1',
            user_id: 'u1',
            type: 'quota_alert',
            payload: {
              title: 'Quota 警告',
              message: 'Quota reached 80%',
              resource_type: 'agent_runs',
              used: 8,
              limit: 10,
              period: '2026-03-07',
              threshold_pct: 80,
            },
            status: 'read',
            created_at: new Date().toISOString(),
          },
          {
            id: 'n3',
            workspace_id: 'ws1',
            user_id: 'u1',
            type: 'automation',
            payload: {
              title: 'Automation',
              message: 'Workflow completed',
            },
            status: 'read',
            created_at: new Date().toISOString(),
          },
          {
            id: 'n4',
            workspace_id: 'ws1',
            user_id: 'u1',
            type: 'unknown',
            payload: {
              title: '系統通知',
              message: 'Unknown notification',
              raw_type: 'legacy_type',
            },
            status: 'read',
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
    expect(screen.getByText('提及你於留言串')).toBeInTheDocument();
    expect(screen.getByText('Quota 警告')).toBeInTheDocument();
    expect(screen.getByText('Automation')).toBeInTheDocument();
    expect(screen.getByText('系統通知')).toBeInTheDocument();

    fireEvent.click(screen.getByText('全部標記已讀'));
    expect(onMarkAllRead).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Hello @you'));
    expect(onOpenNotification).toHaveBeenCalledTimes(1);
  });
});
