import { Buffer } from 'node:buffer';
import { pool } from '../db/client.js';
import { getWorkspaceJobSummary, type WorkspaceJobSummary } from './jobService.js';
import { searchService } from './search.js';

export type AuditEventType =
  | 'workspace_updated'
  | 'member_invited'
  | 'invite_revoked'
  | 'member_role_changed'
  | 'member_removed'
  | 'document_deleted'
  | 'document_reindexed'
  | 'agent_run_rerun'
  | 'automation_triggered'
  | 'quota_alert_raised';

export interface AuditLogItem {
  id: string;
  actorId: string | null;
  actorDisplay: string;
  eventType: AuditEventType;
  targetType: string;
  targetId: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface AuditLogListResult {
  items: AuditLogItem[];
  nextCursor: string | null;
}

export interface UsageQuotaSummary {
  documentsLimit: number | null;
  storageBytesLimit: number | null;
  agentRunsMonthlyLimit: number | null;
  percentUsed: number;
  thresholdReached: boolean;
}

export interface UsageSummary {
  documentsCount: number;
  indexedDocumentsCount: number;
  agentRunsLast7d: number;
  agentRunsLast30d: number;
  failedJobsLast7d: number;
  failedJobsLast30d: number;
  artifactsBytes: number;
  quota: UsageQuotaSummary;
  quotaStatus: 'ok' | 'warning' | 'exceeded';
}

export interface AdminAlert {
  id: string;
  type: 'recent_failed_jobs_spike' | 'stale_documents_present' | 'indexing_failures_present' | 'quota_threshold_reached';
  severity: 'info' | 'warning' | 'critical';
  title: string;
  description: string;
  relatedTargetType: string | null;
  relatedTargetId: string | null;
  createdAt: string;
}

export interface AdminSummary {
  workspace: {
    id: string;
    name: string;
    description: string | null;
    updatedAt: string | null;
  } | null;
  memberCounts: {
    membersTotal: number;
  };
  documentsSummary: {
    documentsTotal: number;
    indexedDocumentsTotal: number;
    staleDocumentsTotal: number;
  };
  searchSummary: {
    totalDocuments: number;
    pendingDocuments: number;
    indexedDocuments: number;
    staleDocuments: number;
    failedDocuments: number;
    lastIndexedAt: string | null;
  };
  agentSummary: {
    agentRunsLast7d: number;
    agentRunsLast30d: number;
  };
  jobsSummary: WorkspaceJobSummary;
  usageSummary: UsageSummary;
  alertsSummary: {
    total: number;
    critical: number;
    warning: number;
  };
}

interface AuditLogCursor {
  createdAt: string;
  id: string;
}

function encodeCursor(cursor: AuditLogCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

function decodeCursor(cursor?: string | null): AuditLogCursor | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!parsed || typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function rowCount(result: { rowCount?: number | null; rows?: unknown[] }): number {
  if (typeof result.rowCount === 'number') return result.rowCount;
  return Array.isArray(result.rows) ? result.rows.length : 0;
}

function numberValue(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function computeQuotaSummary(params: {
  documentsCount: number;
  artifactsBytes: number;
  agentRunsLast30d: number;
  documentsLimit: number | null;
  storageBytesLimit: number | null;
  agentRunsMonthlyLimit: number | null;
}): { quota: UsageQuotaSummary; quotaStatus: UsageSummary['quotaStatus'] } {
  const ratios = [
    params.documentsLimit ? params.documentsCount / params.documentsLimit : 0,
    params.storageBytesLimit ? params.artifactsBytes / params.storageBytesLimit : 0,
    params.agentRunsMonthlyLimit ? params.agentRunsLast30d / params.agentRunsMonthlyLimit : 0,
  ];
  const percentUsed = Math.max(0, Math.round(Math.max(...ratios) * 100));
  const thresholdReached = percentUsed >= 80;
  const quotaStatus: UsageSummary['quotaStatus'] =
    percentUsed >= 100 ? 'exceeded' : thresholdReached ? 'warning' : 'ok';

  return {
    quota: {
      documentsLimit: params.documentsLimit,
      storageBytesLimit: params.storageBytesLimit,
      agentRunsMonthlyLimit: params.agentRunsMonthlyLimit,
      percentUsed,
      thresholdReached,
    },
    quotaStatus,
  };
}

function normalizeAuditRow(row: Record<string, unknown>): AuditLogItem {
  return {
    id: String(row.id),
    actorId: row.actor_id ? String(row.actor_id) : null,
    actorDisplay: String(row.actor_display ?? 'System'),
    eventType: row.event_type as AuditEventType,
    targetType: String(row.target_type ?? ''),
    targetId: row.target_id ? String(row.target_id) : null,
    summary: String(row.summary ?? ''),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

export async function recordAuditLog(params: {
  workspaceId: string;
  actorId?: string | null;
  actorDisplay: string;
  eventType: AuditEventType;
  targetType: string;
  targetId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const p = pool;
  if (!p) return;

  await p.query(
    `INSERT INTO audit_logs
      (workspace_id, actor_id, actor_display, event_type, target_type, target_id, summary, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
    [
      params.workspaceId,
      params.actorId ?? null,
      params.actorDisplay,
      params.eventType,
      params.targetType,
      params.targetId ?? null,
      params.summary,
      JSON.stringify(params.metadata ?? {}),
    ]
  );
}

export async function listWorkspaceAuditLogs(params: {
  workspaceId: string;
  eventType?: AuditEventType | null;
  targetType?: string | null;
  cursor?: string | null;
  limit?: number;
}): Promise<AuditLogListResult> {
  const p = pool;
  if (!p) return { items: [], nextCursor: null };

  const clauses = ['workspace_id = $1'];
  const values: unknown[] = [params.workspaceId];
  let idx = 2;

  if (params.eventType) {
    clauses.push(`event_type = $${idx++}`);
    values.push(params.eventType);
  }
  if (params.targetType) {
    clauses.push(`target_type = $${idx++}`);
    values.push(params.targetType);
  }

  const cursor = decodeCursor(params.cursor);
  if (cursor) {
    clauses.push(`(created_at, id) < ($${idx++}::timestamptz, $${idx++}::uuid)`);
    values.push(cursor.createdAt, cursor.id);
  }

  const limit = Math.max(1, Math.min(params.limit ?? 20, 100));
  values.push(limit + 1);

  const result = await p.query(
    `SELECT id, actor_id, actor_display, event_type, target_type, target_id, summary, metadata, created_at
     FROM audit_logs
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC, id DESC
     LIMIT $${idx}`,
    values
  );

  const rows = result.rows.map(normalizeAuditRow);
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);

  return {
    items,
    nextCursor: hasMore && last
      ? encodeCursor({ createdAt: last.createdAt, id: last.id })
      : null,
  };
}

export async function getWorkspaceUsageSummary(workspaceId: string): Promise<UsageSummary> {
  const p = pool;
  if (!p) {
    return {
      documentsCount: 0,
      indexedDocumentsCount: 0,
      agentRunsLast7d: 0,
      agentRunsLast30d: 0,
      failedJobsLast7d: 0,
      failedJobsLast30d: 0,
      artifactsBytes: 0,
      quota: {
        documentsLimit: null,
        storageBytesLimit: null,
        agentRunsMonthlyLimit: null,
        percentUsed: 0,
        thresholdReached: false,
      },
      quotaStatus: 'ok',
    };
  }

  const [documentsResult, artifactsResult, agentRunsResult, jobsFailedResult, quotaLimitResult, usageResult, searchSummary] = await Promise.all([
    p.query(
      `SELECT
          COUNT(*)::int AS documents_count,
          COUNT(*) FILTER (WHERE index_status = 'indexed')::int AS indexed_documents_count
       FROM documents
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
    p.query(
      `SELECT COALESCE(SUM(size), 0)::bigint AS artifacts_bytes
       FROM agent_artifacts
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
    p.query(
      `SELECT
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS runs_7d,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days')::int AS runs_30d
       FROM agent_runs
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
    p.query(
      `SELECT
          COUNT(*) FILTER (WHERE status IN ('failed', 'timeout') AND created_at >= NOW() - INTERVAL '7 days')::int AS failed_7d,
          COUNT(*) FILTER (WHERE status IN ('failed', 'timeout') AND created_at >= NOW() - INTERVAL '30 days')::int AS failed_30d
       FROM jobs
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
    p.query(
      `SELECT ai_tokens_per_month, ai_calls_per_day, agent_runs_per_day, cost_usd_ceiling
       FROM quota_limits
       WHERE workspace_id = $1
       LIMIT 1`,
      [workspaceId]
    ),
    p.query(
      `SELECT
          COALESCE(SUM(amount) FILTER (WHERE resource_type = 'agent_runs' AND period >= TO_CHAR(CURRENT_DATE - INTERVAL '29 days', 'YYYY-MM-DD')), 0)::int AS agent_runs_last_30d
       FROM usage_records
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
    searchService.getIndexStatusSummary(workspaceId),
  ]);

  const docsRow = documentsResult.rows[0] ?? {};
  const runsRow = agentRunsResult.rows[0] ?? {};
  const failedRow = jobsFailedResult.rows[0] ?? {};
  const quotaRow = quotaLimitResult.rows[0] ?? {};
  const usageRow = usageResult.rows[0] ?? {};

  const documentsCount = numberValue(docsRow.documents_count);
  const indexedDocumentsCount = numberValue(docsRow.indexed_documents_count);
  const artifactsBytes = numberValue(artifactsResult.rows[0]?.artifacts_bytes);
  const agentRunsLast7d = numberValue(runsRow.runs_7d);
  const agentRunsLast30d = Math.max(numberValue(runsRow.runs_30d), numberValue(usageRow.agent_runs_last_30d));
  const failedJobsLast7d = numberValue(failedRow.failed_7d);
  const failedJobsLast30d = numberValue(failedRow.failed_30d);
  const documentsLimit = null;
  const storageBytesLimit = null;
  const agentRunsMonthlyLimit = quotaRow.agent_runs_per_day ? numberValue(quotaRow.agent_runs_per_day) * 30 : null;
  const { quota, quotaStatus } = computeQuotaSummary({
    documentsCount,
    artifactsBytes,
    agentRunsLast30d,
    documentsLimit,
    storageBytesLimit,
    agentRunsMonthlyLimit,
  });

  return {
    documentsCount,
    indexedDocumentsCount: Math.max(indexedDocumentsCount, searchSummary.indexedDocuments),
    agentRunsLast7d,
    agentRunsLast30d,
    failedJobsLast7d,
    failedJobsLast30d,
    artifactsBytes,
    quota,
    quotaStatus,
  };
}

export async function getWorkspaceAdminAlerts(workspaceId: string): Promise<{ items: AdminAlert[] }> {
  const [usageSummary, searchSummary, jobsSummary] = await Promise.all([
    getWorkspaceUsageSummary(workspaceId),
    searchService.getIndexStatusSummary(workspaceId),
    getWorkspaceJobSummary(workspaceId),
  ]);

  const now = new Date().toISOString();
  const items: AdminAlert[] = [];

  if (usageSummary.failedJobsLast7d >= 5) {
    items.push({
      id: `failed-jobs-${workspaceId}`,
      type: 'recent_failed_jobs_spike',
      severity: usageSummary.failedJobsLast7d >= 10 ? 'critical' : 'warning',
      title: 'Recent failed jobs spike',
      description: `${usageSummary.failedJobsLast7d} jobs failed in the last 7 days.`,
      relatedTargetType: 'job',
      relatedTargetId: jobsSummary.latestFailedAt ?? null,
      createdAt: jobsSummary.latestFailedAt ?? now,
    });
  }

  if (searchSummary.staleDocuments > 0) {
    items.push({
      id: `stale-docs-${workspaceId}`,
      type: 'stale_documents_present',
      severity: 'warning',
      title: 'Stale documents present',
      description: `${searchSummary.staleDocuments} documents need reindexing.`,
      relatedTargetType: 'search',
      relatedTargetId: workspaceId,
      createdAt: now,
    });
  }

  if (searchSummary.failedDocuments > 0) {
    items.push({
      id: `index-failures-${workspaceId}`,
      type: 'indexing_failures_present',
      severity: 'critical',
      title: 'Indexing failures present',
      description: `${searchSummary.failedDocuments} documents are in failed indexing state.`,
      relatedTargetType: 'search',
      relatedTargetId: workspaceId,
      createdAt: now,
    });
  }

  if (usageSummary.quota.thresholdReached) {
    items.push({
      id: `quota-threshold-${workspaceId}`,
      type: 'quota_threshold_reached',
      severity: usageSummary.quotaStatus === 'exceeded' ? 'critical' : 'warning',
      title: 'Quota threshold reached',
      description: `Workspace usage is at ${usageSummary.quota.percentUsed}% of the current tracked quota.`,
      relatedTargetType: 'quota',
      relatedTargetId: workspaceId,
      createdAt: now,
    });
  }

  return { items };
}

export async function getWorkspaceAdminSummary(workspaceId: string): Promise<AdminSummary> {
  const p = pool;
  if (!p) {
    const emptyJobsSummary = await getWorkspaceJobSummary(workspaceId);
    const emptyUsage = await getWorkspaceUsageSummary(workspaceId);
    return {
      workspace: null,
      memberCounts: { membersTotal: 0 },
      documentsSummary: { documentsTotal: 0, indexedDocumentsTotal: 0, staleDocumentsTotal: 0 },
      searchSummary: {
        totalDocuments: 0,
        pendingDocuments: 0,
        indexedDocuments: 0,
        staleDocuments: 0,
        failedDocuments: 0,
        lastIndexedAt: null,
      },
      agentSummary: { agentRunsLast7d: 0, agentRunsLast30d: 0 },
      jobsSummary: emptyJobsSummary,
      usageSummary: emptyUsage,
      alertsSummary: { total: 0, critical: 0, warning: 0 },
    };
  }

  const [workspaceResult, memberResult, usageSummary, searchSummary, jobsSummary, alerts] = await Promise.all([
    p.query(
      `SELECT id, name, description, updated_at
       FROM workspaces
       WHERE id = $1
       LIMIT 1`,
      [workspaceId]
    ),
    p.query(
      `SELECT COUNT(*)::int AS members_total
       FROM workspace_members
       WHERE workspace_id = $1`,
      [workspaceId]
    ),
    getWorkspaceUsageSummary(workspaceId),
    searchService.getIndexStatusSummary(workspaceId),
    getWorkspaceJobSummary(workspaceId),
    getWorkspaceAdminAlerts(workspaceId),
  ]);

  const workspaceRow = workspaceResult.rows[0];
  const alertsSummary = alerts.items.reduce(
    (acc, alert) => {
      acc.total += 1;
      if (alert.severity === 'critical') acc.critical += 1;
      if (alert.severity === 'warning') acc.warning += 1;
      return acc;
    },
    { total: 0, critical: 0, warning: 0 }
  );

  return {
    workspace: workspaceRow
      ? {
          id: String(workspaceRow.id),
          name: String(workspaceRow.name),
          description: workspaceRow.description ? String(workspaceRow.description) : null,
          updatedAt: workspaceRow.updated_at instanceof Date
            ? workspaceRow.updated_at.toISOString()
            : workspaceRow.updated_at
              ? String(workspaceRow.updated_at)
              : null,
        }
      : null,
    memberCounts: {
      membersTotal: numberValue(memberResult.rows[0]?.members_total),
    },
    documentsSummary: {
      documentsTotal: usageSummary.documentsCount,
      indexedDocumentsTotal: usageSummary.indexedDocumentsCount,
      staleDocumentsTotal: searchSummary.staleDocuments,
    },
    searchSummary,
    agentSummary: {
      agentRunsLast7d: usageSummary.agentRunsLast7d,
      agentRunsLast30d: usageSummary.agentRunsLast30d,
    },
    jobsSummary,
    usageSummary,
    alertsSummary,
  };
}
