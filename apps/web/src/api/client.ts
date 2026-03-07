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

export type ApiErrorCode =
  | 'BAD_REQUEST'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'INDEXING_FAILED'
  | 'INVALID_STATE';

export interface ApiErrorShape {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export type DocumentIndexStatus = 'pending' | 'indexed' | 'stale' | 'failed';

export interface SearchIndexStatusSummary {
  totalDocuments: number;
  pendingDocuments: number;
  indexedDocuments: number;
  staleDocuments: number;
  failedDocuments: number;
  lastIndexedAt?: string | null;
}

export type SearchIndexStatusResponse = SearchIndexStatusSummary;

export interface SearchHighlight {
  field: 'title' | 'content' | 'source' | 'type';
  text: string;
}

export interface SearchFacetBucket {
  value: string;
  count: number;
}

export interface SearchResultItem {
  documentId: string;
  blockId?: string | null;
  title: string;
  type: string;
  source: string;
  snippet: string;
  highlights: SearchHighlight[];
  matchedFields: Array<'title' | 'content' | 'source' | 'type'>;
  indexedAt: string | null;
  updatedAt: string;
  isStale: boolean;
  staleReason: 'document_updated_after_index' | 'document_marked_stale' | 'index_failed' | 'not_indexed' | null;
  score: number;
  documentTarget: SurfaceLinkTarget;
  traceTarget?: SurfaceLinkTarget | null;
}

export interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  query: string;
  normalizedQuery: string;
  filtersApplied: {
    type: string | null;
    source: string | null;
    updatedFrom: string | null;
    updatedTo: string | null;
    limit: number;
  };
  facets: {
    byType: SearchFacetBucket[];
    bySource: SearchFacetBucket[];
  };
  nextCursor: string | null;
  durationMs: number;
}

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface WorkspacePermissionSummary {
  canViewWorkspace: boolean;
  canManageMembers: boolean;
  canManageSettings: boolean;
  canEditDocuments: boolean;
  canDeleteDocuments: boolean;
  canRunAutomation: boolean;
}

export interface WorkspaceMembershipSummary {
  effectiveRole: WorkspaceRole;
  permissions: string[];
  permissionSummary: WorkspacePermissionSummary;
}

export type SurfaceLinkTarget =
  | {
      surface: 'document';
      payload: {
        documentId?: string;
        threadId?: string;
        commentId?: string;
      };
      context?: SurfaceLinkContext;
    }
  | {
      surface: 'search';
      payload: {
        query?: string;
        documentId?: string;
      };
      context?: SurfaceLinkContext;
    }
  | {
      surface: 'agent';
      payload: {
        runId?: string;
        jobId?: string;
      };
      context?: SurfaceLinkContext;
    }
  | {
      surface: 'operations';
      payload: {
        jobId?: string;
        jobType?: JobType | 'all';
        resourceType?: string;
        resourceId?: string;
      };
      context?: SurfaceLinkContext;
    }
  | {
      surface: 'admin';
      payload: {
        section?: 'summary' | 'usage' | 'alerts' | 'audit';
      };
      context?: SurfaceLinkContext;
    }
  | {
      surface: 'inbox';
      payload: Record<string, never>;
      context?: SurfaceLinkContext;
    };

export interface SurfaceLinkContext {
  tab?: string;
  section?: string;
  query?: string;
  anchor?: string;
  filter?: string;
}

export type SavedViewScope = 'personal' | 'workspace';
export type SavedViewSurface = 'search' | 'operations' | 'agent' | 'inbox' | 'admin';

export interface SearchViewPayload {
  query?: string;
  filters?: Record<string, unknown>;
  type?: string | null;
  source?: string | null;
  updatedRange?: '7d' | '30d' | 'all';
  staleOnly?: boolean;
  sort?: string | null;
  selectedDocumentId?: string | null;
  selectedTraceJobId?: string | null;
}

export interface OperationsViewPayload {
  status?: string | null;
  jobType?: string | null;
  resourceType?: string | null;
  selectedJobId?: string | null;
  detailOpen?: boolean;
  showFailedOnly?: boolean;
}

export interface AgentViewPayload {
  threadId?: string | null;
  status?: string | null;
  agentType?: string | null;
  selectedRunId?: string | null;
  detailOpen?: boolean;
  showFailuresOnly?: boolean;
}

export interface InboxViewPayload {
  filter?: string | null;
  unreadOnly?: boolean;
  type?: string | null;
  selectedNotificationId?: string | null;
}

export interface AdminViewPayload {
  section?: 'summary' | 'usage' | 'alerts' | 'audit';
  auditFilter?: string | null;
  eventType?: string | null;
  targetType?: string | null;
  selectedAlertId?: string | null;
}

export type SavedViewPayload =
  | SearchViewPayload
  | OperationsViewPayload
  | AgentViewPayload
  | InboxViewPayload
  | AdminViewPayload;

export interface SavedViewSummary {
  id: string;
  workspaceId: string;
  ownerUserId: string;
  scope: SavedViewScope;
  surface: SavedViewSurface;
  name: string;
  description: string | null;
  isPinned: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SavedViewDetail extends SavedViewSummary {
  contextVersion: number;
  payload: SavedViewPayload;
}

export interface AuditLogItem {
  id: string;
  actorId: string | null;
  actorDisplay: string;
  eventType:
    | 'workspace_updated'
    | 'member_invited'
    | 'invite_revoked'
    | 'member_role_changed'
    | 'member_removed'
    | 'document_deleted'
    | 'document_reindexed'
    | 'agent_run_rerun'
    | 'automation_triggered'
    | 'quota_alert_raised';
  targetType: string;
  targetId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface UsageQuotaSummary {
  documentsLimit?: number | null;
  storageBytesLimit?: number | null;
  agentRunsMonthlyLimit?: number | null;
  percentUsed: number;
  thresholdReached: boolean;
}

export interface UsageSummary {
  documentsCount: number;
  indexedDocumentsCount: number;
  agentRunsLast7d: number;
  agentRunsLast30d: number;
  failedJobsLast7d: number;
  failedJobsLast30d: number;
  artifactsBytes: number;
  quota: UsageQuotaSummary;
  quotaStatus: 'ok' | 'warning' | 'exceeded';
}

export interface AdminAlert {
  id: string;
  type: 'recent_failed_jobs_spike' | 'stale_documents_present' | 'indexing_failures_present' | 'quota_threshold_reached';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  target: SurfaceLinkTarget;
  relatedTargetType: string | null;
  relatedTargetId: string | null;
  createdAt: string;
}

export interface AdminSummary {
  workspace: {
    id: string;
    name: string;
    description: string | null;
    updatedAt: string | null;
  } | null;
  memberCounts: {
    membersTotal: number;
  };
  documentsSummary: {
    documentsTotal: number;
    indexedDocumentsTotal: number;
    staleDocumentsTotal: number;
  };
  searchSummary: {
    totalDocuments: number;
    pendingDocuments: number;
    indexedDocuments: number;
    staleDocuments: number;
    failedDocuments: number;
    lastIndexedAt: string | null;
  };
  agentSummary: {
    agentRunsLast7d: number;
    agentRunsLast30d: number;
  };
  jobsSummary: WorkspaceJobSummary;
  usageSummary: UsageSummary;
  alertsSummary: {
    total: number;
    critical: number;
    warning: number;
  };
}

export interface WorkspaceRecord extends WorkspaceMembershipSummary {
  id: string;
  name: string;
  description?: string | null;
  slug?: string | null;
  settings?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface WorkspaceMemberRecord {
  id: string;
  workspace_id: string;
  user_id: string;
  name?: string | null;
  email: string;
  role: WorkspaceRole;
  joined_at?: string;
}

export interface WorkspaceInviteRecord {
  id: string;
  workspace_id: string;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string;
  created_at?: string;
  accepted_at?: string | null;
  revoked_at?: string | null;
  invite_link?: string;
}

export type AgentRunStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface AgentRunStep {
  id: string;
  stepKey: string;
  name: string;
  worker: string;
  position: number;
  status: 'pending' | 'running' | 'done' | 'error' | 'aborted';
  input?: unknown;
  output?: unknown;
  error?: string | null;
  tokenUsage?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface AgentRun {
  id: string;
  workspaceId: string;
  userId: string;
  type: string;
  threadId?: string | null;
  mode: 'auto' | 'hybrid' | 'graph';
  status: AgentRunStatus;
  title?: string;
  input?: string;
  inputSummary: string;
  output?: string | null;
  outputSummary?: string | null;
  errorSummary?: string | null;
  promptVersion?: string | null;
  promptLabel?: string | null;
  templateId?: string | null;
  templateVersion?: string | null;
  rerunOfRunId?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  parentRunId?: string | null;
  rootRunId?: string | null;
  depth: number;
  tokenUsage?: number | null;
  jobId?: string | null;
  lastJobId?: string | null;
  result?: { answer?: string; [key: string]: unknown } | null;
  citations?: AgentCitation[];
  relatedArtifacts?: AgentRunArtifact[];
  steps: AgentRunStep[];
}

export interface AgentCitation {
  id: string;
  title: string;
  sourceType: string;
  sourceId: string;
  snippet: string;
  href?: string | null;
}

export interface AgentRunArtifact {
  artifactId: string;
  type: string;
  title: string;
  mimeType?: string | null;
  size?: number | null;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface AgentRunListItem {
  runId: string;
  threadId?: string | null;
  status: AgentRunStatus;
  title: string;
  inputPreview: string;
  outputPreview: string;
  errorSummary?: string | null;
  jobId?: string | null;
  promptVersion?: string | null;
  promptLabel?: string | null;
  templateId?: string | null;
  templateVersion?: string | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  rerunOfRunId?: string | null;
}

export interface AgentRunDetail {
  runId: string;
  workspaceId: string;
  threadId?: string | null;
  type?: string;
  mode?: 'auto' | 'hybrid' | 'graph';
  title?: string;
  status: AgentRunStatus;
  input: string;
  inputSummary?: string;
  output?: string | null;
  outputSummary?: string | null;
  errorCode?: string | null;
  errorSummary?: string | null;
  jobId?: string | null;
  jobTarget?: SurfaceLinkTarget | null;
  promptVersion?: string | null;
  promptLabel?: string | null;
  templateId?: string | null;
  templateVersion?: string | null;
  citations: AgentCitation[];
  relatedArtifacts: AgentRunArtifact[];
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  rerunOfRunId?: string | null;
  steps?: AgentRunStep[];
}

export type JobType =
  | 'document_index'
  | 'document_reindex'
  | 'agent_run'
  | 'automation_trigger';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export interface JobRecord {
  id: string;
  workspaceId: string;
  jobType: JobType;
  resourceType?: string | null;
  resourceId?: string | null;
  sourceDomain: string;
  sourceRunId?: string | null;
  triggeredBy?: string | null;
  triggeredVia?: 'manual' | 'schedule' | 'system' | null;
  status: JobStatus;
  errorCode?: string | null;
  errorSummary?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  retryOfJobId?: string | null;
  cancelRequestedAt?: string | null;
  metadata?: Record<string, unknown>;
}

export interface JobEventRecord {
  id: string;
  jobId: string;
  sequenceNo: number;
  eventType:
    | 'queued'
    | 'started'
    | 'progress'
    | 'retry_requested'
    | 'retry_started'
    | 'cancel_requested'
    | 'cancelled'
    | 'failed'
    | 'completed'
    | 'timed_out';
  message?: string | null;
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface WorkspaceJobSummary {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  timeout: number;
  byType: Record<JobType, number>;
  latestFailedAt: string | null;
}

export interface JobListResponse {
  items: JobRecord[];
  nextCursor: string | null;
}

export interface SearchJobResponse {
  documentId: string;
  jobId: string;
  status: JobStatus;
  indexStatus?: DocumentIndexStatus;
}

export interface AutomationTriggerResponse {
  triggered: boolean;
  automation_id: string;
  jobId: string;
  status: JobStatus;
  message: string;
}

export type { OfflineQueueItem };

export type OfflineQueueMetricsSource = 'bootstrap' | 'queue_changed' | 'online' | 'interval';

export interface OfflineQueueObservabilityPayload {
  workspace_id: string;
  queue_depth: number;
  replay_processed?: number;
  replay_failed?: number;
  source?: OfflineQueueMetricsSource;
  /** SLA fields — populated after a replay run */
  avg_dwell_ms?: number;
  max_dwell_ms?: number;
  p95_dwell_ms?: number;
  /** success_rate in [0, 1] */
  success_rate?: number;
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
export const listWorkspaces = () => api<{ workspaces: WorkspaceRecord[] }>('/workspaces');
export const createWorkspace = (name: string) =>
  api<WorkspaceRecord>('/workspaces', { method: 'POST', body: JSON.stringify({ name }) });
export const getWorkspaceAdminSummary = (workspaceId: string) =>
  api<AdminSummary>(`/workspaces/${workspaceId}/admin/summary`);
export const listWorkspaceAuditLogs = (
  workspaceId: string,
  query: {
    eventType?: AuditLogItem['eventType'];
    targetType?: string;
    cursor?: string;
    limit?: number;
  } = {}
) => {
  const params = new URLSearchParams();
  if (query.eventType) params.set('eventType', query.eventType);
  if (query.targetType) params.set('targetType', query.targetType);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return api<{ items: AuditLogItem[]; nextCursor: string | null }>(`/workspaces/${workspaceId}/audit-logs${suffix}`);
};
export const getWorkspaceUsage = (workspaceId: string) =>
  api<UsageSummary>(`/workspaces/${workspaceId}/usage`);
export const getWorkspaceAdminAlerts = (workspaceId: string) =>
  api<{ items: AdminAlert[] }>(`/workspaces/${workspaceId}/admin/alerts`);

export const listSavedViews = (
  workspaceId: string,
  query?: {
    surface?: SavedViewSurface;
    scope?: SavedViewScope;
    includePinned?: boolean;
  }
) => {
  const params = new URLSearchParams();
  if (query?.surface) params.set('surface', query.surface);
  if (query?.scope) params.set('scope', query.scope);
  if (query?.includePinned) params.set('includePinned', 'true');
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return api<{ items: SavedViewSummary[] }>(`/workspaces/${workspaceId}/saved-views${suffix}`);
};

export const getSavedView = (workspaceId: string, viewId: string) =>
  api<SavedViewDetail>(`/workspaces/${workspaceId}/saved-views/${viewId}`);

export const createSavedView = (
  workspaceId: string,
  payload: {
    scope: SavedViewScope;
    surface: SavedViewSurface;
    name: string;
    description?: string | null;
    payload: SavedViewPayload;
    isPinned?: boolean;
    isDefault?: boolean;
  }
) =>
  api<SavedViewDetail>(`/workspaces/${workspaceId}/saved-views`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const updateSavedView = (
  workspaceId: string,
  viewId: string,
  payload: {
    name?: string;
    description?: string | null;
    payload?: SavedViewPayload;
    isPinned?: boolean;
    isDefault?: boolean;
  }
) =>
  api<SavedViewDetail>(`/workspaces/${workspaceId}/saved-views/${viewId}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  });

export const deleteSavedView = (workspaceId: string, viewId: string) =>
  api<undefined>(`/workspaces/${workspaceId}/saved-views/${viewId}`, {
    method: 'DELETE',
  });

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
export const search = (params: {
  workspaceId: string;
  q: string;
  type?: string;
  source?: string;
  updatedFrom?: string;
  updatedTo?: string;
  limit?: number;
  cursor?: string;
}) => {
  const searchParams = new URLSearchParams({
    workspace_id: params.workspaceId,
    q: params.q,
  });
  if (params.type) searchParams.set('type', params.type);
  if (params.source) searchParams.set('source', params.source);
  if (params.updatedFrom) searchParams.set('updatedFrom', params.updatedFrom);
  if (params.updatedTo) searchParams.set('updatedTo', params.updatedTo);
  if (params.limit) searchParams.set('limit', String(params.limit));
  if (params.cursor) searchParams.set('cursor', params.cursor);
  return api<SearchResponse>(`/search?${searchParams.toString()}`);
};

export const getSearchIndexStatus = (wsId: string) =>
  api<SearchIndexStatusResponse>(`/search/index-status?workspace_id=${wsId}`);

export const reindexSearchDocument = (documentId: string) =>
  api<SearchJobResponse>(`/search/reindex/${documentId}`, {
    method: 'POST',
    body: JSON.stringify({}),
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
export const createAgentRun = (input: string, wsId: string, options?: { mode?: 'auto' | 'hybrid' | 'graph'; template?: string }) =>
  api<AgentRun & { runId?: string }>(
    '/agents/runs',
    {
    method: 'POST',
    body: JSON.stringify({
      input,
      workspace_id: wsId,
      ...(options?.mode ? { mode: options.mode } : {}),
      ...(options?.template ? { template: options.template } : {}),
    }),
    }
  );

export const getAgentRun = (runId: string, wsId: string) =>
  api<AgentRunDetail>(`/agents/runs/${runId}?workspace_id=${encodeURIComponent(wsId)}`);

export const listAgentRuns = (
  wsId: string,
  query: {
    threadId?: string;
    status?: AgentRunStatus;
    agentType?: string;
    cursor?: string;
    limit?: number;
  } = {}
) => {
  const params = new URLSearchParams({ workspace_id: wsId });
  if (query.threadId) params.set('threadId', query.threadId);
  if (query.status) params.set('status', query.status);
  if (query.agentType) params.set('agentType', query.agentType);
  if (query.cursor) params.set('cursor', query.cursor);
  params.set('limit', String(query.limit ?? 10));
  return api<{ items: AgentRunListItem[]; nextCursor: string | null }>(`/agents/runs?${params.toString()}`);
};

export const getAgentRunArtifacts = (runId: string, wsId: string) =>
  api<{ items: AgentRunArtifact[] }>(`/agents/runs/${runId}/artifacts?workspace_id=${encodeURIComponent(wsId)}`);

export const rerunAgentRun = (runId: string, wsId: string) =>
  api<{ runId: string; jobId: string | null; status: AgentRunStatus; rerunOfRunId: string }>(
    `/agents/runs/${runId}/rerun?workspace_id=${encodeURIComponent(wsId)}`,
    { method: 'POST', body: JSON.stringify({}) }
  );

export const listWorkspaceJobs = (
  workspaceId: string,
  query: {
    status?: JobStatus;
    jobType?: JobType;
    resourceType?: string;
    resourceId?: string;
    cursor?: string;
    limit?: number;
  } = {}
) => {
  const params = new URLSearchParams();
  if (query.status) params.set('status', query.status);
  if (query.jobType) params.set('jobType', query.jobType);
  if (query.resourceType) params.set('resourceType', query.resourceType);
  if (query.resourceId) params.set('resourceId', query.resourceId);
  if (query.cursor) params.set('cursor', query.cursor);
  if (query.limit) params.set('limit', String(query.limit));
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return api<JobListResponse>(`/workspaces/${workspaceId}/jobs${suffix}`);
};

export const getWorkspaceJobSummary = (workspaceId: string) =>
  api<WorkspaceJobSummary>(`/workspaces/${workspaceId}/jobs/summary`);

export const getWorkspaceJob = (workspaceId: string, jobId: string) =>
  api<JobRecord>(`/workspaces/${workspaceId}/jobs/${jobId}`);

export const getWorkspaceJobEvents = (workspaceId: string, jobId: string) =>
  api<{ items: JobEventRecord[] }>(`/workspaces/${workspaceId}/jobs/${jobId}/events`);

export const retryWorkspaceJob = (workspaceId: string, jobId: string) =>
  api<{ jobId: string; retryOfJobId: string; status: JobStatus; runId?: string }>(
    `/workspaces/${workspaceId}/jobs/${jobId}/retry`,
    { method: 'POST', body: JSON.stringify({}) }
  );

export const cancelWorkspaceJob = (workspaceId: string, jobId: string) =>
  api<{ jobId: string; status: JobStatus; cancelRequestedAt: string | null }>(
    `/workspaces/${workspaceId}/jobs/${jobId}/cancel`,
    { method: 'POST', body: JSON.stringify({}) }
  );

export const triggerAutomationJob = (automationId: string) =>
  api<AutomationTriggerResponse>(`/automations/${automationId}/trigger`, {
    method: 'POST',
    body: JSON.stringify({}),
  });

export function streamAgentRun(
  runId: string,
  wsId: string,
  onData: (d: any) => void,
  onDone: () => void,
  onError?: () => void
) {
  return sseStream(`/api/v1/agents/runs/${runId}/stream?workspace_id=${encodeURIComponent(wsId)}`, onData, onDone, onError);
}

// ── Workspace Members & Invites ──────────────────────────────
export const listWorkspaceMembers = (workspaceId: string) =>
  api<{ members: WorkspaceMemberRecord[] }>(`/workspaces/${workspaceId}/members`);
export const listWorkspaceInvites = (workspaceId: string) =>
  api<{ invites: WorkspaceInviteRecord[] }>(`/workspaces/${workspaceId}/invites`);
export const createWorkspaceInvite = (workspaceId: string, email: string, role: 'admin' | 'editor' | 'viewer') =>
  api<{ invite: WorkspaceInviteRecord }>(`/workspaces/${workspaceId}/invites`, {
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

type InboxNotificationBase = {
  id: string;
  workspace_id: string;
  user_id: string;
  status: 'unread' | 'read';
  read_at?: string | null;
  created_at: string;
  summary: string;
  sourceTarget: SurfaceLinkTarget;
  relatedJobId?: string | null;
  relatedRunId?: string | null;
  relatedDocumentId?: string | null;
};

export type InboxNotification =
  | (InboxNotificationBase & {
      type: 'mention';
      payload: {
        workspace_id: string;
        document_id: string;
        thread_id: string;
        comment_id: string;
        mentioned_by: string;
        preview?: string;
      };
    })
  | (InboxNotificationBase & {
      type: 'quota_alert';
      payload: {
        title: string;
        message: string;
        resource_type: string;
        used: number;
        limit: number;
        period: string;
        threshold_pct: number;
      };
    })
  | (InboxNotificationBase & {
      type: 'automation';
      payload: {
        title: string;
        message: string;
        entity_type?: string;
        entity_id?: string;
        context?: Record<string, unknown>;
      };
    })
  | (InboxNotificationBase & {
      type: 'unknown';
      payload: {
        title: string;
        message: string;
        raw_type?: string;
      };
    });

interface RawInboxNotification extends InboxNotificationBase {
  type: string;
  payload?: Record<string, unknown> | null;
}

function toSafeString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function toSafeNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function normalizeInboxNotification(notification: RawInboxNotification): InboxNotification {
  const base = {
    id: notification.id,
    workspace_id: notification.workspace_id,
    user_id: notification.user_id,
    status: notification.status,
    read_at: notification.read_at ?? null,
    created_at: notification.created_at,
    summary: notification.summary,
    sourceTarget: notification.sourceTarget,
    relatedJobId: notification.relatedJobId ?? null,
    relatedRunId: notification.relatedRunId ?? null,
    relatedDocumentId: notification.relatedDocumentId ?? null,
  } satisfies InboxNotificationBase;

  const payload = notification.payload ?? {};
  switch (notification.type) {
    case 'mention':
      return {
        ...base,
        type: 'mention',
        payload: {
          workspace_id: toSafeString(payload.workspace_id),
          document_id: toSafeString(payload.document_id),
          thread_id: toSafeString(payload.thread_id),
          comment_id: toSafeString(payload.comment_id),
          mentioned_by: toSafeString(payload.mentioned_by),
          ...(typeof payload.preview === 'string' ? { preview: payload.preview } : {}),
        },
      };
    case 'quota_alert':
      return {
        ...base,
        type: 'quota_alert',
        payload: {
          title: toSafeString(payload.title, 'Quota 警告'),
          message: toSafeString(payload.message, 'Quota 用量已達警戒值。'),
          resource_type: toSafeString(payload.resource_type),
          used: toSafeNumber(payload.used),
          limit: toSafeNumber(payload.limit),
          period: toSafeString(payload.period),
          threshold_pct: toSafeNumber(payload.threshold_pct),
        },
      };
    case 'automation':
      return {
        ...base,
        type: 'automation',
        payload: {
          title: toSafeString(payload.title, 'Automation'),
          message: toSafeString(payload.message, 'An automation was triggered.'),
          ...(typeof payload.entity_type === 'string' ? { entity_type: payload.entity_type } : {}),
          ...(typeof payload.entity_id === 'string' ? { entity_id: payload.entity_id } : {}),
          ...(payload.context && typeof payload.context === 'object'
            ? { context: payload.context as Record<string, unknown> }
            : {}),
        },
      };
    default:
      return {
        ...base,
        type: 'unknown',
        payload: {
          title: toSafeString(payload.title, '系統通知'),
          message: toSafeString(payload.message, '收到未識別的通知。'),
          raw_type: notification.type,
        },
      };
  }
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

export const listInboxNotifications = async (
  status: 'unread' | 'all' = 'unread',
  workspaceId?: string | null
) => {
  const params = new URLSearchParams({ status });
  if (workspaceId) params.set('workspace_id', workspaceId);
  const response = await api<{ notifications: RawInboxNotification[]; unread_count: number }>(`/inbox/notifications?${params.toString()}`);
  return {
    notifications: response.notifications.map(normalizeInboxNotification),
    unread_count: response.unread_count,
  };
};

export const markInboxNotificationRead = async (notificationId: string) => {
  const response = await api<{ notification: RawInboxNotification }>(`/inbox/notifications/${notificationId}/read`, {
    method: 'PATCH',
    body: JSON.stringify({}),
  });
  return { notification: normalizeInboxNotification(response.notification) };
};

export const markAllInboxNotificationsRead = (workspaceId?: string | null) =>
  api<{ updated: number }>(`/inbox/notifications/read_all`, {
    method: 'PATCH',
    body: JSON.stringify(workspaceId ? { workspace_id: workspaceId } : {}),
  });

export type ProductTelemetryEventName =
  | 'search_performed'
  | 'search_no_result'
  | 'reindex_triggered'
  | 'agent_run_created'
  | 'agent_rerun_clicked'
  | 'job_retry_clicked'
  | 'alert_opened'
  | 'notification_opened';

export const trackProductEvent = (
  eventName: ProductTelemetryEventName,
  params: {
    workspaceId: string;
    userId: string;
    surface: 'search' | 'agent' | 'operations' | 'admin' | 'document' | 'inbox';
    targetType?: string | null;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
  }
) =>
  api<{ accepted: true }>('/telemetry/events', {
    method: 'POST',
    body: JSON.stringify({
      event_name: eventName,
      workspace_id: params.workspaceId,
      user_id: params.userId,
      surface: params.surface,
      target_type: params.targetType ?? null,
      target_id: params.targetId ?? null,
      metadata: params.metadata ?? {},
    }),
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
export const updateCollectionSchema = (id: string, schema: any) =>
  api<any>(`/collections/${id}`, { method: 'PATCH', body: JSON.stringify({ schema }) });
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
export function sseStream(
  path: string,
  onData: (d: any) => void,
  onDone: () => void,
  onError?: () => void
) {
  const token = getToken();
  const separator = path.includes('?') ? '&' : '?';
  const url = `${import.meta.env.VITE_API_URL ?? 'http://localhost:4000'}${path}${token ? `${separator}token=${token}` : ''}`;
  const es = new EventSource(url);
  es.onmessage = (e) => { try { onData(JSON.parse(e.data)); } catch { } };
  es.addEventListener('done', () => { onDone(); es.close(); });
  es.onerror = () => { onError?.(); es.close(); };
  return () => es.close();
}
