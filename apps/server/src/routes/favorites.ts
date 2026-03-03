import { Router } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = Router();

// GET /api/v1/favorites — list favorited docs
router.get('/', authMiddleware, checkPermission('view', 'document'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const workspaceId = (req as any).workspaceId;
  const { rows } = await pool.query(
    `SELECT id, title, metadata, updated_at
     FROM documents
     WHERE workspace_id = $1 AND is_favorite = true AND deleted_at IS NULL
     ORDER BY updated_at DESC`,
    [workspaceId],
  );
  res.json({ items: rows });
});

// POST /api/v1/documents/:id/favorite — favorite a doc
router.post('/:id', authMiddleware, checkPermission('view', 'document'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const workspaceId = (req as any).workspaceId;
  const { id } = req.params;
  const { rows } = await pool.query(
    `UPDATE documents SET is_favorite = true, updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
     RETURNING id, title, is_favorite`,
    [id, workspaceId],
  );
  if (!rows.length) return res.status(404).json({ error: 'Document not found' });
  res.json({ document: rows[0] });
});

// DELETE /api/v1/documents/:id/favorite — unfavorite
router.delete('/:id', authMiddleware, checkPermission('view', 'document'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const workspaceId = (req as any).workspaceId;
  const { id } = req.params;
  const { rows } = await pool.query(
    `UPDATE documents SET is_favorite = false, updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2
     RETURNING id, title, is_favorite`,
    [id, workspaceId],
  );
  if (!rows.length) return res.status(404).json({ error: 'Document not found' });
  res.json({ document: rows[0] });
});

export { router as favoritesRouter };
