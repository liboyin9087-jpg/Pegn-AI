import type { Express, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { registerWebhook, unregisterWebhook, listWebhooks, type WebhookEvent } from '../services/webhook.js';

const VALID_EVENTS: WebhookEvent[] = ['document.created', 'document.updated', 'block.updated', 'agent.completed'];

export function registerWebhookRoutes(app: Express): void {

  /**
   * @openapi
   * /api/v1/webhooks:
   *   post:
   *     tags:
   *       - Webhooks
   *     summary: 註冊 Webhook（需 workspace:admin 權限）
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [url, events, workspace_id]
   *             properties:
   *               url: { type: string, format: uri, example: 'https://hooks.example.com/notify' }
   *               events:
   *                 type: array
   *                 items: { type: string }
   *                 example: [document.created, agent.completed]
   *               workspace_id: { type: string, format: uuid }
   *               secret: { type: string, description: 'HMAC 驗證 secret（可選）' }
   *     responses:
   *       '200':
   *         description: Webhook 建立成功，回傳 id
   *       '400':
   *         description: 參數錯誤或無效的 event 類型
   *         content:
   *           application/json:
   *             schema: { $ref: '#/components/schemas/Error' }
   *   get:
   *     tags:
   *       - Webhooks
   *     summary: 列出工作區的所有 Webhooks（需 workspace:admin 權限）
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: workspace_id
   *         required: true
   *         schema: { type: string, format: uuid }
   *     responses:
   *       '200':
   *         description: Webhook 清單
   */
  // Register a webhook (requires workspace:admin)
  app.post('/api/v1/webhooks', authMiddleware, checkPermission('workspace:admin'), async (req: AuthRequest, res: Response) => {
    const { url, events, secret } = req.body;
    const workspaceId = req.body.workspace_id || req.body.workspaceId;

    if (!url || !events?.length) {
      res.status(400).json({ error: 'url 和 events 為必填' });
      return;
    }
    if (!workspaceId) {
      res.status(400).json({ error: 'workspace_id 為必填' });
      return;
    }

    const invalidEvents = (events as string[]).filter(e => !VALID_EVENTS.includes(e as WebhookEvent));
    if (invalidEvents.length > 0) {
      res.status(400).json({ error: `無效的 event 類型: ${invalidEvents.join(', ')}`, valid_events: VALID_EVENTS });
      return;
    }

    try {
      const id = await registerWebhook(workspaceId, req.userId!, url, events as WebhookEvent[], secret);
      res.json({ id, url, events });
    } catch (error) {
      res.status(500).json({ error: '建立 webhook 失敗', details: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // Unregister a webhook (only the creator can delete)
  app.delete('/api/v1/webhooks/:id', authMiddleware, async (req: AuthRequest, res: Response) => {
    try {
      const ok = await unregisterWebhook(req.params.id, req.userId!);
      if (!ok) {
        res.status(404).json({ error: 'webhook not found or permission denied' });
        return;
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: '刪除 webhook 失敗' });
    }
  });

  // List webhooks for a workspace (requires workspace:admin)
  app.get('/api/v1/webhooks', authMiddleware, checkPermission('workspace:admin'), async (req: AuthRequest, res: Response) => {
    const workspaceId = (req.query.workspace_id || req.query.workspaceId) as string;

    if (!workspaceId) {
      res.status(400).json({ error: 'workspace_id 為必填' });
      return;
    }

    try {
      const webhooks = await listWebhooks(workspaceId);
      res.json({ webhooks });
    } catch (error) {
      res.status(500).json({ error: '查詢 webhook 失敗' });
    }
  });
}
