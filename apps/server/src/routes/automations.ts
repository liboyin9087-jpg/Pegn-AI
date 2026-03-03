import { Router } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';

const router = Router();

// GET /api/v1/automations
router.get('/', authMiddleware, checkPermission('view', 'none'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const workspaceId = (req as any).workspaceId;
  const { rows } = await pool.query(
    `SELECT a.*,
            u.name as creator_name,
            (SELECT COUNT(*) FROM automation_runs r WHERE r.automation_id = a.id) as total_runs,
            (SELECT COUNT(*) FROM automation_runs r WHERE r.automation_id = a.id AND r.status = 'failed') as failed_runs
     FROM automations a
     LEFT JOIN users u ON u.id = a.created_by
     WHERE a.workspace_id = $1
     ORDER BY a.created_at DESC`,
    [workspaceId],
  );
  res.json({ automations: rows });
});

// GET /api/v1/automations/:id
router.get('/:id', authMiddleware, checkPermission('view', 'none'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const workspaceId = (req as any).workspaceId;
  const { rows } = await pool.query(
    `SELECT * FROM automations WHERE id = $1 AND workspace_id = $2`,
    [req.params.id, workspaceId],
  );
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  res.json({ automation: rows[0] });
});

// POST /api/v1/automations
router.post('/', authMiddleware, checkPermission('edit', 'none'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const workspaceId = (req as any).workspaceId;
  const userId = (req as any).user?.userId;
  const { name, description, trigger_type, trigger_config, conditions, actions } = req.body;
  if (!name || !trigger_type || !actions) {
    return res.status(400).json({ error: 'name, trigger_type, actions required' });
  }
  const { rows: [automation] } = await pool.query(
    `INSERT INTO automations (workspace_id, name, description, trigger_type, trigger_config, conditions, actions, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      workspaceId, name, description ?? null, trigger_type,
      JSON.stringify(trigger_config ?? {}),
      JSON.stringify(conditions ?? []),
      JSON.stringify(actions),
      userId,
    ],
  );
  res.status(201).json({ automation });
});

// PUT /api/v1/automations/:id
router.put('/:id', authMiddleware, checkPermission('edit', 'none'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const workspaceId = (req as any).workspaceId;
  const { name, description, trigger_type, trigger_config, conditions, actions, enabled } = req.body;
  const { rows: [automation] } = await pool.query(
    `UPDATE automations
     SET name = COALESCE($1, name),
         description = COALESCE($2, description),
         trigger_type = COALESCE($3, trigger_type),
         trigger_config = COALESCE($4, trigger_config),
         conditions = COALESCE($5, conditions),
         actions = COALESCE($6, actions),
         enabled = COALESCE($7, enabled),
         updated_at = NOW()
     WHERE id = $8 AND workspace_id = $9
     RETURNING *`,
    [
      name, description, trigger_type,
      trigger_config ? JSON.stringify(trigger_config) : null,
      conditions ? JSON.stringify(conditions) : null,
      actions ? JSON.stringify(actions) : null,
      enabled, req.params.id, workspaceId,
    ],
  );
  if (!automation) return res.status(404).json({ error: 'Not found' });
  res.json({ automation });
});

// POST /api/v1/automations/:id/toggle
router.post('/:id/toggle', authMiddleware, checkPermission('edit', 'none'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const workspaceId = (req as any).workspaceId;
  const { rows: [a] } = await pool.query(
    `UPDATE automations SET enabled = NOT enabled, updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2
     RETURNING id, enabled`,
    [req.params.id, workspaceId],
  );
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json({ automation: a });
});

// DELETE /api/v1/automations/:id
router.delete('/:id', authMiddleware, checkPermission('edit', 'none'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const workspaceId = (req as any).workspaceId;
  const { rowCount } = await pool.query(
    `DELETE FROM automations WHERE id = $1 AND workspace_id = $2`,
    [req.params.id, workspaceId],
  );
  if (!rowCount) return res.status(404).json({ error: 'Not found' });
  res.json({ deleted: true });
});

// GET /api/v1/automations/:id/runs
router.get('/:id/runs', authMiddleware, checkPermission('view', 'none'), async (req, res) => {
  if (!pool) return res.status(503).json({ error: 'DB unavailable' });
  const workspaceId = (req as any).workspaceId;
  const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10), 100);
  const { rows } = await pool.query(
    `SELECT r.* FROM automation_runs r
     JOIN automations a ON a.id = r.automation_id
     WHERE r.automation_id = $1 AND a.workspace_id = $2
     ORDER BY r.started_at DESC
     LIMIT $3`,
    [req.params.id, workspaceId, limit],
  );
  res.json({ runs: rows });
});

export { router as automationsRouter };
