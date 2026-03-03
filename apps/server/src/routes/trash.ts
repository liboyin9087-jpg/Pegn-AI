import { Router } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = Router();

// GET /api/v1/trash — list soft-deleted docs in workspace
router.get('/', authMiddleware, checkPermission('view', 'document'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const workspaceId = (req as any).workspaceId;
  const { rows } = await pool.query(
    `SELECT id, title, metadata, deleted_at, updated_at, created_at
     FROM documents
     WHERE workspace_id = $1 AND deleted_at IS NOT NULL
     ORDER BY deleted_at DESC`,
    [workspaceId],
  );
  res.json({ items: rows });
});

// POST /api/v1/trash/:id/restore — restore soft-deleted doc
router.post('/:id/restore', authMiddleware, checkPermission('edit', 'document'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const workspaceId = (req as any).workspaceId;
  const { id } = req.params;
  const { rows } = await pool.query(
    `UPDATE documents SET deleted_at = NULL, updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NOT NULL
     RETURNING id, title`,
    [id, workspaceId],
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found in trash' });
  res.json({ document: rows[0] });
});

// DELETE /api/v1/trash/:id — permanently delete
router.delete('/:id', authMiddleware, checkPermission('delete', 'document'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const workspaceId = (req as any).workspaceId;
  const { id } = req.params;
  const { rowCount } = await pool.query(
    `DELETE FROM documents WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NOT NULL`,
    [id, workspaceId],
  );
  if (!rowCount) return res.status(404).json({ error: 'Not found in trash' });
  res.json({ deleted: true });
});

// DELETE /api/v1/trash — empty trash (permanently delete all)
router.delete('/', authMiddleware, checkPermission('delete', 'document'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const workspaceId = (req as any).workspaceId;
  const { rowCount } = await pool.query(
    `DELETE FROM documents WHERE workspace_id = $1 AND deleted_at IS NOT NULL`,
    [workspaceId],
  );
  res.json({ deleted: rowCount ?? 0 });
});

export { router as trashRouter };
