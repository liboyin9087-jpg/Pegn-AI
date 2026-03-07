import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockListWorkspaceJobs = vi.fn();
const mockGetWorkspaceJobSummary = vi.fn();
const mockGetWorkspaceJob = vi.fn();
const mockGetJobEvents = vi.fn();
const mockRequestCancelJob = vi.fn();
const mockAppendJobEvent = vi.fn();
const mockRetryDocumentJob = vi.fn();
const mockRetryAgentJob = vi.fn();
const mockRetryAutomationJob = vi.fn();

const membershipState = {
  permissionSummary: {
    canViewWorkspace: true,
    canManageMembers: false,
    canManageSettings: false,
    canEditDocuments: true,
    canDeleteDocuments: true,
    canRunAutomation: true,
  },
};

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: unknown, next: () => void) => {
    req.userId = 'user-1';
    req.workspacePermissions = membershipState.permissionSummary;
    next();
  },
}));

vi.mock('../../middleware/rbac.js', () => ({
  checkWorkspaceCapability: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../lib/workspaceRoles.js', () => ({
  hasWorkspaceCapability: (permissions: Record<string, boolean>, capability: string) => Boolean(permissions?.[capability]),
}));

vi.mock('../../services/jobService.js', () => ({
  appendJobEvent: (...args: any[]) => mockAppendJobEvent(...args),
  getJobEvents: (...args: any[]) => mockGetJobEvents(...args),
  getWorkspaceJob: (...args: any[]) => mockGetWorkspaceJob(...args),
  getWorkspaceJobSummary: (...args: any[]) => mockGetWorkspaceJobSummary(...args),
  listWorkspaceJobs: (...args: any[]) => mockListWorkspaceJobs(...args),
  requestCancelJob: (...args: any[]) => mockRequestCancelJob(...args),
  InvalidJobStateError: class InvalidJobStateError extends Error {},
}));

vi.mock('../../services/jobPermissionService.js', () => ({
  getJobRequiredCapabilityForCancel: (job: any) =>
    job.jobType === 'document_index' || job.jobType === 'document_reindex'
      ? 'canEditDocuments'
      : 'canRunAutomation',
  getJobRequiredCapabilityForRetry: (job: any) =>
    job.jobType === 'document_index' || job.jobType === 'document_reindex'
      ? 'canEditDocuments'
      : 'canRunAutomation',
}));

vi.mock('../../services/search.js', () => ({
  searchService: {
    retryDocumentJob: (...args: any[]) => mockRetryDocumentJob(...args),
  },
}));

vi.mock('../../services/agent.js', () => ({
  retryAgentJob: (...args: any[]) => mockRetryAgentJob(...args),
}));

vi.mock('../../services/automation.js', () => ({
  retryAutomationJob: (...args: any[]) => mockRetryAutomationJob(...args),
}));

async function createApp() {
  const { registerJobsRoutes } = await import('../jobs.js');
  const app = express();
  app.use(express.json());
  registerJobsRoutes(app);
  return app;
}

function makeJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'job-1',
    workspaceId: 'ws-1',
    jobType: 'document_reindex',
    resourceType: 'document',
    resourceId: 'doc-1',
    sourceDomain: 'search',
    sourceRunId: null,
    triggeredBy: 'user-1',
    triggeredVia: 'manual',
    status: 'failed',
    errorCode: 'index_failed',
    errorSummary: 'Index build failed',
    createdAt: '2026-03-07T10:00:00.000Z',
    updatedAt: '2026-03-07T10:00:10.000Z',
    startedAt: '2026-03-07T10:00:01.000Z',
    finishedAt: '2026-03-07T10:00:10.000Z',
    retryOfJobId: null,
    cancelRequestedAt: null,
    metadata: {},
    ...overrides,
  };
}

describe('jobs routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAppendJobEvent.mockResolvedValue(undefined);
    membershipState.permissionSummary = {
      canViewWorkspace: true,
      canManageMembers: false,
      canManageSettings: false,
      canEditDocuments: true,
      canDeleteDocuments: true,
      canRunAutomation: true,
    };
  });

  it('lists jobs with workspace scope', async () => {
    mockListWorkspaceJobs.mockResolvedValue({ items: [makeJob()], nextCursor: null });
    const app = await createApp();

    const response = await request(app).get('/api/v1/workspaces/ws-1/jobs?status=failed&jobType=document_reindex');

    expect(response.status).toBe(200);
    expect(mockListWorkspaceJobs).toHaveBeenCalledWith('ws-1', expect.objectContaining({
      status: 'failed',
      jobType: 'document_reindex',
    }));
    expect(response.body.items).toHaveLength(1);
  });

  it('returns summary for one workspace', async () => {
    mockGetWorkspaceJobSummary.mockResolvedValue({
      total: 3,
      queued: 1,
      running: 0,
      succeeded: 1,
      failed: 1,
      cancelled: 0,
      timeout: 0,
      byType: {
        document_index: 0,
        document_reindex: 1,
        agent_run: 1,
        automation_trigger: 1,
      },
      latestFailedAt: '2026-03-07T10:00:10.000Z',
    });
    const app = await createApp();

    const response = await request(app).get('/api/v1/workspaces/ws-1/jobs/summary');

    expect(response.status).toBe(200);
    expect(response.body.total).toBe(3);
  });

  it('returns one job and its ordered events', async () => {
    mockGetWorkspaceJob.mockResolvedValue(makeJob());
    mockGetJobEvents.mockResolvedValue([
      {
        id: 'event-1',
        jobId: 'job-1',
        sequenceNo: 1,
        eventType: 'queued',
        message: 'Queued',
        payload: {},
        createdAt: '2026-03-07T10:00:00.000Z',
      },
      {
        id: 'event-2',
        jobId: 'job-1',
        sequenceNo: 2,
        eventType: 'failed',
        message: 'Failed',
        payload: {},
        createdAt: '2026-03-07T10:00:10.000Z',
      },
    ]);
    const app = await createApp();

    const detail = await request(app).get('/api/v1/workspaces/ws-1/jobs/job-1');
    const events = await request(app).get('/api/v1/workspaces/ws-1/jobs/job-1/events');

    expect(detail.status).toBe(200);
    expect(events.status).toBe(200);
    expect(events.body.items.map((item: any) => item.sequenceNo)).toEqual([1, 2]);
  });

  it('retries a document job by creating a new job', async () => {
    mockGetWorkspaceJob.mockResolvedValue(makeJob());
    mockRetryDocumentJob.mockResolvedValue({ jobId: 'job-2', status: 'queued' });
    const app = await createApp();

    const response = await request(app).post('/api/v1/workspaces/ws-1/jobs/job-1/retry');

    expect(response.status).toBe(200);
    expect(mockAppendJobEvent).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-1',
      eventType: 'retry_requested',
    }));
    expect(response.body).toEqual({
      jobId: 'job-2',
      retryOfJobId: 'job-1',
      status: 'queued',
    });
  });

  it('forbids retry when capability mapping denies mutation', async () => {
    membershipState.permissionSummary.canEditDocuments = false;
    mockGetWorkspaceJob.mockResolvedValue(makeJob());
    const app = await createApp();

    const response = await request(app).post('/api/v1/workspaces/ws-1/jobs/job-1/retry');

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('FORBIDDEN');
  });

  it('returns 409 on invalid retry state', async () => {
    mockGetWorkspaceJob.mockResolvedValue(makeJob({ status: 'succeeded' }));
    const app = await createApp();

    const response = await request(app).post('/api/v1/workspaces/ws-1/jobs/job-1/retry');

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('INVALID_JOB_STATE');
  });

  it('cancels a running job inside the same workspace', async () => {
    mockGetWorkspaceJob.mockResolvedValue(makeJob({ status: 'running', errorCode: null, errorSummary: null, finishedAt: null }));
    mockRequestCancelJob.mockResolvedValue(makeJob({
      status: 'running',
      errorCode: null,
      errorSummary: null,
      finishedAt: null,
      cancelRequestedAt: '2026-03-07T10:05:00.000Z',
    }));
    const app = await createApp();

    const response = await request(app).post('/api/v1/workspaces/ws-1/jobs/job-1/cancel');

    expect(response.status).toBe(200);
    expect(response.body.cancelRequestedAt).toBe('2026-03-07T10:05:00.000Z');
  });
});
