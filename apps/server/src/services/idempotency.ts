import type { Request } from 'express';
import { pool } from '../db/client.js';
import { observability } from './observability.js';

export interface IdempotentReplay {
  status_code: number;
  response: any;
}

export interface IdempotencyScope {
  userId: string;
  workspaceId: string;
  operation: string;
  idempotencyKey: string;
}

export function getIdempotencyKeyFromRequest(req: Request): string | undefined {
  const header = req.headers['x-idempotency-key'];
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw || typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function getIdempotentReplay(scope: IdempotencyScope): Promise<IdempotentReplay | null> {
  const p = pool;
  if (!p) return null;

  const result = await p.query(
    `SELECT status_code, response
     FROM api_idempotency_keys
     WHERE user_id = $1
       AND workspace_id = $2
       AND operation = $3
       AND idempotency_key = $4
     LIMIT 1`,
    [scope.userId, scope.workspaceId, scope.operation, scope.idempotencyKey]
  );

  if ((result.rowCount ?? 0) === 0) return null;
  return {
    status_code: result.rows[0].status_code,
    response: result.rows[0].response
  };
}

export async function storeIdempotentReplay(
  scope: IdempotencyScope,
  statusCode: number,
  response: any
): Promise<void> {
  const p = pool;
  if (!p) return;

  try {
    await p.query(
      `INSERT INTO api_idempotency_keys (user_id, workspace_id, operation, idempotency_key, status_code, response)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (user_id, workspace_id, operation, idempotency_key)
       DO UPDATE SET status_code = EXCLUDED.status_code, response = EXCLUDED.response`,
      [scope.userId, scope.workspaceId, scope.operation, scope.idempotencyKey, statusCode, JSON.stringify(response ?? {})]
    );
  } catch (error) {
    observability.warn('Failed to store idempotent replay', {
      error,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
      operation: scope.operation
    });
  }
}
