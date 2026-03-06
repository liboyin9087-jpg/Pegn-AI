import type { Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { getWorkspaceRole } from '../lib/workspaceRoles.js';
import { AuthRequest } from './auth.js';
import { observability } from '../services/observability.js';

export interface RBACRequest extends AuthRequest {
    userPermissions?: string[];
    userRole?: string;
}

function getResultRowCount(result: { rowCount?: number | null; rows?: unknown[] }): number {
    if (typeof result.rowCount === 'number') return result.rowCount;
    return Array.isArray(result.rows) ? result.rows.length : 0;
}

async function checkLegacyPermissionFallback(
    workspaceId: string,
    userId: string,
    requiredPermission: string
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
         WHERE ur.user_id = $2
           AND perm.name IN ($3, 'workspace:admin')
         LIMIT 1`,
        [workspaceId, userId, requiredPermission]
    );

    return {
        isMember: true,
        allowed: getResultRowCount(permissionCheck) > 0,
    };
}

/**
 * Middleware to check if the user has a specific permission in a workspace.
 * Assumes authMiddleware has already run and populated req.userId.
 * Expects workspace_id/workspaceId to be available in req.params, req.body, or req.query.
 * If workspace id is missing but a supported resource id is present, it will resolve it.
 */
export const checkPermission = (
    requiredPermission: string,
    resourceType: 'collection' | 'collection_view' | 'document' | 'kg_entity' | 'comment_thread' | 'inbox_notification' | 'none' = 'none'
) => {
    return async (req: RBACRequest, res: Response, next: NextFunction) => {
        const userId = req.userId;
        const fromQuery = (k: 'workspace_id' | 'workspaceId') => {
            const v = req.query[k];
            return typeof v === 'string' ? v : undefined;
        };

        let workspaceId =
            req.params.workspace_id ||
            req.params.workspaceId ||
            req.body.workspace_id ||
            req.body.workspaceId ||
            fromQuery('workspace_id') ||
            fromQuery('workspaceId');

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized: No user ID found' });
        }

        const p = pool;
        if (!p) {
            return res.status(503).json({ error: 'Service Unavailable: Database not initialized' });
        }

        // Try to resolve workspaceId from resource if missing
        if (!workspaceId) {
            try {
                if (resourceType === 'collection' && req.params.id) {
                    const result = await p.query('SELECT workspace_id FROM collections WHERE id = $1', [req.params.id]);
                    if ((result.rowCount ?? 0) > 0) workspaceId = result.rows[0].workspace_id;
                } else if (resourceType === 'collection' && (req.params.collectionId || req.body.collectionId)) {
                    const cid = req.params.collectionId || req.body.collectionId;
                    const result = await p.query('SELECT workspace_id FROM collections WHERE id = $1', [cid]);
                    if ((result.rowCount ?? 0) > 0) workspaceId = result.rows[0].workspace_id;
                } else if (resourceType === 'collection_view' && req.params.id) {
                    const result = await p.query(`
                        SELECT c.workspace_id 
                        FROM collection_views v
                        JOIN collections c ON v.collection_id = c.id
                        WHERE v.id = $1
                    `, [req.params.id]);
                    if ((result.rowCount ?? 0) > 0) workspaceId = result.rows[0].workspace_id;
                } else if (resourceType === 'document') {
                    const documentId = req.params.id || req.params.document_id || req.params.documentId;
                    if (documentId) {
                        const result = await p.query('SELECT workspace_id FROM documents WHERE id = $1', [documentId]);
                        if ((result.rowCount ?? 0) > 0) workspaceId = result.rows[0].workspace_id;
                    }
                } else if (resourceType === 'comment_thread') {
                    const threadId = req.params.thread_id || req.params.threadId || req.params.id;
                    if (threadId) {
                        const result = await p.query('SELECT workspace_id FROM comment_threads WHERE id = $1', [threadId]);
                        if ((result.rowCount ?? 0) > 0) workspaceId = result.rows[0].workspace_id;
                    }
                } else if (resourceType === 'inbox_notification') {
                    const notificationId = req.params.notification_id || req.params.notificationId || req.params.id;
                    if (notificationId) {
                        const result = await p.query('SELECT workspace_id FROM inbox_notifications WHERE id = $1', [notificationId]);
                        if ((result.rowCount ?? 0) > 0) workspaceId = result.rows[0].workspace_id;
                    }
                } else if (resourceType === 'kg_entity') {
                    const entityId = req.params.entity_id || req.params.id;
                    if (entityId) {
                        const result = await p.query('SELECT workspace_id FROM kg_entities WHERE id = $1', [entityId]);
                        if ((result.rowCount ?? 0) > 0) workspaceId = result.rows[0].workspace_id;
                    }
                }
            } catch (err) {
                observability.error('RBAC Resource Resolution Error', { error: err });
            }
        }

        if (!workspaceId) {
            return res.status(400).json({ error: 'Bad Request: Missing workspace ID' });
        }

        try {
            const roleInfo = await getWorkspaceRole(workspaceId, userId);
            if (!roleInfo) {
                const fallback = await checkLegacyPermissionFallback(workspaceId, userId, requiredPermission);
                if (!fallback.isMember) {
                    return res.status(403).json({ error: 'Forbidden: You are not a member of this workspace' });
                }
                if (fallback.allowed) {
                    req.userPermissions = [requiredPermission];
                    return next();
                }
                return res.status(403).json({ error: `Forbidden: Missing required permission [${requiredPermission}]` });
            }

            // 3. Attach info to request for downstream use
            req.userPermissions = roleInfo.permissions;
            req.userRole = roleInfo.effective_role ?? undefined;

            // 4. Check if required permission is present
            // Admin role bypasses all checks if they have workspace:admin
            if (roleInfo.is_admin || roleInfo.permissions.includes('workspace:admin')) {
                return next();
            }

            if (roleInfo.permissions.includes(requiredPermission)) {
                return next();
            }

            if (roleInfo.permissions.length === 0 && !roleInfo.effective_role) {
                const fallback = await checkLegacyPermissionFallback(workspaceId, userId, requiredPermission);
                if (fallback.allowed) {
                    req.userPermissions = [requiredPermission];
                    return next();
                }
            }

            observability.warn('RBAC Denial', { userId, requiredPermission, workspaceId });
            return res.status(403).json({ error: `Forbidden: Missing required permission [${requiredPermission}]` });

        } catch (error) {
            observability.error('RBAC Middleware Error', { error });
            return res.status(500).json({ error: 'Internal Server Error during RBAC check' });
        }
    };
};
