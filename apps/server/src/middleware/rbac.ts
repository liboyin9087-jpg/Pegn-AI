import type { Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import {
  getWorkspaceRole,
  hasWorkspaceCapability,
  type WorkspaceMembershipSummary,
  type WorkspacePermissionSummary,
  type WorkspaceRole,
} from '../lib/workspaceRoles.js';
import type { AuthRequest } from './auth.js';
import { observability } from '../services/observability.js';

export interface RBACRequest extends AuthRequest {
  userPermissions?: string[];
  userRole?: WorkspaceRole;
  workspacePermissions?: WorkspacePermissionSummary;
  workspaceMembershipSummary?: WorkspaceMembershipSummary;
}

type ResourceType =
  | 'collection'
  | 'collection_view'
  | 'document'
  | 'automation'
  | 'agent_run'
  | 'kg_entity'
  | 'comment_thread'
  | 'collaboration_thread'
  | 'inbox_notification'
  | 'none';

type Capability = keyof WorkspacePermissionSummary;

const FORBIDDEN_BODY = {
  error: {
    code: 'FORBIDDEN',
    message: 'You do not have permission to perform this action',
  },
} as const;

const PERMISSION_CAPABILITY_MAP: Record<string, Capability> = {
  'workspace:read': 'canViewWorkspace',
  'workspace:members:manage': 'canManageMembers',
  'workspace:settings:update': 'canManageSettings',
  'workspace:admin': 'canManageSettings',
  'collection:view': 'canViewWorkspace',
  'document:view': 'canViewWorkspace',
  'comment:view': 'canViewWorkspace',
  'collection:create': 'canEditDocuments',
  'collection:update': 'canEditDocuments',
  'collection:rename': 'canEditDocuments',
  'collection:move': 'canEditDocuments',
  'collection:edit': 'canEditDocuments',
  'document:create': 'canEditDocuments',
  'document:edit': 'canEditDocuments',
  'comment:create': 'canEditDocuments',
  'comment:resolve': 'canEditDocuments',
  'collection:delete': 'canDeleteDocuments',
  'document:delete': 'canDeleteDocuments',
  'agent:run': 'canRunAutomation',
  'automation:trigger': 'canRunAutomation',
  'thread:view': 'canCollaborate',
  'thread:create': 'canCollaborate',
  'thread:comment': 'canCollaborate',
  'thread:resolve': 'canCollaborate',
  'thread:assign': 'canManageAssignments',
};

function getResultRowCount(result: { rowCount?: number | null; rows?: unknown[] }): number {
  if (typeof result.rowCount === 'number') return result.rowCount;
  return Array.isArray(result.rows) ? result.rows.length : 0;
}

async function resolveWorkspaceId(req: AuthRequest, resourceType: ResourceType): Promise<string | undefined> {
  const fromQuery = (key: 'workspace_id' | 'workspaceId') => {
    const value = req.query[key];
    return typeof value === 'string' ? value : undefined;
  };

  let workspaceId =
    req.params.workspace_id ||
    req.params.workspaceId ||
    req.body?.workspace_id ||
    req.body?.workspaceId ||
    fromQuery('workspace_id') ||
    fromQuery('workspaceId');

  if (workspaceId) return workspaceId;

  const p = pool;
  if (!p) return undefined;

  try {
    if (resourceType === 'collection' && req.params.id) {
      const result = await p.query('SELECT workspace_id FROM collections WHERE id = $1', [req.params.id]);
      return result.rows[0]?.workspace_id;
    }

    if (resourceType === 'collection' && (req.params.collectionId || req.body?.collectionId)) {
      const collectionId = req.params.collectionId || req.body?.collectionId;
      const result = await p.query('SELECT workspace_id FROM collections WHERE id = $1', [collectionId]);
      return result.rows[0]?.workspace_id;
    }

    if (resourceType === 'collection_view' && req.params.id) {
      const result = await p.query(
        `SELECT c.workspace_id
         FROM collection_views v
         JOIN collections c ON v.collection_id = c.id
         WHERE v.id = $1`,
        [req.params.id]
      );
      return result.rows[0]?.workspace_id;
    }

    if (resourceType === 'document') {
      const documentId = req.params.id || req.params.document_id || req.params.documentId;
      if (!documentId) return undefined;
      const result = await p.query('SELECT workspace_id FROM documents WHERE id = $1', [documentId]);
      return result.rows[0]?.workspace_id;
    }

    if (resourceType === 'automation') {
      const automationId = req.params.id || req.params.automation_id || req.params.automationId;
      if (!automationId) return undefined;
      const result = await p.query('SELECT workspace_id FROM automations WHERE id = $1', [automationId]);
      return result.rows[0]?.workspace_id;
    }

    if (resourceType === 'agent_run') {
      const runId = req.params.run_id || req.params.runId || req.params.id;
      if (!runId) return undefined;
      const result = await p.query('SELECT workspace_id FROM agent_runs WHERE id = $1', [runId]);
      return result.rows[0]?.workspace_id;
    }

    if (resourceType === 'comment_thread') {
      const threadId = req.params.thread_id || req.params.threadId || req.params.id;
      if (!threadId) return undefined;
      const result = await p.query('SELECT workspace_id FROM comment_threads WHERE id = $1', [threadId]);
      return result.rows[0]?.workspace_id;
    }

    if (resourceType === 'collaboration_thread') {
      const threadId = req.params.thread_id || req.params.threadId || req.params.id;
      if (!threadId) return undefined;
      const result = await p.query('SELECT workspace_id FROM collaboration_threads WHERE id = $1', [threadId]);
      return result.rows[0]?.workspace_id;
    }

    if (resourceType === 'inbox_notification') {
      const notificationId = req.params.notification_id || req.params.notificationId || req.params.id;
      if (!notificationId) return undefined;
      const result = await p.query('SELECT workspace_id FROM inbox_notifications WHERE id = $1', [notificationId]);
      return result.rows[0]?.workspace_id;
    }

    if (resourceType === 'kg_entity') {
      const entityId = req.params.entity_id || req.params.id;
      if (!entityId) return undefined;
      const result = await p.query('SELECT workspace_id FROM kg_entities WHERE id = $1', [entityId]);
      return result.rows[0]?.workspace_id;
    }
  } catch (error) {
    observability.error('RBAC Resource Resolution Error', { error, resourceType });
  }

  return undefined;
}

async function checkLegacyPermissionFallback(
  workspaceId: string,
  userId: string,
  requiredPermissions: string[]
): Promise<{ isMember: boolean; allowed: boolean }> {
  const p = pool;
  if (!p) return { isMember: false, allowed: false };

  const membership = await p.query(
    'SELECT 1 FROM workspace_members WHERE workspace_id = $1 AND user_id = $2 LIMIT 1',
    [workspaceId, userId]
  );

  if (getResultRowCount(membership) === 0) {
    return { isMember: false, allowed: false };
  }

  const permissionCheck = await p.query(
    `SELECT 1
     FROM user_roles ur
     LEFT JOIN role_permissions rp ON rp.role_id = ur.role_id
     LEFT JOIN permissions perm ON perm.id = rp.permission_id
     WHERE ur.user_id = $1
       AND perm.name = ANY($2::text[])
     LIMIT 1`,
    [userId, requiredPermissions]
  );

  return {
    isMember: true,
    allowed: getResultRowCount(permissionCheck) > 0,
  };
}

function attachMembershipSummary(req: RBACRequest, membership: WorkspaceMembershipSummary) {
  req.userRole = membership.effectiveRole;
  req.userPermissions = membership.permissions;
  req.workspacePermissions = membership.permissionSummary;
  req.workspaceMembershipSummary = membership;
}

function sendForbidden(res: Response) {
  return res.status(403).json(FORBIDDEN_BODY);
}

export function checkWorkspaceCapability(
  capability: Capability,
  resourceType: ResourceType = 'none'
) {
  return async (req: RBACRequest, res: Response, next: NextFunction) => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: No user ID found' });
      return;
    }

    const p = pool;
    if (!p) {
      res.status(503).json({ error: 'Service Unavailable: Database not initialized' });
      return;
    }

    const workspaceId = await resolveWorkspaceId(req, resourceType);
    if (!workspaceId) {
      res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Missing workspace ID',
          details: null,
        },
      });
      return;
    }

    try {
      const roleInfo = await getWorkspaceRole(workspaceId, userId);
      if (!roleInfo) {
        const fallbackPermissions = Object.entries(PERMISSION_CAPABILITY_MAP)
          .filter(([, mappedCapability]) => mappedCapability === capability)
          .map(([permission]) => permission);
        const fallback = await checkLegacyPermissionFallback(workspaceId, userId, fallbackPermissions);
        if (!fallback.isMember || !fallback.allowed) {
          observability.warn('RBAC Denial', { userId, workspaceId, capability, reason: 'membership_or_fallback' });
          sendForbidden(res);
          return;
        }
        req.userPermissions = fallbackPermissions;
        next();
        return;
      }

      attachMembershipSummary(req, roleInfo);

      if (hasWorkspaceCapability(roleInfo.permissionSummary, capability)) {
        next();
        return;
      }

      observability.warn('RBAC Denial', {
        userId,
        workspaceId,
        capability,
        effectiveRole: roleInfo.effectiveRole,
      });
      sendForbidden(res);
    } catch (error) {
      observability.error('RBAC Middleware Error', { error, capability });
      res.status(500).json({
        error: {
          code: 'INVALID_STATE',
          message: 'Internal Server Error during RBAC check',
          details: null,
        },
      });
    }
  };
}

export function checkPermission(
  requiredPermission: string | string[],
  resourceType: ResourceType = 'none'
) {
  const requiredPermissions = Array.isArray(requiredPermission) ? requiredPermission : [requiredPermission];
  const mappedCapabilities = requiredPermissions
    .map((permission) => PERMISSION_CAPABILITY_MAP[permission])
    .filter((capability): capability is Capability => Boolean(capability));

  if (mappedCapabilities.length > 0) {
    const capability = mappedCapabilities[0];
    return checkWorkspaceCapability(capability, resourceType);
  }

  return async (req: RBACRequest, res: Response, next: NextFunction) => {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized: No user ID found' });
      return;
    }

    const workspaceId = await resolveWorkspaceId(req, resourceType);
    if (!workspaceId) {
      res.status(400).json({
        error: {
          code: 'BAD_REQUEST',
          message: 'Missing workspace ID',
          details: null,
        },
      });
      return;
    }

    try {
      const roleInfo = await getWorkspaceRole(workspaceId, userId);
      if (roleInfo) {
        attachMembershipSummary(req, roleInfo);
        if (requiredPermissions.some((permission) => roleInfo.permissions.includes(permission))) {
          next();
          return;
        }
      }

      const fallback = await checkLegacyPermissionFallback(workspaceId, userId, requiredPermissions);
      if (!fallback.isMember || !fallback.allowed) {
        observability.warn('RBAC Denial', { userId, workspaceId, requiredPermissions, reason: 'compatibility_wrapper' });
        sendForbidden(res);
        return;
      }

      req.userPermissions = requiredPermissions;
      next();
    } catch (error) {
      observability.error('RBAC Compatibility Wrapper Error', { error, requiredPermissions });
      res.status(500).json({
        error: {
          code: 'INVALID_STATE',
          message: 'Internal Server Error during RBAC check',
          details: null,
        },
      });
    }
  };
}
