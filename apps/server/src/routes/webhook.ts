import type { Express, Request, Response } from 'express';
import { registerWebhook, unregisterWebhook, listWebhooks } from '../services/webhook.js';

export function registerWebhookRoutes(app: Express): void {

  app.post('/api/v1/webhooks', (req: Request, res: Response) => {
    const { url, events, secret } = req.body;
    if (!url || !events?.length) {
      res.status(400).json({ error: 'url 和 events 為必填' }); return;
    }
    const id = registerWebhook(url, events, secret);
    res.json({ id, url, events });
  });

  app.delete('/api/v1/webhooks/:id', (req: Request, res: Response) => {
    const ok = unregisterWebhook(req.params.id);
    if (!ok) { res.status(404).json({ error: 'webhook not found' }); return; }
    res.json({ success: true });
  });

  app.get('/api/v1/webhooks', (_req: Request, res: Response) => {
    res.json({ webhooks: listWebhooks() });
  });
}
