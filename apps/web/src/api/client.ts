import {
  enqueueOfflineItem,
  replayOfflineQueue,
  getOfflineQueueDepth as getStoredQueueDepth,
  onOfflineQueueChanged,
  onOfflineQueueReplayed,
  generateIdempotencyKey,
  type OfflineOperationType,
  type OfflineQueueReplayResult,
  type OfflineQueueItem,
} from '../offline/queue';

const BASE = (import.meta.env.VITE_API_URL ?? 'http://localhost:4000') + '/api/v1';
const OFFLINE_ROLLOUT_USER_KEY = 'pegn_offline_rollout_user_id';

function parseBooleanFlag(rawValue: unknown, defaultValue: boolean): boolean {
  if (rawValue == null) return defaultValue;
  const normalized = String(rawValue).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function stableBucket(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash % 100;
}

function getOfflineRolloutPercent(): number {
  const raw = Number(import.meta.env.VITE_PWA_OFFLINE_V1_PERCENT ?? 100);
  if (!Number.isFinite(raw)) return 100;
  return Math.min(100, Math.max(0, Math.trunc(raw)));
}

function isOfflineQueueEnabled(): boolean {
  const isFlagEnabled = parseBooleanFlag(import.meta.env.VITE_PWA_OFFLINE_V1, true);
  if (!isFlagEnabled) return false;

  const percent = getOfflineRolloutPercent();
  if (percent <= 0) return false;
  if (percent >= 100) return true;

  const userId = typeof localStorage !== 'undefined'
    ? localStorage.getItem(OFFLINE_ROLLOUT_USER_KEY)
    : null;
  if (!userId) return false;
  return stableBucket(userId) < percent;
}

export function setOfflineRolloutUserId(userId?: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (!userId) {
    localStorage.removeItem(OFFLINE_ROLLOUT_USER_KEY);
    return;
  }
  localStorage.setItem(OFFLINE_ROLLOUT_USER_KEY, userId);
}

// ── Token 管理 ──────────────────────────────────────────────
export function getToken(): string | null {
  return localStorage.getItem('auth_token');
}
export function setToken(t: string): void {
  localStorage.setItem('auth_token', t);
}
export function clearToken(): void {
  localStorage.removeItem('auth_token');
}

// ── 基礎 fetch ───────────────────────────────────────────────
function normalizeHeaders(headers?: HeadersInit): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }
  if (Array.isArray(headers)) {
    return Object.fromEntries(headers);
  }
  return headers as Record<string, string>;
}

export async function api<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getToken();
  const providedHeaders = normalizeHeaders(opts?.headers);
  const defaultHeaders: Record<string, string> = {
    ...(opts?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };

  const res = await fetch(`${BASE}${path}`, {
    headers: {
      ...defaultHeaders,
      ...providedHeaders,
    },
    ...opts,
  });
  if (res.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error('Unauthorized');
  }
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return res.json();
}

export interface QueuedMutationResult<T> {
  queued: boolean;
  data?: T;
  idempotency_key: string;
}
export type QueueMutationResult<T> = QueuedMutationResult<T>;

export type { OfflineQueueItem };

export type OfflineQueueMetricsSource = 'bootstrap' | 'queue_changed' | 'online' | 'interval';

export interface OfflineQueueObservabilityPayload {
  workspace_id: string;
  queue_depth: number;
  replay_processed?: number;
  replay_failed?: number;
  source?: OfflineQueueMetricsSource;
}

function shouldQueueOnError(error: unknown): boolean {
  if (!isOfflineQueueEnabled()) return false;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return true;
  return error instanceof TypeError;
}

async function queueableMutation<T>(params: {
  operation_type: OfflineOperationType;
  path: string;
  method: 'POST' | 'PUT' | 'PATCH';
  body: any;
  headers?: HeadersInit;
}): Promise<QueuedMutationResult<T>> {
  const idempotencyKey = generateIdempotencyKey();
  const headers = {
    ...normalizeHeaders(params.headers),
    'x-idempotency-key': idempotencyKey,
  };

  if (!isOfflineQueueEnabled()) {
    const data = await api<T>(params.path, {
      method: params.method,
      headers,
      body: JSON.stringify(params.body ?? {}),
    });
    return { queued: false, data, idempotency_key: idempotencyKey };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    await enqueueOfflineItem({
      operation_type: params.operation_type,
      path: params.path,
      method: params.method,
      body: params.body ?? {},
      idempotency_key: idempotencyKey,
    });
    return { queued: true, idempotency_key: idempotencyKey };
  }

  try {
    const data = await api<T>(params.path, {
      method: params.method,
      headers,
      body: JSON.stringify(params.body ?? {}),
    });
    return { queued: false, data, idempotency_key: idempotencyKey };
  } catch (error) {
    if (!shouldQueueOnError(error)) throw error;
    await enqueueOfflineItem({
      operation_type: params.operation_type,
      path: params.path,
      method: params.method,
      body: params.body ?? {},
      idempotency_key: idempotencyKey,
    });
    return { queued: true, idempotency_key: idempotencyKey };
  }
}

export async function replayQueuedMutations(): Promise<OfflineQueueReplayResult> {
  return replayOfflineQueue({ baseUrl: BASE, token: getToken() });
}

export async function getOfflineQueueDepth(): Promise<number> {
  return getStoredQueueDepth();
}

export const onOfflineQueueChange = onOfflineQueueChanged;
export const onOfflineQueueReplay = onOfflineQueueReplayed;

export const reportOfflineQueueMetrics = (payload: OfflineQueueObservabilityPayload) =>
  api<{ accepted: true }>('/observability/offline_queue', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

// ── OAuth ─────────────────────────────────────────────────────
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

export function oauthLogin(provider: 'google' | 'github') {
  window.location.href = `${API_BASE}/api/v1/auth/${provider}`;
}

export async function getOAuthStatus(): Promise<{ google: boolean; github: boolean }> {
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/oauth/status`);
    return res.ok ? res.json() : { google: false, github: false };
  } catch {
    return { google: false, github: false };
  }
}

// ── Auth ─────────────────────────────────────────────────────
export const register = (email: string, password: string, name: string) =>
  api<{ token: string; user: any }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
export const login = (email: string, password: string) =>
  api<{ token: string; user: any }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
export const getMe = () => api<{ user: any }>('/auth/me');

// ── Workspace ────────────────────────────────────────────────
export const listWorkspaces = () => api<{ workspaces: any[] }>('/workspaces');
export const createWorkspace = (name: string) =>
  api<any>('/workspaces', { method: 'POST', body: JSON.stringify({ name }) });

// ── Documents ────────────────────────────────────────────────
export const listDocuments = (wsId: string) =>
  api<{ documents: any[] }>(`/workspaces/${wsId}/documents`);
export const createDocument = (wsId: string, title: string, parentId?: string) =>
  api<any>('/documents', { method: 'POST', body: JSON.stringify({ workspace_id: wsId, title, metadata: parentId ? { parent_id: parentId } : undefined }) });
export const setDocumentParent = (id: string, parentId: string | null) =>
  api<any>(`/documents/${id}/parent`, { method: 'PATCH', body: JSON.stringify({ parent_id: parentId }) });
export const moveDocument = (id: string, data: { parent_id: string | null; position: number }) =>
  api<any>(`/documents/${id}/move`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteDocument = (id: string) =>
  api<any>(`/documents/${id}`, { method: 'DELETE' });
export const renameDocument = (id: string, title: string) =>
  api<any>(`/documents/${id}/rename`, { method: 'PATCH', body: JSON.stringify({ title }) });
export const updateDocument = (id: string, data: any) =>
  api<any>(`/documents/${id}`, { method: 'PUT', body: JSON.stringify(data) });
export const updateDocumentQueued = (id: string, data: any) =>
  queueableMutation<any>({
    operation_type: 'document_update',
    path: `/documents/${id}`,
    method: 'PUT',
    body: data,
  });

// ── Search ───────────────────────────────────────────────────
export const search = (query: string, wsId: string) =>
  api<{ results: any[] }>('/search', {
    method: 'POST',
    body: JSON.stringify({ query, workspace_id: wsId, limit: 10 }),
  });

export const knowledgeQuery = (query: string, wsId: string, mode: 'auto' | 'hybrid' | 'graph' = 'auto') =>
  api<{
    answer: string;
    sources: any[];
    entities: any[];
    citations: string[];
    mode_used: 'hybrid' | 'graph';
    routing_reason: string;
    debug: { entity_hits: number; hybrid_top_score: number };
  }>('/knowledge/query', {
    method: 'POST',
    body: JSON.stringify({ query, workspace_id: wsId, mode }),
  });

// ── GraphRAG ─────────────────────────────────────────────────
export const graphragQuery = (query: string, wsId: string) =>
  api<{ answer: string; sources: any[]; entities: any[]; citations: string[] }>(
    '/graphrag/query',
    { method: 'POST', body: JSON.stringify({ query, workspace_id: wsId }) }
  );

// ── KG ───────────────────────────────────────────────────────
export const kgExtract = (text: string, wsId: string) =>
  api<{ entities: any[]; relationships: any[] }>('/kg/extract', {
    method: 'POST',
    body: JSON.stringify({ text, workspace_id: wsId }),
  });
export const kgEntities = (wsId: string) =>
  api<{ entities: any[] }>(`/kg/entities?workspace_id=${wsId}`);
export const kgRelationships = (wsId: string) =>
  api<{ relationships: any[] }>(`/kg/relationships?workspace_id=${wsId}`);
export const kgNeighbors = (entityId: string) =>
  api<{ entities: any[]; relationships: any[] }>(`/kg/entities/${entityId}/neighbors`);
export const updateKgEntity = (entityId: string, payload: { name: string; entity_type: string; description?: string }) =>
  api<{ entity: any }>(`/kg/entities/${entityId}`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
export const deleteKgEntity = (entityId: string) =>
  api<{ success: boolean }>(`/kg/entities/${entityId}`, {
    method: 'DELETE',
  });
export const saveKgEntityPosition = (entityId: string, x: number, y: number) =>
  api<{ success: boolean }>(`/kg/entities/${entityId}/position`, {
    method: 'PATCH',
    body: JSON.stringify({ x, y }),
  });

// ── Agent ────────────────────────────────────────────────────
export const startSupervisorAgent = (
  query: string,
  wsId: string,
  mode: 'auto' | 'hybrid' | 'graph' = 'auto'
) =>
  api<{ run_id: string }>('/agents/supervisor', {
    method: 'POST',
    body: JSON.stringify({ query, workspace_id: wsId, mode }),
  });
export const startResearchAgent = (query: string, wsId: string) =>
  api<{ run_id: string }>('/agents/research', {
    method: 'POST',
    body: JSON.stringify({ query, workspace_id: wsId }),
  });
export const startSummarizeAgent = (text: string, wsId: string) =>
  api<{ run_id: string }>('/agents/summarize', {
    method: 'POST',
    body: JSON.stringify({ text, workspace_id: wsId }),
  });
export const getAgentRun = (runId: string) => api<any>(`/agents/runs/${runId}`);

// ── Workspace Members & Invites ──────────────────────────────
export const listWorkspaceMembers = (workspaceId: string) =>
  api<{ members: any[] }>(`/workspaces/${workspaceId}/members`);
export const listWorkspaceInvites = (workspaceId: string) =>
  api<{ invites: any[] }>(`/workspaces/${workspaceId}/invites`);
export const createWorkspaceInvite = (workspaceId: string, email: string, role: 'admin' | 'editor' | 'viewer') =>
  api<{ invite: any }>(`/workspaces/${workspaceId}/invites`, {
    method: 'POST',
    body: JSON.stringify({ email, role }),
  });
export const revokeWorkspaceInvite = (workspaceId: string, inviteId: string) =>
  api<{ success: boolean }>(`/workspaces/${workspaceId}/invites/${inviteId}`, {
    method: 'DELETE',
  });
export const acceptInvite = (token: string) =>
  api<{ success: boolean; workspace_id: string; role: string }>(`/invites/${token}/accept`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

// ── Comments / Mentions / Inbox ─────────────────────────────
export interface CommentAnchor {
  id: string;
  thread_id: string;
  block_id?: string | null;
  start_offset: number;
  end_offset: number;
  yjs_relative_start?: string | null;
  yjs_relative_end?: string | null;
  selected_text?: string | null;
  context_before?: string | null;
  context_after?: string | null;
}

export interface CommentItem {
  id: string;
  thread_id: string;
  parent_comment_id?: string | null;
  body_markdown: string;
  created_by: string;
  created_by_name?: string;
  created_by_email?: string;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  mention_count?: number;
}

export interface CommentThread {
  id: string;
  workspace_id: string;
  document_id: string;
  status: 'open' | 'resolved';
  created_by: string;
  created_by_name?: string;
  resolved_by?: string | null;
  resolved_by_name?: string | null;
  resolved_at?: string | null;
  created_at: string;
  updated_at: string;
  anchor: CommentAnchor | null;
  comments: CommentItem[];
  sync_status?: 'synced' | 'queued' | 'failed';
}

export interface InboxNotification {
  id: string;
  workspace_id: string;
  user_id: string;
  type: 'mention';
  payload: {
    workspace_id: string;
    document_id: string;
    thread_id: string;
    comment_id: string;
    mentioned_by: string;
    preview?: string;
  };
  status: 'unread' | 'read';
  read_at?: string | null;
  created_at: string;
}

export const listCommentThreads = (documentId: string, status: 'open' | 'resolved' | 'all' = 'open') =>
  api<{ threads: CommentThread[] }>(`/documents/${documentId}/comment_threads?status=${status}`);

export const getCommentThread = (threadId: string) =>
  api<{ thread: CommentThread }>(`/comment_threads/${threadId}`);

export const createCommentThread = (
  documentId: string,
  payload: {
    body_markdown: string;
    anchor?: Partial<CommentAnchor>;
  },
  headers?: HeadersInit
) =>
  api<{ thread: CommentThread; mention_count: number }>(`/documents/${documentId}/comment_threads`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
export const createCommentThreadQueued = (
  documentId: string,
  payload: {
    body_markdown: string;
    anchor?: Partial<CommentAnchor>;
  }
) =>
  queueableMutation<{ thread: CommentThread; mention_count: number }>({
    operation_type: 'thread_create',
    path: `/documents/${documentId}/comment_threads`,
    method: 'POST',
    body: payload,
  });

export const createComment = (
  threadId: string,
  payload: { body_markdown: string; parent_comment_id?: string | null },
  headers?: HeadersInit
) =>
  api<{ comment: CommentItem }>(`/comment_threads/${threadId}/comments`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
export const createCommentQueued = (
  threadId: string,
  payload: { body_markdown: string; parent_comment_id?: string | null }
) =>
  queueableMutation<{ comment: CommentItem }>({
    operation_type: 'comment_create',
    path: `/comment_threads/${threadId}/comments`,
    method: 'POST',
    body: payload,
  });

export const resolveCommentThread = (threadId: string, headers?: HeadersInit) =>
  api<{ thread: CommentThread }>(`/comment_threads/${threadId}/resolve`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({}),
  });
export const resolveCommentThreadQueued = (threadId: string) =>
  queueableMutation<{ thread: CommentThread }>({
    operation_type: 'thread_resolve',
    path: `/comment_threads/${threadId}/resolve`,
    method: 'PATCH',
    body: {},
  });

export const reopenCommentThread = (threadId: string, headers?: HeadersInit) =>
  api<{ thread: CommentThread }>(`/comment_threads/${threadId}/reopen`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({}),
  });
export const reopenCommentThreadQueued = (threadId: string) =>
  queueableMutation<{ thread: CommentThread }>({
    operation_type: 'thread_reopen',
    path: `/comment_threads/${threadId}/reopen`,
    method: 'PATCH',
    body: {},
  });

export const listInboxNotifications = (status: 'unread' | 'all' = 'unread') =>
  api<{ notifications: InboxNotification[]; unread_count: number }>(`/inbox/notifications?status=${status}`);

export const markInboxNotificationRead = (notificationId: string) =>
  api<{ notification: InboxNotification }>(`/inbox/notifications/${notificationId}/read`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  });

export const markAllInboxNotificationsRead = () =>
  api<{ updated: number }>(`/inbox/notifications/read_all`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  });

// ── Collections ──────────────────────────────────────────────
export const listCollections = (wsId: string) =>
  api<{ collections: any[] }>(`/collections/workspace/${wsId}`);
export const getCollection = (id: string) =>
  api<any>(`/collections/${id}`);
export const createCollection = (data: { workspace_id?: string; workspaceId?: string; name: string; description?: string; icon?: string; schema?: any }) =>
  api<any>('/collections', { method: 'POST', body: JSON.stringify({ ...data, workspace_id: data.workspace_id ?? data.workspaceId }) });
export const updateCollection = (id: string, data: any) =>
  api<any>(`/collections/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteCollection = (id: string) =>
  api<any>(`/collections/${id}`, { method: 'DELETE' });
export const listCollectionDocuments = (id: string) =>
  api<{ documents: any[] }>(`/collections/${id}/documents`);

// ── Collection Views ─────────────────────────────────────────
export const listCollectionViews = (collectionId: string) =>
  api<{ views: any[] }>(`/collection_views/collection/${collectionId}`);
export const createCollectionView = (data: { collectionId: string; name: string; type: string; configuration?: any; position?: number }) =>
  api<any>('/collection_views', { method: 'POST', body: JSON.stringify(data) });
export const updateCollectionView = (id: string, data: any) =>
  api<any>(`/collection_views/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
export const deleteCollectionView = (id: string) =>
  api<any>(`/collection_views/${id}`, { method: 'DELETE' });

export const exportCollection = async (id: string, format: 'csv' | 'json' = 'csv') => {
  const token = getToken();
  const res = await fetch(`${BASE}/collections/${id}/export?format=${format}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) throw new Error('Export failed');
  return res.blob();
};

// ── SSE helpers ──────────────────────────────────────────────
export function sseStream(path: string, onData: (d: any) => void, onDone: () => void) {
  const token = getToken();
  const url = `${import.meta.env.VITE_API_URL ?? 'http://localhost:4000'}${path}${token ? `?token=${token}` : ''}`;
  const es = new EventSource(url);
  es.onmessage = (e) => { try { onData(JSON.parse(e.data)); } catch { } };
  es.addEventListener('done', () => { onDone(); es.close(); });
  es.onerror = () => es.close();
  return () => es.close();
}
