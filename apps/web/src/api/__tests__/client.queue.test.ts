import { beforeEach, describe, expect, it, vi } from 'vitest';

const queueMocks = vi.hoisted(() => ({
  enqueueOfflineItem: vi.fn(),
  replayOfflineQueue: vi.fn(),
  getOfflineQueueDepth: vi.fn(),
  onOfflineQueueChanged: vi.fn(() => () => {}),
  onOfflineQueueReplayed: vi.fn(() => () => {}),
  generateIdempotencyKey: vi.fn(() => 'idempo-test-001'),
}));

vi.mock('../../offline/queue', () => ({
  enqueueOfflineItem: queueMocks.enqueueOfflineItem,
  replayOfflineQueue: queueMocks.replayOfflineQueue,
  getOfflineQueueDepth: queueMocks.getOfflineQueueDepth,
  onOfflineQueueChanged: queueMocks.onOfflineQueueChanged,
  onOfflineQueueReplayed: queueMocks.onOfflineQueueReplayed,
  generateIdempotencyKey: queueMocks.generateIdempotencyKey,
}));

import { createCommentThreadQueued, updateDocumentQueued, setOfflineRolloutUserId } from '../client';

let online = true;

function setNavigatorOnline(next: boolean) {
  online = next;
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => online,
  });
}

describe('API queueable mutation behavior', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    setNavigatorOnline(true);
    setOfflineRolloutUserId('user-1');
  });

  it('sends x-idempotency-key for online queued document updates', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ id: 'doc-1' }), { status: 200 })
    );

    const result = await updateDocumentQueued('doc-1', { title: 'Draft' });

    expect(result.queued).toBe(false);
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-idempotency-key']).toBe('idempo-test-001');
    expect(queueMocks.enqueueOfflineItem).not.toHaveBeenCalled();
  });

  it('enqueues mutation when offline instead of calling fetch', async () => {
    setNavigatorOnline(false);
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    queueMocks.enqueueOfflineItem.mockResolvedValue({ id: 'q-1' });

    const result = await createCommentThreadQueued('doc-1', {
      body_markdown: '離線留言',
    });

    expect(result.queued).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(queueMocks.enqueueOfflineItem).toHaveBeenCalledWith(
      expect.objectContaining({
        operation_type: 'thread_create',
        path: '/documents/doc-1/comment_threads',
        method: 'POST',
        idempotency_key: 'idempo-test-001',
      })
    );
  });
});
