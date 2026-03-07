import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPoolQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();

const mockPool = {
  query: mockPoolQuery,
  connect: vi.fn(async () => ({
    query: mockClientQuery,
    release: mockClientRelease,
  })),
};

vi.mock('../../db/client.js', () => ({
  pool: mockPool,
}));

function makeJobRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'job-1',
    workspace_id: 'ws-1',
    job_type: 'agent_run',
    resource_type: 'agent_run',
    resource_id: 'run-1',
    source_domain: 'agent',
    source_run_id: 'run-1',
    triggered_by: 'user-1',
    triggered_via: 'manual',
    idempotency_key: null,
    correlation_id: null,
    retry_of_job_id: null,
    status: 'queued',
    error_code: null,
    error_summary: null,
    metadata: {},
    started_at: null,
    finished_at: null,
    cancel_requested_at: null,
    created_at: new Date('2026-03-07T10:00:00.000Z'),
    updated_at: new Date('2026-03-07T10:00:00.000Z'),
    ...overrides,
  };
}

function makeEventRow(sequenceNo: number, eventType: string) {
  return {
    id: `event-${sequenceNo}`,
    job_id: 'job-1',
    sequence_no: sequenceNo,
    event_type: eventType,
    message: `${eventType} message`,
    payload: {},
    created_at: new Date(`2026-03-07T10:00:0${Math.min(sequenceNo, 9)}.000Z`),
  };
}

function queueAppendEvent(sequenceNo: number, eventType: string) {
  mockClientQuery
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({ rows: [{ next_sequence: sequenceNo }] })
    .mockResolvedValueOnce({ rows: [makeEventRow(sequenceNo, eventType)] })
    .mockResolvedValueOnce(undefined);
}

describe('jobService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a queued job and appends the first event', async () => {
    queueAppendEvent(1, 'queued');
    mockPoolQuery.mockResolvedValueOnce({ rows: [makeJobRow()] });

    const { createJob } = await import('../jobService.js');
    const job = await createJob({
      workspaceId: 'ws-1',
      jobType: 'agent_run',
      sourceDomain: 'agent',
      sourceRunId: 'run-1',
    });

    expect(job.status).toBe('queued');
    expect(mockPoolQuery).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO jobs'), expect.any(Array));
    expect(mockClientQuery).toHaveBeenCalledWith(expect.stringContaining('SELECT COALESCE(MAX(sequence_no), 0) + 1'), ['job-1']);
  });

  it('transitions queued -> running -> succeeded', async () => {
    queueAppendEvent(1, 'started');
    queueAppendEvent(2, 'completed');
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: 'queued' })] })
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: 'running', started_at: new Date('2026-03-07T10:00:01.000Z') })] })
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: 'running', started_at: new Date('2026-03-07T10:00:01.000Z') })] })
      .mockResolvedValueOnce({ rows: [makeJobRow({
        status: 'succeeded',
        started_at: new Date('2026-03-07T10:00:01.000Z'),
        finished_at: new Date('2026-03-07T10:00:10.000Z'),
      })] });

    const { startJob, succeedJob } = await import('../jobService.js');
    const started = await startJob('job-1', 'ws-1');
    const completed = await succeedJob('job-1', 'ws-1');

    expect(started.status).toBe('running');
    expect(completed.status).toBe('succeeded');
    expect(completed.finishedAt).toBe('2026-03-07T10:00:10.000Z');
  });

  it('fails jobs with structured error fields', async () => {
    queueAppendEvent(1, 'failed');
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: 'running', started_at: new Date('2026-03-07T10:00:01.000Z') })] })
      .mockResolvedValueOnce({ rows: [makeJobRow({
        status: 'failed',
        error_code: 'runtime_error',
        error_summary: 'Provider timeout',
        started_at: new Date('2026-03-07T10:00:01.000Z'),
        finished_at: new Date('2026-03-07T10:00:10.000Z'),
      })] });

    const { failJob } = await import('../jobService.js');
    const failed = await failJob('job-1', 'ws-1', {
      errorCode: 'runtime_error',
      errorSummary: 'Provider timeout',
    });

    expect(failed.status).toBe('failed');
    expect(failed.errorCode).toBe('runtime_error');
    expect(failed.errorSummary).toBe('Provider timeout');
  });

  it('requests cancellation and then marks cancelled', async () => {
    queueAppendEvent(1, 'cancel_requested');
    queueAppendEvent(2, 'cancelled');
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: 'running', started_at: new Date('2026-03-07T10:00:01.000Z') })] })
      .mockResolvedValueOnce({ rows: [makeJobRow({
        status: 'running',
        started_at: new Date('2026-03-07T10:00:01.000Z'),
        cancel_requested_at: new Date('2026-03-07T10:00:05.000Z'),
      })] })
      .mockResolvedValueOnce({ rows: [makeJobRow({
        status: 'running',
        started_at: new Date('2026-03-07T10:00:01.000Z'),
        cancel_requested_at: new Date('2026-03-07T10:00:05.000Z'),
      })] })
      .mockResolvedValueOnce({ rows: [makeJobRow({
        status: 'cancelled',
        started_at: new Date('2026-03-07T10:00:01.000Z'),
        cancel_requested_at: new Date('2026-03-07T10:00:05.000Z'),
        finished_at: new Date('2026-03-07T10:00:08.000Z'),
      })] });

    const { requestCancelJob, markCancelled } = await import('../jobService.js');
    const requested = await requestCancelJob('job-1', 'ws-1');
    const cancelled = await markCancelled('job-1', 'ws-1');

    expect(requested.cancelRequestedAt).toBe('2026-03-07T10:00:05.000Z');
    expect(cancelled.status).toBe('cancelled');
  });

  it('retries by creating a new queued job with retry_of_job_id', async () => {
    queueAppendEvent(1, 'retry_requested');
    queueAppendEvent(2, 'retry_started');
    mockPoolQuery
      .mockResolvedValueOnce({ rows: [makeJobRow({ status: 'failed', error_code: 'runtime_error', error_summary: 'Boom' })] })
      .mockResolvedValueOnce({ rows: [makeJobRow({
        id: 'job-2',
        status: 'queued',
        retry_of_job_id: 'job-1',
      })] });

    const { retryJob } = await import('../jobService.js');
    const next = await retryJob('ws-1', 'job-1');

    expect(next.id).toBe('job-2');
    expect(next.retryOfJobId).toBe('job-1');
    expect(next.status).toBe('queued');
  });

  it('returns workspace summary counts', async () => {
    mockPoolQuery
      .mockResolvedValueOnce({
        rows: [{
          total: '4',
          queued: '1',
          running: '1',
          succeeded: '1',
          failed: '1',
          cancelled: '0',
          timeout: '0',
          latest_failed_at: new Date('2026-03-07T10:00:10.000Z'),
        }],
      })
      .mockResolvedValueOnce({
        rows: [
          { job_type: 'agent_run', count: '2' },
          { job_type: 'document_reindex', count: '1' },
          { job_type: 'automation_trigger', count: '1' },
        ],
      });

    const { getWorkspaceJobSummary } = await import('../jobService.js');
    const summary = await getWorkspaceJobSummary('ws-1');

    expect(summary).toEqual({
      total: 4,
      queued: 1,
      running: 1,
      succeeded: 1,
      failed: 1,
      cancelled: 0,
      timeout: 0,
      byType: {
        document_index: 0,
        document_reindex: 1,
        agent_run: 2,
        automation_trigger: 1,
      },
      latestFailedAt: '2026-03-07T10:00:10.000Z',
    });
  });
});
