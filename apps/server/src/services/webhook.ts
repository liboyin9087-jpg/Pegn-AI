import { pool } from '../db/client.js';
import { observability } from './observability.js';

export type WebhookEvent = 'document.created' | 'document.updated' | 'block.updated' | 'agent.completed';

export interface WebhookSubscription {
  id: string;
  workspace_id: string;
  user_id: string;
  url: string;
  events: WebhookEvent[];
  secret?: string;
  created_at?: string;
}

export async function registerWebhook(
  workspaceId: string,
  userId: string,
  url: string,
  events: WebhookEvent[],
  secret?: string
): Promise<string> {
  if (!pool) throw new Error('Database not available');

  const result = await pool.query(
    `INSERT INTO webhook_subscriptions (workspace_id, user_id, url, events, secret)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [workspaceId, userId, url, events, secret ?? null]
  );

  const id: string = result.rows[0].id;
  observability.info('Webhook registered', { id, url, events, workspaceId });
  return id;
}

export async function unregisterWebhook(id: string, userId: string): Promise<boolean> {
  if (!pool) return false;

  const result = await pool.query(
    `DELETE FROM webhook_subscriptions WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listWebhooks(workspaceId: string): Promise<Omit<WebhookSubscription, 'secret'>[]> {
  if (!pool) return [];

  const result = await pool.query(
    `SELECT id, workspace_id, user_id, url, events, created_at
     FROM webhook_subscriptions
     WHERE workspace_id = $1
     ORDER BY created_at DESC`,
    [workspaceId]
  );
  return result.rows;
}

export async function emitWebhookEvent(
  event: WebhookEvent,
  payload: Record<string, any>,
  workspaceId?: string
): Promise<void> {
  if (!pool) return;

  const result = workspaceId
    ? await pool.query(
        `SELECT id, url, secret FROM webhook_subscriptions WHERE workspace_id = $1 AND $2 = ANY(events)`,
        [workspaceId, event]
      )
    : await pool.query(
        `SELECT id, url, secret FROM webhook_subscriptions WHERE $1 = ANY(events)`,
        [event]
      );

  if (result.rows.length === 0) return;

  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });

  await Promise.allSettled(result.rows.map(async (sub: any) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (sub.secret) headers['X-Webhook-Secret'] = sub.secret;

      const res = await fetch(sub.url, { method: 'POST', headers, body });
      observability.info('Webhook delivered', { id: sub.id, event, status: res.status });
    } catch (error) {
      observability.error('Webhook delivery failed', { id: sub.id, url: sub.url, error });
    }
  }));
}
