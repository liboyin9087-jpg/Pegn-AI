import type { Express, Request, Response } from 'express';
import Stripe from 'stripe';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { getWorkspaceIdFromRequest } from '../services/request.js';
import { getWorkspaceUsage, checkQuota, getAvailablePlans, getWorkspacePlan, setWorkspacePlan, checkCostAlert } from '../services/quota.js';
import { auditLog } from '../services/audit.js';

// Lazy Stripe client — only created when STRIPE_SECRET_KEY is set
function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  return new Stripe(key, { apiVersion: '2026-02-25.clover' });
}

// Stripe Price IDs per plan (set via env vars so they work in both test+prod)
const STRIPE_PRICE_IDS: Record<string, string | undefined> = {
  pro:   process.env.STRIPE_PRICE_ID_PRO,
  team:  process.env.STRIPE_PRICE_ID_TEAM,
};

export function registerBillingRoutes(app: Express): void {
  // Get available billing plans and quotas
  app.get('/api/v1/billing/plans', authMiddleware, (_req: Request, res: Response) => {
    res.json({ plans: getAvailablePlans() });
  });

  // Get current workspace plan
  app.get('/api/v1/billing/plan', authMiddleware, checkPermission('workspace:admin'), async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    if (!workspaceId) { res.status(400).json({ error: 'workspace_id required' }); return; }

    try {
      const plan = await getWorkspacePlan(workspaceId);
      res.json(plan);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch current plan' });
    }
  });

  // Set workspace billing plan
  app.post('/api/v1/billing/plan', authMiddleware, checkPermission('workspace:admin'), async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    const { plan } = req.body as { plan?: string };
    if (!workspaceId || !plan) {
      res.status(400).json({ error: 'workspace_id and plan required' });
      return;
    }

    try {
      const oldPlan = await getWorkspacePlan(workspaceId);
      const updated = await setWorkspacePlan(workspaceId, plan);
      // P0 Security: audit plan change
      const userId = (req as any).userId;
      await auditLog({ workspaceId, actorUserId: userId, action: 'billing.plan_changed', resourceType: 'quota_limits', resourceId: workspaceId, oldValue: { plan: oldPlan?.plan }, newValue: { plan }, req });
      res.json(updated);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid plan')) {
        res.status(400).json({ error: error.message });
        return;
      }
      res.status(500).json({ error: 'Failed to update billing plan' });
    }
  });

  // Get workspace usage & quota status
  app.get('/api/v1/billing/usage', authMiddleware, checkPermission('workspace:admin'), async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    if (!workspaceId) { res.status(400).json({ error: 'workspace_id required' }); return; }

    try {
      const usage = await getWorkspaceUsage(workspaceId);
      res.json(usage);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch usage data' });
    }
  });

  // Check quota for a specific resource (used by client before heavy operations)
  app.get('/api/v1/billing/quota', authMiddleware, async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    const { resource } = req.query as { resource?: string };
    if (!workspaceId || !resource) { res.status(400).json({ error: 'workspace_id and resource required' }); return; }

    const validResources = ['ai_tokens', 'ai_calls', 'agent_runs'];
    if (!validResources.includes(resource)) {
      res.status(400).json({ error: `resource must be one of: ${validResources.join(', ')}` });
      return;
    }

    try {
      const quota = await checkQuota(workspaceId, resource as any);
      res.json(quota);
    } catch (error) {
      res.status(500).json({ error: 'Failed to check quota' });
    }
  });

  // P2-2: 成本告警 — 查詢當月 token 花費占比，超過 80% 回傳 warning:true
  app.get('/api/v1/billing/cost-alert', authMiddleware, async (req: Request, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    if (!workspaceId) { res.status(400).json({ error: 'workspace_id required' }); return; }

    try {
      const alert = await checkCostAlert(workspaceId);
      res.json(alert);
    } catch (error) {
      res.status(500).json({ error: 'Failed to check cost alert' });
    }
  });

  // ── P0 Monetization: Stripe Checkout ─────────────────────────────────────

  /**
   * POST /api/v1/billing/checkout
   * Creates a Stripe Checkout Session for plan upgrade.
   * Body: { plan: 'pro' | 'team', success_url, cancel_url }
   */
  app.post('/api/v1/billing/checkout', authMiddleware, checkPermission('workspace:admin'), async (req: Request, res: Response) => {
    const stripe = getStripe();
    if (!stripe) {
      res.status(503).json({ error: 'Payment processing is not configured.' });
      return;
    }

    const workspaceId = getWorkspaceIdFromRequest(req);
    const { plan, success_url, cancel_url } = req.body as { plan?: string; success_url?: string; cancel_url?: string };

    if (!workspaceId || !plan || !success_url || !cancel_url) {
      res.status(400).json({ error: 'workspace_id, plan, success_url, cancel_url required' });
      return;
    }

    const priceId = STRIPE_PRICE_IDS[plan];
    if (!priceId) {
      res.status(400).json({ error: `No Stripe price configured for plan: ${plan}` });
      return;
    }

    try {
      const session = await stripe.checkout.sessions.create({
        mode: 'subscription',
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${success_url}?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url,
        metadata: { workspace_id: workspaceId, plan },
      });

      res.json({ url: session.url, session_id: session.id });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create checkout session' });
    }
  });

  /**
   * POST /api/v1/billing/webhook
   * Stripe webhook handler — updates quota_limits on successful subscription.
   * Requires raw body parsing (configured via express.raw middleware in index.ts).
   */
  app.post(
    '/api/v1/billing/webhook',
    // Note: must receive raw body for Stripe signature verification
    (req: Request, res: Response, next) => {
      if (req.headers['content-type'] === 'application/json') {
        // Body was already parsed as JSON by express.json() — skip raw verification in dev
        return next();
      }
      next();
    },
    async (req: Request, res: Response) => {
      const stripe = getStripe();
      if (!stripe) { res.status(503).send('Not configured'); return; }

      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      let event: Stripe.Event;

      // In production, STRIPE_WEBHOOK_SECRET is mandatory — reject unsigned requests.
      if (process.env.NODE_ENV === 'production' && !webhookSecret) {
        console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not set in production');
        res.status(503).send('Webhook not configured');
        return;
      }

      try {
        if (webhookSecret && req.headers['stripe-signature']) {
          const rawBody = (req as any).rawBody ?? JSON.stringify(req.body);
          event = stripe.webhooks.constructEvent(
            rawBody,
            req.headers['stripe-signature'] as string,
            webhookSecret
          );
        } else if (process.env.NODE_ENV !== 'production') {
          // Development only: trust the body directly (no signature check)
          event = req.body as Stripe.Event;
        } else {
          // Production without signature header — reject
          res.status(400).send('Missing Stripe-Signature header');
          return;
        }
      } catch (err) {
        res.status(400).send(`Webhook signature verification failed`);
        return;
      }

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as Stripe.Checkout.Session;
        const workspaceId = session.metadata?.workspace_id;
        const plan = session.metadata?.plan;

        if (workspaceId && plan) {
          try {
            await setWorkspacePlan(workspaceId, plan);
            await auditLog({
              workspaceId,
              action: 'billing.plan_changed',
              resourceType: 'quota_limits',
              resourceId: workspaceId,
              newValue: { plan, source: 'stripe_webhook', session_id: session.id },
            });
          } catch (err) {
            // Log but return 200 so Stripe doesn't retry unnecessarily
            console.error('[stripe-webhook] Failed to update plan:', err);
          }
        }
      }

      res.json({ received: true });
    }
  );

  /**
   * POST /api/v1/billing/portal
   * Creates a Stripe Customer Portal session for subscription management.
   */
  app.post('/api/v1/billing/portal', authMiddleware, checkPermission('workspace:admin'), async (req: Request, res: Response) => {
    const stripe = getStripe();
    if (!stripe) {
      res.status(503).json({ error: 'Payment processing is not configured.' });
      return;
    }

    const { return_url, customer_id } = req.body as { return_url?: string; customer_id?: string };
    if (!return_url || !customer_id) {
      res.status(400).json({ error: 'return_url and customer_id required' });
      return;
    }

    try {
      const portalSession = await stripe.billingPortal.sessions.create({
        customer: customer_id,
        return_url,
      });
      res.json({ url: portalSession.url });
    } catch (err) {
      res.status(500).json({ error: 'Failed to create portal session' });
    }
  });
}
