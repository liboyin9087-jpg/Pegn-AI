import { Buffer } from 'node:buffer';
import { pool } from '../db/client.js';
import {
  projectThreadAssignmentNotification,
  projectThreadMentionNotification,
} from './inboxService.js';
import {
  createAdminTarget,
  createAgentTarget,
  createDocumentTarget,
  createOperationsTarget,
  type SurfaceLinkTarget,
} from './surfaceTargets.js';
import { getWorkspaceAdminAlerts } from './admin.js';

export type CollaborationTargetType = 'document' | 'agentRun' | 'job' | 'adminAlert';
export type CollaborationThreadStatus = 'open' | 'in_progress' | 'resolved';

export interface ThreadAssignment {
  assignmentId: string;
  threadId: string;
  assignedToUserId: string;
  assignedByUserId: string;
  status: CollaborationThreadStatus;
  dueAt: string | null;
  isCurrent: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface ThreadComment {
  commentId: string;
  threadId: string;
  author: {
    userId: string;
    name: string | null;
    email: string | null;
  };
  body: string;
  mentionedUserIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CollaborationThread {
  threadId: string;
  workspaceId: string;
  targetType: CollaborationTargetType;
  targetId: string;
  status: CollaborationThreadStatus;
  title: string;
  commentCount: number;
  currentAssignment: ThreadAssignment | null;
  sourceTarget: SurfaceLinkTarget;
  createdByUserId: string;
  lastActivityAt: string;
  resolvedAt: string | null;
  comments: ThreadComment[];
  assignmentHistory: ThreadAssignment[];
}

export interface ThreadSummary {
  threadId: string;
  targetType: CollaborationTargetType;
  targetId: string;
  status: CollaborationThreadStatus;
  title: string;
  latestCommentPreview: string | null;
  commentCount: number;
  currentAssignment: ThreadAssignment | null;
  lastActivityAt: string;
  sourceTarget: SurfaceLinkTarget;
}

export interface ListThreadsOptions {
  workspaceId: string;
  targetType?: CollaborationTargetType | null;
  status?: CollaborationThreadStatus | null;
  assignedToMe?: string | null;
  cursor?: string | null;
  limit?: number;
}

interface ThreadRow {
  id: string;
  workspace_id: string;
  target_type: CollaborationTargetType;
  target_id: string;
  status: CollaborationThreadStatus;
  title: string | null;
  created_by_user_id: string;
  last_activity_at: Date;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface ThreadCommentRow {
  id: string;
  thread_id: string;
  workspace_id: string;
  author_user_id: string;
  author_name: string | null;
  author_email: string | null;
  body: string;
  mentioned_user_ids: unknown;
  created_at: Date;
  updated_at: Date;
}

interface ThreadAssignmentRow {
  id: string;
  thread_id: string;
  workspace_id: string;
  assigned_to_user_id: string;
  assigned_by_user_id: string;
  status: CollaborationThreadStatus;
  due_at: Date | null;
  is_current: boolean;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
}

interface ThreadListCursor {
  lastActivityAt: string;
  id: string;
}

function normalizeThreadTitle(row: Pick<ThreadRow, 'title' | 'target_type' | 'target_id'>): string {
  if (row.title && row.title.trim()) return row.title.trim();
  switch (row.target_type) {
    case 'document':
      return `Document ${row.target_id}`;
    case 'agentRun':
      return `Agent run ${row.target_id}`;
    case 'job':
      return `Job ${row.target_id}`;
    case 'adminAlert':
      return `Admin alert ${row.target_id}`;
    default:
      return row.target_id;
  }
}

function normalizeMentionedUserIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

function encodeCursor(cursor: ThreadListCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(cursor?: string | null): ThreadListCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.lastActivityAt !== 'string' || typeof parsed.id !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function normalizeAssignment(row: ThreadAssignmentRow): ThreadAssignment {
  return {
    assignmentId: row.id,
    threadId: row.thread_id,
    assignedToUserId: row.assigned_to_user_id,
    assignedByUserId: row.assigned_by_user_id,
    status: row.status,
    dueAt: row.due_at ? row.due_at.toISOString() : null,
    isCurrent: row.is_current,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    resolvedAt: row.resolved_at ? row.resolved_at.toISOString() : null,
  };
}

function normalizeComment(row: ThreadCommentRow): ThreadComment {
  return {
    commentId: row.id,
    threadId: row.thread_id,
    author: {
      userId: row.author_user_id,
      name: row.author_name,
      email: row.author_email,
    },
    body: row.body,
    mentionedUserIds: normalizeMentionedUserIds(row.mentioned_user_ids),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

export function buildThreadSummary(params: {
  thread: ThreadRow;
  latestCommentPreview?: string | null;
  commentCount: number;
  currentAssignment: ThreadAssignment | null;
}): ThreadSummary {
  return {
    threadId: params.thread.id,
    targetType: params.thread.target_type,
    targetId: params.thread.target_id,
    status: params.thread.status,
    title: normalizeThreadTitle(params.thread),
    latestCommentPreview: params.latestCommentPreview ?? null,
    commentCount: params.commentCount,
    currentAssignment: params.currentAssignment,
    lastActivityAt: params.thread.last_activity_at.toISOString(),
    sourceTarget: buildThreadSourceTarget(params.thread),
  };
}

export function buildThreadSourceTarget(
  thread: Pick<ThreadRow, 'id' | 'target_type' | 'target_id'>
): SurfaceLinkTarget {
  switch (thread.target_type) {
    case 'document':
      return createDocumentTarget({
        documentId: thread.target_id,
        threadId: thread.id,
      });
    case 'agentRun':
      return createAgentTarget({
        runId: thread.target_id,
      });
    case 'job':
      return createOperationsTarget({
        jobId: thread.target_id,
        jobType: 'all',
      });
    case 'adminAlert':
      return {
        ...createAdminTarget('alerts'),
        context: {
          section: 'alerts',
          anchor: thread.target_id,
        },
      };
    default:
      return createOperationsTarget();
  }
}

async function ensureTargetExists(workspaceId: string, targetType: CollaborationTargetType, targetId: string): Promise<boolean> {
  const p = pool;
  if (!p) return false;

  switch (targetType) {
    case 'document': {
      const result = await p.query('SELECT 1 FROM documents WHERE id = $1 AND workspace_id = $2 LIMIT 1', [targetId, workspaceId]);
      return result.rowCount === 1;
    }
    case 'agentRun': {
      const result = await p.query('SELECT 1 FROM agent_runs WHERE id = $1 AND workspace_id = $2 LIMIT 1', [targetId, workspaceId]);
      return result.rowCount === 1;
    }
    case 'job': {
      const result = await p.query('SELECT 1 FROM jobs WHERE id = $1 AND workspace_id = $2 LIMIT 1', [targetId, workspaceId]);
      return result.rowCount === 1;
    }
    case 'adminAlert': {
      const alerts = await getWorkspaceAdminAlerts(workspaceId);
      return alerts.items.some((item) => item.id === targetId);
    }
    default:
      return false;
  }
}

async function ensureWorkspaceMembers(workspaceId: string, userIds: string[]): Promise<Set<string>> {
  const p = pool;
  if (!p || userIds.length === 0) return new Set();
  const result = await p.query<{ user_id: string }>(
    `SELECT user_id
     FROM workspace_members
     WHERE workspace_id = $1
       AND user_id = ANY($2::uuid[])`,
    [workspaceId, userIds]
  );
  return new Set(result.rows.map((row) => row.user_id));
}

async function getThreadRow(threadId: string, workspaceId: string): Promise<ThreadRow | null> {
  const p = pool;
  if (!p) return null;
  const result = await p.query<ThreadRow>(
    `SELECT *
     FROM collaboration_threads
     WHERE id = $1 AND workspace_id = $2
     LIMIT 1`,
    [threadId, workspaceId]
  );
  return result.rows[0] ?? null;
}

export async function getThreadWorkspaceId(threadId: string): Promise<string | null> {
  const p = pool;
  if (!p) return null;
  const result = await p.query<{ workspace_id: string }>(
    `SELECT workspace_id
     FROM collaboration_threads
     WHERE id = $1
     LIMIT 1`,
    [threadId]
  );
  return result.rows[0]?.workspace_id ?? null;
}

async function getThreadComments(threadId: string): Promise<ThreadComment[]> {
  const p = pool;
  if (!p) return [];
  const result = await p.query<ThreadCommentRow>(
    `SELECT
        c.id,
        c.thread_id,
        c.workspace_id,
        c.author_user_id,
        u.name AS author_name,
        u.email AS author_email,
        c.body,
        c.mentioned_user_ids,
        c.created_at,
        c.updated_at
     FROM thread_comments c
     JOIN users u ON u.id = c.author_user_id
     WHERE c.thread_id = $1
     ORDER BY c.created_at ASC, c.id ASC`,
    [threadId]
  );
  return result.rows.map(normalizeComment);
}

async function getThreadAssignments(threadId: string): Promise<ThreadAssignment[]> {
  const p = pool;
  if (!p) return [];
  const result = await p.query<ThreadAssignmentRow>(
    `SELECT *
     FROM thread_assignments
     WHERE thread_id = $1
     ORDER BY created_at DESC, id DESC`,
    [threadId]
  );
  return result.rows.map(normalizeAssignment);
}

export async function createOrGetThread(params: {
  workspaceId: string;
  targetType: CollaborationTargetType;
  targetId: string;
  title?: string | null;
  userId: string;
}): Promise<CollaborationThread> {
  const p = pool;
  if (!p) throw new Error('Database not available');

  const targetExists = await ensureTargetExists(params.workspaceId, params.targetType, params.targetId);
  if (!targetExists) {
    throw new Error('Target not found');
  }

  const existing = await p.query<ThreadRow>(
    `SELECT *
     FROM collaboration_threads
     WHERE workspace_id = $1 AND target_type = $2 AND target_id = $3
     LIMIT 1`,
    [params.workspaceId, params.targetType, params.targetId]
  );
  if (existing.rows[0]) {
    return getThreadDetail(existing.rows[0].id, params.workspaceId);
  }

  const result = await p.query<ThreadRow>(
    `INSERT INTO collaboration_threads
      (workspace_id, target_type, target_id, status, title, created_by_user_id)
     VALUES ($1, $2, $3, 'open', $4, $5)
     RETURNING *`,
    [
      params.workspaceId,
      params.targetType,
      params.targetId,
      params.title?.trim() || null,
      params.userId,
    ]
  );

  return getThreadDetail(result.rows[0].id, params.workspaceId);
}

export async function listThreads(options: ListThreadsOptions): Promise<{ items: ThreadSummary[]; nextCursor: string | null }> {
  const p = pool;
  if (!p) return { items: [], nextCursor: null };

  const clauses = ['t.workspace_id = $1'];
  const values: unknown[] = [options.workspaceId];
  let idx = 2;

  if (options.targetType) {
    clauses.push(`t.target_type = $${idx++}`);
    values.push(options.targetType);
  }
  if (options.status) {
    clauses.push(`t.status = $${idx++}`);
    values.push(options.status);
  }
  if (options.assignedToMe) {
    clauses.push(`EXISTS (
      SELECT 1
      FROM thread_assignments ta
      WHERE ta.thread_id = t.id
        AND ta.is_current = true
        AND ta.assigned_to_user_id = $${idx}
    )`);
    values.push(options.assignedToMe);
    idx += 1;
  }

  const cursor = decodeCursor(options.cursor);
  if (cursor) {
    clauses.push(`(t.last_activity_at, t.id) < ($${idx++}::timestamptz, $${idx++}::uuid)`);
    values.push(cursor.lastActivityAt, cursor.id);
  }

  const limit = Math.max(1, Math.min(options.limit ?? 20, 100));
  values.push(limit + 1);

  const result = await p.query<ThreadRow & { latest_comment_preview: string | null; comment_count: string | number }>(
    `SELECT
        t.*,
        (
          SELECT LEFT(c.body, 180)
          FROM thread_comments c
          WHERE c.thread_id = t.id
          ORDER BY c.created_at DESC, c.id DESC
          LIMIT 1
        ) AS latest_comment_preview,
        (
          SELECT COUNT(*)::int
          FROM thread_comments c
          WHERE c.thread_id = t.id
        ) AS comment_count
     FROM collaboration_threads t
     WHERE ${clauses.join(' AND ')}
     ORDER BY t.last_activity_at DESC, t.id DESC
     LIMIT $${idx}`,
    values
  );

  const rows = result.rows;
  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const threadIds = slice.map((row) => row.id);
  const currentAssignments = await p.query<ThreadAssignmentRow>(
    `SELECT *
     FROM thread_assignments
     WHERE thread_id = ANY($1::uuid[]) AND is_current = true`,
    [threadIds]
  );
  const assignmentMap = new Map<string, ThreadAssignment>();
  for (const row of currentAssignments.rows) {
    assignmentMap.set(row.thread_id, normalizeAssignment(row));
  }

  const items = slice.map((row) => buildThreadSummary({
    thread: row,
    latestCommentPreview: row.latest_comment_preview,
    commentCount: Number(row.comment_count ?? 0),
    currentAssignment: assignmentMap.get(row.id) ?? null,
  }));
  const last = items.at(-1);

  return {
    items,
    nextCursor: hasMore && last
      ? encodeCursor({ lastActivityAt: last.lastActivityAt, id: last.threadId })
      : null,
  };
}

export async function getThreadDetail(threadId: string, workspaceId: string): Promise<CollaborationThread> {
  const thread = await getThreadRow(threadId, workspaceId);
  if (!thread) {
    throw new Error('Thread not found');
  }

  const [comments, assignmentHistory] = await Promise.all([
    getThreadComments(threadId),
    getThreadAssignments(threadId),
  ]);
  const currentAssignment = assignmentHistory.find((assignment) => assignment.isCurrent) ?? null;

  return {
    threadId: thread.id,
    workspaceId: thread.workspace_id,
    targetType: thread.target_type,
    targetId: thread.target_id,
    status: thread.status,
    title: normalizeThreadTitle(thread),
    commentCount: comments.length,
    currentAssignment,
    sourceTarget: buildThreadSourceTarget(thread),
    createdByUserId: thread.created_by_user_id,
    lastActivityAt: thread.last_activity_at.toISOString(),
    resolvedAt: thread.resolved_at ? thread.resolved_at.toISOString() : null,
    comments,
    assignmentHistory,
  };
}

export async function addThreadComment(params: {
  threadId: string;
  workspaceId: string;
  authorUserId: string;
  body: string;
  mentionedUserIds?: string[];
}): Promise<ThreadComment> {
  const p = pool;
  if (!p) throw new Error('Database not available');

  const thread = await getThreadRow(params.threadId, params.workspaceId);
  if (!thread) throw new Error('Thread not found');

  const mentionedUserIds = Array.from(new Set((params.mentionedUserIds ?? []).filter(Boolean)));
  const validMentionedUsers = await ensureWorkspaceMembers(params.workspaceId, mentionedUserIds);
  if (mentionedUserIds.length !== validMentionedUsers.size) {
    throw new Error('Mentioned users must be workspace members');
  }

  const result = await p.query<ThreadCommentRow>(
    `INSERT INTO thread_comments
      (thread_id, workspace_id, author_user_id, body, mentioned_user_ids)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING id, thread_id, workspace_id, author_user_id, $6::text AS author_name, $7::text AS author_email, body, mentioned_user_ids, created_at, updated_at`,
    [
      params.threadId,
      params.workspaceId,
      params.authorUserId,
      params.body.trim(),
      JSON.stringify(Array.from(validMentionedUsers)),
      null,
      null,
    ]
  );

  const userResult = await p.query<{ name: string | null; email: string | null }>(
    'SELECT name, email FROM users WHERE id = $1 LIMIT 1',
    [params.authorUserId]
  );
  const row = result.rows[0];
  row.author_name = userResult.rows[0]?.name ?? null;
  row.author_email = userResult.rows[0]?.email ?? null;

  await p.query(
    `UPDATE collaboration_threads
     SET last_activity_at = NOW()
     WHERE id = $1`,
    [params.threadId]
  );

  for (const mentionedUserId of validMentionedUsers) {
    if (mentionedUserId === params.authorUserId) continue;
    await projectThreadMentionNotification({
      workspaceId: params.workspaceId,
      userId: mentionedUserId,
      threadId: params.threadId,
      targetType: thread.target_type,
      targetId: thread.target_id,
      mentionedByUserId: params.authorUserId,
      preview: params.body.trim().slice(0, 200),
      runId: thread.target_type === 'agentRun' ? thread.target_id : null,
      jobId: thread.target_type === 'job' ? thread.target_id : null,
      documentId: thread.target_type === 'document' ? thread.target_id : null,
      db: p,
    });
  }

  return normalizeComment(row);
}

export async function assignThread(params: {
  threadId: string;
  workspaceId: string;
  assignedToUserId: string;
  assignedByUserId: string;
  dueAt?: string | null;
}): Promise<ThreadAssignment> {
  const p = pool;
  if (!p) throw new Error('Database not available');

  const thread = await getThreadRow(params.threadId, params.workspaceId);
  if (!thread) throw new Error('Thread not found');

  const validUsers = await ensureWorkspaceMembers(params.workspaceId, [params.assignedToUserId]);
  if (!validUsers.has(params.assignedToUserId)) {
    throw new Error('Assigned user must be a workspace member');
  }

  await p.query(
    `UPDATE thread_assignments
     SET is_current = false, updated_at = NOW()
     WHERE thread_id = $1 AND is_current = true`,
    [params.threadId]
  );

  const result = await p.query<ThreadAssignmentRow>(
    `INSERT INTO thread_assignments
      (thread_id, workspace_id, assigned_to_user_id, assigned_by_user_id, status, due_at, is_current)
     VALUES ($1, $2, $3, $4, 'open', $5, true)
     RETURNING *`,
    [
      params.threadId,
      params.workspaceId,
      params.assignedToUserId,
      params.assignedByUserId,
      params.dueAt ? new Date(params.dueAt) : null,
    ]
  );

  await p.query(
    `UPDATE collaboration_threads
     SET last_activity_at = NOW()
     WHERE id = $1`,
    [params.threadId]
  );

  const assignment = normalizeAssignment(result.rows[0]);
  await projectThreadAssignmentNotification({
    workspaceId: params.workspaceId,
    userId: params.assignedToUserId,
    threadId: params.threadId,
    targetType: thread.target_type,
    targetId: thread.target_id,
    assignedByUserId: params.assignedByUserId,
    summary: `A collaboration thread was assigned to you: ${normalizeThreadTitle(thread)}`,
    dueAt: assignment.dueAt,
    runId: thread.target_type === 'agentRun' ? thread.target_id : null,
    jobId: thread.target_type === 'job' ? thread.target_id : null,
    documentId: thread.target_type === 'document' ? thread.target_id : null,
    db: p,
  });

  return assignment;
}

export async function resolveThread(threadId: string, workspaceId: string): Promise<CollaborationThread> {
  const p = pool;
  if (!p) throw new Error('Database not available');
  const thread = await getThreadRow(threadId, workspaceId);
  if (!thread) throw new Error('Thread not found');

  await p.query(
    `UPDATE collaboration_threads
     SET status = 'resolved',
         resolved_at = NOW(),
         last_activity_at = NOW()
     WHERE id = $1`,
    [threadId]
  );
  await p.query(
    `UPDATE thread_assignments
     SET status = 'resolved',
         resolved_at = NOW(),
         updated_at = NOW()
     WHERE thread_id = $1
       AND is_current = true`,
    [threadId]
  );

  return getThreadDetail(threadId, workspaceId);
}

export async function reopenThread(threadId: string, workspaceId: string): Promise<CollaborationThread> {
  const p = pool;
  if (!p) throw new Error('Database not available');
  const thread = await getThreadRow(threadId, workspaceId);
  if (!thread) throw new Error('Thread not found');

  await p.query(
    `UPDATE collaboration_threads
     SET status = 'open',
         resolved_at = NULL,
         last_activity_at = NOW()
     WHERE id = $1`,
    [threadId]
  );

  return getThreadDetail(threadId, workspaceId);
}
