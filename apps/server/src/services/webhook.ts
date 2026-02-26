import { observability } from './observability.js';

export type WebhookEvent = 'document.created' | 'document.updated' | 'block.updated' | 'agent.completed';

interface WebhookSubscription {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret?: string;
}

const subscriptions: WebhookSubscription[] = [];

export function registerWebhook(url: string, events: WebhookEvent[], secret?: string): string {
  const id = Math.random().toString(36).slice(2);
  subscriptions.push({ id, url, events, secret });
  observability.info('Webhook registered', { id, url, events });
  return id;
}

export function unregisterWebhook(id: string): boolean {
  const idx = subscriptions.findIndex(s => s.id === id);
  if (idx === -1) return false;
  subscriptions.splice(idx, 1);
  return true;
}

export async function emitWebhookEvent(
  event: WebhookEvent,
  payload: Record<string, any>
): Promise<void> {
  const targets = subscriptions.filter(s => s.events.includes(event));
  if (targets.length === 0) return;

  const body = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });

  await Promise.allSettled(targets.map(async (sub) => {
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

export function listWebhooks(): WebhookSubscription[] {
  return subscriptions.map(({ id, url, events }) => ({ id, url, events }));
}
