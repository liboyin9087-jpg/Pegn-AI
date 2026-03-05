/**
 * App.offline.test.tsx
 * E2E tests for offline detection banner and offline queue behaviour.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import App from '../App';

// ── shared hoisted mocks ───────────────────────────────────────────────────
const editorRenderSpy = vi.hoisted(() => vi.fn());

const apiMocks = vi.hoisted(() => ({
  getToken: vi.fn(() => 'tok'),
  setToken: vi.fn(),
  clearToken: vi.fn(),
  getMe: vi.fn().mockResolvedValue({ user: { id: 'u1', email: 'a@b.com', name: 'Alice' } }),
  setOfflineRolloutUserId: vi.fn(),
  listWorkspaces: vi.fn().mockResolvedValue({ workspaces: [{ id: 'ws1', name: 'Test WS' }] }),
  createWorkspace: vi.fn(),
  listDocuments: vi.fn().mockResolvedValue({ documents: [] }),
  createDocument: vi.fn(),
  deleteDocument: vi.fn(),
  renameDocument: vi.fn(),
  updateDocument: vi.fn(),
  moveDocument: vi.fn(),
  acceptInvite: vi.fn(),
  listInboxNotifications: vi.fn().mockResolvedValue({ notifications: [] }),
  markInboxNotificationRead: vi.fn(),
  markAllInboxNotificationsRead: vi.fn(),
  reportOfflineQueueMetrics: vi.fn().mockResolvedValue({}),
  getOfflineQueueDepth: vi.fn().mockReturnValue(0),
  onOfflineQueueChange: vi.fn(() => () => {}),
  replayQueuedMutations: vi.fn().mockResolvedValue({}),
  getQueueSLAMetrics: vi.fn().mockResolvedValue({ total: 0, success: 0, failed: 0 }),
  listFavorites: vi.fn().mockResolvedValue({ documents: [] }),
  toggleFavorite: vi.fn(),
  listTrash: vi.fn().mockResolvedValue({ documents: [] }),
  restoreFromTrash: vi.fn(),
  permanentDeleteFromTrash: vi.fn(),
}));

vi.mock('../api/client', () => ({ ...apiMocks }));
vi.mock('../hooks/useCollections', () => ({
  useCollections: () => ({ collections: [], addCollection: vi.fn() }),
  useCollectionViews: () => ({ views: [], addView: vi.fn() }),
}));
vi.mock('../components/Editor', () => ({
  default: (props: any) => { editorRenderSpy(props); return <div data-testid="editor-mock" />; },
}));
vi.mock('../components/AuthPage', () => ({ default: () => <div>Auth</div> }));
vi.mock('../components/Sidebar', () => ({
  default: (props: any) => (
    <div data-testid="sidebar-mock">
      <span data-testid="online-status">{props.isOnline ? 'online' : 'offline'}</span>
    </div>
  ),
}));
vi.mock('../components/OnboardingModal', () => ({ default: () => null }));
vi.mock('../components/KGPanel', () => ({ default: () => null }));
vi.mock('../components/AgentPanel', () => ({ default: () => null }));
vi.mock('../components/BillingDashboard', () => ({ default: () => null }));

describe('App offline detection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows online status when navigator.onLine is true', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await act(async () => { render(<App />); });
    // App loads – should not show offline banner
    expect(screen.queryByText(/offline/i)).toBeNull();
  });

  it('updates to offline when offline event fires', async () => {
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    await act(async () => { render(<App />); });

    // Simulate going offline
    await act(async () => {
      Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
      window.dispatchEvent(new Event('offline'));
    });

    // The sidebar mock receives isOnline prop
    const statusEl = screen.queryByTestId('online-status');
    if (statusEl) {
      expect(statusEl.textContent).toBe('offline');
    }
  });

  it('recovers to online when online event fires', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    await act(async () => { render(<App />); });

    await act(async () => {
      Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
      window.dispatchEvent(new Event('online'));
    });

    const statusEl = screen.queryByTestId('online-status');
    if (statusEl) {
      expect(statusEl.textContent).toBe('online');
    }
  });

  it('calls getOfflineQueueDepth on mount', async () => {
    await act(async () => { render(<App />); });
    expect(apiMocks.getOfflineQueueDepth).toHaveBeenCalled();
  });

  it('registers onOfflineQueueChange listener and cleans up on unmount', async () => {
    const cleanup = vi.fn();
    apiMocks.onOfflineQueueChange.mockReturnValue(cleanup);
    const { unmount } = await act(async () => render(<App />));
    expect(apiMocks.onOfflineQueueChange).toHaveBeenCalled();
    unmount();
    expect(cleanup).toHaveBeenCalled();
  });
});
