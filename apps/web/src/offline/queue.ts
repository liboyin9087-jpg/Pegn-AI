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
}

// P1-4: SLA 指標型別
export interface QueueSLAMetrics {
  /** 目前佇列中等待重試的項目數 */
  pending_count: number;
  /** 已超過最大重試次數的失敗項目數 */
  failed_count: number;
  /** 歷史累計成功 replay 次數 */
  cumulative_success: number;
  /** 歷史累計失敗 replay 次數 */
  cumulative_fail: number;
  /** 成功率（0~1），窟無記錄時為 1 */
  success_rate: number;
  /** 目前 pending 項目的平均滞留時間（ms），窟無 pending 項目時為 null */
  avg_dwell_ms: number | null;
  /** P95 滞留時間（ms） */
  p95_dwell_ms: number | null;
}

const DB_NAME = 'pegn_offline_queue_db';
const STORE_NAME = 'mutation_queue';
const DB_VERSION = 2;
const MAX_RETRY_ATTEMPTS = 5;
const QUEUE_CHANGED_EVENT = 'offline-queue:changed';
const QUEUE_REPLAYED_EVENT = 'offline-queue:replayed';

// P1-4: SLA 指標 localStorage keys
const SLA_SUCCESS_KEY = 'pegn_queue_sla_success';
const SLA_FAIL_KEY    = 'pegn_queue_sla_fail';

function _slaIncrement(key: string): void {
  if (typeof localStorage === 'undefined') return;
  const prev = parseInt(localStorage.getItem(key) ?? '0', 10);
  localStorage.setItem(key, String(Number.isFinite(prev) ? prev + 1 : 1));
}

function _slaRead(key: string): number {
  if (typeof localStorage === 'undefined') return 0;
  return parseInt(localStorage.getItem(key) ?? '0', 10) || 0;
}

function _percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.min(idx, sorted.length - 1)];
}

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
        await removeItemsById([item.id]);
        result.processed += 1;
        result.processed_ids.push(item.id);
        _slaIncrement(SLA_SUCCESS_KEY);
        continue;
      }

      const failure = await markReplayFailure(item, `HTTP_${response.status}`);
      if (failure.status === 'failed') {
        result.failed += 1;
        result.failed_ids.push(item.id);
        _slaIncrement(SLA_FAIL_KEY);
      }
    } catch (error) {
      const failure = await markReplayFailure(item, error instanceof Error ? error.message : 'NETWORK_ERROR');
      if (failure.status === 'failed') {
        result.failed += 1;
        result.failed_ids.push(item.id);
        _slaIncrement(SLA_FAIL_KEY);
      }
      break;
    }
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

// P1-4: 離線佇列 SLA 指標 — 讀取 IndexedDB 現狀 + localStorage 累計計數
export async function getQueueSLAMetrics(): Promise<QueueSLAMetrics> {
  const items = await readAllItems();
  const now = Date.now();

  const pending = items.filter(i => i.status === 'pending');
  const failed  = items.filter(i => i.status === 'failed');

  // Dwell time = 「現在」減去每個 pending 項目的 created_at
  const dwellSamples = pending
    .map(i => now - Date.parse(i.created_at))
    .filter(n => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);

  const cumSuccess = _slaRead(SLA_SUCCESS_KEY);
  const cumFail    = _slaRead(SLA_FAIL_KEY);
  const total = cumSuccess + cumFail;
  const successRate = total > 0 ? Math.round((cumSuccess / total) * 1000) / 1000 : 1;

  const avgDwell = dwellSamples.length > 0
    ? Math.round(dwellSamples.reduce((a, b) => a + b, 0) / dwellSamples.length)
    : null;
  const p95Dwell = dwellSamples.length > 0
    ? _percentile(dwellSamples, 95)
    : null;

  return {
    pending_count: pending.length,
    failed_count: failed.length,
    cumulative_success: cumSuccess,
    cumulative_fail: cumFail,
    success_rate: successRate,
    avg_dwell_ms: avgDwell,
    p95_dwell_ms: p95Dwell,
  };
}
