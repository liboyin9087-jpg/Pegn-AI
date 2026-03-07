import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PinnedViewsBar from '../PinnedViewsBar';

const clientMocks = vi.hoisted(() => ({
  listSavedViews: vi.fn(),
  getSavedView: vi.fn(),
}));

vi.mock('../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../api/client')>('../../api/client');
  return {
    ...actual,
    ...clientMocks,
  };
});

describe('PinnedViewsBar', () => {
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
          name: 'Daily triage',
          description: null,
          isPinned: true,
          isDefault: false,
          createdAt: '2026-03-07T12:00:00.000Z',
          updatedAt: '2026-03-07T12:00:00.000Z',
        },
      ],
    });
    clientMocks.getSavedView.mockResolvedValue({
      id: 'view-1',
      workspaceId: 'ws-1',
      ownerUserId: 'user-1',
      scope: 'personal',
      surface: 'search',
      name: 'Daily triage',
      description: null,
      contextVersion: 1,
      payload: { query: 'alpha' },
      isPinned: true,
      isDefault: false,
      createdAt: '2026-03-07T12:00:00.000Z',
      updatedAt: '2026-03-07T12:00:00.000Z',
    });
  });

  it('renders pinned views and applies one on click', async () => {
    const onApplyView = vi.fn();
    render(<PinnedViewsBar workspaceId="ws-1" onApplyView={onApplyView} />);

    expect(await screen.findByText('Daily triage')).toBeInTheDocument();

    fireEvent.click(screen.getByText('Daily triage'));

    await waitFor(() => {
      expect(clientMocks.getSavedView).toHaveBeenCalledWith('ws-1', 'view-1');
    });
    expect(onApplyView).toHaveBeenCalledWith(expect.objectContaining({ id: 'view-1' }));
  });
});
