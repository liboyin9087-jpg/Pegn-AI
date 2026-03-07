import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AiSheet from '../AiSheet';
import { AppContextProvider, type AppContextValue } from '../../contexts/AppContext';

vi.mock('../GraphRAGChat', () => ({ default: () => null }));
vi.mock('../SearchPanel', () => ({ default: () => null }));
vi.mock('../AgentPanel', () => ({ default: () => null }));
vi.mock('../KGPanel', () => ({ default: () => null }));
vi.mock('../AutomationPanel', () => ({ default: () => null }));
vi.mock('../OperationsPanel', () => ({ default: () => null }));
vi.mock('../AdminTrustPanel', () => ({ default: () => <div>Admin trust panel</div> }));

function renderWithContext(canManageSettings: boolean) {
  const value: AppContextValue = {
    user: { id: 'user-1' },
    workspace: null,
    workspacePermissions: {
      canViewWorkspace: true,
      canManageMembers: canManageSettings,
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
  };

  return render(
    <AppContextProvider value={value}>
      <AiSheet open onClose={() => {}} workspaceId="ws-1" />
    </AppContextProvider>
  );
}

describe('AiSheet admin tab visibility', () => {
  it('shows admin tab for workspace admins', () => {
    renderWithContext(true);
    expect(screen.getByText('Admin')).toBeInTheDocument();
  });

  it('hides admin tab for non-admin users', () => {
    renderWithContext(false);
    expect(screen.queryByText('Admin')).not.toBeInTheDocument();
  });
});
