import type { Express, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkWorkspaceCapability } from '../middleware/rbac.js';
import { hasWorkspaceCapability } from '../lib/workspaceRoles.js';
import {
  appendJobEvent,
  getJobEvents,
  getWorkspaceJob,
  getWorkspaceJobSummary,
  listWorkspaceJobs,
  requestCancelJob,
  type JobStatus,
  type JobType,
  InvalidJobStateError,
} from '../services/jobService.js';
import {
  getJobRequiredCapabilityForCancel,
  getJobRequiredCapabilityForRetry,
} from '../services/jobPermissionService.js';
import { searchService } from '../services/search.js';
import { retryAgentJob } from '../services/agent.js';
import { retryAutomationJob } from '../services/automation.js';

function sendApiError(res: Response, status: number, code: string, message: string, details: unknown = null) {
  res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

function parseJobStatus(value: unknown): JobStatus | undefined {
  if (typeof value !== 'string') return undefined;
  if (['queued', 'running', 'succeeded', 'failed', 'cancelled', 'timeout'].includes(value)) {
    return value as JobStatus;
  }
  return undefined;
}

function parseJobType(value: unknown): JobType | undefined {
  if (typeof value !== 'string') return undefined;
  if (['document_index', 'document_reindex', 'agent_run', 'automation_trigger'].includes(value)) {
    return value as JobType;
  }
  return undefined;
}

function ensureCapability(req: AuthRequest, capability: Parameters<typeof hasWorkspaceCapability>[1], res: Response): boolean {
  if (!req.workspacePermissions || !hasWorkspaceCapability(req.workspacePermissions, capability)) {
    sendApiError(res, 403, 'FORBIDDEN', 'You do not have permission to perform this action');
    return false;
  }
  return true;
}

export function registerJobsRoutes(app: Express): void {
  app.get(
    '/api/v1/workspaces/:workspaceId/jobs',
    authMiddleware,
    checkWorkspaceCapability('canViewWorkspace'),
    async (req: AuthRequest, res: Response) => {
      const workspaceId = req.params.workspaceId;

      try {
        const result = await listWorkspaceJobs(workspaceId, {
          status: parseJobStatus(req.query.status),
          jobType: parseJobType(req.query.jobType),
          resourceType: typeof req.query.resourceType === 'string' ? req.query.resourceType : undefined,
          resourceId: typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined,
          cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
          limit: typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined,
        });
        res.json(result);
      } catch (error) {
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to list jobs', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.get(
    '/api/v1/workspaces/:workspaceId/jobs/summary',
    authMiddleware,
    checkWorkspaceCapability('canViewWorkspace'),
    async (req: AuthRequest, res: Response) => {
      try {
        const summary = await getWorkspaceJobSummary(req.params.workspaceId);
        res.json(summary);
      } catch (error) {
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to get jobs summary', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.get(
    '/api/v1/workspaces/:workspaceId/jobs/:jobId',
    authMiddleware,
    checkWorkspaceCapability('canViewWorkspace'),
    async (req: AuthRequest, res: Response) => {
      try {
        const job = await getWorkspaceJob(req.params.workspaceId, req.params.jobId);
        if (!job) {
          sendApiError(res, 404, 'NOT_FOUND', 'Job not found');
          return;
        }
        res.json(job);
      } catch (error) {
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to get job', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.get(
    '/api/v1/workspaces/:workspaceId/jobs/:jobId/events',
    authMiddleware,
    checkWorkspaceCapability('canViewWorkspace'),
    async (req: AuthRequest, res: Response) => {
      try {
        const job = await getWorkspaceJob(req.params.workspaceId, req.params.jobId);
        if (!job) {
          sendApiError(res, 404, 'NOT_FOUND', 'Job not found');
          return;
        }
        const items = await getJobEvents(req.params.workspaceId, req.params.jobId);
        res.json({ items });
      } catch (error) {
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to get job events', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.post(
    '/api/v1/workspaces/:workspaceId/jobs/:jobId/retry',
    authMiddleware,
    checkWorkspaceCapability('canViewWorkspace'),
    async (req: AuthRequest, res: Response) => {
      try {
        const job = await getWorkspaceJob(req.params.workspaceId, req.params.jobId);
        if (!job) {
          sendApiError(res, 404, 'NOT_FOUND', 'Job not found');
          return;
        }

        const requiredCapability = getJobRequiredCapabilityForRetry(job);
        if (!ensureCapability(req, requiredCapability, res)) {
          return;
        }
        if (job.status !== 'failed' && job.status !== 'timeout') {
          throw new InvalidJobStateError('This job cannot be retried from its current state');
        }
        await appendJobEvent({
          jobId: job.id,
          eventType: 'retry_requested',
          message: 'Retry requested from jobs API',
        }).catch(() => undefined);

        switch (job.jobType) {
          case 'document_index':
          case 'document_reindex': {
            const dispatch = await searchService.retryDocumentJob(job, req.userId!);
            res.json({
              jobId: dispatch.jobId,
              retryOfJobId: job.id,
              status: dispatch.status,
            });
            return;
          }
          case 'agent_run': {
            const run = await retryAgentJob(job, req.userId!);
            res.json({
              jobId: run.jobId,
              retryOfJobId: job.id,
              status: run.status,
              runId: run.id,
            });
            return;
          }
          case 'automation_trigger': {
            const dispatch = await retryAutomationJob(job, req.userId!);
            res.json({
              jobId: dispatch.jobId,
              retryOfJobId: job.id,
              status: dispatch.status,
            });
            return;
          }
          default:
            sendApiError(res, 400, 'BAD_REQUEST', 'Unsupported job type');
        }
      } catch (error) {
        if (error instanceof InvalidJobStateError) {
          sendApiError(res, 409, 'INVALID_JOB_STATE', 'This job cannot be retried or cancelled from its current state');
          return;
        }
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to retry job', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );

  app.post(
    '/api/v1/workspaces/:workspaceId/jobs/:jobId/cancel',
    authMiddleware,
    checkWorkspaceCapability('canViewWorkspace'),
    async (req: AuthRequest, res: Response) => {
      try {
        const job = await getWorkspaceJob(req.params.workspaceId, req.params.jobId);
        if (!job) {
          sendApiError(res, 404, 'NOT_FOUND', 'Job not found');
          return;
        }

        const requiredCapability = getJobRequiredCapabilityForCancel(job);
        if (!ensureCapability(req, requiredCapability, res)) {
          return;
        }

        const updated = await requestCancelJob(job.id, job.workspaceId);
        res.json({
          jobId: updated.id,
          status: updated.status,
          cancelRequestedAt: updated.cancelRequestedAt,
        });
      } catch (error) {
        if (error instanceof InvalidJobStateError) {
          sendApiError(res, 409, 'INVALID_JOB_STATE', 'This job cannot be retried or cancelled from its current state');
          return;
        }
        sendApiError(res, 500, 'INVALID_STATE', 'Failed to cancel job', error instanceof Error ? error.message : 'Unknown error');
      }
    }
  );
}
