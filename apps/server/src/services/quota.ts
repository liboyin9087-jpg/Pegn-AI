import { pool } from '../db/client.js';
import { observability } from './observability.js';

export type ResourceType = 'ai_tokens' | 'ai_calls' | 'agent_runs';

function dayPeriod(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function monthPeriod(): string {
  return new Date().toISOString().slice(0, 7); // YYYY-MM
}

function periodForResource(type: ResourceType): string {
  return type === 'ai_tokens' ? monthPeriod() : dayPeriod();
}

export async function recordUsage(
  workspaceId: string,
  userId: string | undefined,
  type: ResourceType,
  amount: number
): Promise<void> {
  const p = pool;
  if (!p || amount <= 0) return;

  const period = periodForResource(type);
  try {
    await p.query(
      `INSERT INTO usage_records (workspace_id, user_id, resource_type, period, amount)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, resource_type, period)
       DO UPDATE SET amount = usage_records.amount + EXCLUDED.amount, updated_at = NOW()`,
      [workspaceId, userId ?? null, type, period, amount]
    );
  } catch (error) {
    observability.warn('Failed to record usage', { workspaceId, type, amount, error });
  }
}

export async function checkQuota(
  workspaceId: string,
  type: ResourceType,
  requestedAmount = 1
): Promise<{ allowed: boolean; used: number; limit: number; remaining: number }> {
  const p = pool;
  if (!p) return { allowed: true, used: 0, limit: Infinity, remaining: Infinity };

  try {
    // Get workspace quota limits (creates defaults if not exists)
    const quotaRes = await p.query(
      `INSERT INTO quota_limits (workspace_id)
       VALUES ($1)
       ON CONFLICT (workspace_id) DO NOTHING`,
      [workspaceId]
    );

    const limitsRes = await p.query(
      `SELECT ai_tokens_per_month, ai_calls_per_day, agent_runs_per_day
       FROM quota_limits WHERE workspace_id = $1`,
      [workspaceId]
    );

    const limits = limitsRes.rows[0];
    const limitMap: Record<ResourceType, number> = {
      ai_tokens: limits?.ai_tokens_per_month ?? 100000,
      ai_calls: limits?.ai_calls_per_day ?? 200,
      agent_runs: limits?.agent_runs_per_day ?? 20,
    };
    const limit = limitMap[type];

    const period = periodForResource(type);
    const usageRes = await p.query(
      `SELECT COALESCE(amount, 0) as amount FROM usage_records
       WHERE workspace_id = $1 AND resource_type = $2 AND period = $3`,
      [workspaceId, type, period]
    );
    const used = parseInt(usageRes.rows[0]?.amount ?? '0', 10);
    const remaining = Math.max(0, limit - used);

    return {
      allowed: used + requestedAmount <= limit,
      used,
      limit,
      remaining,
    };
  } catch (error) {
    observability.warn('Failed to check quota', { workspaceId, type, error });
    return { allowed: true, used: 0, limit: Infinity, remaining: Infinity };
  }
}

export async function getWorkspaceUsage(workspaceId: string): Promise<{
  plan: string;
  quotas: Record<ResourceType, { limit: number; used: number; remaining: number; period: string }>;
}> {
  const p = pool;
  if (!p) return { plan: 'unknown', quotas: {} as any };

  const limitsRes = await p.query(
    `SELECT plan, ai_tokens_per_month, ai_calls_per_day, agent_runs_per_day
     FROM quota_limits WHERE workspace_id = $1`,
    [workspaceId]
  );

  const row = limitsRes.rows[0] ?? { plan: 'free', ai_tokens_per_month: 100000, ai_calls_per_day: 200, agent_runs_per_day: 20 };

  const resources: ResourceType[] = ['ai_tokens', 'ai_calls', 'agent_runs'];
  const quotas: any = {};

  for (const type of resources) {
    const period = periodForResource(type);
    const usageRes = await p.query(
      `SELECT COALESCE(amount, 0) as amount FROM usage_records
       WHERE workspace_id = $1 AND resource_type = $2 AND period = $3`,
      [workspaceId, type, period]
    );
    const used = parseInt(usageRes.rows[0]?.amount ?? '0', 10);
    const limitMap: Record<ResourceType, number> = {
      ai_tokens: row.ai_tokens_per_month,
      ai_calls: row.ai_calls_per_day,
      agent_runs: row.agent_runs_per_day,
    };
    const limit = limitMap[type];
    quotas[type] = { limit, used, remaining: Math.max(0, limit - used), period };
  }

  return { plan: row.plan, quotas };
}
