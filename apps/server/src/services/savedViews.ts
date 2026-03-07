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
      if (record.updatedRange && !['7d', '30d', 'all'].includes(String(record.updatedRange))) {
        throw new Error('Invalid search updatedRange');
      }
      return;
    case 'operations':
      if (record.detailOpen != null && typeof record.detailOpen !== 'boolean') throw new Error('Invalid operations detailOpen');
      return;
    case 'agent':
      if (record.detailOpen != null && typeof record.detailOpen !== 'boolean') throw new Error('Invalid agent detailOpen');
      return;
    case 'inbox':
      if (record.unreadOnly != null && typeof record.unreadOnly !== 'boolean') throw new Error('Invalid inbox unreadOnly');
      return;
    case 'admin':
      if (record.section && !['summary', 'usage', 'alerts', 'audit'].includes(String(record.section))) {
        throw new Error('Invalid admin section');
      }
      return;
    default:
      throw new Error('Unsupported surface');
  }
}

export function normalizeSavedViewPayload(surface: SavedViewSurface, payload: unknown): SavedViewPayload {
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
     ORDER BY is_pinned DESC, created_at DESC, id DESC`,
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
  validateSavedViewPayload(params.surface, params.payload);
  const normalizedPayload = normalizeSavedViewPayload(params.surface, params.payload);
  if (params.isDefault) {
    await enforceDefaultViewRule(params.workspaceId, params.ownerUserId, params.surface);
  }

  const result = await db.query<SavedViewRow>(
    `INSERT INTO saved_views (
       workspace_id, owner_user_id, scope, surface, name, description, context_version, payload, is_pinned, is_default
     ) VALUES ($1, $2, $3, $4, $5, $6, 1, $7::jsonb, $8, $9)
     RETURNING *`,
    [
      params.workspaceId,
      params.ownerUserId,
      params.scope,
      params.surface,
      params.name.trim(),
      params.description?.trim() ?? null,
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

  const nextPayload = params.payload == null ? existing.payload : normalizeSavedViewPayload(existing.surface, params.payload);
  if (params.payload != null) validateSavedViewPayload(existing.surface, params.payload);
  const nextIsDefault = params.isDefault ?? existing.is_default;
  if (nextIsDefault) {
    await enforceDefaultViewRule(existing.workspace_id, existing.owner_user_id, existing.surface, existing.id);
  }

  const result = await db.query<SavedViewRow>(
    `UPDATE saved_views
     SET name = $3,
         description = $4,
         payload = $5::jsonb,
         is_pinned = $6,
         is_default = $7,
         updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2
     RETURNING *`,
    [
      params.viewId,
      params.workspaceId,
      params.name?.trim() ?? existing.name,
      params.description === undefined ? existing.description : params.description?.trim() ?? null,
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
