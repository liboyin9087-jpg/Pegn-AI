import { pool } from '../db/client.js';
import type { AuthRequest } from '../middleware/auth.js';
import { createAdminTarget, createAgentTarget, createDocumentTarget, createOperationsTarget, createSearchTarget, type SurfaceLinkTarget } from './surfaceTargets.js';

export interface InboxListOptions {
  userId: string;
  workspaceId?: string | null;
  status?: 'unread' | 'all';
}

export interface InboxNotificationRow {
  id: string;
  workspace_id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown> | null;
  status: 'unread' | 'read';
  read_at: Date | null;
  created_at: Date;
}

export interface InboxNotificationProjection {
  id: string;
  workspace_id: string;
  user_id: string;
  type: string;
  payload: Record<string, unknown> | null;
  status: 'unread' | 'read';
  read_at: string | null;
  created_at: string;
  summary: string;
  sourceTarget: SurfaceLinkTarget;
  relatedJobId?: string | null;
  relatedRunId?: string | null;
  relatedDocumentId?: string | null;
}

export function buildNotificationSummary(notification: Pick<InboxNotificationRow, 'type' | 'payload'>): string {
  const payload = notification.payload ?? {};
  switch (notification.type) {
    case 'mention':
      return typeof payload.preview === 'string' && payload.preview.trim()
        ? payload.preview
        : 'You were mentioned in a comment thread.';
    case 'quota_alert':
      return typeof payload.message === 'string' && payload.message.trim()
        ? payload.message
        : 'Workspace quota threshold has been reached.';
    case 'automation':
      return typeof payload.message === 'string' && payload.message.trim()
        ? payload.message
        : 'An automation-related event requires attention.';
    default:
      return 'Open the related surface for more details.';
  }
}

export function buildNotificationTarget(notification: Pick<InboxNotificationRow, 'type' | 'payload' | 'workspace_id'>): {
  sourceTarget: SurfaceLinkTarget;
  relatedJobId: string | null;
  relatedRunId: string | null;
  relatedDocumentId: string | null;
} {
  const payload = notification.payload ?? {};
  const context = payload.context && typeof payload.context === 'object'
    ? payload.context as Record<string, unknown>
    : {};
  const relatedJobId = typeof context.job_id === 'string'
    ? context.job_id
    : typeof payload.job_id === 'string'
      ? payload.job_id
      : null;
  const relatedRunId = typeof context.run_id === 'string'
    ? context.run_id
    : typeof payload.run_id === 'string'
      ? payload.run_id
      : null;
  const relatedDocumentId = typeof payload.document_id === 'string'
    ? payload.document_id
    : typeof context.document_id === 'string'
      ? context.document_id
      : null;

  switch (notification.type) {
    case 'mention':
      return {
        sourceTarget: createDocumentTarget({
          documentId: typeof payload.document_id === 'string' ? payload.document_id : null,
          threadId: typeof payload.thread_id === 'string' ? payload.thread_id : null,
          commentId: typeof payload.comment_id === 'string' ? payload.comment_id : null,
        }),
        relatedJobId,
        relatedRunId,
        relatedDocumentId,
      };
    case 'quota_alert':
      return {
        sourceTarget: createAdminTarget('usage'),
        relatedJobId,
        relatedRunId,
        relatedDocumentId,
      };
    case 'automation': {
      const notificationKind = typeof context.notification_kind === 'string' ? context.notification_kind : null;
      if (notificationKind === 'agent_run_failed' || relatedRunId) {
        return {
          sourceTarget: createAgentTarget({ runId: relatedRunId, jobId: relatedJobId }),
          relatedJobId,
          relatedRunId,
          relatedDocumentId,
        };
      }
      if (notificationKind === 'reindex_failed') {
        return {
          sourceTarget: createOperationsTarget({
            jobId: relatedJobId,
            jobType: 'document_reindex',
            resourceType: 'document',
            resourceId: relatedDocumentId,
            filter: relatedDocumentId ? `document:${relatedDocumentId}` : 'document_reindex',
          }),
          relatedJobId,
          relatedRunId,
          relatedDocumentId,
        };
      }
      if (notificationKind === 'stale_documents_present') {
        return {
          sourceTarget: createSearchTarget({
            filter: 'stale',
          }),
          relatedJobId,
          relatedRunId,
          relatedDocumentId,
        };
      }
      return {
        sourceTarget: createOperationsTarget({
          jobId: relatedJobId,
          jobType: typeof context.job_type === 'string' ? context.job_type as any : 'automation_trigger',
        }),
        relatedJobId,
        relatedRunId,
        relatedDocumentId,
      };
    }
    default:
      return {
        sourceTarget: createSearchTarget({
          query: typeof payload.query === 'string' ? payload.query : undefined,
          documentId: relatedDocumentId,
        }),
        relatedJobId,
        relatedRunId,
        relatedDocumentId,
      };
  }
}

function normalizeInboxRow(row: InboxNotificationRow): InboxNotificationProjection {
  const summary = buildNotificationSummary(row);
  const target = buildNotificationTarget(row);
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    user_id: row.user_id,
    type: row.type,
    payload: row.payload,
    status: row.status,
    read_at: row.read_at ? row.read_at.toISOString() : null,
    created_at: row.created_at.toISOString(),
    summary,
    sourceTarget: target.sourceTarget,
    relatedJobId: target.relatedJobId,
    relatedRunId: target.relatedRunId,
    relatedDocumentId: target.relatedDocumentId,
  };
}

export async function listInboxNotifications(options: InboxListOptions): Promise<{
  notifications: InboxNotificationProjection[];
  unread_count: number;
}> {
  if (!pool) {
    return { notifications: [], unread_count: 0 };
  }

  const values: unknown[] = [options.userId];
  const clauses = [
    `n.user_id = $1`,
    `EXISTS (
      SELECT 1
      FROM workspace_members m
      WHERE m.workspace_id = n.workspace_id
        AND m.user_id = $1
    )`,
  ];
  let index = 2;
  if (options.workspaceId) {
    clauses.push(`n.workspace_id = $${index++}`);
    values.push(options.workspaceId);
  }
  if (options.status !== 'all') {
    clauses.push(`n.status = 'unread'`);
  }

  const notificationsResult = await pool.query<InboxNotificationRow>(
    `SELECT
        n.id,
        n.workspace_id,
        n.user_id,
        n.type,
        n.payload,
        n.status,
        n.read_at,
        n.created_at
     FROM inbox_notifications n
     WHERE ${clauses.join(' AND ')}
     ORDER BY n.created_at DESC
     LIMIT 200`,
    values
  );

  const unreadClauses = clauses.filter((clause) => clause !== `n.status = 'unread'`).concat(`n.status = 'unread'`);
  const unreadResult = await pool.query<{ unread_count: number }>(
    `SELECT COUNT(*)::int AS unread_count
     FROM inbox_notifications n
     WHERE ${unreadClauses.join(' AND ')}`,
    values
  );

  return {
    notifications: notificationsResult.rows.map(normalizeInboxRow),
    unread_count: unreadResult.rows[0]?.unread_count ?? 0,
  };
}

export async function markInboxNotificationRead(notificationId: string, userId: string): Promise<InboxNotificationProjection | null> {
  if (!pool) return null;

  const updateResult = await pool.query<InboxNotificationRow>(
    `UPDATE inbox_notifications
     SET status = 'read',
         read_at = COALESCE(read_at, NOW()),
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING id, workspace_id, user_id, type, payload, status, read_at, created_at`,
    [notificationId, userId]
  );

  if ((updateResult.rowCount ?? 0) === 0) return null;

  await pool.query(
    `UPDATE comment_mentions
     SET status = 'read', updated_at = NOW()
     WHERE notification_id = $1`,
    [notificationId]
  );

  return normalizeInboxRow(updateResult.rows[0]);
}

export async function markAllInboxNotificationsRead(userId: string, workspaceId?: string | null): Promise<number> {
  if (!pool) return 0;

  const values: unknown[] = [userId];
  const clauses = [
    `n.user_id = $1`,
    `n.status = 'unread'`,
    `EXISTS (
      SELECT 1
      FROM workspace_members m
      WHERE m.workspace_id = n.workspace_id
        AND m.user_id = $1
    )`,
  ];
  let index = 2;
  if (workspaceId) {
    clauses.push(`n.workspace_id = $${index++}`);
    values.push(workspaceId);
  }

  const updateResult = await pool.query<{ id: string }>(
    `UPDATE inbox_notifications n
     SET status = 'read',
         read_at = COALESCE(read_at, NOW()),
         updated_at = NOW()
     WHERE ${clauses.join(' AND ')}
     RETURNING n.id`,
    values
  );

  const notificationIds = updateResult.rows.map((row) => row.id);
  if (notificationIds.length > 0) {
    await pool.query(
      `UPDATE comment_mentions
       SET status = 'read', updated_at = NOW()
       WHERE notification_id = ANY($1::uuid[])`,
      [notificationIds]
    );
  }
  return updateResult.rowCount ?? notificationIds.length;
}

export function getInboxWorkspaceScope(req: AuthRequest): string | null {
  const workspaceId = typeof req.query.workspace_id === 'string'
    ? req.query.workspace_id
    : typeof req.query.workspaceId === 'string'
      ? req.query.workspaceId
      : null;
  return workspaceId;
}
