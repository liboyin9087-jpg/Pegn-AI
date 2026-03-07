import { pool } from '../db/client.js';

export type WorkspaceRole = 'owner' | 'admin' | 'editor' | 'viewer';

export interface WorkspacePermissionSummary {
  canViewWorkspace: boolean;
  canManageMembers: boolean;
  canManageSettings: boolean;
  canEditDocuments: boolean;
  canDeleteDocuments: boolean;
  canRunAutomation: boolean;
  canCollaborate: boolean;
  canManageAssignments: boolean;
}

export interface WorkspaceMembershipSummary {
  effectiveRole: WorkspaceRole;
  permissions: string[];
  permissionSummary: WorkspacePermissionSummary;
}

export interface WorkspaceRoleInfo extends WorkspaceMembershipSummary {
  user_id: string;
  workspace_id: string;
  legacy_role: string | null;
  role_name: string | null;
  is_admin: boolean;
}

export const ROLE_PERMISSION_MATRIX: Record<WorkspaceRole, WorkspacePermissionSummary> = {
  owner: {
    canViewWorkspace: true,
    canManageMembers: true,
    canManageSettings: true,
    canEditDocuments: true,
    canDeleteDocuments: true,
    canRunAutomation: true,
    canCollaborate: true,
    canManageAssignments: true,
  },
  admin: {
    canViewWorkspace: true,
    canManageMembers: true,
    canManageSettings: true,
    canEditDocuments: true,
    canDeleteDocuments: true,
    canRunAutomation: true,
    canCollaborate: true,
    canManageAssignments: true,
  },
  editor: {
    canViewWorkspace: true,
    canManageMembers: false,
    canManageSettings: false,
    canEditDocuments: true,
    canDeleteDocuments: true,
    canRunAutomation: true,
    canCollaborate: true,
    canManageAssignments: true,
  },
  viewer: {
    canViewWorkspace: true,
    canManageMembers: false,
    canManageSettings: false,
    canEditDocuments: false,
    canDeleteDocuments: false,
    canRunAutomation: false,
    canCollaborate: false,
    canManageAssignments: false,
  },
};

const CAPABILITY_PERMISSION_MAP: Record<keyof WorkspacePermissionSummary, string[]> = {
  canViewWorkspace: [
    'workspace:read',
    'collection:view',
    'document:view',
    'comment:view',
  ],
  canManageMembers: [
    'workspace:members:manage',
  ],
  canManageSettings: [
    'workspace:admin',
    'workspace:settings:update',
  ],
  canEditDocuments: [
    'collection:create',
    'collection:edit',
    'document:create',
    'document:edit',
    'comment:create',
    'comment:resolve',
  ],
  canDeleteDocuments: [
    'collection:delete',
    'document:delete',
  ],
  canRunAutomation: [
    'agent:run',
    'automation:trigger',
  ],
  canCollaborate: [
    'thread:view',
    'thread:create',
    'thread:comment',
    'thread:resolve',
  ],
  canManageAssignments: [
    'thread:assign',
  ],
};

const LEGACY_ROLE_ALIASES: Record<string, WorkspaceRole> = {
  owner: 'owner',
  admin: 'admin',
  editor: 'editor',
  viewer: 'viewer',
};

function getResultRowCount(result: { rowCount?: number | null; rows?: unknown[] }): number {
  if (typeof result.rowCount === 'number') return result.rowCount;
  return Array.isArray(result.rows) ? result.rows.length : 0;
}

function normalizeWorkspaceRole(role: string | null | undefined): WorkspaceRole | null {
  if (!role) return null;
  const normalized = String(role).trim().toLowerCase();
  return LEGACY_ROLE_ALIASES[normalized] ?? null;
}

function buildPermissionsFromSummary(permissionSummary: WorkspacePermissionSummary): string[] {
  return (Object.keys(permissionSummary) as (keyof WorkspacePermissionSummary)[])
    .flatMap((capability) => (permissionSummary[capability] ? CAPABILITY_PERMISSION_MAP[capability] : []));
}

function mergePermissions(base: string[], extra: string[]): string[] {
  return Array.from(new Set([...base, ...extra]));
}

export function getWorkspacePermissions(role: WorkspaceRole): WorkspacePermissionSummary {
  return { ...ROLE_PERMISSION_MATRIX[role] };
}

export function hasWorkspaceCapability(
  roleOrPermissions: WorkspaceRole | WorkspacePermissionSummary,
  capability: keyof WorkspacePermissionSummary
): boolean {
  const permissionSummary = typeof roleOrPermissions === 'string'
    ? getWorkspacePermissions(roleOrPermissions)
    : roleOrPermissions;
  return permissionSummary[capability];
}

export function getLegacyPermissions(role: string | null | undefined): string[] {
  const normalizedRole = normalizeWorkspaceRole(role);
  if (!normalizedRole) return [];
  return buildPermissionsFromSummary(getWorkspacePermissions(normalizedRole));
}

export function getWorkspaceMembershipSummary(params: {
  roleName?: string | null;
  legacyWorkspaceRole?: string | null;
  permissions?: string[] | null;
}): WorkspaceMembershipSummary | null {
  const effectiveRole =
    normalizeWorkspaceRole(params.roleName)
    ?? normalizeWorkspaceRole(params.legacyWorkspaceRole);

  if (!effectiveRole) return null;

  const permissionSummary = getWorkspacePermissions(effectiveRole);
  const compatibilityPermissions = buildPermissionsFromSummary(permissionSummary);
  const permissions = mergePermissions(compatibilityPermissions, params.permissions ?? []);

  return {
    effectiveRole,
    permissions,
    permissionSummary,
  };
}

function parsePermissions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function mapRowToRoleInfo(row: {
  user_id?: string;
  workspace_id?: string;
  legacy_role: string | null;
  role_name: string | null;
  permissions?: unknown;
}, workspaceId?: string, userId?: string): WorkspaceRoleInfo | null {
  const permissions = parsePermissions(row.permissions);
  const membership = getWorkspaceMembershipSummary({
    roleName: row.role_name,
    legacyWorkspaceRole: row.legacy_role,
    permissions,
  });

  if (!membership) return null;

  return {
    user_id: row.user_id ?? userId ?? '',
    workspace_id: row.workspace_id ?? workspaceId ?? '',
    legacy_role: row.legacy_role,
    role_name: row.role_name,
    effectiveRole: membership.effectiveRole,
    permissions: membership.permissions,
    permissionSummary: membership.permissionSummary,
    is_admin: membership.effectiveRole === 'owner' || membership.effectiveRole === 'admin',
  };
}

export async function getWorkspaceRole(workspaceId: string, userId: string): Promise<WorkspaceRoleInfo | null> {
  const p = pool;
  if (!p) return null;

  const result = await p.query<{
    user_id: string;
    workspace_id: string;
    legacy_role: string | null;
    role_name: string | null;
    permissions: unknown;
  }>(
    `SELECT
        m.user_id,
        m.workspace_id,
        m.role AS legacy_role,
        r.name AS role_name,
        r.permissions
     FROM workspace_members m
     LEFT JOIN roles r ON m.role_id = r.id
     WHERE m.user_id = $1 AND m.workspace_id = $2
     LIMIT 1`,
    [userId, workspaceId]
  );

  if (getResultRowCount(result) === 0) return null;
  return mapRowToRoleInfo(result.rows[0], workspaceId, userId);
}

export async function isWorkspaceAdmin(workspaceId: string, userId: string): Promise<boolean> {
  const role = await getWorkspaceRole(workspaceId, userId);
  return role?.is_admin ?? false;
}

export async function listWorkspaceAdmins(workspaceId: string): Promise<string[]> {
  const p = pool;
  if (!p) return [];

  const result = await p.query<{
    user_id: string;
    workspace_id: string;
    legacy_role: string | null;
    role_name: string | null;
    permissions: unknown;
  }>(
    `SELECT
        m.user_id,
        m.workspace_id,
        m.role AS legacy_role,
        r.name AS role_name,
        r.permissions
     FROM workspace_members m
     LEFT JOIN roles r ON r.id = m.role_id
     WHERE m.workspace_id = $1`,
    [workspaceId]
  );

  return result.rows
    .map((row) => mapRowToRoleInfo(row, workspaceId))
    .filter((row): row is WorkspaceRoleInfo => Boolean(row))
    .filter((row) => row.is_admin)
    .map((row) => row.user_id)
    .slice(0, 20);
}
