export type OfflineOperationType =
  | 'document_update'
  | 'thread_create'
  | 'comment_create'
  | 'thread_resolve'
  | 'thread_reopen';

export type OfflineQueueStatus = 'pending' | 'failed';

export interface OfflineQueueItem {
  id: string;
  operation_type: OfflineOperationType;
  path: string;
  method: 'POST' | 'PUT' | 'PATCH';
  body: any;
  idempotency_key: string;
  created_at: string;
  retry_count: number;
  status: OfflineQueueStatus;
  next_retry_at?: string | null;
  last_error?: string | null;
}

export interface OfflineQueueReplayResult {
  processed: number;
  failed: number;
  processed_ids: string[];
  failed_ids: string[];
  /** P50/P95/Max dwell time of successfully processed items (ms since created_at). Present when ≥1 item processed. */
  avg_dwell_ms?: number;
  max_dwell_ms?: number;
  p95_dwell_ms?: number;
  /** processed / (processed + permanently-failed) in [0,1]. Present when replay touched at least one item. */
  success_rate?: number;
}

/** SLA snapshot of items currently sitting in the queue (pending + failed). */
export interface OfflineQueueSLAMetrics {
  queue_depth: number;
  pending_count: number;
  failed_count: number;
  /** Dwell time statistics (ms) across all items currently in the queue. */
  avg_dwell_ms: number | null;
  max_dwell_ms: number | null;
  p95_dwell_ms: number | null;
  sampled_at: string;
}

const DB_NAME = 'pegn_offline_queue_db';
const STORE_NAME = 'mutation_queue';
const DB_VERSION = 2;
const MAX_RETRY_ATTEMPTS = 5;
const QUEUE_CHANGED_EVENT = 'offline-queue:changed';
const QUEUE_REPLAYED_EVENT = 'offline-queue:replayed';

function supportIndexedDb(): boolean {
  return typeof window !== 'undefined' && !!window.indexedDB;
}

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function generateIdempotencyKey(): string {
  return generateId();
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function normalizeItem(item: any): OfflineQueueItem {
  return {
    id: String(item?.id ?? generateId()),
    operation_type: item?.operation_type,
    path: String(item?.path ?? ''),
    method: item?.method,
    body: item?.body ?? {},
    idempotency_key: String(item?.idempotency_key ?? generateId()),
    created_at: String(item?.created_at ?? new Date().toISOString()),
    retry_count: Number.isFinite(item?.retry_count) ? Number(item.retry_count) : 0,
    status: item?.status === 'failed' ? 'failed' : 'pending',
    next_retry_at: item?.next_retry_at ?? null,
    last_error: item?.last_error ?? null,
  };
}

async function readAllItems(): Promise<OfflineQueueItem[]> {
  if (!supportIndexedDb()) return [];
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const request = store.getAll();
    request.onsuccess = () => {
      const raw = (request.result as any[]) ?? [];
      const items = raw.map(normalizeItem);
      items.sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
      resolve(items);
    };
    request.onerror = () => reject(request.error);
  });
}

async function upsertItem(item: OfflineQueueItem): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.objectStore(STORE_NAME).put(item);
  });
}

async function removeItemsById(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    const store = tx.objectStore(STORE_NAME);
    ids.forEach((id) => store.delete(id));
  });
}

function dispatchQueueChanged(depth: number): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(QUEUE_CHANGED_EVENT, { detail: { depth } }));
}

function dispatchQueueReplayed(result: OfflineQueueReplayResult): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(QUEUE_REPLAYED_EVENT, { detail: result }));
}

function isSameDocumentMutation(a: OfflineQueueItem, b: { operation_type: OfflineOperationType; path: string; method: 'POST' | 'PUT' | 'PATCH' }): boolean {
  return a.operation_type === 'document_update' && b.operation_type === 'document_update' && a.path === b.path && a.method === b.method;
}

export async function enqueueOfflineItem(item: Omit<OfflineQueueItem, 'id' | 'created_at' | 'retry_count' | 'status' | 'next_retry_at' | 'last_error'>): Promise<OfflineQueueItem> {
  if (!supportIndexedDb()) {
    throw new Error('IndexedDB is not supported in this browser');
  }

  const existing = await readAllItems();
  const mergeCandidates = existing.filter((queued) => isSameDocumentMutation(queued, item));
  const keepId = mergeCandidates[0]?.id ?? generateId();

  const queuedItem: OfflineQueueItem = {
    id: keepId,
    created_at: new Date().toISOString(),
    operation_type: item.operation_type,
    path: item.path,
    method: item.method,
    body: item.body,
    idempotency_key: item.idempotency_key,
    retry_count: 0,
    status: 'pending',
    next_retry_at: null,
    last_error: null,
  };

  await upsertItem(queuedItem);
  if (mergeCandidates.length > 1) {
    await removeItemsById(mergeCandidates.slice(1).map((candidate) => candidate.id));
  }

  const depth = await getOfflineQueueDepth();
  dispatchQueueChanged(depth);
  return queuedItem;
}

export async function removeOfflineItem(id: string): Promise<void> {
  if (!supportIndexedDb()) return;
  await removeItemsById([id]);

  const depth = await getOfflineQueueDepth();
  dispatchQueueChanged(depth);
}

export async function getOfflineQueueDepth(): Promise<number> {
  if (!supportIndexedDb()) return 0;
  const items = await readAllItems();
  return items.length;
}

function calcBackoffMs(retryCount: number): number {
  const exponent = Math.max(0, retryCount - 1);
  return Math.min(60_000, Math.pow(2, exponent) * 1000);
}

async function markReplayFailure(item: OfflineQueueItem, errorMessage: string): Promise<{ status: OfflineQueueStatus }> {
  const nextRetryCount = item.retry_count + 1;
  if (nextRetryCount >= MAX_RETRY_ATTEMPTS) {
    await upsertItem({
      ...item,
      retry_count: nextRetryCount,
      status: 'failed',
      next_retry_at: null,
      last_error: errorMessage,
    });
    return { status: 'failed' };
  }

  await upsertItem({
    ...item,
    retry_count: nextRetryCount,
    status: 'pending',
    next_retry_at: new Date(Date.now() + calcBackoffMs(nextRetryCount)).toISOString(),
    last_error: errorMessage,
  });
  return { status: 'pending' };
}

// ── SLA helpers ───────────────────────────────────────────────────────────

function computeDwellStats(dwellMs: number[]): { avg: number; max: number; p95: number } | null {
  if (dwellMs.length === 0) return null;
  const sorted = [...dwellMs].sort((a, b) => a - b);
  const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
  const max = sorted[sorted.length - 1]!;
  const p95Idx = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  const p95 = sorted[p95Idx]!;
  return { avg: Math.round(avg), max, p95 };
}

/**
 * Snapshot the SLA state of items currently sitting in the offline queue.
 * Dwell time = time since `created_at`; reflects how long items have been waiting.
 */
export async function getSLAMetrics(): Promise<OfflineQueueSLAMetrics> {
  const items = await readAllItems();
  const now = Date.now();
  const dwellMs = items
    .map((item) => {
      const created = Date.parse(item.created_at);
      return Number.isFinite(created) ? now - created : null;
    })
    .filter((v): v is number => v !== null && v >= 0);

  const stats = computeDwellStats(dwellMs);
  return {
    queue_depth: items.length,
    pending_count: items.filter((i) => i.status === 'pending').length,
    failed_count: items.filter((i) => i.status === 'failed').length,
    avg_dwell_ms: stats?.avg ?? null,
    max_dwell_ms: stats?.max ?? null,
    p95_dwell_ms: stats?.p95 ?? null,
    sampled_at: new Date(now).toISOString(),
  };
}

// ── Replay ────────────────────────────────────────────────────────────────

export async function replayOfflineQueue(options: { baseUrl: string; token?: string | null }): Promise<OfflineQueueReplayResult> {
  if (!supportIndexedDb()) {
    return { processed: 0, failed: 0, processed_ids: [], failed_ids: [] };
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return { processed: 0, failed: 0, processed_ids: [], failed_ids: [] };
  }

  const items = await readAllItems();
  const now = Date.now();
  const result: OfflineQueueReplayResult = {
    processed: 0,
    failed: 0,
    processed_ids: [],
    failed_ids: [],
  };

  /** Dwell times (ms) for items that were successfully replayed this run. */
  const processedDwellMs: number[] = [];

  for (const item of items) {
    if (item.status === 'failed') continue;
    const nextRetryAtMs = item.next_retry_at ? Date.parse(item.next_retry_at) : NaN;
    if (Number.isFinite(nextRetryAtMs) && nextRetryAtMs > now) continue;

    try {
      const response = await fetch(`${options.baseUrl}${item.path}`, {
        method: item.method,
        headers: {
          'Content-Type': 'application/json',
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
          'x-idempotency-key': item.idempotency_key,
        },
        body: JSON.stringify(item.body ?? {}),
      });

      if (response.status === 401) {
        break;
      }

      if (response.ok || response.status === 409) {
        // Record dwell time before deletion
        const created = Date.parse(item.created_at);
        if (Number.isFinite(created)) {
          processedDwellMs.push(Date.now() - created);
        }
        await removeItemsById([item.id]);
        result.processed += 1;
        result.processed_ids.push(item.id);
        continue;
      }

      const failure = await markReplayFailure(item, `HTTP_${response.status}`);
      if (failure.status === 'failed') {
        result.failed += 1;
        result.failed_ids.push(item.id);
      }
    } catch (error) {
      const failure = await markReplayFailure(item, error instanceof Error ? error.message : 'NETWORK_ERROR');
      if (failure.status === 'failed') {
        result.failed += 1;
        result.failed_ids.push(item.id);
      }
      break;
    }
  }

  // Attach SLA metrics when at least one item was touched
  const dwellStats = computeDwellStats(processedDwellMs);
  if (dwellStats) {
    result.avg_dwell_ms = dwellStats.avg;
    result.max_dwell_ms = dwellStats.max;
    result.p95_dwell_ms = dwellStats.p95;
  }
  const totalTouched = result.processed + result.failed;
  if (totalTouched > 0) {
    result.success_rate = result.processed / totalTouched;
  }

  dispatchQueueReplayed(result);
  const depth = await getOfflineQueueDepth();
  dispatchQueueChanged(depth);
  return result;
}

export function onOfflineQueueChanged(listener: (depth: number) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<{ depth: number }>;
    listener(customEvent.detail?.depth ?? 0);
  };
  window.addEventListener(QUEUE_CHANGED_EVENT, handler as EventListener);
  return () => window.removeEventListener(QUEUE_CHANGED_EVENT, handler as EventListener);
}

export function onOfflineQueueReplayed(listener: (result: OfflineQueueReplayResult) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (event: Event) => {
    const customEvent = event as CustomEvent<OfflineQueueReplayResult>;
    listener(customEvent.detail ?? { processed: 0, failed: 0, processed_ids: [], failed_ids: [] });
  };
  window.addEventListener(QUEUE_REPLAYED_EVENT, handler as EventListener);
  return () => window.removeEventListener(QUEUE_REPLAYED_EVENT, handler as EventListener);
}
