import type { WorkspaceMembershipSummary, WorkspacePermissionSummary, WorkspaceRole } from '../lib/workspaceRoles.js';

declare global {
  namespace Express {
    interface Request {
      userRole?: WorkspaceRole;
      workspacePermissions?: WorkspacePermissionSummary;
      workspaceMembershipSummary?: WorkspaceMembershipSummary;
      userPermissions?: string[];
    }
  }
}

export {};
