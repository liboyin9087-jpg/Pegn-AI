import type { Request } from 'express';

export function getWorkspaceIdFromRequest(req: Request): string | undefined {
  const queryWorkspaceId =
    typeof req.query.workspace_id === 'string'
      ? req.query.workspace_id
      : typeof req.query.workspaceId === 'string'
        ? req.query.workspaceId
        : undefined;

  return (
    req.params.workspace_id ||
    req.params.workspaceId ||
    req.body?.workspace_id ||
    req.body?.workspaceId ||
    queryWorkspaceId
  );
}

export function getWorkspaceIdFromBody(body: any): string | undefined {
  return body?.workspace_id || body?.workspaceId;
}

