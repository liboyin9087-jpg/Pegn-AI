import { pool } from '../db/client.js';

export type SavedViewScope = 'personal' | 'workspace';
export type SavedViewSurface = 'search' | 'operations' | 'agent' | 'inbox' | 'admin';

export type SavedViewPayload =
  | SearchViewPayload
  | OperationsViewPayload
  | AgentViewPayload
  | InboxViewPayload
  | AdminViewPayload;

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

interface SavedViewRow {
  id: string;
  workspace_id: string;
  owner_user_id: string;
  scope: SavedViewScope;
  surface: SavedViewSurface;
  name: string;
  description: string | null;
  context_version: number;
  payload: SavedViewPayload;
  is_pinned: boolean;
  is_default: boolean;
  created_at: Date;
  updated_at: Date;
}

interface ListSavedViewsParams {
  workspaceId: string;
  userId: string;
  surface?: SavedViewSurface | null;
  scope?: SavedViewScope | null;
  includePinned?: boolean;
}

interface CreateSavedViewParams {
  workspaceId: string;
  ownerUserId: string;
  scope: SavedViewScope;
  surface: SavedViewSurface;
  name: string;
  description?: string | null;
  contextVersion?: number;
  payload: unknown;
  isPinned?: boolean;
  isDefault?: boolean;
  canManageWorkspaceViews: boolean;
}

interface UpdateSavedViewParams {
  workspaceId: string;
  viewId: string;
  userId: string;
  name?: string;
  description?: string | null;
  contextVersion?: number;
  payload?: unknown;
  isPinned?: boolean;
  isDefault?: boolean;
  canManageWorkspaceViews: boolean;
}

interface DeleteSavedViewParams {
  workspaceId: string;
  viewId: string;
  userId: string;
  canManageWorkspaceViews: boolean;
}

function assertPool() {
  if (!pool) throw new Error('Database not initialized');
  return pool;
}

function toSavedViewSummary(row: SavedViewRow): SavedViewSummary {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    ownerUserId: row.owner_user_id,
    scope: row.scope,
    surface: row.surface,
    name: row.name,
    description: row.description,
    isPinned: row.is_pinned,
    isDefault: row.is_default,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toSavedViewDetail(row: SavedViewRow): SavedViewDetail {
  return {
    ...toSavedViewSummary(row),
    contextVersion: row.context_version,
    payload: row.payload,
  };
}

function sanitizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function validateSavedViewPayload(surface: SavedViewSurface, payload: unknown): void {
  const record = toRecord(payload);
  switch (surface) {
    case 'search':
      if (record.query != null && typeof record.query !== 'string') throw new Error('Invalid search query');
      if (record.filters != null && (typeof record.filters !== 'object' || Array.isArray(record.filters))) throw new Error('Invalid search filters');
      if (record.type != null && typeof record.type !== 'string') throw new Error('Invalid search type');
      if (record.source != null && typeof record.source !== 'string') throw new Error('Invalid search source');
      if (record.updatedRange && !['7d', '30d', 'all'].includes(String(record.updatedRange))) {
        throw new Error('Invalid search updatedRange');
      }
      if (record.staleOnly != null && typeof record.staleOnly !== 'boolean') throw new Error('Invalid search staleOnly');
      if (record.sort != null && typeof record.sort !== 'string') throw new Error('Invalid search sort');
      if (record.selectedDocumentId != null && typeof record.selectedDocumentId !== 'string') throw new Error('Invalid search selectedDocumentId');
      if (record.selectedTraceJobId != null && typeof record.selectedTraceJobId !== 'string') throw new Error('Invalid search selectedTraceJobId');
      return;
    case 'operations':
      if (record.status != null && typeof record.status !== 'string') throw new Error('Invalid operations status');
      if (record.jobType != null && typeof record.jobType !== 'string') throw new Error('Invalid operations jobType');
      if (record.resourceType != null && typeof record.resourceType !== 'string') throw new Error('Invalid operations resourceType');
      if (record.selectedJobId != null && typeof record.selectedJobId !== 'string') throw new Error('Invalid operations selectedJobId');
      if (record.detailOpen != null && typeof record.detailOpen !== 'boolean') throw new Error('Invalid operations detailOpen');
      if (record.showFailedOnly != null && typeof record.showFailedOnly !== 'boolean') throw new Error('Invalid operations showFailedOnly');
      return;
    case 'agent':
      if (record.threadId != null && typeof record.threadId !== 'string') throw new Error('Invalid agent threadId');
      if (record.status != null && typeof record.status !== 'string') throw new Error('Invalid agent status');
      if (record.agentType != null && typeof record.agentType !== 'string') throw new Error('Invalid agent agentType');
      if (record.selectedRunId != null && typeof record.selectedRunId !== 'string') throw new Error('Invalid agent selectedRunId');
      if (record.detailOpen != null && typeof record.detailOpen !== 'boolean') throw new Error('Invalid agent detailOpen');
      if (record.showFailuresOnly != null && typeof record.showFailuresOnly !== 'boolean') throw new Error('Invalid agent showFailuresOnly');
      return;
    case 'inbox':
      if (record.filter != null && typeof record.filter !== 'string') throw new Error('Invalid inbox filter');
      if (record.unreadOnly != null && typeof record.unreadOnly !== 'boolean') throw new Error('Invalid inbox unreadOnly');
      if (record.type != null && typeof record.type !== 'string') throw new Error('Invalid inbox type');
      if (record.selectedNotificationId != null && typeof record.selectedNotificationId !== 'string') throw new Error('Invalid inbox selectedNotificationId');
      return;
    case 'admin':
      if (record.section && !['summary', 'usage', 'alerts', 'audit'].includes(String(record.section))) {
        throw new Error('Invalid admin section');
      }
      if (record.auditFilter != null && typeof record.auditFilter !== 'string') throw new Error('Invalid admin auditFilter');
      if (record.eventType != null && typeof record.eventType !== 'string') throw new Error('Invalid admin eventType');
      if (record.targetType != null && typeof record.targetType !== 'string') throw new Error('Invalid admin targetType');
      if (record.selectedAlertId != null && typeof record.selectedAlertId !== 'string') throw new Error('Invalid admin selectedAlertId');
      return;
    default:
      throw new Error('Unsupported surface');
  }
}

export function normalizeSavedViewPayload(surface: SavedViewSurface, payload: unknown, contextVersion = 1): SavedViewPayload {
  void contextVersion;
  const record = toRecord(payload);
  switch (surface) {
    case 'search':
      return {
        query: sanitizeString(record.query) ?? undefined,
        filters: toRecord(record.filters),
        type: sanitizeString(record.type),
        source: sanitizeString(record.source),
        updatedRange: (['7d', '30d', 'all'].includes(String(record.updatedRange)) ? record.updatedRange : 'all') as '7d' | '30d' | 'all',
        staleOnly: Boolean(record.staleOnly),
        sort: sanitizeString(record.sort),
        selectedDocumentId: sanitizeString(record.selectedDocumentId),
        selectedTraceJobId: sanitizeString(record.selectedTraceJobId),
      };
    case 'operations':
      return {
        status: sanitizeString(record.status),
        jobType: sanitizeString(record.jobType),
        resourceType: sanitizeString(record.resourceType),
        selectedJobId: sanitizeString(record.selectedJobId),
        detailOpen: Boolean(record.detailOpen),
        showFailedOnly: Boolean(record.showFailedOnly),
      };
    case 'agent':
      return {
        threadId: sanitizeString(record.threadId),
        status: sanitizeString(record.status),
        agentType: sanitizeString(record.agentType),
        selectedRunId: sanitizeString(record.selectedRunId),
        detailOpen: Boolean(record.detailOpen),
        showFailuresOnly: Boolean(record.showFailuresOnly),
      };
    case 'inbox':
      return {
        filter: sanitizeString(record.filter),
        unreadOnly: Boolean(record.unreadOnly),
        type: sanitizeString(record.type),
        selectedNotificationId: sanitizeString(record.selectedNotificationId),
      };
    case 'admin':
      return {
        section: (['summary', 'usage', 'alerts', 'audit'].includes(String(record.section)) ? record.section : 'summary') as 'summary' | 'usage' | 'alerts' | 'audit',
        auditFilter: sanitizeString(record.auditFilter),
        eventType: sanitizeString(record.eventType),
        targetType: sanitizeString(record.targetType),
        selectedAlertId: sanitizeString(record.selectedAlertId),
      };
  }
}

async function enforceDefaultViewRule(workspaceId: string, ownerUserId: string, surface: SavedViewSurface, excludedViewId?: string) {
  const db = assertPool();
  await db.query(
    `UPDATE saved_views
     SET is_default = false
     WHERE workspace_id = $1
       AND owner_user_id = $2
       AND surface = $3
       ${excludedViewId ? 'AND id <> $4' : ''}`,
    excludedViewId ? [workspaceId, ownerUserId, surface, excludedViewId] : [workspaceId, ownerUserId, surface]
  );
}

function assertCanMutateView(view: SavedViewRow, userId: string, canManageWorkspaceViews: boolean) {
  if (view.scope === 'workspace') {
    if (!canManageWorkspaceViews) throw new Error('FORBIDDEN');
    return;
  }
  if (view.owner_user_id !== userId) throw new Error('FORBIDDEN');
}

export async function listSavedViews(params: ListSavedViewsParams): Promise<{ items: SavedViewSummary[] }> {
  const db = assertPool();
  const values: unknown[] = [params.workspaceId, params.userId];
  const conditions = [
    'workspace_id = $1',
    "(scope = 'workspace' OR owner_user_id = $2)",
  ];
  if (params.surface) {
    values.push(params.surface);
    conditions.push(`surface = $${values.length}`);
  }
  if (params.scope) {
    values.push(params.scope);
    conditions.push(`scope = $${values.length}`);
  }
  if (params.includePinned) {
    conditions.push('is_pinned = true');
  }

  const result = await db.query<SavedViewRow>(
    `SELECT *
     FROM saved_views
     WHERE ${conditions.join(' AND ')}
     ORDER BY is_pinned DESC,
              CASE WHEN scope = 'personal' THEN 0 ELSE 1 END ASC,
              updated_at DESC,
              id DESC`,
    values
  );
  return { items: result.rows.map(toSavedViewSummary) };
}

export async function getSavedView(workspaceId: string, viewId: string, userId: string): Promise<SavedViewDetail | null> {
  const db = assertPool();
  const result = await db.query<SavedViewRow>(
    `SELECT *
     FROM saved_views
     WHERE id = $1
       AND workspace_id = $2
       AND (scope = 'workspace' OR owner_user_id = $3)
     LIMIT 1`,
    [viewId, workspaceId, userId]
  );
  if (!result.rows[0]) return null;
  return toSavedViewDetail(result.rows[0]);
}

export async function createSavedView(params: CreateSavedViewParams): Promise<SavedViewDetail> {
  const db = assertPool();
  if (params.scope === 'workspace' && !params.canManageWorkspaceViews) {
    throw new Error('FORBIDDEN');
  }
  const contextVersion = params.contextVersion ?? 1;
  if (contextVersion !== 1) {
    throw new Error('Invalid saved view contextVersion');
  }
  validateSavedViewPayload(params.surface, params.payload);
  const normalizedPayload = normalizeSavedViewPayload(params.surface, params.payload, contextVersion);
  if (params.isDefault) {
    await enforceDefaultViewRule(params.workspaceId, params.ownerUserId, params.surface);
  }

  const result = await db.query<SavedViewRow>(
    `INSERT INTO saved_views (
       workspace_id, owner_user_id, scope, surface, name, description, context_version, payload, is_pinned, is_default
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
     RETURNING *`,
    [
      params.workspaceId,
      params.ownerUserId,
      params.scope,
      params.surface,
      params.name.trim(),
      params.description?.trim() ?? null,
      contextVersion,
      JSON.stringify(normalizedPayload),
      Boolean(params.isPinned),
      Boolean(params.isDefault),
    ]
  );
  return toSavedViewDetail(result.rows[0]);
}

export async function updateSavedView(params: UpdateSavedViewParams): Promise<SavedViewDetail | null> {
  const db = assertPool();
  const existingResult = await db.query<SavedViewRow>('SELECT * FROM saved_views WHERE id = $1 AND workspace_id = $2 LIMIT 1', [params.viewId, params.workspaceId]);
  const existing = existingResult.rows[0];
  if (!existing) return null;
  assertCanMutateView(existing, params.userId, params.canManageWorkspaceViews);

  const nextContextVersion = params.contextVersion ?? existing.context_version ?? 1;
  if (nextContextVersion !== 1) {
    throw new Error('Invalid saved view contextVersion');
  }
  const nextPayload = params.payload == null
    ? normalizeSavedViewPayload(existing.surface, existing.payload, nextContextVersion)
    : normalizeSavedViewPayload(existing.surface, params.payload, nextContextVersion);
  if (params.payload != null) validateSavedViewPayload(existing.surface, params.payload);
  const nextIsDefault = params.isDefault ?? existing.is_default;
  if (nextIsDefault) {
    await enforceDefaultViewRule(existing.workspace_id, existing.owner_user_id, existing.surface, existing.id);
  }

  const result = await db.query<SavedViewRow>(
    `UPDATE saved_views
     SET name = $3,
         description = $4,
         context_version = $5,
         payload = $6::jsonb,
         is_pinned = $7,
         is_default = $8,
         updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2
     RETURNING *`,
    [
      params.viewId,
      params.workspaceId,
      params.name?.trim() ?? existing.name,
      params.description === undefined ? existing.description : params.description?.trim() ?? null,
      nextContextVersion,
      JSON.stringify(nextPayload),
      params.isPinned ?? existing.is_pinned,
      nextIsDefault,
    ]
  );
  return toSavedViewDetail(result.rows[0]);
}

export async function deleteSavedView(params: DeleteSavedViewParams): Promise<boolean> {
  const db = assertPool();
  const existingResult = await db.query<SavedViewRow>('SELECT * FROM saved_views WHERE id = $1 AND workspace_id = $2 LIMIT 1', [params.viewId, params.workspaceId]);
  const existing = existingResult.rows[0];
  if (!existing) return false;
  assertCanMutateView(existing, params.userId, params.canManageWorkspaceViews);
  await db.query('DELETE FROM saved_views WHERE id = $1 AND workspace_id = $2', [params.viewId, params.workspaceId]);
  return true;
}
