/**
 * audit.ts — P0 Security: Audit Logging Service
 *
 * Provides append-only audit log for security-sensitive actions:
 * - workspace member role changes
 * - member invite/removal
 * - workspace deletion
 * - RBAC permission changes
 * - sensitive admin operations
 */

import { pool } from '../db/client.js';
import { observability } from './observability.js';
import type { Request } from 'express';

export type AuditAction =
  | 'member.invited'
  | 'member.role_changed'
  | 'member.removed'
  | 'workspace.created'
  | 'workspace.deleted'
  | 'document.deleted'
  | 'collection.deleted'
  | 'rbac.denied'
  | 'billing.plan_changed'
  | 'auth.login'
  | 'auth.logout';

export interface AuditEntry {
  workspaceId?: string;
  actorUserId?: string;
  action: AuditAction;
  resourceType?: string;
  resourceId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  req?: Request;
}

/**
 * Appends an immutable audit log entry. Fire-and-forget — never throws.
 */
export async function auditLog(entry: AuditEntry): Promise<void> {
  const p = pool;
  if (!p) return;

  try {
    const ipAddress = entry.req
      ? (entry.req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
        entry.req.socket.remoteAddress ??
        null
      : null;
    const userAgent = entry.req ? (entry.req.headers['user-agent'] ?? null) : null;

    await p.query(
      `INSERT INTO audit_logs
         (workspace_id, actor_user_id, action, resource_type, resource_id,
          old_value, new_value, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)`,
      [
        entry.workspaceId ?? null,
        entry.actorUserId ?? null,
        entry.action,
        entry.resourceType ?? null,
        entry.resourceId ?? null,
        entry.oldValue ? JSON.stringify(entry.oldValue) : null,
        entry.newValue ? JSON.stringify(entry.newValue) : null,
        ipAddress,
        userAgent,
      ]
    );
  } catch (err) {
    // Never let audit logging crash the main request
    observability.error('auditLog write failed', { action: entry.action, err });
  }
}

/**
 * Query audit logs for a workspace (admin only).
 */
export async function queryAuditLogs(
  workspaceId: string,
  options: { action?: string; limit?: number; before?: string } = {}
): Promise<any[]> {
  const p = pool;
  if (!p) return [];

  const { action, limit = 100, before } = options;
  const params: any[] = [workspaceId];
  let sql = `SELECT al.*, u.email AS actor_email, u.name AS actor_name
             FROM audit_logs al
             LEFT JOIN users u ON al.actor_user_id = u.id
             WHERE al.workspace_id = $1`;

  if (action) {
    params.push(action);
    sql += ` AND al.action = $${params.length}`;
  }
  if (before) {
    params.push(before);
    sql += ` AND al.created_at < $${params.length}`;
  }

  params.push(Math.min(limit, 500));
  sql += ` ORDER BY al.created_at DESC LIMIT $${params.length}`;

  const result = await p.query(sql, params);
  return result.rows;
}
