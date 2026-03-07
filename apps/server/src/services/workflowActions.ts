import { Buffer } from 'node:buffer';
import { pool } from '../db/client.js';
import { recordAuditLog } from './admin.js';
import { getRunById, rerunAgentRun } from './agent.js';
import { dispatchAutomationExecution } from './automation.js';
import { createInboxNotification } from './inboxService.js';
import { getWorkspaceJob, type JobRecord } from './jobService.js';
import { listWorkspaceAdmins } from '../lib/workspaceRoles.js';
import { DocumentModel } from '../models/document.js';
import { searchService } from './search.js';
import {
  createAdminTarget,
  createAgentTarget,
  createDocumentTarget,
  createOperationsTarget,
  createSearchTarget,
  type SurfaceLinkTarget,
} from './surfaceTargets.js';

export type WorkflowActionType =
  | 'document_reindex'
  | 'bulk_document_reindex'
  | 'agent_rerun'
  | 'automation_trigger';

export type WorkflowTargetType = 'document' | 'documentSet' | 'agentRun' | 'automation';
export type WorkflowApprovalMode = 'not_required' | 'single_approver';
export type WorkflowActionStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'executing'
  | 'executed'
  | 'execution_failed'
  | 'cancelled';

export interface WorkflowActorSummary {
  userId: string | null;
  displayName: string;
}

export interface WorkflowApprovalDecision {
  approvalId: string;
  approverUserId: string;
  decision: 'approved' | 'rejected';
  comment: string | null;
  createdAt: string;
}

export interface WorkflowActionSummary {
  actionId: string;
  workspaceId: string;
  actionType: WorkflowActionType;
  targetType: WorkflowTargetType;
  targetId: string;
  status: WorkflowActionStatus;
  approvalMode: WorkflowApprovalMode;
  summary: string;
  requestedBy: WorkflowActorSummary;
  approvedBy?: WorkflowActorSummary | null;
  executedJobId?: string | null;
  executedRunId?: string | null;
  executionErrorSummary?: string | null;
  threadId?: string | null;
  sourceTarget: SurfaceLinkTarget;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowActionDetail extends WorkflowActionSummary {
  payload: Record<string, unknown>;
  rejectedBy?: WorkflowActorSummary | null;
  cancelledBy?: WorkflowActorSummary | null;
  approvalHistory: WorkflowApprovalDecision[];
}

interface WorkflowActionRow {
  id: string;
  workspace_id: string;
  action_type: WorkflowActionType;
  target_type: WorkflowTargetType;
  target_id: string;
  status: WorkflowActionStatus;
  approval_mode: WorkflowApprovalMode;
  requested_by_user_id: string;
  submitted_at: Date | null;
  approved_by_user_id: string | null;
  approved_at: Date | null;
  rejected_by_user_id: string | null;
  rejected_at: Date | null;
  cancelled_by_user_id: string | null;
  cancelled_at: Date | null;
  executed_job_id: string | null;
  executed_run_id: string | null;
  execution_error_summary: string | null;
  summary: string;
  payload: Record<string, unknown> | null;
  thread_id: string | null;
  created_at: Date;
  updated_at: Date;
}

interface WorkflowApprovalRow {
  id: string;
  action_id: string;
  workspace_id: string;
  approver_user_id: string;
  decision: 'approved' | 'rejected';
  comment: string | null;
  created_at: Date;
}

interface UserSummaryRow {
  id: string;
  display_name: string;
}

export interface WorkflowActionListResult {
  items: WorkflowActionSummary[];
  nextCursor: string | null;
}

export class InvalidWorkflowActionStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidWorkflowActionStateError';
  }
}

function assertPool() {
  if (!pool) throw new Error('Database not initialized');
  return pool;
}

function sanitizeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseCursor(cursor?: string | null): { createdAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (typeof parsed?.createdAt !== 'string' || typeof parsed?.id !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function makeCursor(item?: WorkflowActionSummary): string | null {
  if (!item) return null;
  return Buffer.from(JSON.stringify({ createdAt: item.createdAt, id: item.actionId }), 'utf8').toString('base64url');
}

function assertStatus(actual: WorkflowActionStatus, allowed: WorkflowActionStatus[], message: string) {
  if (!allowed.includes(actual)) {
    throw new InvalidWorkflowActionStateError(message);
  }
}

function normalizeApprovalMode(actionType: WorkflowActionType): WorkflowApprovalMode {
  switch (actionType) {
    case 'document_reindex':
    case 'agent_rerun':
      return 'not_required';
    case 'bulk_document_reindex':
    case 'automation_trigger':
      return 'single_approver';
    default:
      return 'not_required';
  }
}

export function determineApprovalMode(actionType: WorkflowActionType): WorkflowApprovalMode {
  return normalizeApprovalMode(actionType);
}

function normalizePayload(actionType: WorkflowActionType, payload: unknown): Record<string, unknown> {
  const record = toRecord(payload);
  switch (actionType) {
    case 'document_reindex':
      return {};
    case 'bulk_document_reindex': {
      const documentIds = Array.isArray(record.documentIds)
        ? record.documentIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        : [];
      if (documentIds.length === 0) throw new Error('bulk_document_reindex requires payload.documentIds');
      return { documentIds };
    }
    case 'agent_rerun':
      return {};
    case 'automation_trigger':
      return {
        payload: toRecord(record.payload),
      };
    default:
      return {};
  }
}

async function getUserSummaries(userIds: string[]): Promise<Map<string, WorkflowActorSummary>> {
  const db = assertPool();
  if (userIds.length === 0) return new Map();
  const uniqueIds = [...new Set(userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return new Map();
  const result = await db.query<UserSummaryRow>(
    `SELECT id, COALESCE(name, email, id::text) AS display_name
     FROM users
     WHERE id = ANY($1::uuid[])`,
    [uniqueIds]
  );
  return new Map(result.rows.map((row) => [row.id, { userId: row.id, displayName: row.display_name }]));
}

function actorFor(userId: string | null, users: Map<string, WorkflowActorSummary>): WorkflowActorSummary | null {
  if (!userId) return null;
  return users.get(userId) ?? { userId, displayName: userId };
}

export function buildWorkflowSourceTarget(action: Pick<WorkflowActionRow, 'action_type' | 'target_type' | 'target_id' | 'executed_job_id' | 'executed_run_id'>): SurfaceLinkTarget {
  switch (action.target_type) {
    case 'document':
      return createDocumentTarget({ documentId: action.target_id });
    case 'documentSet':
      return createSearchTarget({ filter: 'documents' });
    case 'agentRun':
      return createAgentTarget({
        runId: action.executed_run_id ?? action.target_id,
        jobId: action.executed_job_id,
      });
    case 'automation':
      return createOperationsTarget({
        jobId: action.executed_job_id,
        jobType: 'automation_trigger',
        resourceType: 'automation',
        resourceId: action.target_id,
      });
    default:
      return createAdminTarget('summary');
  }
}

function buildWorkflowActionSummaryText(actionType: WorkflowActionType, targetId: string): string {
  switch (actionType) {
    case 'document_reindex':
      return `Reindex document ${targetId}`;
    case 'bulk_document_reindex':
      return `Reindex selected documents`;
    case 'agent_rerun':
      return `Rerun agent run ${targetId}`;
    case 'automation_trigger':
      return `Trigger automation ${targetId}`;
    default:
      return `Workflow action ${actionType}`;
  }
}

export function buildWorkflowActionSummary(row: WorkflowActionRow, users: Map<string, WorkflowActorSummary>): WorkflowActionSummary {
  return {
    actionId: row.id,
    workspaceId: row.workspace_id,
    actionType: row.action_type,
    targetType: row.target_type,
    targetId: row.target_id,
    status: row.status,
    approvalMode: row.approval_mode,
    summary: row.summary,
    requestedBy: actorFor(row.requested_by_user_id, users) ?? { userId: row.requested_by_user_id, displayName: row.requested_by_user_id },
    approvedBy: actorFor(row.approved_by_user_id, users),
    executedJobId: row.executed_job_id,
    executedRunId: row.executed_run_id,
    executionErrorSummary: row.execution_error_summary,
    threadId: row.thread_id,
    sourceTarget: buildWorkflowSourceTarget(row),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function getWorkflowActionRow(workspaceId: string, actionId: string): Promise<WorkflowActionRow | null> {
  const db = assertPool();
  const result = await db.query<WorkflowActionRow>(
    `SELECT *
     FROM workflow_actions
     WHERE id = $1
       AND workspace_id = $2
     LIMIT 1`,
    [actionId, workspaceId]
  );
  return result.rows[0] ?? null;
}

async function getWorkflowApprovalHistory(actionId: string): Promise<WorkflowApprovalDecision[]> {
  const db = assertPool();
  const result = await db.query<WorkflowApprovalRow>(
    `SELECT *
     FROM workflow_approvals
     WHERE action_id = $1
     ORDER BY created_at DESC, id DESC`,
    [actionId]
  );
  return result.rows.map((row) => ({
    approvalId: row.id,
    approverUserId: row.approver_user_id,
    decision: row.decision,
    comment: row.comment,
    createdAt: row.created_at.toISOString(),
  }));
}

async function updateWorkflowActionState(
  workspaceId: string,
  actionId: string,
  patch: {
    status?: WorkflowActionStatus;
    approvedByUserId?: string | null;
    approvedAt?: Date | null;
    rejectedByUserId?: string | null;
    rejectedAt?: Date | null;
    cancelledByUserId?: string | null;
    cancelledAt?: Date | null;
    submittedAt?: Date | null;
    executedJobId?: string | null;
    executedRunId?: string | null;
    executionErrorSummary?: string | null;
    payload?: Record<string, unknown>;
    summary?: string;
    threadId?: string | null;
  }
): Promise<WorkflowActionRow> {
  const db = assertPool();
  const fields: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  const appendField = (column: string, value: unknown, cast?: string) => {
    fields.push(`${column} = $${index++}${cast ?? ''}`);
    values.push(value);
  };

  if (patch.status !== undefined) appendField('status', patch.status);
  if (patch.approvedByUserId !== undefined) appendField('approved_by_user_id', patch.approvedByUserId);
  if (patch.approvedAt !== undefined) appendField('approved_at', patch.approvedAt);
  if (patch.rejectedByUserId !== undefined) appendField('rejected_by_user_id', patch.rejectedByUserId);
  if (patch.rejectedAt !== undefined) appendField('rejected_at', patch.rejectedAt);
  if (patch.cancelledByUserId !== undefined) appendField('cancelled_by_user_id', patch.cancelledByUserId);
  if (patch.cancelledAt !== undefined) appendField('cancelled_at', patch.cancelledAt);
  if (patch.submittedAt !== undefined) appendField('submitted_at', patch.submittedAt);
  if (patch.executedJobId !== undefined) appendField('executed_job_id', patch.executedJobId);
  if (patch.executedRunId !== undefined) appendField('executed_run_id', patch.executedRunId);
  if (patch.executionErrorSummary !== undefined) appendField('execution_error_summary', patch.executionErrorSummary);
  if (patch.payload !== undefined) appendField('payload', JSON.stringify(patch.payload), '::jsonb');
  if (patch.summary !== undefined) appendField('summary', patch.summary);
  if (patch.threadId !== undefined) appendField('thread_id', patch.threadId);

  fields.push('updated_at = NOW()');
  values.push(actionId, workspaceId);

  const result = await db.query<WorkflowActionRow>(
    `UPDATE workflow_actions
     SET ${fields.join(', ')}
     WHERE id = $${index++}
       AND workspace_id = $${index}
     RETURNING *`,
    values
  );
  if (!result.rows[0]) throw new Error('Workflow action not found');
  return result.rows[0];
}

async function validateTargetExists(workspaceId: string, actionType: WorkflowActionType, targetType: WorkflowTargetType, targetId: string): Promise<void> {
  const db = assertPool();
  switch (targetType) {
    case 'document': {
      const document = await DocumentModel.findById(targetId);
      if (!document || document.workspace_id !== workspaceId) throw new Error('Target not found');
      return;
    }
    case 'agentRun': {
      const run = await getRunById(targetId);
      if (!run || run.workspaceId !== workspaceId) throw new Error('Target not found');
      return;
    }
    case 'automation': {
      const result = await db.query<{ id: string }>(
        `SELECT id
         FROM automations
         WHERE id = $1
           AND workspace_id = $2
         LIMIT 1`,
        [targetId, workspaceId]
      );
      if (!result.rows[0]) throw new Error('Target not found');
      return;
    }
    case 'documentSet': {
      if (actionType !== 'bulk_document_reindex') throw new Error('Target not found');
      return;
    }
    default:
      throw new Error('Target not found');
  }
}

async function notifyApprovers(action: WorkflowActionRow): Promise<void> {
  const admins = await listWorkspaceAdmins(action.workspace_id);
  const recipients = admins.filter((userId) => userId !== action.requested_by_user_id);
  await Promise.all(
    recipients.map((userId) =>
      createInboxNotification({
        workspaceId: action.workspace_id,
        userId,
        type: 'approval_requested',
        payload: {
          action_id: action.id,
          action_type: action.action_type,
          summary: action.summary,
          source_target: buildWorkflowSourceTarget(action),
        },
      }).catch(() => null)
    )
  );
}

async function notifyRequester(action: WorkflowActionRow, type: 'approval_rejected' | 'execution_failed'): Promise<void> {
  await createInboxNotification({
    workspaceId: action.workspace_id,
    userId: action.requested_by_user_id,
    type,
    payload: {
      action_id: action.id,
      action_type: action.action_type,
      summary: action.summary,
      execution_error_summary: action.execution_error_summary,
      source_target: buildWorkflowSourceTarget(action),
      job_id: action.executed_job_id,
      run_id: action.executed_run_id,
    },
  }).catch(() => null);
}

async function appendApprovalDecision(params: {
  actionId: string;
  workspaceId: string;
  approverUserId: string;
  decision: 'approved' | 'rejected';
  comment?: string | null;
}): Promise<void> {
  const db = assertPool();
  await db.query(
    `INSERT INTO workflow_approvals (id, action_id, workspace_id, approver_user_id, decision, comment)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5)`,
    [params.actionId, params.workspaceId, params.approverUserId, params.decision, sanitizeString(params.comment)]
  );
}

async function shapeWorkflowActionDetail(row: WorkflowActionRow): Promise<WorkflowActionDetail> {
  const approvalHistory = await getWorkflowApprovalHistory(row.id);
  const userIds = [
    row.requested_by_user_id,
    row.approved_by_user_id,
    row.rejected_by_user_id,
    row.cancelled_by_user_id,
    ...approvalHistory.map((item) => item.approverUserId),
  ].filter((value): value is string => Boolean(value));
  const users = await getUserSummaries(userIds);
  const summary = buildWorkflowActionSummary(row, users);
  return {
    ...summary,
    payload: row.payload ?? {},
    rejectedBy: actorFor(row.rejected_by_user_id, users),
    cancelledBy: actorFor(row.cancelled_by_user_id, users),
    approvalHistory,
  };
}

export async function listWorkflowActions(params: {
  workspaceId: string;
  status?: WorkflowActionStatus | null;
  actionType?: WorkflowActionType | null;
  requestedByUserId?: string | null;
  approvalsPendingForUserId?: string | null;
  cursor?: string | null;
  limit?: number;
}): Promise<WorkflowActionListResult> {
  const db = assertPool();
  const conditions = ['workspace_id = $1'];
  const values: unknown[] = [params.workspaceId];
  let index = 2;

  if (params.status) {
    conditions.push(`status = $${index++}`);
    values.push(params.status);
  }
  if (params.actionType) {
    conditions.push(`action_type = $${index++}`);
    values.push(params.actionType);
  }
  if (params.requestedByUserId) {
    conditions.push(`requested_by_user_id = $${index++}`);
    values.push(params.requestedByUserId);
  }
  if (params.approvalsPendingForUserId) {
    conditions.push(`status = 'pending_approval'`);
    conditions.push(`requested_by_user_id <> $${index++}`);
    values.push(params.approvalsPendingForUserId);
  }

  const cursor = parseCursor(params.cursor);
  if (cursor) {
    conditions.push(`(created_at, id) < ($${index++}::timestamptz, $${index++}::uuid)`);
    values.push(cursor.createdAt, cursor.id);
  }

  const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
  values.push(limit + 1);

  const result = await db.query<WorkflowActionRow>(
    `SELECT *
     FROM workflow_actions
     WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT $${index}`,
    values
  );
  const rows = result.rows.slice(0, limit);
  const userIds = [...new Set(rows.flatMap((row) => [row.requested_by_user_id, row.approved_by_user_id].filter(Boolean) as string[]))];
  const users = await getUserSummaries(userIds);
  const items = rows.map((row) => buildWorkflowActionSummary(row, users));
  return {
    items,
    nextCursor: result.rows.length > limit ? makeCursor(items.at(-1)) : null,
  };
}

export async function getWorkflowActionDetail(workspaceId: string, actionId: string): Promise<WorkflowActionDetail | null> {
  const row = await getWorkflowActionRow(workspaceId, actionId);
  if (!row) return null;
  return shapeWorkflowActionDetail(row);
}

export async function createWorkflowActionDraft(params: {
  workspaceId: string;
  actionType: WorkflowActionType;
  targetType: WorkflowTargetType;
  targetId: string;
  requestedByUserId: string;
  payload?: unknown;
  summary?: string | null;
  threadId?: string | null;
}): Promise<WorkflowActionDetail> {
  const db = assertPool();
  await validateTargetExists(params.workspaceId, params.actionType, params.targetType, params.targetId);
  const approvalMode = determineApprovalMode(params.actionType);
  const payload = normalizePayload(params.actionType, params.payload);
  const result = await db.query<WorkflowActionRow>(
    `INSERT INTO workflow_actions (
       id,
       workspace_id,
       action_type,
       target_type,
       target_id,
       status,
       approval_mode,
       requested_by_user_id,
       summary,
       payload,
       thread_id
     ) VALUES (
       gen_random_uuid(),
       $1, $2, $3, $4,
       'draft',
       $5,
       $6,
       $7,
       $8::jsonb,
       $9
     )
     RETURNING *`,
    [
      params.workspaceId,
      params.actionType,
      params.targetType,
      params.targetId,
      approvalMode,
      params.requestedByUserId,
      sanitizeString(params.summary) ?? buildWorkflowActionSummaryText(params.actionType, params.targetId),
      JSON.stringify(payload),
      sanitizeString(params.threadId),
    ]
  );
  return shapeWorkflowActionDetail(result.rows[0]);
}

export async function updateWorkflowActionDraft(params: {
  workspaceId: string;
  actionId: string;
  requestedByUserId: string;
  payload?: unknown;
  summary?: string | null;
  threadId?: string | null;
}): Promise<WorkflowActionDetail | null> {
  const existing = await getWorkflowActionRow(params.workspaceId, params.actionId);
  if (!existing) return null;
  if (existing.requested_by_user_id !== params.requestedByUserId) throw new Error('FORBIDDEN');
  assertStatus(existing.status, ['draft'], 'Only draft workflow actions can be updated');
  const payload = params.payload === undefined
    ? (existing.payload ?? {})
    : normalizePayload(existing.action_type, params.payload);
  const updated = await updateWorkflowActionState(params.workspaceId, params.actionId, {
    payload,
    summary: params.summary === undefined ? existing.summary : sanitizeString(params.summary) ?? existing.summary,
    threadId: params.threadId === undefined ? existing.thread_id : sanitizeString(params.threadId),
  });
  return shapeWorkflowActionDetail(updated);
}

async function dispatchDocumentReindex(action: WorkflowActionRow): Promise<{ executedJobId: string | null; executedRunId: string | null }> {
  const dispatch = await searchService.enqueueDocumentReindex(action.target_id, action.workspace_id, {
    triggeredBy: action.requested_by_user_id,
    triggeredVia: 'manual',
  });
  return { executedJobId: dispatch.jobId, executedRunId: null };
}

async function dispatchBulkDocumentReindex(action: WorkflowActionRow): Promise<{ executedJobId: string | null; executedRunId: string | null }> {
  const payload = toRecord(action.payload);
  const documentIds = Array.isArray(payload.documentIds)
    ? payload.documentIds.filter((value): value is string => typeof value === 'string')
    : [];
  let firstJobId: string | null = null;
  for (const documentId of documentIds) {
    const dispatch = await searchService.enqueueDocumentReindex(documentId, action.workspace_id, {
      triggeredBy: action.requested_by_user_id,
      triggeredVia: 'manual',
    });
    if (!firstJobId) firstJobId = dispatch.jobId;
  }
  return { executedJobId: firstJobId, executedRunId: null };
}

async function dispatchAgentRerun(action: WorkflowActionRow): Promise<{ executedJobId: string | null; executedRunId: string | null }> {
  const run = await rerunAgentRun(action.target_id, action.workspace_id, action.requested_by_user_id);
  return { executedJobId: run.jobId ?? null, executedRunId: run.id };
}

async function dispatchAutomationTrigger(action: WorkflowActionRow): Promise<{ executedJobId: string | null; executedRunId: string | null }> {
  const db = assertPool();
  const automationResult = await db.query<any>(
    `SELECT *
     FROM automations
     WHERE id = $1
       AND workspace_id = $2
     LIMIT 1`,
    [action.target_id, action.workspace_id]
  );
  const automation = automationResult.rows[0];
  if (!automation) throw new Error('Target not found');
  const payload = toRecord(action.payload).payload;
  const dispatch = await dispatchAutomationExecution(
    automation,
    {
      type: automation.trigger_type,
      workspaceId: automation.workspace_id,
      payload: toRecord(payload),
      triggeredBy: action.requested_by_user_id,
    },
    'manual'
  );
  return { executedJobId: dispatch.jobId, executedRunId: null };
}

export async function syncWorkflowExecutionOutcome(workspaceId: string, actionId: string): Promise<WorkflowActionDetail | null> {
  const action = await getWorkflowActionRow(workspaceId, actionId);
  if (!action) return null;
  if (action.status !== 'executing') {
    return shapeWorkflowActionDetail(action);
  }

  if (action.action_type === 'agent_rerun' && action.executed_run_id) {
    const run = await getRunById(action.executed_run_id);
    if (!run) return shapeWorkflowActionDetail(action);
    if (run.workspaceId !== workspaceId) return shapeWorkflowActionDetail(action);
    if (run.status === 'completed') {
      const updated = await updateWorkflowActionState(workspaceId, actionId, { status: 'executed' });
      await recordAuditLog({
        workspaceId,
        actorId: action.requested_by_user_id,
        actorDisplay: action.requested_by_user_id,
        eventType: 'workflow_action_executed',
        targetType: action.target_type,
        targetId: action.target_id,
        summary: `Workflow action executed: ${action.summary}`,
        metadata: { actionId: action.id, runId: run.id, jobId: updated.executed_job_id },
      });
      return shapeWorkflowActionDetail(updated);
    }
    if (run.status === 'failed') {
      const updated = await updateWorkflowActionState(workspaceId, actionId, {
        status: 'execution_failed',
        executionErrorSummary: run.errorSummary ?? 'Agent rerun failed',
      });
      await notifyRequester(updated, 'execution_failed');
      await recordAuditLog({
        workspaceId,
        actorId: action.requested_by_user_id,
        actorDisplay: action.requested_by_user_id,
        eventType: 'workflow_action_execution_failed',
        targetType: action.target_type,
        targetId: action.target_id,
        summary: `Workflow action failed: ${action.summary}`,
        metadata: { actionId: action.id, runId: run.id, errorSummary: updated.execution_error_summary },
      });
      return shapeWorkflowActionDetail(updated);
    }
    return shapeWorkflowActionDetail(action);
  }

  if (action.executed_job_id) {
    const job = await getWorkspaceJob(workspaceId, action.executed_job_id);
    if (!job) return shapeWorkflowActionDetail(action);
    if (job.status === 'succeeded') {
      const updated = await updateWorkflowActionState(workspaceId, actionId, { status: 'executed' });
      await recordAuditLog({
        workspaceId,
        actorId: action.requested_by_user_id,
        actorDisplay: action.requested_by_user_id,
        eventType: 'workflow_action_executed',
        targetType: action.target_type,
        targetId: action.target_id,
        summary: `Workflow action executed: ${action.summary}`,
        metadata: { actionId: action.id, jobId: job.id },
      });
      return shapeWorkflowActionDetail(updated);
    }
    if (job.status === 'failed' || job.status === 'timeout' || job.status === 'cancelled') {
      const updated = await updateWorkflowActionState(workspaceId, actionId, {
        status: 'execution_failed',
        executionErrorSummary: job.errorSummary ?? 'Workflow execution failed',
      });
      await notifyRequester(updated, 'execution_failed');
      await recordAuditLog({
        workspaceId,
        actorId: action.requested_by_user_id,
        actorDisplay: action.requested_by_user_id,
        eventType: 'workflow_action_execution_failed',
        targetType: action.target_type,
        targetId: action.target_id,
        summary: `Workflow action failed: ${action.summary}`,
        metadata: { actionId: action.id, jobId: job.id, errorSummary: updated.execution_error_summary },
      });
      return shapeWorkflowActionDetail(updated);
    }
  }

  return shapeWorkflowActionDetail(action);
}

export async function dispatchWorkflowExecution(workspaceId: string, actionId: string): Promise<WorkflowActionDetail> {
  const action = await getWorkflowActionRow(workspaceId, actionId);
  if (!action) throw new Error('Workflow action not found');
  assertStatus(action.status, ['approved', 'executing'], 'Only approved workflow actions can execute');
  const current = action.status === 'approved'
    ? await updateWorkflowActionState(workspaceId, actionId, { status: 'executing' })
    : action;

  let executedJobId: string | null = current.executed_job_id;
  let executedRunId: string | null = current.executed_run_id;

  if (!executedJobId && !executedRunId) {
    const dispatched = await (async () => {
      switch (current.action_type) {
        case 'document_reindex':
          return dispatchDocumentReindex(current);
        case 'bulk_document_reindex':
          return dispatchBulkDocumentReindex(current);
        case 'agent_rerun':
          return dispatchAgentRerun(current);
        case 'automation_trigger':
          return dispatchAutomationTrigger(current);
      }
    })();
    executedJobId = dispatched.executedJobId;
    executedRunId = dispatched.executedRunId;
    await updateWorkflowActionState(workspaceId, actionId, {
      status: 'executing',
      executedJobId,
      executedRunId,
      executionErrorSummary: null,
    });
  }

  const synced = await syncWorkflowExecutionOutcome(workspaceId, actionId);
  return synced ?? shapeWorkflowActionDetail(current);
}

export async function submitWorkflowAction(params: {
  workspaceId: string;
  actionId: string;
  requestedByUserId: string;
}): Promise<WorkflowActionDetail> {
  const action = await getWorkflowActionRow(params.workspaceId, params.actionId);
  if (!action) throw new Error('Workflow action not found');
  if (action.requested_by_user_id !== params.requestedByUserId) throw new Error('FORBIDDEN');
  assertStatus(action.status, ['draft'], 'Only draft workflow actions can be submitted');

  if (action.approval_mode === 'not_required') {
    let updated = await updateWorkflowActionState(params.workspaceId, params.actionId, {
      status: 'approved',
      submittedAt: new Date(),
    });
    await recordAuditLog({
      workspaceId: params.workspaceId,
      actorId: params.requestedByUserId,
      actorDisplay: params.requestedByUserId,
      eventType: 'workflow_action_submitted',
      targetType: action.target_type,
      targetId: action.target_id,
      summary: `Workflow action submitted: ${action.summary}`,
      metadata: { actionId: action.id, approvalMode: action.approval_mode },
    });
    updated = await getWorkflowActionRow(params.workspaceId, params.actionId) ?? updated;
    return dispatchWorkflowExecution(params.workspaceId, updated.id);
  }

  const updated = await updateWorkflowActionState(params.workspaceId, params.actionId, {
    status: 'pending_approval',
    submittedAt: new Date(),
  });
  await notifyApprovers(updated);
  await recordAuditLog({
    workspaceId: params.workspaceId,
    actorId: params.requestedByUserId,
    actorDisplay: params.requestedByUserId,
    eventType: 'workflow_action_submitted',
    targetType: action.target_type,
    targetId: action.target_id,
    summary: `Workflow action submitted: ${action.summary}`,
    metadata: { actionId: action.id, approvalMode: action.approval_mode },
  });
  return shapeWorkflowActionDetail(updated);
}

export async function approveWorkflowAction(params: {
  workspaceId: string;
  actionId: string;
  approverUserId: string;
}): Promise<WorkflowActionDetail> {
  const action = await getWorkflowActionRow(params.workspaceId, params.actionId);
  if (!action) throw new Error('Workflow action not found');
  assertStatus(action.status, ['pending_approval'], 'Only pending workflow actions can be approved');

  await appendApprovalDecision({
    actionId: action.id,
    workspaceId: action.workspace_id,
    approverUserId: params.approverUserId,
    decision: 'approved',
  });
  const updated = await updateWorkflowActionState(params.workspaceId, params.actionId, {
    status: 'approved',
    approvedByUserId: params.approverUserId,
    approvedAt: new Date(),
  });
  await recordAuditLog({
    workspaceId: params.workspaceId,
    actorId: params.approverUserId,
    actorDisplay: params.approverUserId,
    eventType: 'workflow_action_approved',
    targetType: action.target_type,
    targetId: action.target_id,
    summary: `Workflow action approved: ${action.summary}`,
    metadata: { actionId: action.id },
  });
  return dispatchWorkflowExecution(params.workspaceId, updated.id);
}

export async function rejectWorkflowAction(params: {
  workspaceId: string;
  actionId: string;
  approverUserId: string;
  comment?: string | null;
}): Promise<WorkflowActionDetail> {
  const action = await getWorkflowActionRow(params.workspaceId, params.actionId);
  if (!action) throw new Error('Workflow action not found');
  assertStatus(action.status, ['pending_approval'], 'Only pending workflow actions can be rejected');

  await appendApprovalDecision({
    actionId: action.id,
    workspaceId: action.workspace_id,
    approverUserId: params.approverUserId,
    decision: 'rejected',
    comment: params.comment,
  });
  const updated = await updateWorkflowActionState(params.workspaceId, params.actionId, {
    status: 'rejected',
    rejectedByUserId: params.approverUserId,
    rejectedAt: new Date(),
  });
  await notifyRequester(updated, 'approval_rejected');
  await recordAuditLog({
    workspaceId: params.workspaceId,
    actorId: params.approverUserId,
    actorDisplay: params.approverUserId,
    eventType: 'workflow_action_rejected',
    targetType: action.target_type,
    targetId: action.target_id,
    summary: `Workflow action rejected: ${action.summary}`,
    metadata: { actionId: action.id, comment: sanitizeString(params.comment) },
  });
  return shapeWorkflowActionDetail(updated);
}

export async function cancelWorkflowAction(params: {
  workspaceId: string;
  actionId: string;
  requesterUserId: string;
}): Promise<WorkflowActionDetail> {
  const action = await getWorkflowActionRow(params.workspaceId, params.actionId);
  if (!action) throw new Error('Workflow action not found');
  if (action.requested_by_user_id !== params.requesterUserId) throw new Error('FORBIDDEN');
  assertStatus(action.status, ['draft', 'pending_approval'], 'This workflow action cannot be cancelled from its current state');

  const updated = await updateWorkflowActionState(params.workspaceId, params.actionId, {
    status: 'cancelled',
    cancelledByUserId: params.requesterUserId,
    cancelledAt: new Date(),
  });
  await recordAuditLog({
    workspaceId: params.workspaceId,
    actorId: params.requesterUserId,
    actorDisplay: params.requesterUserId,
    eventType: 'workflow_action_cancelled',
    targetType: action.target_type,
    targetId: action.target_id,
    summary: `Workflow action cancelled: ${action.summary}`,
    metadata: { actionId: action.id },
  });
  return shapeWorkflowActionDetail(updated);
}
