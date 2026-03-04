/**
 * automations.ts — REST API for Automation Engine
 *
 * Routes:
 *   GET    /api/v1/automations?workspace_id=...
 *   POST   /api/v1/automations
 *   GET    /api/v1/automations/:id
 *   PATCH  /api/v1/automations/:id
 *   DELETE /api/v1/automations/:id
 *   POST   /api/v1/automations/:id/trigger   (manual trigger)
 *   GET    /api/v1/automations/:id/runs       (run history)
 */

import type { Express, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { observability } from '../services/observability.js';
import { executeAutomation, type AutomationRow } from '../services/automation.js';

export function registerAutomationRoutes(app: Express): void {

  // ── List automations for a workspace ───────────────────────────────────
  app.get('/api/v1/automations', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
    const workspaceId = (req.query.workspace_id || req.query.workspaceId) as string;
    if (!workspaceId) { res.status(400).json({ error: 'workspace_id is required' }); return; }

    const p = pool;
    if (!p) { res.status(503).json({ error: 'Database unavailable' }); return; }

    try {
      const { rows } = await p.query<AutomationRow>(
        `SELECT * FROM automations
         WHERE workspace_id = $1
         ORDER BY created_at DESC`,
        [workspaceId]
      );
      res.json({ automations: rows, total: rows.length });
    } catch (err) {
      observability.error('[automations] list failed', { err: String(err) });
      res.status(500).json({ error: 'Failed to list automations' });
    }
  });

  // ── Create automation ──────────────────────────────────────────────────
  app.post('/api/v1/automations', authMiddleware, checkPermission('collection:edit'), async (req: Request, res: Response) => {
    const {
      workspace_id, name, description,
      trigger_type, trigger_config = {},
      conditions = [], actions = [],
      schedule_cron, enabled = true,
    } = req.body;

    if (!workspace_id || !name || !trigger_type) {
      res.status(400).json({ error: 'workspace_id, name, trigger_type are required' });
      return;
    }

    const VALID_TRIGGERS = ['doc_created', 'doc_updated', 'doc_deleted', 'property_changed', 'status_changed', 'comment_created', 'schedule'];
    if (!VALID_TRIGGERS.includes(trigger_type)) {
      res.status(400).json({ error: `Invalid trigger_type. Must be one of: ${VALID_TRIGGERS.join(', ')}` });
      return;
    }

    if (trigger_type === 'schedule' && !schedule_cron) {
      res.status(400).json({ error: 'schedule_cron is required for schedule trigger type' });
      return;
    }

    const p = pool;
    if (!p) { res.status(503).json({ error: 'Database unavailable' }); return; }

    try {
      const { rows } = await p.query<AutomationRow>(
        `INSERT INTO automations
           (workspace_id, created_by, name, description, enabled, trigger_type, trigger_config, conditions, actions, schedule_cron)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [
          workspace_id, (req as any).userId, name, description ?? null, enabled,
          trigger_type, JSON.stringify(trigger_config),
          JSON.stringify(conditions), JSON.stringify(actions),
          schedule_cron ?? null,
        ]
      );

      observability.info('[automations] created', { id: rows[0].id, workspace_id, trigger_type });
      res.status(201).json(rows[0]);
    } catch (err) {
      observability.error('[automations] create failed', { err: String(err) });
      res.status(500).json({ error: 'Failed to create automation' });
    }
  });

  // ── Get automation by ID ───────────────────────────────────────────────
  app.get('/api/v1/automations/:id', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
    const p = pool;
    if (!p) { res.status(503).json({ error: 'Database unavailable' }); return; }

    try {
      const { rows } = await p.query<AutomationRow>(
        'SELECT * FROM automations WHERE id = $1',
        [req.params.id]
      );
      if (rows.length === 0) { res.status(404).json({ error: 'Automation not found' }); return; }
      res.json(rows[0]);
    } catch (err) {
      observability.error('[automations] get failed', { err: String(err) });
      res.status(500).json({ error: 'Failed to get automation' });
    }
  });

  // ── Update automation ──────────────────────────────────────────────────
  app.patch('/api/v1/automations/:id', authMiddleware, checkPermission('collection:edit'), async (req: Request, res: Response) => {
    const p = pool;
    if (!p) { res.status(503).json({ error: 'Database unavailable' }); return; }

    const allowed = ['name', 'description', 'enabled', 'trigger_type', 'trigger_config', 'conditions', 'actions', 'schedule_cron'];
    const updates: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const val = ['trigger_config', 'conditions', 'actions'].includes(key)
          ? JSON.stringify(req.body[key])
          : req.body[key];
        updates.push(`${key} = $${idx++}`);
        values.push(val);
      }
    }

    if (updates.length === 0) { res.status(400).json({ error: 'No valid fields to update' }); return; }

    updates.push(`updated_at = NOW()`);
    values.push(req.params.id);

    try {
      const { rows } = await p.query<AutomationRow>(
        `UPDATE automations SET ${updates.join(', ')} WHERE id = $${idx} RETURNING *`,
        values
      );
      if (rows.length === 0) { res.status(404).json({ error: 'Automation not found' }); return; }
      res.json(rows[0]);
    } catch (err) {
      observability.error('[automations] update failed', { err: String(err) });
      res.status(500).json({ error: 'Failed to update automation' });
    }
  });

  // ── Delete automation ──────────────────────────────────────────────────
  app.delete('/api/v1/automations/:id', authMiddleware, checkPermission('collection:edit'), async (req: Request, res: Response) => {
    const p = pool;
    if (!p) { res.status(503).json({ error: 'Database unavailable' }); return; }

    try {
      const { rowCount } = await p.query(
        'DELETE FROM automations WHERE id = $1',
        [req.params.id]
      );
      if ((rowCount ?? 0) === 0) { res.status(404).json({ error: 'Automation not found' }); return; }
      res.json({ deleted: true, id: req.params.id });
    } catch (err) {
      observability.error('[automations] delete failed', { err: String(err) });
      res.status(500).json({ error: 'Failed to delete automation' });
    }
  });

  // ── Manual trigger ─────────────────────────────────────────────────────
  app.post('/api/v1/automations/:id/trigger', authMiddleware, checkPermission('collection:edit'), async (req: Request, res: Response) => {
    const p = pool;
    if (!p) { res.status(503).json({ error: 'Database unavailable' }); return; }

    try {
      const { rows } = await p.query<AutomationRow>(
        'SELECT * FROM automations WHERE id = $1',
        [req.params.id]
      );
      if (rows.length === 0) { res.status(404).json({ error: 'Automation not found' }); return; }

      const automation = rows[0];
      const payload = req.body.payload ?? {};

      // Fire async
      executeAutomation(
        automation,
        { type: automation.trigger_type, workspaceId: automation.workspace_id, payload, triggeredBy: (req as any).userId },
        'manual'
      ).catch(err => observability.error('[automations] manual trigger failed', { id: automation.id, err: String(err) }));

      observability.info('[automations] manual trigger dispatched', { id: automation.id });
      res.json({ triggered: true, automation_id: automation.id, message: 'Automation triggered, running in background' });
    } catch (err) {
      observability.error('[automations] manual trigger error', { err: String(err) });
      res.status(500).json({ error: 'Failed to trigger automation' });
    }
  });

  // ── Run history ────────────────────────────────────────────────────────
  app.get('/api/v1/automations/:id/runs', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
    const p = pool;
    if (!p) { res.status(503).json({ error: 'Database unavailable' }); return; }

    const limit = Math.min(100, parseInt((req.query.limit as string) || '20', 10));
    const offset = parseInt((req.query.offset as string) || '0', 10);

    try {
      const { rows } = await p.query(
        `SELECT * FROM automation_runs
         WHERE automation_id = $1
         ORDER BY started_at DESC
         LIMIT $2 OFFSET $3`,
        [req.params.id, limit, offset]
      );

      const count = await p.query(
        'SELECT COUNT(*) FROM automation_runs WHERE automation_id = $1',
        [req.params.id]
      );

      res.json({ runs: rows, total: parseInt(count.rows[0].count, 10), limit, offset });
    } catch (err) {
      observability.error('[automations] run history failed', { err: String(err) });
      res.status(500).json({ error: 'Failed to get run history' });
    }
  });

  // ── Workspace-level run summary ────────────────────────────────────────
  app.get('/api/v1/automations/runs/summary', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
    const workspaceId = (req.query.workspace_id || req.query.workspaceId) as string;
    if (!workspaceId) { res.status(400).json({ error: 'workspace_id is required' }); return; }

    const p = pool;
    if (!p) { res.status(503).json({ error: 'Database unavailable' }); return; }

    try {
      const { rows } = await p.query(
        `SELECT
           status,
           COUNT(*) as count,
           AVG(duration_ms) as avg_duration_ms
         FROM automation_runs
         WHERE workspace_id = $1
           AND started_at > NOW() - INTERVAL '7 days'
         GROUP BY status`,
        [workspaceId]
      );

      const recent = await p.query(
        `SELECT ar.*, a.name as automation_name
         FROM automation_runs ar
         JOIN automations a ON a.id = ar.automation_id
         WHERE ar.workspace_id = $1
         ORDER BY ar.started_at DESC
         LIMIT 10`,
        [workspaceId]
      );

      res.json({ summary: rows, recent_runs: recent.rows });
    } catch (err) {
      observability.error('[automations] summary failed', { err: String(err) });
      res.status(500).json({ error: 'Failed to get runs summary' });
    }
  });
}
