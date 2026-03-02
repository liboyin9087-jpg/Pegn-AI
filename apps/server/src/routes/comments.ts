import type { Express, Response } from 'express';
import type { PoolClient } from 'pg';
import { pool } from '../db/client.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { isFeatureEnabled } from '../services/featureFlags.js';
import { observability } from '../services/observability.js';
import {
  getIdempotencyKeyFromRequest,
  getIdempotentReplay,
  storeIdempotentReplay
} from '../services/idempotency.js';

type ThreadStatus = 'open' | 'resolved';

interface AnchorInput {
  block_id?: string;
  start_offset?: number;
  end_offset?: number;
  yjs_relative_start?: string;
  yjs_relative_end?: string;
  selected_text?: string;
  context_before?: string;
  context_after?: string;
}

interface MentionCandidate {
  user_id: string;
  email_lower: string;
  email_local: string;
  name_lower: string;
  name_snake: string;
}

function ensureCommentsEnabled(res: Response): boolean {
  if (isFeatureEnabled('COMMENTS_V1')) return true;
  res.status(404).json({ error: 'Not found' });
  return false;
}

function normalizeMentionToken(rawToken: string): string {
  return rawToken
    .trim()
    .replace(/[)\]}>,!?;:]+$/g, '')
    .toLowerCase();
}

function extractMentionTokens(bodyMarkdown: string): string[] {
  const tokens = new Set<string>();
  const regex = /@([^\s()[\]{}<>]+)/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(bodyMarkdown)) !== null) {
    const token = normalizeMentionToken(match[1]);
    if (token.length >= 2) tokens.add(token);
  }
  return Array.from(tokens);
}

function resolveMentionedUsers(tokens: string[], directory: MentionCandidate[]): MentionCandidate[] {
  if (tokens.length === 0) return [];
  const mentioned = new Map<string, MentionCandidate>();
  for (const token of tokens) {
    for (const candidate of directory) {
      const isEmail = token.includes('@');
      const matched = isEmail
        ? candidate.email_lower === token
        : candidate.name_snake === token ||
          candidate.name_lower === token ||
          candidate.email_local === token;
      if (matched) {
        mentioned.set(candidate.user_id, candidate);
      }
    }
  }
  return Array.from(mentioned.values());
}

async function getWorkspaceMemberDirectory(client: PoolClient, workspaceId: string): Promise<MentionCandidate[]> {
  const result = await client.query(
    `SELECT
        m.user_id,
        lower(u.email) AS email_lower,
        split_part(lower(u.email), '@', 1) AS email_local,
        lower(u.name) AS name_lower,
        lower(regexp_replace(u.name, '\s+', '_', 'g')) AS name_snake
     FROM workspace_members m
     JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = $1`,
    [workspaceId]
  );
  return result.rows;
}

async function createMentionNotifications(params: {
  client: PoolClient;
  workspaceId: string;
  documentId: string;
  threadId: string;
  commentId: string;
  commentBody: string;
  actorUserId: string;
  mentionedUsers: MentionCandidate[];
}): Promise<number> {
  const { client, workspaceId, documentId, threadId, commentId, commentBody, actorUserId, mentionedUsers } = params;
  let created = 0;

  for (const mentionedUser of mentionedUsers) {
    if (mentionedUser.user_id === actorUserId) continue;
    const payload = {
      workspace_id: workspaceId,
      document_id: documentId,
      thread_id: threadId,
      comment_id: commentId,
      mentioned_by: actorUserId,
      preview: commentBody.slice(0, 200)
    };

    const notificationResult = await client.query(
      `INSERT INTO inbox_notifications (workspace_id, user_id, type, payload, status)
       VALUES ($1, $2, 'mention', $3::jsonb, 'unread')
       RETURNING id`,
      [workspaceId, mentionedUser.user_id, JSON.stringify(payload)]
    );
    const notificationId = notificationResult.rows[0].id as string;

    await client.query(
      `INSERT INTO comment_mentions (comment_id, mentioned_user_id, notification_id, status)
       VALUES ($1, $2, $3, 'unread')
       ON CONFLICT (comment_id, mentioned_user_id)
       DO UPDATE SET notification_id = EXCLUDED.notification_id, status = EXCLUDED.status`,
      [commentId, mentionedUser.user_id, notificationId]
    );
    created += 1;
  }

  return created;
}

async function listCommentsByThreadIds(client: PoolClient, threadIds: string[]) {
  if (threadIds.length === 0) return new Map<string, any[]>();
  const result = await client.query(
    `SELECT
        c.id,
        c.thread_id,
        c.parent_comment_id,
        c.body_markdown,
        c.created_by,
        c.created_at,
        c.edited_at,
        c.deleted_at,
        u.name AS created_by_name,
        u.email AS created_by_email,
        COALESCE((
          SELECT COUNT(*)::int
          FROM comment_mentions cm
          WHERE cm.comment_id = c.id
        ), 0) AS mention_count
     FROM comments c
     JOIN users u ON u.id = c.created_by
     WHERE c.thread_id = ANY($1::uuid[])
       AND c.deleted_at IS NULL
     ORDER BY c.created_at ASC`,
    [threadIds]
  );

  const grouped = new Map<string, any[]>();
  for (const row of result.rows) {
    const list = grouped.get(row.thread_id) ?? [];
    list.push(row);
    grouped.set(row.thread_id, list);
  }
  return grouped;
}

async function hydrateThreadList(client: PoolClient, threadRows: any[]) {
  const threadIds = threadRows.map(row => row.id as string);
  const commentsByThread = await listCommentsByThreadIds(client, threadIds);

  return threadRows.map((row) => ({
    id: row.id,
    workspace_id: row.workspace_id,
    document_id: row.document_id,
    status: row.status,
    created_by: row.created_by,
    created_by_name: row.created_by_name,
    resolved_by: row.resolved_by,
    resolved_by_name: row.resolved_by_name,
    resolved_at: row.resolved_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    anchor: row.anchor_id
      ? {
          id: row.anchor_id,
          thread_id: row.id,
          block_id: row.block_id,
          start_offset: row.start_offset,
          end_offset: row.end_offset,
          yjs_relative_start: row.yjs_relative_start,
          yjs_relative_end: row.yjs_relative_end,
          selected_text: row.selected_text,
          context_before: row.context_before,
          context_after: row.context_after
        }
      : null,
    comments: commentsByThread.get(row.id) ?? []
  }));
}

async function getThreadById(client: PoolClient, threadId: string) {
  const threadResult = await client.query(
    `SELECT
        t.*,
        cu.name AS created_by_name,
        ru.name AS resolved_by_name,
        a.id AS anchor_id,
        a.block_id,
        a.start_offset,
        a.end_offset,
        a.yjs_relative_start,
        a.yjs_relative_end,
        a.selected_text,
        a.context_before,
        a.context_after
     FROM comment_threads t
     JOIN users cu ON cu.id = t.created_by
     LEFT JOIN users ru ON ru.id = t.resolved_by
     LEFT JOIN comment_anchors a ON a.thread_id = t.id
     WHERE t.id = $1
     LIMIT 1`,
    [threadId]
  );

  if ((threadResult.rowCount ?? 0) === 0) return null;
  const [thread] = await hydrateThreadList(client, threadResult.rows);
  return thread;
}

async function getWorkspaceAndDocumentByThread(client: PoolClient, threadId: string) {
  const result = await client.query(
    `SELECT workspace_id, document_id
     FROM comment_threads
     WHERE id = $1
     LIMIT 1`,
    [threadId]
  );
  return result.rows[0] as { workspace_id: string; document_id: string } | undefined;
}

export function registerCommentRoutes(app: Express): void {
  app.post(
    '/api/v1/documents/:document_id/comment_threads',
    authMiddleware,
    checkPermission('comment:create', 'document'),
    async (req: AuthRequest, res: Response) => {
      if (!ensureCommentsEnabled(res)) return;

      const p = pool;
      if (!p || !req.userId) {
        res.status(503).json({ error: 'Database not available' });
        return;
      }

      const documentId = req.params.document_id;
      const bodyMarkdown = String(req.body?.body_markdown ?? req.body?.bodyMarkdown ?? '').trim();
      const anchor = (req.body?.anchor ?? {}) as AnchorInput;

      if (!documentId || !bodyMarkdown) {
        res.status(400).json({ error: 'document_id and body_markdown are required' });
        return;
      }

      const client = await p.connect();
      try {
        const docResult = await client.query(
          'SELECT workspace_id FROM documents WHERE id = $1 LIMIT 1',
          [documentId]
        );
        if ((docResult.rowCount ?? 0) === 0) {
          res.status(404).json({ error: 'Document not found' });
          return;
        }
        const workspaceId = docResult.rows[0].workspace_id as string;

        const idempotencyKey = getIdempotencyKeyFromRequest(req);
        if (idempotencyKey) {
          const replay = await getIdempotentReplay({
            userId: req.userId,
            workspaceId,
            operation: 'thread_create',
            idempotencyKey
          });
          if (replay) {
            res.status(replay.status_code).json(replay.response);
            return;
          }
        }

        await client.query('BEGIN');

        const threadInsert = await client.query(
          `INSERT INTO comment_threads (workspace_id, document_id, status, created_by)
           VALUES ($1, $2, 'open', $3)
           RETURNING id`,
          [workspaceId, documentId, req.userId]
        );
        const threadId = threadInsert.rows[0].id as string;

        await client.query(
          `INSERT INTO comment_anchors
           (thread_id, block_id, start_offset, end_offset, yjs_relative_start, yjs_relative_end, selected_text, context_before, context_after)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            threadId,
            anchor.block_id ?? null,
            Number.isFinite(anchor.start_offset) ? Number(anchor.start_offset) : 0,
            Number.isFinite(anchor.end_offset) ? Number(anchor.end_offset) : 0,
            anchor.yjs_relative_start ?? null,
            anchor.yjs_relative_end ?? null,
            anchor.selected_text ?? null,
            anchor.context_before ?? null,
            anchor.context_after ?? null
          ]
        );

        const commentInsert = await client.query(
          `INSERT INTO comments (thread_id, body_markdown, created_by)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [threadId, bodyMarkdown, req.userId]
        );
        const commentId = commentInsert.rows[0].id as string;

        const mentionDirectory = await getWorkspaceMemberDirectory(client, workspaceId);
        const mentionTokens = extractMentionTokens(bodyMarkdown);
        const mentionedUsers = resolveMentionedUsers(mentionTokens, mentionDirectory);
        const mentionCount = await createMentionNotifications({
          client,
          workspaceId,
          documentId,
          threadId,
          commentId,
          commentBody: bodyMarkdown,
          actorUserId: req.userId,
          mentionedUsers
        });

        const thread = await getThreadById(client, threadId);
        await client.query('COMMIT');

        const responseBody = { thread, mention_count: mentionCount };
        const statusCode = 201;
        if (idempotencyKey) {
          await storeIdempotentReplay(
            { userId: req.userId, workspaceId, operation: 'thread_create', idempotencyKey },
            statusCode,
            responseBody
          );
        }

        observability.recordMetric('comments_created_total', 1, { workspace_id: workspaceId });
        if (mentionCount > 0) {
          observability.recordMetric('mention_notifications_unread', mentionCount, { workspace_id: workspaceId });
        }
        observability.info('Comment thread created', {
          workspace_id: workspaceId,
          user_id: req.userId,
          thread_id: threadId,
          comment_id: commentId,
          idempotency_key: idempotencyKey
        });

        res.status(statusCode).json(responseBody);
      } catch (error) {
        await client.query('ROLLBACK');
        observability.error('Create comment thread failed', {
          error,
          document_id: documentId,
          user_id: req.userId
        });
        res.status(500).json({ error: 'Failed to create comment thread' });
      } finally {
        client.release();
      }
    }
  );

  app.get(
    '/api/v1/documents/:document_id/comment_threads',
    authMiddleware,
    checkPermission('comment:view', 'document'),
    async (req: AuthRequest, res: Response) => {
      if (!ensureCommentsEnabled(res)) return;
      const p = pool;
      if (!p) {
        res.status(503).json({ error: 'Database not available' });
        return;
      }

      const documentId = req.params.document_id;
      const rawStatus = String(req.query.status ?? 'open');
      const status = rawStatus === 'resolved' || rawStatus === 'open' ? rawStatus : 'all';

      const client = await p.connect();
      try {
        const whereStatus = status === 'all' ? '' : 'AND t.status = $2';
        const params: any[] = [documentId];
        if (status !== 'all') params.push(status);

        const threadResult = await client.query(
          `SELECT
              t.*,
              cu.name AS created_by_name,
              ru.name AS resolved_by_name,
              a.id AS anchor_id,
              a.block_id,
              a.start_offset,
              a.end_offset,
              a.yjs_relative_start,
              a.yjs_relative_end,
              a.selected_text,
              a.context_before,
              a.context_after
           FROM comment_threads t
           JOIN users cu ON cu.id = t.created_by
           LEFT JOIN users ru ON ru.id = t.resolved_by
           LEFT JOIN comment_anchors a ON a.thread_id = t.id
           WHERE t.document_id = $1
           ${whereStatus}
           ORDER BY t.updated_at DESC`,
          params
        );

        const threads = await hydrateThreadList(client, threadResult.rows);
        res.json({ threads });
      } catch (error) {
        observability.error('List comment threads failed', { error, document_id: documentId });
        res.status(500).json({ error: 'Failed to list comment threads' });
      } finally {
        client.release();
      }
    }
  );

  app.get(
    '/api/v1/comment_threads/:thread_id',
    authMiddleware,
    checkPermission('comment:view', 'comment_thread'),
    async (req: AuthRequest, res: Response) => {
      if (!ensureCommentsEnabled(res)) return;
      const p = pool;
      if (!p) {
        res.status(503).json({ error: 'Database not available' });
        return;
      }

      const threadId = req.params.thread_id;
      const client = await p.connect();
      try {
        const thread = await getThreadById(client, threadId);
        if (!thread) {
          res.status(404).json({ error: 'Comment thread not found' });
          return;
        }
        res.json({ thread });
      } catch (error) {
        observability.error('Get comment thread failed', { error, thread_id: threadId });
        res.status(500).json({ error: 'Failed to get comment thread' });
      } finally {
        client.release();
      }
    }
  );

  app.post(
    '/api/v1/comment_threads/:thread_id/comments',
    authMiddleware,
    checkPermission('comment:create', 'comment_thread'),
    async (req: AuthRequest, res: Response) => {
      if (!ensureCommentsEnabled(res)) return;

      const p = pool;
      if (!p || !req.userId) {
        res.status(503).json({ error: 'Database not available' });
        return;
      }

      const threadId = req.params.thread_id;
      const bodyMarkdown = String(req.body?.body_markdown ?? req.body?.bodyMarkdown ?? '').trim();
      const parentCommentId = req.body?.parent_comment_id ?? req.body?.parentCommentId ?? null;
      if (!threadId || !bodyMarkdown) {
        res.status(400).json({ error: 'thread_id and body_markdown are required' });
        return;
      }

      const client = await p.connect();
      try {
        const workspaceAndDocument = await getWorkspaceAndDocumentByThread(client, threadId);
        if (!workspaceAndDocument) {
          res.status(404).json({ error: 'Comment thread not found' });
          return;
        }

        const { workspace_id: workspaceId, document_id: documentId } = workspaceAndDocument;
        const idempotencyKey = getIdempotencyKeyFromRequest(req);
        if (idempotencyKey) {
          const replay = await getIdempotentReplay({
            userId: req.userId,
            workspaceId,
            operation: 'comment_create',
            idempotencyKey
          });
          if (replay) {
            res.status(replay.status_code).json(replay.response);
            return;
          }
        }

        await client.query('BEGIN');

        const insertResult = await client.query(
          `INSERT INTO comments (thread_id, parent_comment_id, body_markdown, created_by)
           VALUES ($1, $2, $3, $4)
           RETURNING id, thread_id, parent_comment_id, body_markdown, created_by, created_at, edited_at, deleted_at`,
          [threadId, parentCommentId, bodyMarkdown, req.userId]
        );

        await client.query(
          `UPDATE comment_threads
           SET updated_at = NOW()
           WHERE id = $1`,
          [threadId]
        );

        const comment = insertResult.rows[0];
        const mentionDirectory = await getWorkspaceMemberDirectory(client, workspaceId);
        const mentionTokens = extractMentionTokens(bodyMarkdown);
        const mentionedUsers = resolveMentionedUsers(mentionTokens, mentionDirectory);
        const mentionCount = await createMentionNotifications({
          client,
          workspaceId,
          documentId,
          threadId,
          commentId: comment.id,
          commentBody: bodyMarkdown,
          actorUserId: req.userId,
          mentionedUsers
        });

        await client.query('COMMIT');

        const responseBody = { comment: { ...comment, mention_count: mentionCount } };
        const statusCode = 201;
        if (idempotencyKey) {
          await storeIdempotentReplay(
            { userId: req.userId, workspaceId, operation: 'comment_create', idempotencyKey },
            statusCode,
            responseBody
          );
        }

        observability.recordMetric('comments_created_total', 1, { workspace_id: workspaceId });
        if (mentionCount > 0) {
          observability.recordMetric('mention_notifications_unread', mentionCount, { workspace_id: workspaceId });
        }
        observability.info('Comment created', {
          workspace_id: workspaceId,
          user_id: req.userId,
          thread_id: threadId,
          comment_id: comment.id,
          idempotency_key: idempotencyKey
        });

        res.status(statusCode).json(responseBody);
      } catch (error) {
        await client.query('ROLLBACK');
        observability.error('Create comment failed', { error, thread_id: threadId, user_id: req.userId });
        res.status(500).json({ error: 'Failed to create comment' });
      } finally {
        client.release();
      }
    }
  );

  app.patch(
    '/api/v1/comment_threads/:thread_id/resolve',
    authMiddleware,
    checkPermission('comment:resolve', 'comment_thread'),
    async (req: AuthRequest, res: Response) => {
      if (!ensureCommentsEnabled(res)) return;
      await updateThreadStatus(req, res, 'resolved');
    }
  );

  app.patch(
    '/api/v1/comment_threads/:thread_id/reopen',
    authMiddleware,
    checkPermission('comment:resolve', 'comment_thread'),
    async (req: AuthRequest, res: Response) => {
      if (!ensureCommentsEnabled(res)) return;
      await updateThreadStatus(req, res, 'open');
    }
  );
}

async function updateThreadStatus(req: AuthRequest, res: Response, nextStatus: ThreadStatus): Promise<void> {
  const p = pool;
  if (!p || !req.userId) {
    res.status(503).json({ error: 'Database not available' });
    return;
  }

  const threadId = req.params.thread_id;
  const client = await p.connect();
  try {
    const threadMeta = await getWorkspaceAndDocumentByThread(client, threadId);
    if (!threadMeta) {
      res.status(404).json({ error: 'Comment thread not found' });
      return;
    }

    const workspaceId = threadMeta.workspace_id;
    const idempotencyKey = getIdempotencyKeyFromRequest(req);
    const operation = nextStatus === 'resolved' ? 'thread_resolve' : 'thread_reopen';
    if (idempotencyKey) {
      const replay = await getIdempotentReplay({
        userId: req.userId,
        workspaceId,
        operation,
        idempotencyKey
      });
      if (replay) {
        res.status(replay.status_code).json(replay.response);
        return;
      }
    }

    const result = await client.query(
      `UPDATE comment_threads
       SET status = $2,
           resolved_by = CASE WHEN $2 = 'resolved' THEN $3 ELSE NULL END,
           resolved_at = CASE WHEN $2 = 'resolved' THEN NOW() ELSE NULL END,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, workspace_id, status, resolved_by, resolved_at, updated_at`,
      [threadId, nextStatus, req.userId]
    );

    if ((result.rowCount ?? 0) === 0) {
      res.status(404).json({ error: 'Comment thread not found' });
      return;
    }

    const hydratedThread = await getThreadById(client, threadId);
    const responseBody = { thread: hydratedThread ?? result.rows[0] };
    if (idempotencyKey) {
      await storeIdempotentReplay(
        { userId: req.userId, workspaceId, operation, idempotencyKey },
        200,
        responseBody
      );
    }

    if (nextStatus === 'resolved') {
      observability.recordMetric('threads_resolved_total', 1, { workspace_id: workspaceId });
    }
    observability.info('Comment thread status changed', {
      workspace_id: workspaceId,
      user_id: req.userId,
      thread_id: threadId,
      status: nextStatus,
      idempotency_key: idempotencyKey
    });

    res.json(responseBody);
  } catch (error) {
    observability.error('Update comment thread status failed', {
      error,
      thread_id: req.params.thread_id,
      status: nextStatus
    });
    res.status(500).json({ error: 'Failed to update comment thread status' });
  } finally {
    client.release();
  }
}

export function registerInboxRoutes(app: Express): void {
  app.get('/api/v1/inbox/notifications', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!ensureCommentsEnabled(res)) return;
    const p = pool;
    if (!p || !req.userId) {
      res.status(503).json({ error: 'Database not available' });
      return;
    }

    const status = String(req.query.status ?? 'unread');
    const statusClause = status === 'all' ? '' : `AND n.status = 'unread'`;

    try {
      const notificationsResult = await p.query(
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
         WHERE n.user_id = $1
           AND EXISTS (
             SELECT 1
             FROM workspace_members m
             WHERE m.workspace_id = n.workspace_id
               AND m.user_id = $1
           )
           ${statusClause}
         ORDER BY n.created_at DESC
         LIMIT 200`,
        [req.userId]
      );

      const unreadResult = await p.query(
        `SELECT COUNT(*)::int AS unread_count
         FROM inbox_notifications n
         WHERE n.user_id = $1
           AND n.status = 'unread'
           AND EXISTS (
             SELECT 1
             FROM workspace_members m
             WHERE m.workspace_id = n.workspace_id
               AND m.user_id = $1
           )`,
        [req.userId]
      );

      res.json({
        notifications: notificationsResult.rows,
        unread_count: unreadResult.rows[0]?.unread_count ?? 0
      });
    } catch (error) {
      observability.error('List inbox notifications failed', { error, user_id: req.userId });
      res.status(500).json({ error: 'Failed to list inbox notifications' });
    }
  });

  app.patch(
    '/api/v1/inbox/notifications/:notification_id/read',
    authMiddleware,
    checkPermission('comment:view', 'inbox_notification'),
    async (req: AuthRequest, res: Response) => {
      if (!ensureCommentsEnabled(res)) return;
      const p = pool;
      if (!p || !req.userId) {
        res.status(503).json({ error: 'Database not available' });
        return;
      }

      const notificationId = req.params.notification_id;
      try {
        const updateResult = await p.query(
          `UPDATE inbox_notifications
           SET status = 'read',
               read_at = COALESCE(read_at, NOW()),
               updated_at = NOW()
           WHERE id = $1 AND user_id = $2
           RETURNING id, workspace_id, user_id, type, payload, status, read_at, created_at`,
          [notificationId, req.userId]
        );

        if ((updateResult.rowCount ?? 0) === 0) {
          res.status(404).json({ error: 'Notification not found' });
          return;
        }

        await p.query(
          `UPDATE comment_mentions
           SET status = 'read', updated_at = NOW()
           WHERE notification_id = $1`,
          [notificationId]
        );

        observability.recordMetric('inbox_notifications_read_total', 1, {
          workspace_id: updateResult.rows[0].workspace_id,
          user_id: req.userId
        });
        observability.info('Inbox notification marked as read', {
          workspace_id: updateResult.rows[0].workspace_id,
          user_id: req.userId,
          notification_id: notificationId
        });

        res.json({ notification: updateResult.rows[0] });
      } catch (error) {
        observability.error('Mark inbox notification read failed', {
          error,
          user_id: req.userId,
          notification_id: notificationId
        });
        res.status(500).json({ error: 'Failed to mark notification as read' });
      }
    }
  );

  app.patch('/api/v1/inbox/notifications/read_all', authMiddleware, async (req: AuthRequest, res: Response) => {
    if (!ensureCommentsEnabled(res)) return;
    const p = pool;
    if (!p || !req.userId) {
      res.status(503).json({ error: 'Database not available' });
      return;
    }

    try {
      const updateResult = await p.query(
        `UPDATE inbox_notifications n
         SET status = 'read',
             read_at = COALESCE(read_at, NOW()),
             updated_at = NOW()
         WHERE n.user_id = $1
           AND n.status = 'unread'
           AND EXISTS (
             SELECT 1
             FROM workspace_members m
             WHERE m.workspace_id = n.workspace_id
               AND m.user_id = $1
           )
         RETURNING n.id, n.workspace_id`,
        [req.userId]
      );

      const notificationIds = updateResult.rows.map(row => row.id);
      if (notificationIds.length > 0) {
        await p.query(
          `UPDATE comment_mentions cm
           SET status = 'read', updated_at = NOW()
           WHERE cm.notification_id = ANY($1::uuid[])`,
          [notificationIds]
        );
      }

      const perWorkspace = new Map<string, number>();
      for (const row of updateResult.rows) {
        const workspaceId = String(row.workspace_id ?? '');
        if (!workspaceId) continue;
        perWorkspace.set(workspaceId, (perWorkspace.get(workspaceId) ?? 0) + 1);
      }
      for (const [workspaceId, count] of perWorkspace.entries()) {
        observability.recordMetric('inbox_notifications_read_total', count, {
          workspace_id: workspaceId,
          user_id: req.userId
        });
      }
      observability.info('All inbox notifications marked as read', {
        user_id: req.userId,
        updated: updateResult.rowCount ?? 0,
        workspace_ids: Array.from(perWorkspace.keys())
      });

      res.json({ updated: updateResult.rowCount ?? 0 });
    } catch (error) {
      observability.error('Mark all notifications read failed', { error, user_id: req.userId });
      res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }
  });
}
