import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ThreadAssignmentBar from '../ThreadAssignmentBar';
import type { WorkspaceMemberRecord } from '../../api/client';

const members: WorkspaceMemberRecord[] = [
  {
    id: 'member-1',
    workspace_id: 'ws-1',
    user_id: 'user-1',
    email: 'alex@example.com',
    name: 'Alex',
    role: 'admin',
  },
  {
    id: 'member-2',
    workspace_id: 'ws-1',
    user_id: 'user-2',
    email: 'pat@example.com',
    name: 'Pat',
    role: 'editor',
  },
];

describe('ThreadAssignmentBar', () => {
  it('renders the current assignee and due date', () => {
    render(
      <ThreadAssignmentBar
        currentAssignment={{
          assignmentId: 'assignment-1',
          threadId: 'thread-1',
          assignedToUserId: 'user-2',
          assignedByUserId: 'user-1',
          status: 'open',
          dueAt: '2026-03-10T00:00:00.000Z',
          isCurrent: true,
          createdAt: '2026-03-07T00:00:00.000Z',
          updatedAt: '2026-03-07T00:00:00.000Z',
          resolvedAt: null,
        }}
        members={members}
        canManageAssignments={false}
        onAssign={vi.fn()}
      />
    );

    expect(screen.getByText(/assigned to pat/i)).toBeInTheDocument();
    expect(screen.getByText(/due/i)).toBeInTheDocument();
    expect(screen.queryByText('Assign')).not.toBeInTheDocument();
  });

  it('assigns a teammate when assignment management is enabled', async () => {
    const onAssign = vi.fn().mockResolvedValue(undefined);

    render(
      <ThreadAssignmentBar
        currentAssignment={null}
        members={members}
        canManageAssignments
        onAssign={onAssign}
      />
    );

    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'user-2' },
    });
    fireEvent.change(screen.getByDisplayValue(''), {
      target: { value: '2026-03-12' },
    });
    fireEvent.click(screen.getByText('Assign'));

    await waitFor(() => {
      expect(onAssign).toHaveBeenCalledWith({
        assignedToUserId: 'user-2',
        dueAt: new Date('2026-03-12T00:00:00').toISOString(),
      });
    });
  });
});
