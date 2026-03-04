import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  enqueueOfflineItem: vi.fn(),
  replayOfflineQueue: vi.fn(async () => ({ processed: 0, failed: 0 })),
  getOfflineQueueDepth: vi.fn(async () => 0),
  onOfflineQueueChanged: vi.fn(() => () => {}),
  onOfflineQueueReplayed: vi.fn(() => () => {}),
  generateIdempotencyKey: vi.fn(() => 'test-idempotency-key'),
}));

vi.mock('../../offline/queue', () => ({
  enqueueOfflineItem: mocks.enqueueOfflineItem,
  replayOfflineQueue: mocks.replayOfflineQueue,
  getOfflineQueueDepth: mocks.getOfflineQueueDepth,
  onOfflineQueueChanged: mocks.onOfflineQueueChanged,
  onOfflineQueueReplayed: mocks.onOfflineQueueReplayed,
  generateIdempotencyKey: mocks.generateIdempotencyKey,
}));

import {
  createCommentThreadQueued,
  replayQueuedMutations,
  setToken,
  clearToken,
} from '../client';

describe('offline queue client integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearToken();
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  it('sends x-idempotency-key for queueable online mutation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ thread: { id: 'thread-1' }, mention_count: 0 }), { status: 200 })
    );

    const result = await createCommentThreadQueued('doc-1', { body_markdown: 'hello' });

    expect(result.queued).toBe(false);
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get('x-idempotency-key')).toBe('test-idempotency-key');
    expect(mocks.enqueueOfflineItem).not.toHaveBeenCalled();
  });

  it('enqueues mutation when browser is offline', async () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const result = await createCommentThreadQueued('doc-2', { body_markdown: 'offline' });

    expect(result.queued).toBe(true);
    expect(mocks.enqueueOfflineItem).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'thread_create',
        path: '/documents/doc-2/comment_threads',
        method: 'POST',
        idempotency_key: 'test-idempotency-key',
      })
    );
  });

  it('replays queued mutations with current auth token', async () => {
    setToken('token-123');

    await replayQueuedMutations();

    expect(mocks.replayOfflineQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'token-123',
      })
    );
  });
});
