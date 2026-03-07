import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import ShareModal from '../ShareModal';
import type { WorkspaceMembershipSummary } from '../../api/client';

const clientMocks = vi.hoisted(() => ({
  listWorkspaceMembers: vi.fn(),
  listWorkspaceInvites: vi.fn(),
  createWorkspaceInvite: vi.fn(),
  revokeWorkspaceInvite: vi.fn(),
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    listWorkspaceMembers: clientMocks.listWorkspaceMembers,
    listWorkspaceInvites: clientMocks.listWorkspaceInvites,
    createWorkspaceInvite: clientMocks.createWorkspaceInvite,
    revokeWorkspaceInvite: clientMocks.revokeWorkspaceInvite,
  };
});

const adminMembership: WorkspaceMembershipSummary = {
  effectiveRole: 'admin',
  permissions: ['workspace:read', 'workspace:members:manage'],
  permissionSummary: {
    canViewWorkspace: true,
    canManageMembers: true,
    canManageSettings: true,
    canEditDocuments: true,
    canDeleteDocuments: true,
    canRunAutomation: true,
    canCollaborate: true,
    canManageAssignments: true,
  },
};

const viewerMembership: WorkspaceMembershipSummary = {
  effectiveRole: 'viewer',
  permissions: ['workspace:read'],
  permissionSummary: {
    canViewWorkspace: true,
    canManageMembers: false,
    canManageSettings: false,
    canEditDocuments: false,
    canDeleteDocuments: false,
    canRunAutomation: false,
    canCollaborate: false,
    canManageAssignments: false,
  },
};

describe('ShareModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.listWorkspaceMembers.mockResolvedValue({
      members: [
        {
          id: 'member-1',
          workspace_id: 'ws-1',
          user_id: 'user-1',
          name: 'Alex',
          email: 'alex@example.com',
          role: 'admin',
        },
      ],
    });
    clientMocks.listWorkspaceInvites.mockResolvedValue({ invites: [] });
  });

  it('shows invite controls for admins', async () => {
    render(
      <ShareModal
        isOpen
        onClose={() => {}}
        workspaceId="ws-1"
        workspaceName="Alpha"
        workspaceMembershipSummary={adminMembership}
      />
    );

    expect(await screen.findByText('Share "Alpha"')).toBeInTheDocument();
    expect(screen.getByText('Invite')).toBeInTheDocument();
    await waitFor(() => {
      expect(clientMocks.listWorkspaceInvites).toHaveBeenCalledWith('ws-1');
    });
  });

  it('shows read-only sharing for viewers and skips invite queries', async () => {
    render(
      <ShareModal
        isOpen
        onClose={() => {}}
        workspaceId="ws-1"
        workspaceName="Alpha"
        workspaceMembershipSummary={viewerMembership}
      />
    );

    expect(await screen.findByText('Read-only sharing')).toBeInTheDocument();
    expect(screen.getByText(/only managers can change invites/i)).toBeInTheDocument();
    expect(screen.queryByText('Invite')).not.toBeInTheDocument();
    expect(clientMocks.listWorkspaceInvites).not.toHaveBeenCalled();
  });
});
