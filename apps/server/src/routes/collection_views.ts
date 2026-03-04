import { Router, type Response, type NextFunction } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { observability } from '../services/observability.js';

export const collectionViewsRouter = Router();

/**
 * List all views for a specific collection
 */
collectionViewsRouter.get(
    '/collection/:collectionId',
    authMiddleware,
    checkPermission('collection:view', 'collection'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const p = pool;
        if (!p) return res.status(503).json({ error: 'Database not initialized' });

        const { collectionId } = req.params;
        try {
            const result = await p.query(
                'SELECT * FROM collection_views WHERE collection_id = $1 ORDER BY position ASC, created_at ASC',
                [collectionId]
            );
            res.json({ views: result.rows });
        } catch (error) {
            next(error);
        }
    }
);

/**
 * Create a new view for a collection
 */
collectionViewsRouter.post(
    '/',
    authMiddleware,
    checkPermission('collection:edit', 'collection'), // Need edit permission to add views
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const p = pool;
        if (!p) return res.status(503).json({ error: 'Database not initialized' });

        const { collectionId, name, type, configuration, position } = req.body;

        if (!collectionId || !name || !type) {
            return res.status(400).json({ error: 'collectionId, name, and type are required' });
        }

        try {
            const result = await p.query(
                `INSERT INTO collection_views (collection_id, name, type, configuration, position)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
                [collectionId, name, type, configuration || {}, position || 0]
            );

            observability.info('Collection View created', { viewId: result.rows[0].id, collectionId });
            res.status(201).json(result.rows[0]);
        } catch (error) {
            next(error);
        }
    }
);

/**
 * Update a collection view
 */
collectionViewsRouter.patch(
    '/:id',
    authMiddleware,
    checkPermission('collection:edit', 'collection_view'),
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const p = pool;
        if (!p) return res.status(503).json({ error: 'Database not initialized' });

        const { id } = req.params;
        const { name, type, configuration, position } = req.body;

        try {
            const updates = [];
            const values = [];
            let paramIdx = 1;

            if (name !== undefined) {
                updates.push(`name = $${paramIdx++}`);
                values.push(name);
            }
            if (type !== undefined) {
                updates.push(`type = $${paramIdx++}`);
                values.push(type);
            }
            if (configuration !== undefined) {
                updates.push(`configuration = $${paramIdx++}`);
                values.push(configuration);
            }
            if (position !== undefined) {
                updates.push(`position = $${paramIdx++}`);
                values.push(position);
            }

            if (updates.length === 0) {
                return res.json({ message: 'No updates provided' });
            }

            values.push(id);

            const result = await p.query(
                `UPDATE collection_views SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
                values
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'View not found' });
            }

            res.json(result.rows[0]);
        } catch (error) {
            next(error);
        }
    }
);

/**
 * Delete a collection view
 */
collectionViewsRouter.delete(
    '/:id',
    authMiddleware,
    checkPermission('collection:edit', 'collection_view'), // Deleting a view is an edit to the collection
    async (req: AuthRequest, res: Response, next: NextFunction) => {
        const p = pool;
        if (!p) return res.status(503).json({ error: 'Database not initialized' });

        const { id } = req.params;
        try {
            const result = await p.query(
                'DELETE FROM collection_views WHERE id = $1 RETURNING id',
                [id]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'View not found' });
            }

            observability.info('Collection View deleted', { viewId: id });
            res.json({ success: true, id });
        } catch (error) {
            next(error);
        }
    }
);

export function registerCollectionViewRoutes(app: any) {
    app.use('/api/v1/collection_views', collectionViewsRouter);
}
