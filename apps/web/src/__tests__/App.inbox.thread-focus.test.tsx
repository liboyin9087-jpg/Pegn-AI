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
  updateDocument: vi.fn(),
  moveDocument: vi.fn(),
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
          <button key={notification.id} onClick={() => props.onOpenNotification(notification)}>
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

vi.mock('../components/TaskModal', () => ({
  default: () => null,
}));

vi.mock('../components/PresentationOverlay', () => ({
  default: () => null,
}));

vi.mock('../components/ErrorBoundary', () => ({
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../components/database/CollectionView', () => ({
  CollectionView: () => null,
}));

function createNotifications() {
  return [
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
      status: 'unread',
      created_at: new Date().toISOString(),
    },
    {
      id: 'n3',
      workspace_id: 'ws-1',
      user_id: 'user-1',
      type: 'automation',
      payload: {
        title: 'Automation',
        message: 'Workflow completed',
      },
      status: 'unread',
      created_at: new Date().toISOString(),
    },
    {
      id: 'n4',
      workspace_id: 'ws-1',
      user_id: 'user-1',
      type: 'unknown',
      payload: {
        title: '系統通知',
        message: 'Unknown notification',
        raw_type: 'legacy_type',
      },
      status: 'unread',
      created_at: new Date().toISOString(),
    },
  ];
}

function setupBaseMocks() {
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
  apiMocks.markInboxNotificationRead.mockResolvedValue({
    notification: { id: 'n1', status: 'read', read_at: new Date().toISOString() },
  });
  apiMocks.markAllInboxNotificationsRead.mockResolvedValue({ updated: 4 });
  apiMocks.getOfflineQueueDepth.mockResolvedValue(0);
  apiMocks.onOfflineQueueChange.mockImplementation(() => () => {});
  apiMocks.replayQueuedMutations.mockResolvedValue({
    processed: 0,
    failed: 0,
    processed_ids: [],
    failed_ids: [],
  });
  apiMocks.reportOfflineQueueMetrics.mockResolvedValue({ accepted: true });
}

async function renderAuthedApp(notifications = createNotifications()) {
  setupBaseMocks();
  apiMocks.listInboxNotifications.mockResolvedValue({
    notifications,
    unread_count: notifications.filter((item) => item.status === 'unread').length,
  });

  render(<App />);
  await screen.findByTestId('sidebar-mock');
  await waitFor(() => {
    expect(screen.getByTestId('editor-mock')).toHaveTextContent('doc:doc-1|focus:');
  });
}

describe('App inbox thread focus integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
  });

  it('opens a mention notification and routes to the document/thread', async () => {
    await renderAuthedApp();

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
      expect(screen.queryByTestId('inbox-panel-mock')).not.toBeInTheDocument();
    });
  });

  it('opens a quota alert without rerouting the active document', async () => {
    await renderAuthedApp();

    fireEvent.click(screen.getByText('open-inbox'));
    await screen.findByTestId('inbox-panel-mock');
    fireEvent.click(screen.getByText('open-n2'));

    await waitFor(() => {
      expect(apiMocks.markInboxNotificationRead).toHaveBeenCalledWith('n2');
    });
    expect(screen.getByTestId('editor-mock')).toHaveTextContent('doc:doc-1|focus:');
    await waitFor(() => {
      expect(screen.queryByTestId('inbox-panel-mock')).not.toBeInTheDocument();
    });
  });

  it('opens an automation notification and closes inbox safely', async () => {
    await renderAuthedApp();

    fireEvent.click(screen.getByText('open-inbox'));
    await screen.findByTestId('inbox-panel-mock');
    fireEvent.click(screen.getByText('open-n3'));

    await waitFor(() => {
      expect(apiMocks.markInboxNotificationRead).toHaveBeenCalledWith('n3');
    });
    expect(screen.getByTestId('editor-mock')).toHaveTextContent('doc:doc-1|focus:');
    await waitFor(() => {
      expect(screen.queryByTestId('inbox-panel-mock')).not.toBeInTheDocument();
    });
  });

  it('opens an unknown notification without crashing', async () => {
    await renderAuthedApp();

    fireEvent.click(screen.getByText('open-inbox'));
    await screen.findByTestId('inbox-panel-mock');
    fireEvent.click(screen.getByText('open-n4'));

    await waitFor(() => {
      expect(apiMocks.markInboxNotificationRead).toHaveBeenCalledWith('n4');
    });
    expect(screen.getByTestId('editor-mock')).toHaveTextContent('doc:doc-1|focus:');
    await waitFor(() => {
      expect(screen.queryByTestId('inbox-panel-mock')).not.toBeInTheDocument();
    });
  });
});
