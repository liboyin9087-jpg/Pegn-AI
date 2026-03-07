import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ThreadComposer from '../ThreadComposer';
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

describe('ThreadComposer', () => {
  it('renders a read-only state when collaboration is disabled', () => {
    render(<ThreadComposer canCollaborate={false} members={members} onSubmit={vi.fn()} />);

    expect(screen.getByText(/only editors and admins can comment/i)).toBeInTheDocument();
    expect(screen.queryByText('Post comment')).not.toBeInTheDocument();
  });

  it('submits the comment body and explicit mentions', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(<ThreadComposer canCollaborate members={members} onSubmit={onSubmit} />);

    fireEvent.change(screen.getByPlaceholderText('Add context, decisions, or next steps...'), {
      target: { value: 'Investigate the latest failure.' },
    });
    fireEvent.click(screen.getByLabelText('Pat'));
    fireEvent.click(screen.getByText('Post comment'));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        body: 'Investigate the latest failure.',
        mentionedUserIds: ['user-2'],
      });
    });
  });
});
