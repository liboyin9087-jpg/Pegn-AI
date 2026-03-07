import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ThreadStatusBar from '../ThreadStatusBar';
import type { CollaborationThread } from '../../api/client';

const baseThread: CollaborationThread = {
  threadId: 'thread-1',
  workspaceId: 'ws-1',
  targetType: 'job',
  targetId: 'job-1',
  status: 'open',
  title: 'Investigate failed job',
  commentCount: 0,
  currentAssignment: null,
  sourceTarget: { surface: 'operations', payload: { jobId: 'job-1', jobType: 'all' } },
  createdByUserId: 'user-1',
  lastActivityAt: '2026-03-07T00:00:00.000Z',
  resolvedAt: null,
  comments: [],
  assignmentHistory: [],
};

describe('ThreadStatusBar', () => {
  it('renders source CTA and resolve action for open threads', () => {
    const onResolve = vi.fn();
    const onOpenSource = vi.fn();

    render(
      <ThreadStatusBar
        thread={baseThread}
        canCollaborate
        onResolve={onResolve}
        onReopen={vi.fn()}
        onOpenSource={onOpenSource}
      />
    );

    fireEvent.click(screen.getByText('Open source'));
    fireEvent.click(screen.getByText('Resolve'));

    expect(onOpenSource).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledTimes(1);
  });

  it('renders reopen for resolved threads', () => {
    const onReopen = vi.fn();

    render(
      <ThreadStatusBar
        thread={{ ...baseThread, status: 'resolved', resolvedAt: '2026-03-08T00:00:00.000Z' }}
        canCollaborate
        onResolve={vi.fn()}
        onReopen={onReopen}
      />
    );

    fireEvent.click(screen.getByText('Reopen'));
    expect(onReopen).toHaveBeenCalledTimes(1);
  });
});
