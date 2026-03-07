import type { Express, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkWorkspaceCapability } from '../middleware/rbac.js';
import {
  approveWorkflowAction,
  cancelWorkflowAction,
  createWorkflowActionDraft,
  getWorkflowActionDetail,
  InvalidWorkflowActionStateError,
  listWorkflowActions,
  rejectWorkflowAction,
  submitWorkflowAction,
  syncWorkflowExecutionOutcome,
  type WorkflowActionStatus,
  type WorkflowActionType,
  type WorkflowTargetType,
  updateWorkflowActionDraft,
} from '../services/workflowActions.js';

function sendApiError(res: Response, status: number, code: string, message: string, details: unknown = null) {
  res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

function parseWorkflowStatus(value: unknown): WorkflowActionStatus | null {
  if (typeof value !== 'string') return null;
  return ['draft', 'pending_approval', 'approved', 'rejected', 'executing', 'executed', 'execution_failed', 'cancelled'].includes(value)
    ? value as WorkflowActionStatus
    : null;
}

function parseWorkflowActionType(value: unknown): WorkflowActionType | null {
  if (typeof value !== 'string') return null;
  return ['document_reindex', 'bulk_document_reindex', 'agent_rerun', 'automation_trigger'].includes(value)
    ? value as WorkflowActionType
    : null;
}

function parseWorkflowTargetType(value: unknown): WorkflowTargetType | null {
  if (typeof value !== 'string') return null;
  return ['document', 'documentSet', 'agentRun', 'automation'].includes(value)
    ? value as WorkflowTargetType
    : null;
}

export function registerWorkflowActionRoutes(app: Express): void {
  app.get(
    '/api/v1/workspaces/:workspaceId/workflow-actions',
    authMiddleware,
    checkWorkspaceCapability('canViewWorkspace'),
    async (req: AuthRequest, res: Response) => {
      try {
        const result = await listWorkflowActions({
          workspaceId: req.params.workspaceId,
          status: parseWorkflowStatus(req.query.status),
          actionType: parseWorkflowActionType(req.query.actionType),
          requestedByUserId: req.query.requestedByMe === 'true' ? req.userId ?? null : null,
          approvalsPendingForUserId: req.query.approvalsPendingForMe === 'true' ? req.userId ?? null : null,
          cursor: typeof req.query.cursor === 'string' ? req.query.cursor : null,
          limit: typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined,
        });
        res.json(result);
      } catch (error) {
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to list workflow actions', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.get(
    '/api/v1/workspaces/:workspaceId/workflow-actions/:actionId',
    authMiddleware,
    checkWorkspaceCapability('canViewWorkspace'),
    async (req: AuthRequest, res: Response) => {
      try {
        await syncWorkflowExecutionOutcome(req.params.workspaceId, req.params.actionId).catch(() => null);
        const action = await getWorkflowActionDetail(req.params.workspaceId, req.params.actionId);
        if (!action) {
          sendApiError(res, 404, 'NOT_FOUND', 'Workflow action not found');
          return;
        }
        res.json(action);
      } catch (error) {
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to load workflow action', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.post(
    '/api/v1/workspaces/:workspaceId/workflow-actions',
    authMiddleware,
    checkWorkspaceCapability('canRequestWorkflowActions'),
    async (req: AuthRequest, res: Response) => {
      try {
        const actionType = parseWorkflowActionType(req.body?.actionType);
        const targetType = parseWorkflowTargetType(req.body?.targetType);
        const targetId = typeof req.body?.targetId === 'string' ? req.body.targetId : null;
        if (!actionType || !targetType || !targetId || !req.userId) {
          sendApiError(res, 400, 'BAD_REQUEST', 'actionType, targetType, and targetId are required');
          return;
        }
        const action = await createWorkflowActionDraft({
          workspaceId: req.params.workspaceId,
          actionType,
          targetType,
          targetId,
          requestedByUserId: req.userId,
          payload: req.body?.payload,
          summary: req.body?.summary,
          threadId: req.body?.threadId,
        });
        res.status(201).json(action);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        if (message === 'Target not found' || message.toLowerCase().includes('requires')) {
          sendApiError(res, 400, 'BAD_REQUEST', message);
          return;
        }
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to create workflow action', message);
      }
    }
  );

  app.put(
    '/api/v1/workspaces/:workspaceId/workflow-actions/:actionId',
    authMiddleware,
    checkWorkspaceCapability('canRequestWorkflowActions'),
    async (req: AuthRequest, res: Response) => {
      try {
        const action = await updateWorkflowActionDraft({
          workspaceId: req.params.workspaceId,
          actionId: req.params.actionId,
          requestedByUserId: req.userId!,
          payload: req.body?.payload,
          summary: req.body?.summary,
          threadId: req.body?.threadId,
        });
        if (!action) {
          sendApiError(res, 404, 'NOT_FOUND', 'Workflow action not found');
          return;
        }
        res.json(action);
      } catch (error) {
        if (error instanceof InvalidWorkflowActionStateError) {
          sendApiError(res, 409, 'INVALID_WORKFLOW_STATE', error.message);
          return;
        }
        if (error instanceof Error && error.message === 'FORBIDDEN') {
          sendApiError(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action');
          return;
        }
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to update workflow action', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.post(
    '/api/v1/workspaces/:workspaceId/workflow-actions/:actionId/submit',
    authMiddleware,
    checkWorkspaceCapability('canRequestWorkflowActions'),
    async (req: AuthRequest, res: Response) => {
      try {
        const action = await submitWorkflowAction({
          workspaceId: req.params.workspaceId,
          actionId: req.params.actionId,
          requestedByUserId: req.userId!,
        });
        res.json({ actionId: action.actionId, status: action.status, executedJobId: action.executedJobId ?? null, executedRunId: action.executedRunId ?? null });
      } catch (error) {
        if (error instanceof InvalidWorkflowActionStateError) {
          sendApiError(res, 409, 'INVALID_WORKFLOW_STATE', error.message);
          return;
        }
        if (error instanceof Error && error.message === 'FORBIDDEN') {
          sendApiError(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action');
          return;
        }
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to submit workflow action', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.post(
    '/api/v1/workspaces/:workspaceId/workflow-actions/:actionId/approve',
    authMiddleware,
    checkWorkspaceCapability('canApproveWorkflowActions'),
    async (req: AuthRequest, res: Response) => {
      try {
        const action = await approveWorkflowAction({
          workspaceId: req.params.workspaceId,
          actionId: req.params.actionId,
          approverUserId: req.userId!,
        });
        res.json({ actionId: action.actionId, status: action.status, executedJobId: action.executedJobId ?? null, executedRunId: action.executedRunId ?? null });
      } catch (error) {
        if (error instanceof InvalidWorkflowActionStateError) {
          sendApiError(res, 409, 'INVALID_WORKFLOW_STATE', error.message);
          return;
        }
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to approve workflow action', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.post(
    '/api/v1/workspaces/:workspaceId/workflow-actions/:actionId/reject',
    authMiddleware,
    checkWorkspaceCapability('canApproveWorkflowActions'),
    async (req: AuthRequest, res: Response) => {
      try {
        const action = await rejectWorkflowAction({
          workspaceId: req.params.workspaceId,
          actionId: req.params.actionId,
          approverUserId: req.userId!,
          comment: req.body?.comment,
        });
        res.json({ actionId: action.actionId, status: action.status });
      } catch (error) {
        if (error instanceof InvalidWorkflowActionStateError) {
          sendApiError(res, 409, 'INVALID_WORKFLOW_STATE', error.message);
          return;
        }
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to reject workflow action', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.post(
    '/api/v1/workspaces/:workspaceId/workflow-actions/:actionId/cancel',
    authMiddleware,
    checkWorkspaceCapability('canRequestWorkflowActions'),
    async (req: AuthRequest, res: Response) => {
      try {
        const action = await cancelWorkflowAction({
          workspaceId: req.params.workspaceId,
          actionId: req.params.actionId,
          requesterUserId: req.userId!,
        });
        res.json({ actionId: action.actionId, status: action.status });
      } catch (error) {
        if (error instanceof InvalidWorkflowActionStateError) {
          sendApiError(res, 409, 'INVALID_WORKFLOW_STATE', error.message);
          return;
        }
        if (error instanceof Error && error.message === 'FORBIDDEN') {
          sendApiError(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action');
          return;
        }
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to cancel workflow action', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );
}
