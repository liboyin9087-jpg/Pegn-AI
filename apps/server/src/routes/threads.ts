import type { Express, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkWorkspaceCapability } from '../middleware/rbac.js';
import {
  addThreadComment,
  assignThread,
  createOrGetThread,
  getThreadDetail,
  getThreadWorkspaceId,
  listThreads,
  reopenThread,
  resolveThread,
  type CollaborationTargetType,
  type CollaborationThreadStatus,
} from '../services/threads.js';

function sendApiError(res: Response, status: number, code: string, message: string, details: unknown = null) {
  res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

function isTargetType(value: unknown): value is CollaborationTargetType {
  return value === 'document' || value === 'agentRun' || value === 'job' || value === 'adminAlert';
}

function isThreadStatus(value: unknown): value is CollaborationThreadStatus {
  return value === 'open' || value === 'in_progress' || value === 'resolved';
}

async function resolveThreadWorkspace(threadId: string): Promise<string | null> {
  return getThreadWorkspaceId(threadId);
}

export function registerThreadsRoutes(app: Express): void {
  app.post('/api/v1/threads', authMiddleware, checkWorkspaceCapability('canCollaborate'), async (req: AuthRequest, res: Response) => {
    const workspaceId = typeof req.body?.workspaceId === 'string'
      ? req.body.workspaceId
      : typeof req.body?.workspace_id === 'string'
        ? req.body.workspace_id
        : null;
    const targetType = req.body?.targetType;
    const targetId = typeof req.body?.targetId === 'string' ? req.body.targetId : null;
    const title = typeof req.body?.title === 'string' ? req.body.title : null;

    if (!workspaceId || !isTargetType(targetType) || !targetId || !req.userId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'workspaceId, targetType, and targetId are required');
      return;
    }

    try {
      const thread = await createOrGetThread({
        workspaceId,
        targetType,
        targetId,
        title,
        userId: req.userId,
      });
      res.status(201).json(thread);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const status = message === 'Target not found' ? 404 : 500;
      const code = message === 'Target not found' ? 'NOT_FOUND' : 'INVALID_STATE';
      sendApiError(res, status, code, message);
    }
  });

  app.get('/api/v1/threads', authMiddleware, checkWorkspaceCapability('canViewWorkspace'), async (req: AuthRequest, res: Response) => {
    const workspaceId = typeof req.query.workspaceId === 'string'
      ? req.query.workspaceId
      : typeof req.query.workspace_id === 'string'
        ? req.query.workspace_id
        : null;
    if (!workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'workspaceId is required');
      return;
    }

    const targetType = typeof req.query.targetType === 'string' && isTargetType(req.query.targetType)
      ? req.query.targetType
      : null;
    const targetId = typeof req.query.targetId === 'string'
      ? req.query.targetId
      : typeof req.query.target_id === 'string'
        ? req.query.target_id
        : null;
    const status = typeof req.query.status === 'string' && isThreadStatus(req.query.status)
      ? req.query.status
      : null;
    const assignedToMe = req.query.assignedToMe === 'true' ? req.userId ?? null : null;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;
    const limit = Math.max(1, Math.min(parseInt(String(req.query.limit ?? '20'), 10) || 20, 100));

    try {
      const response = await listThreads({
        workspaceId,
        targetType,
        targetId,
        status,
        assignedToMe,
        cursor,
        limit,
      });
      res.json(response);
    } catch (error) {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to list threads', error instanceof Error ? error.message : 'Unknown error');
    }
  });

  app.get('/api/v1/threads/:threadId', authMiddleware, checkWorkspaceCapability('canViewWorkspace', 'collaboration_thread'), async (req: AuthRequest, res: Response) => {
    const threadId = req.params.threadId;
    const workspaceId = await resolveThreadWorkspace(threadId);
    if (!workspaceId) {
      sendApiError(res, 404, 'NOT_FOUND', 'Thread not found');
      return;
    }

    try {
      const thread = await getThreadDetail(threadId, workspaceId);
      res.json(thread);
    } catch (error) {
      sendApiError(res, 404, 'NOT_FOUND', error instanceof Error ? error.message : 'Thread not found');
    }
  });

  app.post('/api/v1/threads/:threadId/comments', authMiddleware, checkWorkspaceCapability('canCollaborate', 'collaboration_thread'), async (req: AuthRequest, res: Response) => {
    const threadId = req.params.threadId;
    const workspaceId = await resolveThreadWorkspace(threadId);
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const mentionedUserIds = Array.isArray(req.body?.mentionedUserIds)
      ? req.body.mentionedUserIds.filter((value: unknown): value is string => typeof value === 'string')
      : [];

    if (!workspaceId) {
      sendApiError(res, 404, 'NOT_FOUND', 'Thread not found');
      return;
    }
    if (!req.userId || !body) {
      sendApiError(res, 400, 'BAD_REQUEST', 'body is required');
      return;
    }

    try {
      const comment = await addThreadComment({
        threadId,
        workspaceId,
        authorUserId: req.userId,
        body,
        mentionedUserIds,
      });
      res.status(201).json(comment);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const badRequest = message === 'Mentioned users must be workspace members';
      sendApiError(res, badRequest ? 400 : 500, badRequest ? 'BAD_REQUEST' : 'INVALID_STATE', message);
    }
  });

  app.post('/api/v1/threads/:threadId/assignments', authMiddleware, checkWorkspaceCapability('canManageAssignments', 'collaboration_thread'), async (req: AuthRequest, res: Response) => {
    const threadId = req.params.threadId;
    const workspaceId = await resolveThreadWorkspace(threadId);
    const assignedToUserId = typeof req.body?.assignedToUserId === 'string' ? req.body.assignedToUserId : null;
    const dueAt = typeof req.body?.dueAt === 'string' ? req.body.dueAt : null;

    if (!workspaceId) {
      sendApiError(res, 404, 'NOT_FOUND', 'Thread not found');
      return;
    }
    if (!req.userId || !assignedToUserId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'assignedToUserId is required');
      return;
    }

    try {
      const assignment = await assignThread({
        threadId,
        workspaceId,
        assignedToUserId,
        assignedByUserId: req.userId,
        dueAt,
      });
      res.status(201).json(assignment);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const badRequest = message === 'Assigned user must be a workspace member';
      sendApiError(res, badRequest ? 400 : 500, badRequest ? 'BAD_REQUEST' : 'INVALID_STATE', message);
    }
  });

  app.post('/api/v1/threads/:threadId/resolve', authMiddleware, checkWorkspaceCapability('canCollaborate', 'collaboration_thread'), async (req: AuthRequest, res: Response) => {
    const threadId = req.params.threadId;
    const workspaceId = await resolveThreadWorkspace(threadId);
    if (!workspaceId) {
      sendApiError(res, 404, 'NOT_FOUND', 'Thread not found');
      return;
    }

    try {
      const thread = await resolveThread(threadId, workspaceId);
      res.json({
        threadId: thread.threadId,
        status: thread.status,
        resolvedAt: thread.resolvedAt,
      });
    } catch (error) {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to resolve thread', error instanceof Error ? error.message : 'Unknown error');
    }
  });

  app.post('/api/v1/threads/:threadId/reopen', authMiddleware, checkWorkspaceCapability('canCollaborate', 'collaboration_thread'), async (req: AuthRequest, res: Response) => {
    const threadId = req.params.threadId;
    const workspaceId = await resolveThreadWorkspace(threadId);
    if (!workspaceId) {
      sendApiError(res, 404, 'NOT_FOUND', 'Thread not found');
      return;
    }

    try {
      const thread = await reopenThread(threadId, workspaceId);
      res.json({
        threadId: thread.threadId,
        status: thread.status,
      });
    } catch (error) {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to reopen thread', error instanceof Error ? error.message : 'Unknown error');
    }
  });
}
