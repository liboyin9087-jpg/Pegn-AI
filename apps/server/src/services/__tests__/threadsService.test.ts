import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPool = vi.hoisted(() => ({ query: vi.fn() }));
const inboxProjectionMocks = vi.hoisted(() => ({
  projectThreadMentionNotification: vi.fn(),
  projectThreadAssignmentNotification: vi.fn(),
}));

vi.mock('../../db/client.js', () => ({ pool: mockPool }));
vi.mock('../../services/inboxService.js', () => inboxProjectionMocks);
vi.mock('../../services/admin.js', () => ({
  getWorkspaceAdminAlerts: vi.fn(async (workspaceId: string) => ({
    items: [
      {
        id: `failed-jobs-${workspaceId}`,
        title: 'Recent failed jobs spike',
      },
    ],
  })),
}));

import {
  addThreadComment,
  assignThread,
  buildThreadSourceTarget,
  createOrGetThread,
  getThreadDetail,
  reopenThread,
  resolveThread,
} from '../threads.js';

type ThreadRow = {
  id: string;
  workspace_id: string;
  target_type: 'document' | 'agentRun' | 'job' | 'adminAlert';
  target_id: string;
  status: 'open' | 'in_progress' | 'resolved';
  title: string | null;
  created_by_user_id: string;
  last_activity_at: Date;
  resolved_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

type CommentRow = {
  id: string;
  thread_id: string;
  workspace_id: string;
  author_user_id: string;
  body: string;
  mentioned_user_ids: string[];
  created_at: Date;
  updated_at: Date;
};

type AssignmentRow = {
  id: string;
  thread_id: string;
  workspace_id: string;
  assigned_to_user_id: string;
  assigned_by_user_id: string;
  status: 'open' | 'in_progress' | 'resolved';
  due_at: Date | null;
  is_current: boolean;
  created_at: Date;
  updated_at: Date;
  resolved_at: Date | null;
};

let threads: ThreadRow[] = [];
let comments: CommentRow[] = [];
let assignments: AssignmentRow[] = [];
let nextThreadId = 1;
let nextCommentId = 1;
let nextAssignmentId = 1;

function resetState() {
  threads = [];
  comments = [];
  assignments = [];
  nextThreadId = 1;
  nextCommentId = 1;
  nextAssignmentId = 1;
}

beforeEach(() => {
  resetState();
  vi.clearAllMocks();

  mockPool.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized === 'select 1 from documents where id = $1 and workspace_id = $2 limit 1') {
      return { rows: [{ '?column?': 1 }], rowCount: 1 };
    }
    if (normalized === 'select 1 from agent_runs where id = $1 and workspace_id = $2 limit 1') {
      return { rows: [{ '?column?': 1 }], rowCount: 1 };
    }
    if (normalized === 'select 1 from jobs where id = $1 and workspace_id = $2 limit 1') {
      return { rows: [{ '?column?': 1 }], rowCount: 1 };
    }

    if (normalized.startsWith('select * from collaboration_threads where workspace_id = $1 and target_type = $2 and target_id = $3')) {
      const [workspaceId, targetType, targetId] = params as [string, ThreadRow['target_type'], string];
      const row = threads.find((item) => item.workspace_id === workspaceId && item.target_type === targetType && item.target_id === targetId);
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }

    if (normalized.startsWith('insert into collaboration_threads')) {
      const [workspaceId, targetType, targetId, title, userId] = params as [string, ThreadRow['target_type'], string, string | null, string];
      const now = new Date('2026-03-07T12:00:00.000Z');
      const row: ThreadRow = {
        id: `thread-${nextThreadId++}`,
        workspace_id: workspaceId,
        target_type: targetType,
        target_id: targetId,
        status: 'open',
        title,
        created_by_user_id: userId,
        last_activity_at: now,
        resolved_at: null,
        created_at: now,
        updated_at: now,
      };
      threads.push(row);
      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (normalized.startsWith('select * from collaboration_threads where id = $1 and workspace_id = $2 limit 1')) {
      const [threadId, workspaceId] = params as [string, string];
      const row = threads.find((item) => item.id === threadId && item.workspace_id === workspaceId);
      return { rows: row ? [{ ...row }] : [], rowCount: row ? 1 : 0 };
    }

    if (normalized.startsWith('select workspace_id from collaboration_threads where id = $1 limit 1')) {
      const [threadId] = params as [string];
      const row = threads.find((item) => item.id === threadId);
      return { rows: row ? [{ workspace_id: row.workspace_id }] : [], rowCount: row ? 1 : 0 };
    }

    if (normalized.includes('from thread_comments c join users u on u.id = c.author_user_id')) {
      const [threadId] = params as [string];
      const rows = comments
        .filter((item) => item.thread_id === threadId)
        .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
        .map((item) => ({
          ...item,
          author_name: item.author_user_id === 'user-1' ? 'Alex' : 'Pat',
          author_email: item.author_user_id === 'user-1' ? 'alex@example.com' : 'pat@example.com',
        }));
      return { rows, rowCount: rows.length };
    }

    if (normalized.startsWith('select * from thread_assignments where thread_id = $1')) {
      const [threadId] = params as [string];
      const rows = assignments
        .filter((item) => item.thread_id === threadId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .map((item) => ({ ...item }));
      return { rows, rowCount: rows.length };
    }

    if (normalized.startsWith('select user_id from workspace_members where workspace_id = $1 and user_id = any($2::uuid[])')) {
      const [_workspaceId, userIds] = params as [string, string[]];
      const rows = userIds.map((userId) => ({ user_id: userId }));
      return { rows, rowCount: rows.length };
    }

    if (normalized.startsWith('insert into thread_comments')) {
      const [threadId, workspaceId, authorUserId, body, mentionedUserIds] = params as [string, string, string, string, string];
      const now = new Date('2026-03-07T12:05:00.000Z');
      const row: CommentRow = {
        id: `comment-${nextCommentId++}`,
        thread_id: threadId,
        workspace_id: workspaceId,
        author_user_id: authorUserId,
        body,
        mentioned_user_ids: JSON.parse(mentionedUserIds),
        created_at: now,
        updated_at: now,
      };
      comments.push(row);
      return {
        rows: [{
          ...row,
          author_name: null,
          author_email: null,
        }],
        rowCount: 1,
      };
    }

    if (normalized === 'select name, email from users where id = $1 limit 1') {
      return { rows: [{ name: 'Alex', email: 'alex@example.com' }], rowCount: 1 };
    }

    if (normalized.startsWith('update collaboration_threads set last_activity_at = now() where id = $1')) {
      const [threadId] = params as [string];
      threads = threads.map((item) => item.id === threadId ? { ...item, last_activity_at: new Date('2026-03-07T12:06:00.000Z') } : item);
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('update thread_assignments set is_current = false, updated_at = now() where thread_id = $1 and is_current = true')) {
      const [threadId] = params as [string];
      assignments = assignments.map((item) => item.thread_id === threadId && item.is_current ? { ...item, is_current: false } : item);
      return { rows: [], rowCount: 0 };
    }

    if (normalized.startsWith('insert into thread_assignments')) {
      const [threadId, workspaceId, assignedToUserId, assignedByUserId, dueAt] = params as [string, string, string, string, Date | null];
      const now = new Date('2026-03-07T12:07:00.000Z');
      const row: AssignmentRow = {
        id: `assignment-${nextAssignmentId++}`,
        thread_id: threadId,
        workspace_id: workspaceId,
        assigned_to_user_id: assignedToUserId,
        assigned_by_user_id: assignedByUserId,
        status: 'open',
        due_at: dueAt,
        is_current: true,
        created_at: now,
        updated_at: now,
        resolved_at: null,
      };
      assignments.push(row);
      return { rows: [{ ...row }], rowCount: 1 };
    }

    if (normalized.startsWith("update collaboration_threads set status = 'resolved'")) {
      const [threadId] = params as [string];
      threads = threads.map((item) => item.id === threadId ? {
        ...item,
        status: 'resolved',
        resolved_at: new Date('2026-03-07T12:08:00.000Z'),
        last_activity_at: new Date('2026-03-07T12:08:00.000Z'),
      } : item);
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("update thread_assignments set status = 'resolved'")) {
      const [threadId] = params as [string];
      assignments = assignments.map((item) => item.thread_id === threadId && item.is_current ? {
        ...item,
        status: 'resolved',
        resolved_at: new Date('2026-03-07T12:08:00.000Z'),
      } : item);
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith("update collaboration_threads set status = 'open'")) {
      const [threadId] = params as [string];
      threads = threads.map((item) => item.id === threadId ? {
        ...item,
        status: 'open',
        resolved_at: null,
        last_activity_at: new Date('2026-03-07T12:09:00.000Z'),
      } : item);
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL in threadsService test: ${normalized}`);
  });
});

describe('threads service', () => {
  it('creates one canonical thread per workspace target', async () => {
    const first = await createOrGetThread({
      workspaceId: 'ws-1',
      targetType: 'document',
      targetId: 'doc-1',
      title: 'Discuss doc',
      userId: 'user-1',
    });
    const second = await createOrGetThread({
      workspaceId: 'ws-1',
      targetType: 'document',
      targetId: 'doc-1',
      title: 'Discuss doc',
      userId: 'user-1',
    });

    expect(first.threadId).toBe(second.threadId);
    expect(threads).toHaveLength(1);
  });

  it('projects mention notifications when adding comments', async () => {
    const thread = await createOrGetThread({
      workspaceId: 'ws-1',
      targetType: 'job',
      targetId: 'job-1',
      title: 'Investigate failed job',
      userId: 'user-1',
    });

    const comment = await addThreadComment({
      threadId: thread.threadId,
      workspaceId: 'ws-1',
      authorUserId: 'user-1',
      body: 'Please review this failure',
      mentionedUserIds: ['user-2'],
    });

    expect(comment.body).toBe('Please review this failure');
    expect(inboxProjectionMocks.projectThreadMentionNotification).toHaveBeenCalledTimes(1);
  });

  it('projects assignment notifications and keeps one current assignment', async () => {
    const thread = await createOrGetThread({
      workspaceId: 'ws-1',
      targetType: 'agentRun',
      targetId: 'run-1',
      title: 'Agent follow-up',
      userId: 'user-1',
    });

    const first = await assignThread({
      threadId: thread.threadId,
      workspaceId: 'ws-1',
      assignedToUserId: 'user-2',
      assignedByUserId: 'user-1',
      dueAt: null,
    });
    const second = await assignThread({
      threadId: thread.threadId,
      workspaceId: 'ws-1',
      assignedToUserId: 'user-3',
      assignedByUserId: 'user-1',
      dueAt: null,
    });
    const detail = await getThreadDetail(thread.threadId, 'ws-1');

    expect(first.isCurrent).toBe(true);
    expect(second.isCurrent).toBe(true);
    expect(detail.currentAssignment?.assignedToUserId).toBe('user-3');
    expect(detail.assignmentHistory.filter((assignment) => assignment.isCurrent)).toHaveLength(1);
    expect(inboxProjectionMocks.projectThreadAssignmentNotification).toHaveBeenCalledTimes(2);
  });

  it('resolves and reopens threads', async () => {
    const thread = await createOrGetThread({
      workspaceId: 'ws-1',
      targetType: 'adminAlert',
      targetId: 'failed-jobs-ws-1',
      title: 'Failed jobs spike',
      userId: 'user-1',
    });

    const resolved = await resolveThread(thread.threadId, 'ws-1');
    const reopened = await reopenThread(thread.threadId, 'ws-1');

    expect(resolved.status).toBe('resolved');
    expect(reopened.status).toBe('open');
  });

  it('builds canonical source targets for supported types', () => {
    expect(buildThreadSourceTarget({ id: 'thread-1', target_type: 'document', target_id: 'doc-1' })).toMatchObject({
      surface: 'document',
      payload: { documentId: 'doc-1', threadId: 'thread-1' },
    });
    expect(buildThreadSourceTarget({ id: 'thread-2', target_type: 'job', target_id: 'job-1' })).toMatchObject({
      surface: 'operations',
      payload: { jobId: 'job-1' },
    });
    expect(buildThreadSourceTarget({ id: 'thread-3', target_type: 'agentRun', target_id: 'run-1' })).toMatchObject({
      surface: 'agent',
      payload: { runId: 'run-1' },
    });
    expect(buildThreadSourceTarget({ id: 'thread-4', target_type: 'adminAlert', target_id: 'failed-jobs-ws-1' })).toMatchObject({
      surface: 'admin',
      payload: { section: 'alerts' },
    });
  });
});
