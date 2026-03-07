import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SavedViewPicker from '../SavedViewPicker';
import { AppContextProvider, type AppContextValue } from '../../contexts/AppContext';

const clientMocks = vi.hoisted(() => ({
  listSavedViews: vi.fn(),
  getSavedView: vi.fn(),
  deleteSavedView: vi.fn(),
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    ...clientMocks,
  };
});

function renderWithContext(canManageSettings = true) {
  const value: AppContextValue = {
    user: { id: 'user-1' },
    workspace: null,
    workspacePermissions: {
      canViewWorkspace: true,
      canManageMembers: false,
      canManageSettings,
      canEditDocuments: true,
      canDeleteDocuments: true,
      canRunAutomation: true,
    },
    workspaceMembershipSummary: null,
    documents: [],
    collections: [],
    activeDoc: null,
    setActiveDoc: vi.fn(),
    handleSelectDoc: vi.fn(),
    handleNewDoc: vi.fn(),
    activeCollection: null,
    setActiveCollection: vi.fn(),
    handleSelectCollection: vi.fn(),
    sidebarOpen: true,
    setSidebarOpen: vi.fn(),
    presentationMode: false,
    setPresentationMode: vi.fn(),
    showTaskModal: false,
    editingItem: null,
    openTaskModal: vi.fn(),
    openEditModal: vi.fn(),
    closeTaskModal: vi.fn(),
    openSurfaceTarget: vi.fn(),
    requestRefresh: vi.fn(),
    refreshVersions: { search: 0, agentRuns: 0, jobs: 0, admin: 0, audit: 0, inbox: 0 },
  };

  const onApplyView = vi.fn();

  render(
    <AppContextProvider value={value}>
      <SavedViewPicker
        open
        workspaceId="ws-1"
        surface="search"
        onClose={() => undefined}
        onApplyView={onApplyView}
      />
    </AppContextProvider>
  );

  return { onApplyView };
}

describe('SavedViewPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.listSavedViews.mockResolvedValue({
      items: [
        {
          id: 'view-1',
          workspaceId: 'ws-1',
          ownerUserId: 'user-1',
          scope: 'personal',
          surface: 'search',
          name: 'Pinned personal',
          description: null,
          isPinned: true,
          isDefault: true,
          createdAt: '2026-03-07T12:00:00.000Z',
          updatedAt: '2026-03-07T12:00:00.000Z',
        },
        {
          id: 'view-2',
          workspaceId: 'ws-1',
          ownerUserId: 'user-2',
          scope: 'workspace',
          surface: 'search',
          name: 'Shared search',
          description: 'team view',
          isPinned: false,
          isDefault: false,
          createdAt: '2026-03-07T11:00:00.000Z',
          updatedAt: '2026-03-07T11:00:00.000Z',
        },
      ],
    });
    clientMocks.getSavedView.mockResolvedValue({
      id: 'view-1',
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      scope: 'personal',
      surface: 'search',
      name: 'Pinned personal',
      description: null,
      contextVersion: 1,
      payload: { query: 'alpha' },
      isPinned: true,
      isDefault: true,
      createdAt: '2026-03-07T12:00:00.000Z',
      updatedAt: '2026-03-07T12:00:00.000Z',
    });
    clientMocks.deleteSavedView.mockResolvedValue(undefined);
  });

  it('renders grouped saved views and applies a selection', async () => {
    const { onApplyView } = renderWithContext();

    expect(await screen.findByText('Pinned personal')).toBeInTheDocument();
    expect(screen.getByText('Shared search')).toBeInTheDocument();

    fireEvent.click(screen.getAllByText('Apply')[0]);

    await waitFor(() => {
      expect(clientMocks.getSavedView).toHaveBeenCalledWith('ws-1', 'view-1');
    });
    expect(onApplyView).toHaveBeenCalledWith(expect.objectContaining({
      id: 'view-1',
      contextVersion: 1,
    }));
  });

  it('allows deleting owned personal views', async () => {
    renderWithContext(false);

    fireEvent.click(await screen.findByText('Delete'));

    await waitFor(() => {
      expect(clientMocks.deleteSavedView).toHaveBeenCalledWith('ws-1', 'view-1');
    });
  });
});
