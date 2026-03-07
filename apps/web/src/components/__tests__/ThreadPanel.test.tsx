import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ThreadPanel from '../ThreadPanel';
import type { WorkspaceMembershipSummary } from '../../api/client';

const clientMocks = vi.hoisted(() => ({
  addThreadComment: vi.fn(),
  assignThread: vi.fn(),
  createOrGetThread: vi.fn(),
  getThreadDetail: vi.fn(),
  listThreads: vi.fn(),
  listWorkspaceMembers: vi.fn(),
  reopenThread: vi.fn(),
  resolveThread: vi.fn(),
}));

const appContextMocks = vi.hoisted(() => ({
  useOptionalAppContext: vi.fn(),
  useWorkspacePermissions: vi.fn(),
}));

vi.mock('../../api/client', () => clientMocks);
vi.mock('../../contexts/AppContext', () => appContextMocks);

const editorPermissions: WorkspaceMembershipSummary['permissionSummary'] = {
  canViewWorkspace: true,
  canManageMembers: false,
  canManageSettings: false,
  canEditDocuments: true,
  canDeleteDocuments: true,
  canRunAutomation: true,
  canCollaborate: true,
  canManageAssignments: true,
};

const viewerPermissions: WorkspaceMembershipSummary['permissionSummary'] = {
  canViewWorkspace: true,
  canManageMembers: false,
  canManageSettings: false,
  canEditDocuments: false,
  canDeleteDocuments: false,
  canRunAutomation: false,
  canCollaborate: false,
  canManageAssignments: false,
};

function makeThread(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    threadId: 'thread-1',
    workspaceId: 'ws-1',
    targetType: 'job',
    targetId: 'job-1',
    status: 'open',
    title: 'Investigate failed job',
    commentCount: 1,
    currentAssignment: null,
    sourceTarget: { surface: 'operations', payload: { jobId: 'job-1', jobType: 'all' } },
    createdByUserId: 'user-1',
    lastActivityAt: '2026-03-07T00:00:00.000Z',
    resolvedAt: null,
    comments: [
      {
        commentId: 'comment-1',
        threadId: 'thread-1',
        author: { userId: 'user-1', name: 'Alex', email: 'alex@example.com' },
        body: 'Need investigation.',
        mentionedUserIds: [],
        createdAt: '2026-03-07T00:00:00.000Z',
        updatedAt: '2026-03-07T00:00:00.000Z',
      },
    ],
    assignmentHistory: [],
    ...overrides,
  };
}

describe('ThreadPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    appContextMocks.useOptionalAppContext.mockReturnValue({ requestRefresh: vi.fn() });
    clientMocks.listWorkspaceMembers.mockResolvedValue({
      members: [
        { user_id: 'user-1', email: 'alex@example.com', name: 'Alex', role: 'admin' },
        { user_id: 'user-2', email: 'pat@example.com', name: 'Pat', role: 'editor' },
      ],
    });
    clientMocks.createOrGetThread.mockResolvedValue(makeThread());
    clientMocks.getThreadDetail.mockResolvedValue(makeThread());
    clientMocks.addThreadComment.mockResolvedValue({});
    clientMocks.assignThread.mockResolvedValue({});
    clientMocks.resolveThread.mockResolvedValue({});
    clientMocks.reopenThread.mockResolvedValue({});
    clientMocks.listThreads.mockResolvedValue({ items: [], nextCursor: null });
  });

  it('loads the canonical thread and allows editors to comment', async () => {
    appContextMocks.useWorkspacePermissions.mockReturnValue(editorPermissions);

    render(<ThreadPanel workspaceId="ws-1" targetType="job" targetId="job-1" title="Investigate failed job" />);

    expect(await screen.findByText('Investigate failed job')).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Add context, decisions, or next steps...'), {
      target: { value: 'Please investigate.' },
    });
    fireEvent.click(screen.getByText('Post comment'));

    await waitFor(() => {
      expect(clientMocks.addThreadComment).toHaveBeenCalledWith('thread-1', {
        body: 'Please investigate.',
        mentionedUserIds: [],
      });
    });
  });

  it('falls back to existing thread lookup for viewers and stays read-only', async () => {
    appContextMocks.useWorkspacePermissions.mockReturnValue(viewerPermissions);
    clientMocks.listThreads.mockResolvedValue({
      items: [{
        threadId: 'thread-1',
        targetType: 'job',
        targetId: 'job-1',
        status: 'open',
        title: 'Investigate failed job',
        latestCommentPreview: 'Need investigation.',
        commentCount: 1,
        currentAssignment: null,
        lastActivityAt: '2026-03-07T00:00:00.000Z',
        sourceTarget: { surface: 'operations', payload: { jobId: 'job-1', jobType: 'all' } },
      }],
      nextCursor: null,
    });

    render(<ThreadPanel workspaceId="ws-1" targetType="job" targetId="job-1" />);

    expect(await screen.findByText('Investigate failed job')).toBeInTheDocument();
    expect(clientMocks.createOrGetThread).not.toHaveBeenCalled();
    expect(screen.getByText(/only editors and admins can comment/i)).toBeInTheDocument();
  });
});
