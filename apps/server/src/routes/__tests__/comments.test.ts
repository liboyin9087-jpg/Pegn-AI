import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { signToken } from '../../middleware/auth.js';

const mockPool = {
  query: vi.fn(),
  connect: vi.fn(),
};

vi.mock('../../db/client.js', () => ({
  pool: mockPool,
}));

type Role = 'admin' | 'editor' | 'viewer';

interface MockState {
  documents: Record<string, { id: string; workspace_id: string }>;
  users: Record<string, { id: string; email: string; name: string }>;
  memberships: Record<string, { workspace_id: string; role: Role }>;
  threads: Array<{
    id: string;
    workspace_id: string;
    document_id: string;
    status: 'open' | 'resolved';
    created_by: string;
    resolved_by: string | null;
    resolved_at: string | null;
    created_at: string;
    updated_at: string;
  }>;
  anchors: Array<{
    id: string;
    thread_id: string;
    block_id: string | null;
    start_offset: number;
    end_offset: number;
    yjs_relative_start: string | null;
    yjs_relative_end: string | null;
    selected_text: string | null;
    context_before: string | null;
    context_after: string | null;
  }>;
  comments: Array<{
    id: string;
    thread_id: string;
    parent_comment_id: string | null;
    body_markdown: string;
    created_by: string;
    created_at: string;
  }>;
  notifications: Array<{
    id: string;
    workspace_id: string;
    user_id: string;
    type: 'mention';
    payload: any;
    status: 'unread' | 'read';
    read_at: string | null;
    created_at: string;
  }>;
  mentions: Array<{
    comment_id: string;
    mentioned_user_id: string;
    notification_id: string;
    status: 'unread' | 'read';
  }>;
  idempotency: Map<string, { status_code: number; response: any }>;
  counters: { thread: number; anchor: number; comment: number; notification: number };
}

function result(rows: any[]) {
  return { rows, rowCount: rows.length };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function permissionsFor(role: Role): string[] {
  if (role === 'admin') return ['workspace:admin'];
  if (role === 'editor') return ['comment:view', 'comment:create', 'comment:resolve'];
  return ['comment:view', 'comment:create'];
}

function createMockState(): MockState {
  return {
    documents: {
      'doc-1': { id: 'doc-1', workspace_id: 'ws-1' },
    },
    users: {
      'user-editor': { id: 'user-editor', email: 'editor@example.com', name: 'Editor User' },
      'user-viewer': { id: 'user-viewer', email: 'viewer@example.com', name: 'Viewer User' },
    },
    memberships: {
      'user-editor': { workspace_id: 'ws-1', role: 'editor' },
      'user-viewer': { workspace_id: 'ws-1', role: 'viewer' },
    },
    threads: [],
    anchors: [],
    comments: [],
    notifications: [],
    mentions: [],
    idempotency: new Map(),
    counters: { thread: 0, anchor: 0, comment: 0, notification: 0 },
  };
}

function setupPoolWithState(state: MockState): void {
  const queryHandler = vi.fn(async (sqlText: string, params: any[] = []) => {
    const sql = normalizeSql(sqlText);

    if (sql.startsWith('begin') || sql.startsWith('commit') || sql.startsWith('rollback')) {
      return result([]);
    }

    if (sql.includes('select workspace_id from documents where id = $1')) {
      const document = state.documents[params[0]];
      return result(document ? [{ workspace_id: document.workspace_id }] : []);
    }

    if (sql.includes('from workspace_members m') && sql.includes('left join roles r')) {
      const userId = params[0] as string;
      const workspaceId = params[1] as string;
      const membership = state.memberships[userId];
      if (!membership || membership.workspace_id !== workspaceId) return result([]);
      const role = membership.role;
      return result([{
        legacy_role: role,
        role_name: role,
        permissions: permissionsFor(role),
      }]);
    }

    if (sql.includes('select workspace_id from comment_threads where id = $1')) {
      const thread = state.threads.find((item) => item.id === params[0]);
      return result(thread ? [{ workspace_id: thread.workspace_id }] : []);
    }

    if (sql.includes('select workspace_id, document_id from comment_threads where id = $1')) {
      const thread = state.threads.find((item) => item.id === params[0]);
      if (!thread) return result([]);
      return result([{ workspace_id: thread.workspace_id, document_id: thread.document_id }]);
    }

    if (sql.includes('select status_code, response from api_idempotency_keys')) {
      const key = `${params[0]}|${params[1]}|${params[2]}|${params[3]}`;
      const replay = state.idempotency.get(key);
      return result(replay ? [replay] : []);
    }

    if (sql.includes('insert into api_idempotency_keys')) {
      const key = `${params[0]}|${params[1]}|${params[2]}|${params[3]}`;
      state.idempotency.set(key, {
        status_code: params[4],
        response: JSON.parse(params[5]),
      });
      return result([]);
    }

    if (sql.includes('insert into comment_threads')) {
      const id = `thread-${++state.counters.thread}`;
      const now = new Date().toISOString();
      state.threads.push({
        id,
        workspace_id: params[0],
        document_id: params[1],
        status: 'open',
        created_by: params[2],
        resolved_by: null,
        resolved_at: null,
        created_at: now,
        updated_at: now,
      });
      return result([{ id }]);
    }

    if (sql.includes('insert into comment_anchors')) {
      const id = `anchor-${++state.counters.anchor}`;
      state.anchors.push({
        id,
        thread_id: params[0],
        block_id: params[1],
        start_offset: params[2],
        end_offset: params[3],
        yjs_relative_start: params[4],
        yjs_relative_end: params[5],
        selected_text: params[6],
        context_before: params[7],
        context_after: params[8],
      });
      return result([{ id }]);
    }

    if (sql.includes('insert into comments')) {
      const id = `comment-${++state.counters.comment}`;
      const now = new Date().toISOString();
      const hasParent = sql.includes('parent_comment_id');
      const comment = {
        id,
        thread_id: params[0],
        parent_comment_id: hasParent ? (params[1] as string | null) : null,
        body_markdown: hasParent ? params[2] : params[1],
        created_by: hasParent ? params[3] : params[2],
        created_at: now,
      };
      state.comments.push(comment);
      return result([{
        ...comment,
        edited_at: null,
        deleted_at: null,
      }]);
    }

    if (sql.includes("split_part(lower(u.email), '@', 1) as email_local")) {
      const workspaceId = params[0] as string;
      const rows = Object.entries(state.memberships)
        .filter(([, membership]) => membership.workspace_id === workspaceId)
        .map(([userId]) => {
          const user = state.users[userId];
          return {
            user_id: user.id,
            email_lower: user.email.toLowerCase(),
            email_local: user.email.toLowerCase().split('@')[0],
            name_lower: user.name.toLowerCase(),
            name_snake: user.name.toLowerCase().replace(/\s+/g, '_'),
          };
        });
      return result(rows);
    }

    if (sql.includes('insert into inbox_notifications')) {
      const id = `notification-${++state.counters.notification}`;
      const now = new Date().toISOString();
      state.notifications.push({
        id,
        workspace_id: params[0],
        user_id: params[1],
        type: 'mention',
        payload: JSON.parse(params[2]),
        status: 'unread',
        read_at: null,
        created_at: now,
      });
      return result([{ id }]);
    }

    if (sql.includes('select workspace_id from inbox_notifications where id = $1')) {
      const notification = state.notifications.find((item) => item.id === params[0]);
      return result(notification ? [{ workspace_id: notification.workspace_id }] : []);
    }

    if (sql.includes('insert into comment_mentions')) {
      state.mentions.push({
        comment_id: params[0],
        mentioned_user_id: params[1],
        notification_id: params[2],
        status: 'unread',
      });
      return result([]);
    }

    if (sql.includes('from comment_threads t') && sql.includes('where t.id = $1')) {
      const thread = state.threads.find((item) => item.id === params[0]);
      if (!thread) return result([]);
      const anchor = state.anchors.find((item) => item.thread_id === thread.id);
      const creator = state.users[thread.created_by];
      const resolver = thread.resolved_by ? state.users[thread.resolved_by] : null;
      return result([{
        ...thread,
        created_by_name: creator?.name ?? 'Unknown',
        resolved_by_name: resolver?.name ?? null,
        anchor_id: anchor?.id ?? null,
        block_id: anchor?.block_id ?? null,
        start_offset: anchor?.start_offset ?? 0,
        end_offset: anchor?.end_offset ?? 0,
        yjs_relative_start: anchor?.yjs_relative_start ?? null,
        yjs_relative_end: anchor?.yjs_relative_end ?? null,
        selected_text: anchor?.selected_text ?? null,
        context_before: anchor?.context_before ?? null,
        context_after: anchor?.context_after ?? null,
      }]);
    }

    if (sql.includes('from comments c') && sql.includes('where c.thread_id = any')) {
      const threadIds = params[0] as string[];
      const rows = state.comments
        .filter((comment) => threadIds.includes(comment.thread_id))
        .map((comment) => ({
          ...comment,
          edited_at: null,
          deleted_at: null,
          created_by_name: state.users[comment.created_by]?.name ?? 'Unknown',
          created_by_email: state.users[comment.created_by]?.email ?? 'unknown@example.com',
          mention_count: state.mentions.filter((m) => m.comment_id === comment.id).length,
        }));
      return result(rows);
    }

    if (sql.includes('update comment_threads set status = $2')) {
      const thread = state.threads.find((item) => item.id === params[0]);
      if (!thread) return result([]);
      thread.status = params[1];
      thread.resolved_by = params[1] === 'resolved' ? params[2] : null;
      thread.resolved_at = params[1] === 'resolved' ? new Date().toISOString() : null;
      thread.updated_at = new Date().toISOString();
      return result([{
        id: thread.id,
        workspace_id: thread.workspace_id,
        status: thread.status,
        resolved_by: thread.resolved_by,
        resolved_at: thread.resolved_at,
        updated_at: thread.updated_at,
      }]);
    }

    if (sql.includes('update comment_threads') && sql.includes('set updated_at = now()')) {
      const thread = state.threads.find((item) => item.id === params[0]);
      if (thread) thread.updated_at = new Date().toISOString();
      return result([]);
    }

    if (sql.includes('select n.id') && sql.includes('from inbox_notifications n') && sql.includes('where n.user_id = $1')) {
      const userId = params[0] as string;
      const unreadOnly = sql.includes("and n.status = 'unread'");
      const rows = state.notifications
        .filter((notification) => notification.user_id === userId)
        .filter((notification) => (unreadOnly ? notification.status === 'unread' : true))
        .map((notification) => ({
          id: notification.id,
          workspace_id: notification.workspace_id,
          user_id: notification.user_id,
          type: notification.type,
          payload: notification.payload,
          status: notification.status,
          read_at: notification.read_at,
          created_at: notification.created_at,
        }));
      return result(rows);
    }

    if (sql.includes('select count(*)::int as unread_count') && sql.includes('from inbox_notifications n')) {
      const userId = params[0] as string;
      const unreadCount = state.notifications.filter((notification) => notification.user_id === userId && notification.status === 'unread').length;
      return result([{ unread_count: unreadCount }]);
    }

    if (sql.includes('update inbox_notifications') && sql.includes('where id = $1 and user_id = $2') && sql.includes('returning id')) {
      const notification = state.notifications.find((item) => item.id === params[0] && item.user_id === params[1]);
      if (!notification) return result([]);
      if (notification.status !== 'read') {
        notification.status = 'read';
        notification.read_at = new Date().toISOString();
      }
      return result([{
        id: notification.id,
        workspace_id: notification.workspace_id,
        user_id: notification.user_id,
        type: notification.type,
        payload: notification.payload,
        status: notification.status,
        read_at: notification.read_at,
        created_at: notification.created_at,
      }]);
    }

    if (sql.includes('update comment_mentions') && sql.includes('where notification_id = $1')) {
      const notificationId = params[0] as string;
      state.mentions = state.mentions.map((mention) =>
        mention.notification_id === notificationId
          ? { ...mention, status: 'read' }
          : mention
      );
      return result([]);
    }

    if (sql.includes('update inbox_notifications n') && sql.includes('where n.user_id = $1') && sql.includes('returning n.id')) {
      const userId = params[0] as string;
      const updatedIds: Array<{ id: string }> = [];
      state.notifications = state.notifications.map((notification) => {
        if (notification.user_id === userId && notification.status === 'unread') {
          updatedIds.push({ id: notification.id });
          return { ...notification, status: 'read', read_at: new Date().toISOString() };
        }
        return notification;
      });
      return result(updatedIds);
    }

    if (sql.includes('update comment_mentions cm') && sql.includes('where cm.notification_id = any($1::uuid[])')) {
      const notificationIds = params[0] as string[];
      state.mentions = state.mentions.map((mention) =>
        notificationIds.includes(mention.notification_id)
          ? { ...mention, status: 'read' }
          : mention
      );
      return result([]);
    }

    throw new Error(`Unhandled SQL in test mock: ${sql}`);
  });

  mockPool.query.mockImplementation(queryHandler);
  mockPool.connect.mockImplementation(async () => ({
    query: queryHandler,
    release: () => {},
  }));
}

async function createApp() {
  const { registerCommentRoutes, registerInboxRoutes } = await import('../comments.js');
  const app = express();
  app.use(express.json());
  registerCommentRoutes(app);
  registerInboxRoutes(app);
  return app;
}

describe('comments routes', () => {
  it('creates comment thread and mention notification', async () => {
    const state = createMockState();
    setupPoolWithState(state);
    const app = await createApp();
    const token = signToken('user-editor', 'editor@example.com');

    const response = await request(app)
      .post('/api/v1/documents/doc-1/comment_threads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        body_markdown: '請 @viewer@example.com 幫我確認',
        anchor: { start_offset: 5, end_offset: 25, selected_text: '@viewer@example.com' },
      });

    expect(response.status).toBe(201);
    expect(response.body.thread.id).toBe('thread-1');
    expect(response.body.mention_count).toBe(1);
    expect(state.notifications).toHaveLength(1);
    expect(state.mentions).toHaveLength(1);
    expect(state.threads).toHaveLength(1);
  });

  it('rejects resolve when viewer lacks comment:resolve permission', async () => {
    const state = createMockState();
    state.threads.push({
      id: 'thread-existing',
      workspace_id: 'ws-1',
      document_id: 'doc-1',
      status: 'open',
      created_by: 'user-editor',
      resolved_by: null,
      resolved_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    setupPoolWithState(state);
    const app = await createApp();
    const token = signToken('user-viewer', 'viewer@example.com');

    const response = await request(app)
      .patch('/api/v1/comment_threads/thread-existing/resolve')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(403);
    expect(state.threads[0].status).toBe('open');
  });

  it('replays same response with x-idempotency-key and avoids duplicate writes', async () => {
    const state = createMockState();
    setupPoolWithState(state);
    const app = await createApp();
    const token = signToken('user-editor', 'editor@example.com');
    const idempotencyKey = 'idempo-thread-create-001';

    const first = await request(app)
      .post('/api/v1/documents/doc-1/comment_threads')
      .set('Authorization', `Bearer ${token}`)
      .set('x-idempotency-key', idempotencyKey)
      .send({ body_markdown: '第一次建立' });

    const second = await request(app)
      .post('/api/v1/documents/doc-1/comment_threads')
      .set('Authorization', `Bearer ${token}`)
      .set('x-idempotency-key', idempotencyKey)
      .send({ body_markdown: '第一次建立' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.thread.id).toBe(second.body.thread.id);
    expect(state.threads).toHaveLength(1);
  });

  it('returns hydrated thread payload when resolving thread', async () => {
    const state = createMockState();
    state.threads.push({
      id: 'thread-1',
      workspace_id: 'ws-1',
      document_id: 'doc-1',
      status: 'open',
      created_by: 'user-editor',
      resolved_by: null,
      resolved_at: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    state.anchors.push({
      id: 'anchor-1',
      thread_id: 'thread-1',
      block_id: null,
      start_offset: 1,
      end_offset: 5,
      yjs_relative_start: null,
      yjs_relative_end: null,
      selected_text: '重點文字',
      context_before: '前文',
      context_after: '後文',
    });
    state.comments.push({
      id: 'comment-1',
      thread_id: 'thread-1',
      parent_comment_id: null,
      body_markdown: '請協助確認',
      created_by: 'user-editor',
      created_at: new Date().toISOString(),
    });
    setupPoolWithState(state);
    const app = await createApp();
    const token = signToken('user-editor', 'editor@example.com');

    const response = await request(app)
      .patch('/api/v1/comment_threads/thread-1/resolve')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.thread.id).toBe('thread-1');
    expect(response.body.thread.status).toBe('resolved');
    expect(response.body.thread.anchor.selected_text).toBe('重點文字');
    expect(response.body.thread.comments).toHaveLength(1);
    expect(response.body.thread.comments[0].body_markdown).toBe('請協助確認');
  });
});
