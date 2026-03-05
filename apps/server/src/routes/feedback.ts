import type { Express, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { pool } from '../db/client.js';
import { observability } from '../services/observability.js';

const ALLOWED_TYPES = ['bug', 'idea', 'other'] as const;
type FeedbackType = typeof ALLOWED_TYPES[number];

export function registerFeedbackRoutes(app: Express): void {
  /**
   * POST /api/v1/feedback
   * Submit in-app feedback. User must be authenticated.
   * Body: { type: 'bug' | 'idea' | 'other', message: string, workspace_id?: string, metadata?: object }
   */
  app.post('/api/v1/feedback', authMiddleware, async (req: AuthRequest, res: Response) => {
    const { type, message, workspace_id, metadata } = req.body as {
      type?: string;
      message?: string;
      workspace_id?: string;
      metadata?: Record<string, unknown>;
    };

    if (!type || !ALLOWED_TYPES.includes(type as FeedbackType)) {
      res.status(400).json({ error: `type must be one of: ${ALLOWED_TYPES.join(', ')}` });
      return;
    }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({ error: 'message is required and must be non-empty' });
      return;
    }
    if (message.length > 5000) {
      res.status(400).json({ error: 'message must be 5000 characters or fewer' });
      return;
    }

    const p = pool;
    if (!p) {
      res.status(503).json({ error: 'DB not available' });
      return;
    }

    try {
      const result = await p.query(
        `INSERT INTO feedback (user_id, workspace_id, type, message, metadata)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, type, created_at`,
        [req.userId, workspace_id ?? null, type, message.trim(), JSON.stringify(metadata ?? {})]
      );
      observability.info('Feedback submitted', { feedbackId: result.rows[0].id, type, userId: req.userId });
      res.status(201).json({ id: result.rows[0].id, type: result.rows[0].type, created_at: result.rows[0].created_at });
    } catch (err) {
      observability.error('Failed to save feedback', { error: String(err) });
      res.status(500).json({ error: 'Failed to save feedback' });
    }
  });

  /**
   * GET /api/v1/feedback  (admin viewing — workspace members only)
   * Query: ?workspace_id=xxx&limit=50
   */
  app.get('/api/v1/feedback', authMiddleware, async (req: AuthRequest, res: Response) => {
    const { workspace_id, limit = '50' } = req.query as Record<string, string>;
    const p = pool;
    if (!p) { res.json({ feedback: [] }); return; }
    try {
      let query = `SELECT f.id, f.type, f.message, f.created_at, u.email as user_email
                   FROM feedback f LEFT JOIN users u ON u.id = f.user_id`;
      const params: any[] = [];
      if (workspace_id) {
        query += ' WHERE f.workspace_id = $1';
        params.push(workspace_id);
      }
      query += ` ORDER BY f.created_at DESC LIMIT $${params.length + 1}`;
      params.push(Math.min(parseInt(limit), 200));
      const result = await p.query(query, params);
      res.json({ feedback: result.rows });
    } catch {
      res.status(500).json({ error: 'Failed to fetch feedback' });
    }
  });
}
