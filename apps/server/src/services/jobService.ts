import crypto from 'node:crypto';
import { pool } from '../db/client.js';
import { runWithSystemDbContext } from '../db/context.js';

export type JobType =
  | 'document_index'
  | 'document_reindex'
  | 'agent_run'
  | 'automation_trigger';

export type JobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'timeout';

export type JobEventType =
  | 'queued'
  | 'started'
  | 'progress'
  | 'retry_requested'
  | 'retry_started'
  | 'cancel_requested'
  | 'cancelled'
  | 'failed'
  | 'completed'
  | 'timed_out';

export type JobTriggeredVia = 'manual' | 'schedule' | 'system' | null;

export interface JobRecord {
  id: string;
  workspaceId: string;
  jobType: JobType;
  resourceType?: string | null;
  resourceId?: string | null;
  sourceDomain: string;
  sourceRunId?: string | null;
  triggeredBy?: string | null;
  triggeredVia?: JobTriggeredVia;
  idempotencyKey?: string | null;
  correlationId?: string | null;
  retryOfJobId?: string | null;
  status: JobStatus;
  errorCode?: string | null;
  errorSummary?: string | null;
  metadata: Record<string, unknown>;
  startedAt?: string | null;
  finishedAt?: string | null;
  cancelRequestedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface JobEventRecord {
  id: string;
  jobId: string;
  sequenceNo: number;
  eventType: JobEventType;
  message?: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

interface JobRow {
  id: string;
  workspace_id: string;
  job_type: JobType;
  resource_type: string | null;
  resource_id: string | null;
  source_domain: string;
  source_run_id: string | null;
  triggered_by: string | null;
  triggered_via: JobTriggeredVia;
  idempotency_key: string | null;
  correlation_id: string | null;
  retry_of_job_id: string | null;
  status: JobStatus;
  error_code: string | null;
  error_summary: string | null;
  metadata: Record<string, unknown> | null;
  started_at: Date | null;
  finished_at: Date | null;
  cancel_requested_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface JobEventRow {
  id: string;
  job_id: string;
  sequence_no: number;
  event_type: JobEventType;
  message: string | null;
  payload: Record<string, unknown> | null;
  created_at: Date;
}

export interface CreateJobParams {
  workspaceId: string;
  jobType: JobType;
  resourceType?: string | null;
  resourceId?: string | null;
  sourceDomain: string;
  sourceRunId?: string | null;
  triggeredBy?: string | null;
  triggeredVia?: JobTriggeredVia;
  idempotencyKey?: string | null;
  correlationId?: string | null;
  retryOfJobId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface JobListQuery {
  status?: JobStatus;
  jobType?: JobType;
  resourceType?: string;
  resourceId?: string;
  cursor?: string;
  limit?: number;
}

export interface JobListResult {
  items: JobRecord[];
  nextCursor: string | null;
}

export interface WorkspaceJobSummary {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  timeout: number;
  byType: Record<JobType, number>;
  latestFailedAt: string | null;
}

type RetryOverrides = {
  triggeredBy?: string | null;
  triggeredVia?: JobTriggeredVia;
  correlationId?: string | null;
  metadata?: Record<string, unknown>;
};

const RETRYABLE_STATUSES: JobStatus[] = ['failed', 'timeout'];
const CANCELLABLE_STATUSES: JobStatus[] = ['queued', 'running'];

export class InvalidJobStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidJobStateError';
  }
}

function normalizeJob(row: JobRow): JobRecord {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    jobType: row.job_type,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    sourceDomain: row.source_domain,
    sourceRunId: row.source_run_id,
    triggeredBy: row.triggered_by,
    triggeredVia: row.triggered_via,
    idempotencyKey: row.idempotency_key,
    correlationId: row.correlation_id,
    retryOfJobId: row.retry_of_job_id,
    status: row.status,
    errorCode: row.error_code,
    errorSummary: row.error_summary,
    metadata: row.metadata ?? {},
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    cancelRequestedAt: row.cancel_requested_at ? row.cancel_requested_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function normalizeJobEvent(row: JobEventRow): JobEventRecord {
  return {
    id: row.id,
    jobId: row.job_id,
    sequenceNo: row.sequence_no,
    eventType: row.event_type,
    message: row.message,
    payload: row.payload ?? {},
    createdAt: row.created_at.toISOString(),
  };
}

function parseCursor(cursor?: string): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof decoded?.createdAt !== 'string' || typeof decoded?.id !== 'string') return null;
    return decoded;
  } catch {
    return null;
  }
}

function makeCursor(item?: JobRecord): string | null {
  if (!item) return null;
  return Buffer.from(JSON.stringify({ createdAt: item.createdAt, id: item.id }), 'utf8').toString('base64url');
}

async function loadJobRow(jobId: string, workspaceId?: string): Promise<JobRow | null> {
  const p = pool;
  if (!p) return null;

  const conditions = ['id = $1'];
  const values: unknown[] = [jobId];
  if (workspaceId) {
    conditions.push(`workspace_id = $2`);
    values.push(workspaceId);
  }

  const result = await p.query<JobRow>(
    `SELECT * FROM jobs WHERE ${conditions.join(' AND ')} LIMIT 1`,
    values
  );
  return result.rows[0] ?? null;
}

function assertStatus(actual: JobStatus, allowed: JobStatus[], message: string) {
  if (!allowed.includes(actual)) {
    throw new InvalidJobStateError(message);
  }
}

async function updateJobState(jobId: string, workspaceId: string, patch: {
  status?: JobStatus;
  errorCode?: string | null;
  errorSummary?: string | null;
  startedAt?: Date | null;
  finishedAt?: Date | null;
  cancelRequestedAt?: Date | null;
  metadata?: Record<string, unknown>;
}): Promise<JobRecord> {
  const p = pool;
  if (!p) {
    throw new Error('Database not available');
  }

  const fields: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  if (patch.status !== undefined) {
    fields.push(`status = $${index++}`);
    values.push(patch.status);
  }
  if (patch.errorCode !== undefined) {
    fields.push(`error_code = $${index++}`);
    values.push(patch.errorCode);
  }
  if (patch.errorSummary !== undefined) {
    fields.push(`error_summary = $${index++}`);
    values.push(patch.errorSummary);
  }
  if (patch.startedAt !== undefined) {
    fields.push(`started_at = $${index++}`);
    values.push(patch.startedAt);
  }
  if (patch.finishedAt !== undefined) {
    fields.push(`finished_at = $${index++}`);
    values.push(patch.finishedAt);
  }
  if (patch.cancelRequestedAt !== undefined) {
    fields.push(`cancel_requested_at = $${index++}`);
    values.push(patch.cancelRequestedAt);
  }
  if (patch.metadata !== undefined) {
    fields.push(`metadata = $${index++}::jsonb`);
    values.push(JSON.stringify(patch.metadata));
  }

  fields.push('updated_at = NOW()');
  values.push(jobId, workspaceId);

  const result = await p.query<JobRow>(
    `UPDATE jobs
     SET ${fields.join(', ')}
     WHERE id = $${index++}
       AND workspace_id = $${index}
     RETURNING *`,
    values
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Job not found');
  }
  return normalizeJob(row);
}

export async function appendJobEvent(params: {
  jobId: string;
  eventType: JobEventType;
  message?: string | null;
  payload?: Record<string, unknown>;
}): Promise<JobEventRecord> {
  const p = pool;
  if (!p) {
    throw new Error('Database not available');
  }

  const client = await p.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [params.jobId]);
    const nextSequence = await client.query<{ next_sequence: number }>(
      `SELECT COALESCE(MAX(sequence_no), 0) + 1 AS next_sequence
       FROM job_events
       WHERE job_id = $1`,
      [params.jobId]
    );

    const result = await client.query<JobEventRow>(
      `INSERT INTO job_events (id, job_id, sequence_no, event_type, message, payload)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       RETURNING *`,
      [
        crypto.randomUUID(),
        params.jobId,
        nextSequence.rows[0]?.next_sequence ?? 1,
        params.eventType,
        params.message ?? null,
        JSON.stringify(params.payload ?? {}),
      ]
    );
    await client.query('COMMIT');
    return normalizeJobEvent(result.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function createJob(params: CreateJobParams): Promise<JobRecord> {
  const p = pool;
  if (!p) {
    throw new Error('Database not available');
  }

  const result = await p.query<JobRow>(
    `INSERT INTO jobs (
       id,
       workspace_id,
       job_type,
       resource_type,
       resource_id,
       source_domain,
       source_run_id,
       triggered_by,
       triggered_via,
       idempotency_key,
       correlation_id,
       retry_of_job_id,
       status,
       metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'queued', $13::jsonb)
     RETURNING *`,
    [
      crypto.randomUUID(),
      params.workspaceId,
      params.jobType,
      params.resourceType ?? null,
      params.resourceId ?? null,
      params.sourceDomain,
      params.sourceRunId ?? null,
      params.triggeredBy ?? null,
      params.triggeredVia ?? null,
      params.idempotencyKey ?? null,
      params.correlationId ?? null,
      params.retryOfJobId ?? null,
      JSON.stringify(params.metadata ?? {}),
    ]
  );

  const job = normalizeJob(result.rows[0]);
  await appendJobEvent({
    jobId: job.id,
    eventType: params.retryOfJobId ? 'retry_started' : 'queued',
    message: params.retryOfJobId ? 'Retry job queued for processing' : 'Job queued for processing',
  });
  return job;
}

export async function startJob(jobId: string, workspaceId: string): Promise<JobRecord> {
  const current = await loadJobRow(jobId, workspaceId);
  if (!current) throw new Error('Job not found');
  assertStatus(current.status, ['queued'], 'This job cannot be started from its current state');

  const next = await updateJobState(jobId, workspaceId, {
    status: 'running',
    startedAt: current.started_at ?? new Date(),
    errorCode: null,
    errorSummary: null,
  });
  await appendJobEvent({ jobId, eventType: 'started', message: 'Job started' });
  return next;
}

export async function succeedJob(jobId: string, workspaceId: string, metadata?: Record<string, unknown>): Promise<JobRecord> {
  const current = await loadJobRow(jobId, workspaceId);
  if (!current) throw new Error('Job not found');
  assertStatus(current.status, ['running'], 'This job cannot be completed from its current state');

  const next = await updateJobState(jobId, workspaceId, {
    status: 'succeeded',
    finishedAt: new Date(),
    errorCode: null,
    errorSummary: null,
    metadata: metadata ?? current.metadata ?? {},
  });
  await appendJobEvent({ jobId, eventType: 'completed', message: 'Job completed successfully', payload: metadata });
  return next;
}

export async function failJob(jobId: string, workspaceId: string, params: {
  errorCode: string;
  errorSummary: string;
  metadata?: Record<string, unknown>;
}): Promise<JobRecord> {
  const current = await loadJobRow(jobId, workspaceId);
  if (!current) throw new Error('Job not found');
  assertStatus(current.status, ['queued', 'running'], 'This job cannot fail from its current state');

  const next = await updateJobState(jobId, workspaceId, {
    status: 'failed',
    errorCode: params.errorCode,
    errorSummary: params.errorSummary,
    finishedAt: new Date(),
    metadata: params.metadata ?? current.metadata ?? {},
  });
  await appendJobEvent({
    jobId,
    eventType: 'failed',
    message: params.errorSummary,
    payload: params.metadata ?? {},
  });
  return next;
}

export async function markTimeout(jobId: string, workspaceId: string, params?: {
  errorCode?: string;
  errorSummary?: string;
  metadata?: Record<string, unknown>;
}): Promise<JobRecord> {
  const current = await loadJobRow(jobId, workspaceId);
  if (!current) throw new Error('Job not found');
  assertStatus(current.status, ['running'], 'This job cannot time out from its current state');

  const next = await updateJobState(jobId, workspaceId, {
    status: 'timeout',
    errorCode: params?.errorCode ?? 'timeout',
    errorSummary: params?.errorSummary ?? 'Job execution timed out',
    finishedAt: new Date(),
    metadata: params?.metadata ?? current.metadata ?? {},
  });
  await appendJobEvent({
    jobId,
    eventType: 'timed_out',
    message: next.errorSummary ?? 'Job execution timed out',
    payload: params?.metadata ?? {},
  });
  return next;
}

export async function requestCancelJob(jobId: string, workspaceId: string): Promise<JobRecord> {
  const current = await loadJobRow(jobId, workspaceId);
  if (!current) throw new Error('Job not found');
  assertStatus(current.status, CANCELLABLE_STATUSES, 'This job cannot be retried or cancelled from its current state');

  const next = await updateJobState(jobId, workspaceId, {
    cancelRequestedAt: current.cancel_requested_at ?? new Date(),
  });
  await appendJobEvent({ jobId, eventType: 'cancel_requested', message: 'Cancellation requested' });
  return next;
}

export async function markCancelled(jobId: string, workspaceId: string, metadata?: Record<string, unknown>): Promise<JobRecord> {
  const current = await loadJobRow(jobId, workspaceId);
  if (!current) throw new Error('Job not found');
  assertStatus(current.status, CANCELLABLE_STATUSES, 'This job cannot be retried or cancelled from its current state');

  const next = await updateJobState(jobId, workspaceId, {
    status: 'cancelled',
    finishedAt: new Date(),
    cancelRequestedAt: current.cancel_requested_at ?? new Date(),
    metadata: metadata ?? current.metadata ?? {},
  });
  await appendJobEvent({ jobId, eventType: 'cancelled', message: 'Job cancelled', payload: metadata });
  return next;
}

export async function getWorkspaceJob(workspaceId: string, jobId: string): Promise<JobRecord | null> {
  const row = await loadJobRow(jobId, workspaceId);
  return row ? normalizeJob(row) : null;
}

export async function getJobBySourceRunId(sourceRunId: string, workspaceId: string, jobType?: JobType): Promise<JobRecord | null> {
  const p = pool;
  if (!p) return null;

  const conditions = ['source_run_id = $1', 'workspace_id = $2'];
  const values: unknown[] = [sourceRunId, workspaceId];
  if (jobType) {
    conditions.push(`job_type = $3`);
    values.push(jobType);
  }

  const result = await p.query<JobRow>(
    `SELECT *
     FROM jobs
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT 1`,
    values
  );
  return result.rows[0] ? normalizeJob(result.rows[0]) : null;
}

export async function getJobEvents(workspaceId: string, jobId: string): Promise<JobEventRecord[]> {
  const p = pool;
  if (!p) return [];

  const result = await p.query<JobEventRow>(
    `SELECT e.*
     FROM job_events e
     JOIN jobs j ON j.id = e.job_id
     WHERE e.job_id = $1
       AND j.workspace_id = $2
     ORDER BY e.sequence_no ASC`,
    [jobId, workspaceId]
  );
  return result.rows.map(normalizeJobEvent);
}

export async function listWorkspaceJobs(workspaceId: string, query: JobListQuery = {}): Promise<JobListResult> {
  const p = pool;
  if (!p) return { items: [], nextCursor: null };

  const conditions = ['workspace_id = $1'];
  const values: unknown[] = [workspaceId];
  let index = 2;

  if (query.status) {
    conditions.push(`status = $${index++}`);
    values.push(query.status);
  }
  if (query.jobType) {
    conditions.push(`job_type = $${index++}`);
    values.push(query.jobType);
  }
  if (query.resourceType) {
    conditions.push(`resource_type = $${index++}`);
    values.push(query.resourceType);
  }
  if (query.resourceId) {
    conditions.push(`resource_id = $${index++}`);
    values.push(query.resourceId);
  }

  const parsedCursor = parseCursor(query.cursor);
  if (parsedCursor) {
    conditions.push(`(created_at, id) < ($${index++}::timestamptz, $${index++}::uuid)`);
    values.push(parsedCursor.createdAt, parsedCursor.id);
  }

  const limit = Math.max(1, Math.min(100, query.limit ?? 20));
  values.push(limit + 1);

  const result = await p.query<JobRow>(
    `SELECT *
     FROM jobs
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT $${index}`,
    values
  );

  const items = result.rows.slice(0, limit).map(normalizeJob);
  return {
    items,
    nextCursor: result.rows.length > limit ? makeCursor(items[items.length - 1]) : null,
  };
}

export async function getWorkspaceJobSummary(workspaceId: string): Promise<WorkspaceJobSummary> {
  const p = pool;
  if (!p) {
    return {
      total: 0,
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
      timeout: 0,
      byType: {
        document_index: 0,
        document_reindex: 0,
        agent_run: 0,
        automation_trigger: 0,
      },
      latestFailedAt: null,
    };
  }

  const [statusResult, typeResult] = await Promise.all([
    p.query<{
      total: string;
      queued: string;
      running: string;
      succeeded: string;
      failed: string;
      cancelled: string;
      timeout: string;
      latest_failed_at: Date | null;
    }>(
      `SELECT
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'queued') AS queued,
         COUNT(*) FILTER (WHERE status = 'running') AS running,
         COUNT(*) FILTER (WHERE status = 'succeeded') AS succeeded,
         COUNT(*) FILTER (WHERE status = 'failed') AS failed,
         COUNT(*) FILTER (WHERE status = 'cancelled') AS cancelled,
         COUNT(*) FILTER (WHERE status = 'timeout') AS timeout,
         MAX(CASE WHEN status IN ('failed', 'timeout') THEN finished_at ELSE NULL END) AS latest_failed_at
       FROM jobs
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
    p.query<{ job_type: JobType; count: string }>(
      `SELECT job_type, COUNT(*) AS count
       FROM jobs
       WHERE workspace_id = $1
       GROUP BY job_type`,
      [workspaceId]
    ),
  ]);

  const row = statusResult.rows[0];
  const byType: WorkspaceJobSummary['byType'] = {
    document_index: 0,
    document_reindex: 0,
    agent_run: 0,
    automation_trigger: 0,
  };
  for (const item of typeResult.rows) {
    byType[item.job_type] = parseInt(item.count, 10);
  }

  return {
    total: parseInt(row?.total ?? '0', 10),
    queued: parseInt(row?.queued ?? '0', 10),
    running: parseInt(row?.running ?? '0', 10),
    succeeded: parseInt(row?.succeeded ?? '0', 10),
    failed: parseInt(row?.failed ?? '0', 10),
    cancelled: parseInt(row?.cancelled ?? '0', 10),
    timeout: parseInt(row?.timeout ?? '0', 10),
    byType,
    latestFailedAt: row?.latest_failed_at ? row.latest_failed_at.toISOString() : null,
  };
}

export async function retryJob(workspaceId: string, jobId: string, overrides: RetryOverrides = {}): Promise<JobRecord> {
  const current = await loadJobRow(jobId, workspaceId);
  if (!current) throw new Error('Job not found');
  assertStatus(current.status, RETRYABLE_STATUSES, 'This job cannot be retried from its current state');

  await appendJobEvent({ jobId, eventType: 'retry_requested', message: 'Retry requested' });
  return createJob({
    workspaceId,
    jobType: current.job_type,
    resourceType: current.resource_type,
    resourceId: current.resource_id,
    sourceDomain: current.source_domain,
    sourceRunId: current.source_run_id,
    triggeredBy: overrides.triggeredBy ?? current.triggered_by,
    triggeredVia: overrides.triggeredVia ?? current.triggered_via,
    correlationId: overrides.correlationId ?? current.correlation_id,
    retryOfJobId: current.id,
    metadata: {
      ...(current.metadata ?? {}),
      ...(overrides.metadata ?? {}),
    },
  });
}

export async function isCancelRequested(jobId: string, workspaceId: string): Promise<boolean> {
  const row = await loadJobRow(jobId, workspaceId);
  return Boolean(row?.cancel_requested_at);
}

export async function recoverRunningJobsOnBoot(): Promise<number> {
  return runWithSystemDbContext({}, async () => {
    const p = pool;
    if (!p) return 0;

    const result = await p.query<JobRow>(
      `UPDATE jobs
       SET status = 'failed',
           error_code = 'server_restart',
           error_summary = COALESCE(error_summary, 'Job interrupted by server restart'),
           finished_at = NOW(),
           updated_at = NOW()
       WHERE status = 'running'
       RETURNING *`
    );

    for (const row of result.rows) {
      await appendJobEvent({
        jobId: row.id,
        eventType: 'failed',
        message: 'Job interrupted by server restart',
        payload: { recovery: 'boot' },
      }).catch(() => undefined);
    }

    return result.rows.length;
  });
}
