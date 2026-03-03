import { Router } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = Router({ mergeParams: true });

// GET /api/v1/documents/:id/versions
router.get('/', authMiddleware, checkPermission('view', 'document'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const { id } = req.params;
  const { rows } = await pool.query(
    `SELECT v.id, v.version_number, v.title, v.created_at,
            u.id as author_id, u.name as author_name
     FROM document_versions v
     LEFT JOIN users u ON u.id = v.created_by
     WHERE v.document_id = $1
     ORDER BY v.version_number DESC
     LIMIT 50`,
    [id],
  );
  res.json({ versions: rows });
});

// GET /api/v1/documents/:id/versions/:ver — get specific version content
router.get('/:ver', authMiddleware, checkPermission('view', 'document'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const { id, ver } = req.params;
  const { rows } = await pool.query(
    `SELECT v.*, u.name as author_name
     FROM document_versions v
     LEFT JOIN users u ON u.id = v.created_by
     WHERE v.document_id = $1 AND v.version_number = $2`,
    [id, parseInt(ver, 10)],
  );
  if (!rows.length) return res.status(404).json({ error: 'Version not found' });
  res.json({ version: rows[0] });
});

// POST /api/v1/documents/:id/versions — create snapshot manually
router.post('/', authMiddleware, checkPermission('edit', 'document'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const userId = (req as any).user?.userId;
  const { id } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [doc] } = await client.query(
      `SELECT title, content, yjs_state FROM documents WHERE id = $1`,
      [id],
    );
    if (!doc) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Document not found' }); }

    const { rows: [{ max_ver }] } = await client.query(
      `SELECT COALESCE(MAX(version_number), 0) as max_ver FROM document_versions WHERE document_id = $1`,
      [id],
    );
    const { rows: [ver] } = await client.query(
      `INSERT INTO document_versions (document_id, version_number, title, content, yjs_state, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, version_number, created_at`,
      [id, max_ver + 1, doc.title, doc.content, doc.yjs_state, userId],
    );
    await client.query('COMMIT');
    res.status(201).json({ version: ver });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

// POST /api/v1/documents/:id/versions/:ver/restore
router.post('/:ver/restore', authMiddleware, checkPermission('edit', 'document'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const userId = (req as any).user?.userId;
  const { id, ver } = req.params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Get the version to restore
    const { rows: [ver_row] } = await client.query(
      `SELECT * FROM document_versions WHERE document_id = $1 AND version_number = $2`,
      [id, parseInt(ver, 10)],
    );
    if (!ver_row) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Version not found' }); }

    // Snapshot current state first
    const { rows: [doc] } = await client.query(`SELECT title, content, yjs_state FROM documents WHERE id = $1`, [id]);
    const { rows: [{ max_ver }] } = await client.query(
      `SELECT COALESCE(MAX(version_number), 0) as max_ver FROM document_versions WHERE document_id = $1`, [id],
    );
    await client.query(
      `INSERT INTO document_versions (document_id, version_number, title, content, yjs_state, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, max_ver + 1, doc.title, doc.content, doc.yjs_state, userId],
    );

    // Restore from old version
    await client.query(
      `UPDATE documents SET title = $1, content = $2, yjs_state = $3, updated_at = NOW() WHERE id = $4`,
      [ver_row.title, ver_row.content, ver_row.yjs_state, id],
    );
    await client.query('COMMIT');
    res.json({ restored: true, from_version: ver });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
});

export { router as versionsRouter };
