import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Editor from '../Editor';

vi.mock('@hocuspocus/provider', () => {
  class MockProvider {
    private config: any;

    constructor(config: any) {
      this.config = config;
      this.config?.onConnect?.();
    }

    destroy() {
      this.config?.onDisconnect?.();
    }
  }

  return { HocuspocusProvider: MockProvider };
});

const apiMocks = vi.hoisted(() => ({
  listWorkspaceMembers: vi.fn(),
  updateDocumentQueued: vi.fn(),
  listCommentThreads: vi.fn(),
  createCommentThreadQueued: vi.fn(),
  createCommentQueued: vi.fn(),
  resolveCommentThreadQueued: vi.fn(),
  reopenCommentThreadQueued: vi.fn(),
  onOfflineQueueReplay: vi.fn(),
}));

vi.mock('../../api/client', () => ({
  listWorkspaceMembers: apiMocks.listWorkspaceMembers,
  updateDocumentQueued: apiMocks.updateDocumentQueued,
  listCommentThreads: apiMocks.listCommentThreads,
  createCommentThreadQueued: apiMocks.createCommentThreadQueued,
  createCommentQueued: apiMocks.createCommentQueued,
  resolveCommentThreadQueued: apiMocks.resolveCommentThreadQueued,
  reopenCommentThreadQueued: apiMocks.reopenCommentThreadQueued,
  onOfflineQueueReplay: apiMocks.onOfflineQueueReplay,
}));

const baseDoc = {
  id: 'doc-1',
  title: 'Spec Doc',
  metadata: {},
  updatedAt: new Date().toISOString(),
};

describe('Editor comments integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMocks.listWorkspaceMembers.mockResolvedValue({ members: [] });
    apiMocks.updateDocumentQueued.mockResolvedValue({ queued: false, data: { ok: true }, idempotency_key: 'save-1' });
    apiMocks.listCommentThreads.mockResolvedValue({ threads: [] });
    apiMocks.createCommentThreadQueued.mockResolvedValue({
      queued: false,
      idempotency_key: 'thread-1',
      data: {
        mention_count: 0,
        thread: {
          id: 'thread-1',
          workspace_id: 'ws-1',
          document_id: 'doc-1',
          status: 'open',
          created_by: 'user-editor',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          anchor: {
            id: 'anchor-1',
            thread_id: 'thread-1',
            start_offset: 2,
            end_offset: 6,
            selected_text: 'abcd',
            context_before: '01',
            context_after: '89',
          },
          comments: [],
        },
      },
    });
    apiMocks.createCommentQueued.mockResolvedValue({
      queued: false,
      idempotency_key: 'comment-1',
      data: {
        comment: {
          id: 'comment-1',
          thread_id: 'thread-1',
          body_markdown: '@viewer_user 請確認',
          created_by: 'user-editor',
          created_at: new Date().toISOString(),
          mention_count: 1,
        },
      },
    });
    apiMocks.resolveCommentThreadQueued.mockResolvedValue({
      queued: false,
      idempotency_key: 'resolve-1',
      data: {
        thread: {
          id: 'thread-1',
          workspace_id: 'ws-1',
          document_id: 'doc-1',
          status: 'resolved',
          created_by: 'user-editor',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          resolved_at: new Date().toISOString(),
          anchor: {
            id: 'anchor-1',
            thread_id: 'thread-1',
            start_offset: 0,
            end_offset: 5,
            selected_text: 'hello',
          },
          comments: [],
        },
      },
    });
    apiMocks.reopenCommentThreadQueued.mockResolvedValue({
      queued: false,
      idempotency_key: 'reopen-1',
      data: {
        thread: {
          id: 'thread-1',
          workspace_id: 'ws-1',
          document_id: 'doc-1',
          status: 'open',
          created_by: 'user-editor',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          resolved_at: null,
          anchor: {
            id: 'anchor-1',
            thread_id: 'thread-1',
            start_offset: 0,
            end_offset: 5,
            selected_text: 'hello',
          },
          comments: [],
        },
      },
    });
    apiMocks.onOfflineQueueReplay.mockImplementation(() => () => {});
  });

  it('creates thread from selection with full anchor payload', async () => {
    render(<Editor doc={baseDoc} workspaceId="ws-1" />);

    const textarea = await screen.findByPlaceholderText(/開始輸入/);
    fireEvent.change(textarea, { target: { value: '01abcd89' } });
    (textarea as HTMLTextAreaElement).focus();
    (textarea as HTMLTextAreaElement).setSelectionRange(2, 6);
    fireEvent.mouseUp(textarea);

    fireEvent.click(await screen.findByRole('button', { name: '留言' }));

    const composerInput = await screen.findByPlaceholderText('輸入留言內容，支援 @mention');
    fireEvent.change(composerInput, { target: { value: '請協助確認' } });
    fireEvent.click(screen.getByRole('button', { name: '建立留言串' }));

    await waitFor(() => {
      expect(apiMocks.createCommentThreadQueued).toHaveBeenCalledTimes(1);
    });

    expect(apiMocks.createCommentThreadQueued).toHaveBeenCalledWith(
      'doc-1',
      expect.objectContaining({
        body_markdown: '請協助確認',
        anchor: expect.objectContaining({
          start_offset: 2,
          end_offset: 6,
          selected_text: 'abcd',
          context_before: '01',
          context_after: '89',
        }),
      }),
    );
  });

  it('supports mention autocomplete, reply, resolve/reopen, and focusThread handoff', async () => {
    apiMocks.listWorkspaceMembers.mockResolvedValue({
      members: [
        {
          user_id: 'user-viewer',
          name: 'Viewer User',
          email: 'viewer@example.com',
          role: 'viewer',
        },
      ],
    });
    apiMocks.listCommentThreads.mockResolvedValue({
      threads: [
        {
          id: 'thread-1',
          workspace_id: 'ws-1',
          document_id: 'doc-1',
          status: 'open',
          created_by: 'user-editor',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          anchor: {
            id: 'anchor-1',
            thread_id: 'thread-1',
            start_offset: 0,
            end_offset: 5,
            selected_text: 'hello',
            context_before: '...',
            context_after: '...',
          },
          comments: [
            {
              id: 'comment-init',
              thread_id: 'thread-1',
              body_markdown: '先看這段',
              created_by: 'user-editor',
              created_by_name: 'Editor User',
              created_at: new Date().toISOString(),
              mention_count: 0,
            },
          ],
        },
      ],
    });

    const onFocusThreadHandled = vi.fn();
    render(
      <Editor
        doc={baseDoc}
        workspaceId="ws-1"
        focusThreadId="thread-1"
        onFocusThreadHandled={onFocusThreadHandled}
      />,
    );

    await waitFor(() => {
      expect(onFocusThreadHandled).toHaveBeenCalled();
    });

    const replyInput = await screen.findByPlaceholderText('回覆留言，支援 @mention');
    fireEvent.change(replyInput, { target: { value: '@view' } });
    fireEvent.click(await screen.findByText('Viewer User'));
    expect(replyInput).toHaveValue('@viewer_user ');

    fireEvent.click(screen.getByRole('button', { name: '回覆' }));
    await waitFor(() => {
      expect(apiMocks.createCommentQueued).toHaveBeenCalledWith('thread-1', {
        body_markdown: '@viewer_user',
      });
    });

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    await waitFor(() => {
      expect(apiMocks.resolveCommentThreadQueued).toHaveBeenCalledWith('thread-1');
    });
    expect(await screen.findByRole('button', { name: 'Reopen' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reopen' }));
    await waitFor(() => {
      expect(apiMocks.reopenCommentThreadQueued).toHaveBeenCalledWith('thread-1');
    });
  });
});
