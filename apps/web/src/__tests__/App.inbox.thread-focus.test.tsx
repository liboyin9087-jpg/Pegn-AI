import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../App';

const editorRenderSpy = vi.hoisted(() => vi.fn());

const apiMocks = vi.hoisted(() => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
  clearToken: vi.fn(),
  getMe: vi.fn(),
  setOfflineRolloutUserId: vi.fn(),
  listWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  listDocuments: vi.fn(),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  renameDocument: vi.fn(),
  acceptInvite: vi.fn(),
  listInboxNotifications: vi.fn(),
  markInboxNotificationRead: vi.fn(),
  markAllInboxNotificationsRead: vi.fn(),
  getOfflineQueueDepth: vi.fn(),
  onOfflineQueueChange: vi.fn(),
  replayQueuedMutations: vi.fn(),
  reportOfflineQueueMetrics: vi.fn(),
}));

vi.mock('../api/client', () => ({
  ...apiMocks,
}));

vi.mock('../hooks/useCollections', () => ({
  useCollections: () => ({
    collections: [],
    addCollection: vi.fn(),
  }),
  useCollectionViews: () => ({
    views: [],
    addView: vi.fn(),
  }),
}));

vi.mock('../components/AuthPage', () => ({
  default: () => <div>Auth</div>,
}));

vi.mock('../components/Sidebar', () => ({
  default: (props: any) => (
    <div data-testid="sidebar-mock">
      <button onClick={props.onOpenInbox}>open-inbox</button>
      <span data-testid="sidebar-unread">{props.inboxUnreadCount}</span>
    </div>
  ),
}));

vi.mock('../components/Editor', () => ({
  default: (props: any) => {
    editorRenderSpy(props);
    return (
      <div data-testid="editor-mock">
        {`doc:${props.doc?.id ?? 'none'}|focus:${props.focusThreadId ?? ''}`}
      </div>
    );
  },
}));

vi.mock('../components/InboxPanel', () => ({
  default: (props: any) => {
    if (!props.open) return null;
    return (
      <div data-testid="inbox-panel-mock">
        <span data-testid="inbox-unread">{props.unreadCount}</span>
        <button onClick={props.onMarkAllRead}>mark-all</button>
        {props.notifications.map((notification: any) => (
          <button
            key={notification.id}
            onClick={() => props.onOpenNotification(notification)}
          >
            {`open-${notification.id}`}
          </button>
        ))}
      </div>
    );
  },
}));

vi.mock('../components/AiSheet', () => ({
  default: () => null,
}));

vi.mock('../components/CommandBar', () => ({
  default: () => null,
}));

vi.mock('../components/OnboardingModal', () => ({
  default: () => null,
}));

vi.mock('../components/UploadModal', () => ({
  default: () => null,
}));

vi.mock('../components/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/agent-dashboard/DashboardShowcase', () => ({
  DashboardShowcase: () => null,
}));

vi.mock('../components/database/CollectionView', () => ({
  CollectionView: () => null,
}));

describe('App inbox thread focus integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();

    const notifications = [
      {
        id: 'n1',
        workspace_id: 'ws-1',
        user_id: 'user-1',
        type: 'mention',
        payload: {
          workspace_id: 'ws-1',
          document_id: 'doc-2',
          thread_id: 'thread-1',
          comment_id: 'comment-1',
          mentioned_by: 'user-2',
          preview: 'please review',
        },
        status: 'unread',
        created_at: new Date().toISOString(),
      },
      {
        id: 'n2',
        workspace_id: 'ws-1',
        user_id: 'user-1',
        type: 'mention',
        payload: {
          workspace_id: 'ws-1',
          document_id: 'doc-1',
          thread_id: 'thread-2',
          comment_id: 'comment-2',
          mentioned_by: 'user-3',
          preview: 'another ping',
        },
        status: 'unread',
        created_at: new Date().toISOString(),
      },
    ];

    apiMocks.getToken.mockReturnValue('token');
    apiMocks.getMe.mockResolvedValue({ user: { id: 'user-1', email: 'user@example.com' } });
    apiMocks.listWorkspaces.mockResolvedValue({
      workspaces: [{ id: 'ws-1', name: 'Workspace 1' }],
    });
    apiMocks.createWorkspace.mockResolvedValue({ id: 'ws-1', name: 'Workspace 1' });
    apiMocks.listDocuments.mockResolvedValue({
      documents: [
        { id: 'doc-1', title: 'Doc 1', metadata: {} },
        { id: 'doc-2', title: 'Doc 2', metadata: {} },
      ],
    });
    apiMocks.acceptInvite.mockResolvedValue({ success: true });
    apiMocks.listInboxNotifications
      .mockResolvedValueOnce({ notifications, unread_count: 2 })
      .mockResolvedValueOnce({ notifications, unread_count: 2 })
      .mockResolvedValueOnce({
        notifications: notifications.map((item, idx) => (
          idx === 0 ? { ...item, status: 'read', read_at: new Date().toISOString() } : item
        )),
        unread_count: 1,
      });
    apiMocks.markInboxNotificationRead.mockResolvedValue({
      notification: { id: 'n1', status: 'read', read_at: new Date().toISOString() },
    });
    apiMocks.markAllInboxNotificationsRead.mockResolvedValue({ updated: 1 });
    apiMocks.getOfflineQueueDepth.mockResolvedValue(0);
    apiMocks.onOfflineQueueChange.mockImplementation(() => () => {});
    apiMocks.replayQueuedMutations.mockResolvedValue({
      processed: 0,
      failed: 0,
      processed_ids: [],
      failed_ids: [],
    });
    apiMocks.reportOfflineQueueMetrics.mockResolvedValue({ accepted: true });
  });

  it('navigates to notification target and keeps unread flows correct', async () => {
    render(<App />);

    await screen.findByTestId('sidebar-mock');
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-unread')).toHaveTextContent('2');
    });

    fireEvent.click(screen.getByText('open-inbox'));
    await screen.findByTestId('inbox-panel-mock');

    fireEvent.click(screen.getByText('open-n1'));

    await waitFor(() => {
      expect(apiMocks.markInboxNotificationRead).toHaveBeenCalledWith('n1');
    });
    await waitFor(() => {
      expect(screen.getByTestId('editor-mock')).toHaveTextContent('doc:doc-2|focus:thread-1');
    });
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-unread')).toHaveTextContent('1');
    });

    fireEvent.click(screen.getByText('open-inbox'));
    await screen.findByTestId('inbox-panel-mock');
    fireEvent.click(screen.getByText('mark-all'));

    await waitFor(() => {
      expect(apiMocks.markAllInboxNotificationsRead).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByTestId('sidebar-unread')).toHaveTextContent('0');
    });
  });
});
