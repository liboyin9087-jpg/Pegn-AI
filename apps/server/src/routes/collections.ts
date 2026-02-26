import { Router, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { observability } from '../services/observability.js';

export const collectionsRouter = Router();

/**
 * List all collections in a workspace
 */
collectionsRouter.get(
    '/workspace/:workspaceId',
    authMiddleware,
    checkPermission('collection:view'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const p = pool;
        if (!p) return res.status(503).json({ error: 'Database not initialized' });

        const { workspaceId } = req.params;
        if (!workspaceId) return res.status(400).json({ error: 'workspaceId is required' });

        try {
            const result = await p.query(
                'SELECT * FROM collections WHERE workspace_id = $1 ORDER BY updated_at DESC',
                [workspaceId]
            );
            res.json({ collections: result.rows });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * Get a specific collection by ID
 */
collectionsRouter.get(
    '/:id',
    authMiddleware,
    checkPermission('collection:view', 'collection'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const p = pool;
        if (!p) return res.status(503).json({ error: 'Database not initialized' });

        const { id } = req.params;
        try {
            const result = await p.query(
                'SELECT * FROM collections WHERE id = $1',
                [id]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Collection not found' });
            }
            res.json(result.rows[0]);
        } catch (error) {
            next(error);
        }
    }
);

/**
 * Create a new collection
 */
collectionsRouter.post(
    '/',
    authMiddleware,
    checkPermission('collection:create'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const p = pool;
        if (!p) return res.status(503).json({ error: 'Database not initialized' });

        const { workspaceId, name, description, icon, schema } = req.body;
        const userId = req.userId;

        if (!workspaceId || !name) {
            return res.status(400).json({ error: 'workspaceId and name are required' });
        }

        try {
            const result = await p.query(
                `INSERT INTO collections (workspace_id, name, description, icon, schema, created_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING *`,
                [workspaceId, name, description, icon, schema || { properties: {} }, userId]
            );

            observability.info('Collection created', { collectionId: result.rows[0].id, workspaceId });
            res.status(201).json(result.rows[0]);
        } catch (error) {
            next(error);
        }
    }
);

/**
 * Update a collection
 */
collectionsRouter.patch(
    '/:id',
    authMiddleware,
    checkPermission('collection:edit', 'collection'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const p = pool;
        if (!p) return res.status(503).json({ error: 'Database not initialized' });

        const { id } = req.params;
        const { name, description, icon, schema } = req.body;

        try {
            // Build dynamic update query
            const updates = [];
            const values = [];
            let paramIdx = 1;

            if (name !== undefined) {
                updates.push(`name = $${paramIdx++}`);
                values.push(name);
            }
            if (description !== undefined) {
                updates.push(`description = $${paramIdx++}`);
                values.push(description);
            }
            if (icon !== undefined) {
                updates.push(`icon = $${paramIdx++}`);
                values.push(icon);
            }
            if (schema !== undefined) {
                updates.push(`schema = $${paramIdx++}`);
                values.push(schema);
            }

            if (updates.length === 0) {
                return res.json({ message: 'No updates provided' });
            }

            values.push(id);

            const result = await p.query(
                `UPDATE collections SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
                values
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Collection not found' });
            }

            res.json(result.rows[0]);
        } catch (error) {
            next(error);
        }
    }
);

/**
 * Delete a collection
 */
collectionsRouter.delete(
    '/:id',
    authMiddleware,
    checkPermission('collection:delete', 'collection'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const p = pool;
        if (!p) return res.status(503).json({ error: 'Database not initialized' });

        const { id } = req.params;
        try {
            const result = await p.query(
                'DELETE FROM collections WHERE id = $1 RETURNING id',
                [id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Collection not found' });
            }

            observability.info('Collection deleted', { collectionId: id });
            res.json({ success: true, id });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * List all documents in a collection
 */
collectionsRouter.get(
    '/:id/documents',
    authMiddleware,
    checkPermission('collection:view', 'collection'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const p = pool;
        if (!p) return res.status(503).json({ error: 'Database not initialized' });

        const { id } = req.params;
        try {
            const result = await p.query(
                `SELECT d.* FROM documents d
         WHERE d.collection_id = $1
         ORDER BY d.updated_at DESC`,
                [id]
            );
            res.json({ documents: result.rows });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * Export collection data
 */
collectionsRouter.get(
    '/:id/export',
    authMiddleware,
    checkPermission('collection:view', 'collection'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const p = pool;
        if (!p) return res.status(503).json({ error: 'Database not initialized' });

        const { id } = req.params;
        const format = (req.query.format as string) || 'json';

        try {
            // 1. Fetch collection info for schema
            const colResult = await p.query('SELECT * FROM collections WHERE id = $1', [id]);
            if (colResult.rowCount === 0) return res.status(404).json({ error: 'Collection not found' });
            const collection = colResult.rows[0];

            // 2. Fetch all documents in this collection
            const docsResult = await p.query(
                'SELECT title, properties, created_at FROM documents WHERE collection_id = $1 ORDER BY created_at ASC',
                [id]
            );
            const documents = docsResult.rows;

            if (format === 'json') {
                res.setHeader('Content-Type', 'application/json');
                res.setHeader('Content-Disposition', `attachment; filename="${collection.name}.json"`);
                return res.json(documents);
            }

            if (format === 'csv') {
                // Extract unique property keys from schema or from docs
                const propertyKeys = Object.keys(collection.schema?.properties || {});
                const headers = ['Title', ...propertyKeys, 'Created At'];

                const rows = documents.map((doc: any) => {
                    const row = [doc.title];
                    propertyKeys.forEach(key => {
                        const val = doc.properties?.[key];
                        if (val === null || val === undefined) row.push('');
                        else if (typeof val === 'object') row.push(JSON.stringify(val));
                        else row.push(val.toString());
                    });
                    row.push(new Date(doc.created_at).toISOString());
                    return row.map(cell => `"${(cell || '').replace(/"/g, '""')}"`).join(',');
                });

                const csvContent = [headers.join(','), ...rows].join('\n');
                res.setHeader('Content-Type', 'text/csv');
                res.setHeader('Content-Disposition', `attachment; filename="${collection.name}.csv"`);
                return res.send(csvContent);
            }

            res.status(400).json({ error: 'Invalid format. Supported: json, csv' });
        } catch (error) {
            next(error);
        }
    }
);

// Helper function to register this router
export function registerCollectionRoutes(app: any) {
    app.use('/api/v1/collections', collectionsRouter);
}
