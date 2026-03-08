import type { Request } from 'express';
import { updateDbRequestContext } from '../db/context.js';

export function getWorkspaceIdFromRequest(req: Request): string | undefined {
  const existing = (req as Request & { workspaceId?: string }).workspaceId;
  if (existing) {
    updateDbRequestContext({ workspaceId: existing });
    return existing;
  }

  const queryWorkspaceId =
    typeof req.query.workspace_id === 'string'
      ? req.query.workspace_id
      : typeof req.query.workspaceId === 'string'
        ? req.query.workspaceId
        : undefined;

  const workspaceId = (
    req.params.workspace_id ||
    req.params.workspaceId ||
    req.body?.workspace_id ||
    req.body?.workspaceId ||
    queryWorkspaceId
  );

  if (workspaceId) {
    (req as Request & { workspaceId?: string }).workspaceId = workspaceId;
    updateDbRequestContext({ workspaceId });
  }

  return workspaceId;
}

export function getWorkspaceIdFromBody(body: any): string | undefined {
  return body?.workspace_id || body?.workspaceId;
}
