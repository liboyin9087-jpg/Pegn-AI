import { pool } from '../db/client.js';

export interface WorkspaceRoleInfo {
  user_id: string;
  workspace_id: string;
  legacy_role: string | null;
  role_name: string | null;
  effective_role: string | null;
  permissions: string[];
  is_admin: boolean;
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

function getResultRowCount(result: { rowCount?: number | null; rows?: unknown[] }): number {
  if (typeof result.rowCount === 'number') return result.rowCount;
  return Array.isArray(result.rows) ? result.rows.length : 0;
}

export function getLegacyPermissions(role: string | null | undefined): string[] {
  switch (role) {
    case 'owner':
    case 'admin':
      return [
        'workspace:admin',
        'collection:create', 'collection:edit', 'collection:delete', 'collection:view',
        'document:create', 'document:edit', 'document:delete', 'document:view',
        'comment:view', 'comment:create', 'comment:resolve',
      ];
    case 'editor':
      return [
        'collection:create', 'collection:edit', 'collection:view',
        'document:create', 'document:edit', 'document:view',
        'comment:view', 'comment:create', 'comment:resolve',
      ];
    case 'viewer':
      return ['collection:view', 'document:view', 'comment:view', 'comment:create'];
    default:
      return [];
  }
}

function isAdminRole(role: string | null | undefined): boolean {
  return role === 'admin' || role === 'owner';
}

function mapRowToRoleInfo(row: {
  user_id?: string;
  workspace_id?: string;
  legacy_role: string | null;
  role_name: string | null;
  permissions: unknown;
}, workspaceId?: string, userId?: string): WorkspaceRoleInfo {
  const permissions = parsePermissions(row.permissions);
  const fallbackPermissions = permissions.length > 0 ? permissions : getLegacyPermissions(row.legacy_role);
  return {
    user_id: row.user_id ?? userId ?? '',
    workspace_id: row.workspace_id ?? workspaceId ?? '',
    legacy_role: row.legacy_role,
    role_name: row.role_name,
    effective_role: row.role_name ?? row.legacy_role ?? null,
    permissions: fallbackPermissions,
    is_admin: fallbackPermissions.includes('workspace:admin')
      || isAdminRole(row.role_name)
      || isAdminRole(row.legacy_role),
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
     LEFT JOIN roles r ON m.role_id = r.id
     WHERE m.workspace_id = $1`,
    [workspaceId]
  );

  return result.rows
    .map((row) => mapRowToRoleInfo(row, workspaceId))
    .filter((row) => row.is_admin)
    .map((row) => row.user_id)
    .slice(0, 20);
}
