import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const serviceMocks = vi.hoisted(() => ({
  createOrGetThread: vi.fn(),
  listThreads: vi.fn(),
  getThreadDetail: vi.fn(),
  addThreadComment: vi.fn(),
  assignThread: vi.fn(),
  resolveThread: vi.fn(),
  reopenThread: vi.fn(),
  getThreadWorkspaceId: vi.fn(),
}));

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: unknown, next: () => void) => {
    req.userId = 'user-1';
    req.userEmail = 'user@example.com';
    next();
  },
}));

vi.mock('../../middleware/rbac.js', () => ({
  checkWorkspaceCapability: (capability: string) => (req: any, res: any, next: () => void) => {
    const role = req.headers['x-role'] ?? 'editor';
    const canView = capability === 'canViewWorkspace';
    const canCollaborate = capability === 'canCollaborate' && role !== 'viewer';
    const canManageAssignments = capability === 'canManageAssignments' && role !== 'viewer';
    if (canView || canCollaborate || canManageAssignments) {
      next();
      return;
    }
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'You do not have permission to perform this action',
      },
    });
  },
}));

vi.mock('../../services/threads.js', () => serviceMocks);

async function createApp() {
  const { registerThreadsRoutes } = await import('../threads.js');
  const app = express();
  app.use(express.json());
  registerThreadsRoutes(app);
  return app;
}

function makeThread() {
  return {
    threadId: 'thread-1',
    workspaceId: 'ws-1',
    targetType: 'job',
    targetId: 'job-1',
    status: 'open',
    title: 'Job issue',
    commentCount: 1,
    currentAssignment: null,
    sourceTarget: { surface: 'operations', payload: { jobId: 'job-1', jobType: 'all' } },
    createdByUserId: 'user-1',
    lastActivityAt: '2026-03-07T12:00:00.000Z',
    resolvedAt: null,
    comments: [],
    assignmentHistory: [],
  };
}

describe('threads routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    serviceMocks.createOrGetThread.mockResolvedValue(makeThread());
    serviceMocks.listThreads.mockResolvedValue({ items: [], nextCursor: null });
    serviceMocks.getThreadDetail.mockResolvedValue(makeThread());
    serviceMocks.addThreadComment.mockResolvedValue({
      commentId: 'comment-1',
      threadId: 'thread-1',
      author: { userId: 'user-1', name: 'Alex', email: 'alex@example.com' },
      body: 'Please check this failure',
      mentionedUserIds: ['user-2'],
      createdAt: '2026-03-07T12:01:00.000Z',
      updatedAt: '2026-03-07T12:01:00.000Z',
    });
    serviceMocks.assignThread.mockResolvedValue({
      assignmentId: 'assignment-1',
      threadId: 'thread-1',
      assignedToUserId: 'user-2',
      assignedByUserId: 'user-1',
      status: 'open',
      dueAt: null,
      isCurrent: true,
      createdAt: '2026-03-07T12:02:00.000Z',
      updatedAt: '2026-03-07T12:02:00.000Z',
      resolvedAt: null,
    });
    serviceMocks.resolveThread.mockResolvedValue({
      threadId: 'thread-1',
      status: 'resolved',
      resolvedAt: '2026-03-07T12:03:00.000Z',
    });
    serviceMocks.reopenThread.mockResolvedValue({
      threadId: 'thread-1',
      status: 'open',
    });
    serviceMocks.getThreadWorkspaceId.mockResolvedValue('ws-1');
  });

  it('creates or gets a canonical thread', async () => {
    const app = await createApp();
    const response = await request(app)
      .post('/api/v1/threads')
      .send({
        workspaceId: 'ws-1',
        targetType: 'job',
        targetId: 'job-1',
        title: 'Job issue',
      });

    expect(response.status).toBe(201);
    expect(serviceMocks.createOrGetThread).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      targetType: 'job',
      targetId: 'job-1',
      title: 'Job issue',
      userId: 'user-1',
    });
    expect(response.body.threadId).toBe('thread-1');
  });

  it('allows viewers to list and read threads', async () => {
    serviceMocks.listThreads.mockResolvedValue({
      items: [{
        threadId: 'thread-1',
        targetType: 'job',
        targetId: 'job-1',
        status: 'open',
        title: 'Job issue',
        latestCommentPreview: 'Please check this failure',
        commentCount: 1,
        currentAssignment: null,
        lastActivityAt: '2026-03-07T12:00:00.000Z',
        sourceTarget: { surface: 'operations', payload: { jobId: 'job-1', jobType: 'all' } },
      }],
      nextCursor: null,
    });
    const app = await createApp();

    const listResponse = await request(app)
      .get('/api/v1/threads?workspaceId=ws-1&targetType=job&targetId=job-1')
      .set('x-role', 'viewer');
    const detailResponse = await request(app)
      .get('/api/v1/threads/thread-1')
      .set('x-role', 'viewer');

    expect(listResponse.status).toBe(200);
    expect(detailResponse.status).toBe(200);
  });

  it('blocks viewers from commenting and assigning', async () => {
    const app = await createApp();

    const commentResponse = await request(app)
      .post('/api/v1/threads/thread-1/comments')
      .set('x-role', 'viewer')
      .send({ body: 'Need investigation', mentionedUserIds: ['user-2'] });
    const assignmentResponse = await request(app)
      .post('/api/v1/threads/thread-1/assignments')
      .set('x-role', 'viewer')
      .send({ assignedToUserId: 'user-2' });

    expect(commentResponse.status).toBe(403);
    expect(assignmentResponse.status).toBe(403);
  });

  it('allows editors to comment, assign, resolve, and reopen', async () => {
    const app = await createApp();

    const commentResponse = await request(app)
      .post('/api/v1/threads/thread-1/comments')
      .send({ body: 'Need investigation', mentionedUserIds: ['user-2'] });
    const assignmentResponse = await request(app)
      .post('/api/v1/threads/thread-1/assignments')
      .send({ assignedToUserId: 'user-2' });
    const resolveResponse = await request(app)
      .post('/api/v1/threads/thread-1/resolve')
      .send({});
    const reopenResponse = await request(app)
      .post('/api/v1/threads/thread-1/reopen')
      .send({});

    expect(commentResponse.status).toBe(201);
    expect(assignmentResponse.status).toBe(201);
    expect(resolveResponse.status).toBe(200);
    expect(reopenResponse.status).toBe(200);
    expect(serviceMocks.addThreadComment).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-1',
      authorUserId: 'user-1',
    }));
    expect(serviceMocks.assignThread).toHaveBeenCalledWith(expect.objectContaining({
      threadId: 'thread-1',
      assignedToUserId: 'user-2',
      assignedByUserId: 'user-1',
    }));
  });

  it('returns 404 when the thread workspace cannot be resolved', async () => {
    serviceMocks.getThreadWorkspaceId.mockResolvedValue(null);
    const app = await createApp();

    const response = await request(app)
      .get('/api/v1/threads/missing-thread');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });
});
