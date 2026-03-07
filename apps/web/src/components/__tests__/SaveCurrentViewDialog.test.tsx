import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SaveCurrentViewDialog from '../SaveCurrentViewDialog';
import { AppContextProvider, type AppContextValue } from '../../contexts/AppContext';

const clientMocks = vi.hoisted(() => ({
  createSavedView: vi.fn(),
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    ...clientMocks,
  };
});

function renderWithContext(canManageSettings: boolean) {
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

  const onSaved = vi.fn();

  render(
    <AppContextProvider value={value}>
      <SaveCurrentViewDialog
        open
        workspaceId="ws-1"
        surface="search"
        payload={{ query: 'alpha', updatedRange: '7d' }}
        onClose={() => undefined}
        onSaved={onSaved}
      />
    </AppContextProvider>
  );

  return { onSaved };
}

describe('SaveCurrentViewDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.createSavedView.mockResolvedValue({
      id: 'view-1',
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      scope: 'personal',
      surface: 'search',
      name: 'Saved search',
      description: null,
      contextVersion: 1,
      payload: { query: 'alpha', updatedRange: '7d' },
      isPinned: false,
      isDefault: false,
      createdAt: '2026-03-07T12:00:00.000Z',
      updatedAt: '2026-03-07T12:00:00.000Z',
    });
  });

  it('creates a saved view with contextVersion=1', async () => {
    const { onSaved } = renderWithContext(true);

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Search alpha' } });
    fireEvent.click(screen.getByText('Save view'));

    await waitFor(() => {
      expect(clientMocks.createSavedView).toHaveBeenCalledWith('ws-1', expect.objectContaining({
        name: 'Search alpha',
        contextVersion: 1,
        payload: { query: 'alpha', updatedRange: '7d' },
      }));
    });
    expect(onSaved).toHaveBeenCalled();
  });

  it('disables workspace scope for users without manage settings permission', () => {
    renderWithContext(false);

    expect(screen.getByText('Only workspace admins can create shared views.')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Workspace' })).toBeDisabled();
  });
});
