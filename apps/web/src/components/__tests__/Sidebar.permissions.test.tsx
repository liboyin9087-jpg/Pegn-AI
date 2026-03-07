import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Sidebar from '../Sidebar';
import type { WorkspaceMembershipSummary } from '../../api/client';

const adminMembership: WorkspaceMembershipSummary = {
  effectiveRole: 'admin',
  permissions: ['workspace:read', 'collection:create', 'collection:delete'],
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

function renderSidebar(workspaceMembershipSummary: WorkspaceMembershipSummary) {
  return render(
    <Sidebar
      workspace={{ id: 'ws-1', name: 'Alpha' }}
      documents={[{ id: 'doc-1', title: 'Roadmap', metadata: {} }]}
      collections={[]}
      activeDoc={null}
      activeCollection={null}
      user={{ id: 'user-1', name: 'Alex', email: 'alex@example.com' }}
      onSelectDoc={() => {}}
      onSelectCollection={() => {}}
      onNewDoc={() => {}}
      onNewCollection={() => {}}
      onUpload={() => {}}
      onDeleteDoc={() => {}}
      onRenameDoc={() => {}}
      onLogout={() => {}}
      workspaceMembershipSummary={workspaceMembershipSummary}
    />
  );
}

describe('Sidebar permissions', () => {
  it('shows read-only workspace copy for viewers', () => {
    renderSidebar(viewerMembership);

    expect(screen.getByText('Read-only workspace')).toBeInTheDocument();
    expect(screen.getByText(/view access only/i)).toBeInTheDocument();
  });

  it('does not show read-only copy for admins', () => {
    renderSidebar(adminMembership);

    expect(screen.queryByText('Read-only workspace')).not.toBeInTheDocument();
  });
});
