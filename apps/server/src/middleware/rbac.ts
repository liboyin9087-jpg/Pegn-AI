import type { Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { AuthRequest } from './auth.js';
import { observability } from '../services/observability.js';

export interface RBACRequest extends AuthRequest {
    userPermissions?: string[];
    userRole?: string;
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
            // 1. Get user's role and permissions in this workspace
            // We join with roles table to get the permissions array.
            // We also support the legacy 'role' string if role_id is null.
            const result = await p.query(`
                SELECT 
                    m.role as legacy_role,
                    r.name as role_name,
                    r.permissions
                FROM workspace_members m
                LEFT JOIN roles r ON m.role_id = r.id
                WHERE m.user_id = $1 AND m.workspace_id = $2
            `, [userId, workspaceId]);

            if ((result.rowCount ?? 0) === 0) {
                return res.status(403).json({ error: 'Forbidden: You are not a member of this workspace' });
            }

            const { legacy_role, role_name, permissions } = result.rows[0];

            // 2. Determine permissions
            let userPermissions: string[] = Array.isArray(permissions)
                ? permissions
                : typeof permissions === 'string'
                    ? (() => {
                        try {
                            const parsed = JSON.parse(permissions);
                            return Array.isArray(parsed) ? parsed : [];
                        } catch {
                            return [];
                        }
                    })()
                    : [];

            // If it's a legacy role, map it to default permissions
            if (userPermissions.length === 0 && legacy_role) {
                if (legacy_role === 'owner' || legacy_role === 'admin') {
                    userPermissions = [
                        'workspace:admin',
                        'collection:create', 'collection:edit', 'collection:delete', 'collection:view',
                        'document:create', 'document:edit', 'document:delete', 'document:view',
                        'comment:view', 'comment:create', 'comment:resolve'
                    ];
                } else if (legacy_role === 'editor') {
                    userPermissions = [
                        'collection:create', 'collection:edit', 'collection:view',
                        'document:create', 'document:edit', 'document:view',
                        'comment:view', 'comment:create', 'comment:resolve'
                    ];
                } else if (legacy_role === 'viewer') {
                    userPermissions = [
                        'collection:view',
                        'document:view',
                        'comment:view', 'comment:create'
                    ];
                }
            }

            // 3. Attach info to request for downstream use
            req.userPermissions = userPermissions;
            req.userRole = role_name || legacy_role;

            // 4. Check if required permission is present
            // Admin role bypasses all checks if they have workspace:admin
            if (userPermissions.includes('workspace:admin')) {
                return next();
            }

            if (userPermissions.includes(requiredPermission)) {
                return next();
            }

            observability.warn('RBAC Denial', { userId, requiredPermission, workspaceId });
            return res.status(403).json({ error: `Forbidden: Missing required permission [${requiredPermission}]` });

        } catch (error) {
            observability.error('RBAC Middleware Error', { error });
            return res.status(500).json({ error: 'Internal Server Error during RBAC check' });
        }
    };
};
