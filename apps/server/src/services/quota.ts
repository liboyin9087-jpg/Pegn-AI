import { pool } from '../db/client.js';
import { listWorkspaceAdmins } from '../lib/workspaceRoles.js';
import { observability } from './observability.js';
import { recordAuditLog } from './admin.js';

export type ResourceType = 'ai_tokens' | 'ai_calls' | 'agent_runs';

const TOKEN_COST_USD_PER_1K = parseFloat(process.env.TOKEN_COST_USD_PER_1K ?? '0.01');

export function tokensToUSD(tokens: number): number {
  return Math.round((tokens / 1000) * TOKEN_COST_USD_PER_1K * 1_000_000) / 1_000_000;
}

function dayPeriod(): string {
  return new Date().toISOString().slice(0, 10);
}

function monthPeriod(): string {
  return new Date().toISOString().slice(0, 7);
}

function periodForResource(type: ResourceType): string {
  return type === 'ai_tokens' ? monthPeriod() : dayPeriod();
}

export async function notifyQuotaAlert(
  workspaceId: string,
  type: ResourceType,
  thresholdPct: number,
  used: number,
  limit: number,
  period: string
): Promise<void> {
  const p = pool;
  if (!p) return;

  try {
    const flagKey = `quota_alert_${type}_${thresholdPct}_${period}`;
    const alreadySent = await p.query(
      `SELECT 1 FROM system_metrics WHERE workspace_id = $1 AND name = $2 LIMIT 1`,
      [workspaceId, flagKey]
    );
    if ((alreadySent.rowCount ?? 0) > 0) return;

    const adminIds = await listWorkspaceAdmins(workspaceId);
    if (adminIds.length === 0) return;

    const label = thresholdPct >= 100 ? '已達上限' : `已達 ${thresholdPct}%`;
    const message = `Quota 警告：${type} 用量${label}（${used}/${limit}，週期 ${period}）`;
    const payload = {
      title: 'Quota 警告',
      message,
      resource_type: type,
      used,
      limit,
      period,
      threshold_pct: thresholdPct,
    };

    for (const userId of adminIds) {
      await p.query(
        `INSERT INTO inbox_notifications (user_id, workspace_id, type, payload, status)
         VALUES ($1, $2, 'quota_alert', $3::jsonb, 'unread')
         ON CONFLICT DO NOTHING`,
        [userId, workspaceId, JSON.stringify(payload)]
      );
    }

    await p.query(
      `INSERT INTO system_metrics (workspace_id, name, value) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [workspaceId, flagKey, used]
    );

    await recordAuditLog({
      workspaceId,
      actorId: null,
      actorDisplay: 'System',
      eventType: 'quota_alert_raised',
      targetType: 'quota',
      targetId: type,
      summary: `Quota alert raised for ${type} at ${thresholdPct}%`,
      metadata: {
        resourceType: type,
        thresholdPct,
        used,
        limit,
        period,
      },
    });

    observability.warn('Quota threshold alert sent', {
      workspaceId,
      type,
      thresholdPct,
      used,
      limit,
      period,
    });
  } catch (err) {
    observability.warn('Failed to send quota alert', { workspaceId, type, err });
  }
}

export async function recordUsage(
  workspaceId: string,
  userId: string | undefined,
  type: ResourceType,
  amount: number,
  costUsd?: number
): Promise<void> {
  const p = pool;
  if (!p || amount <= 0) return;

  const period = periodForResource(type);
  const cost = costUsd ?? (type === 'ai_tokens' ? tokensToUSD(amount) : 0);

  try {
    await p.query(
      `INSERT INTO usage_records (workspace_id, user_id, resource_type, period, amount, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (workspace_id, resource_type, period)
       DO UPDATE SET amount = usage_records.amount + EXCLUDED.amount,
                     cost_usd = usage_records.cost_usd + EXCLUDED.cost_usd,
                     updated_at = NOW()`,
      [workspaceId, userId ?? null, type, period, amount, cost]
    );

    void (async () => {
      const quota = await checkQuota(workspaceId, type);
      const pct = quota.limit > 0 ? (quota.used / quota.limit) * 100 : 0;
      if (pct >= 100) await notifyQuotaAlert(workspaceId, type, 100, quota.used, quota.limit, period);
      else if (pct >= 80) await notifyQuotaAlert(workspaceId, type, 80, quota.used, quota.limit, period);
    })();
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
    await p.query(
      `INSERT INTO quota_limits (workspace_id)
       VALUES ($1)
       ON CONFLICT (workspace_id) DO NOTHING`,
      [workspaceId]
    );

    const limitsRes = await p.query(
      `SELECT ai_tokens_per_month, ai_calls_per_day, agent_runs_per_day, cost_usd_ceiling
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
    const costUsdCeiling: number | null = limits?.cost_usd_ceiling ?? null;

    const period = periodForResource(type);
    const usageRes = await p.query(
      `SELECT COALESCE(amount, 0) as amount, COALESCE(cost_usd, 0) as cost_usd
       FROM usage_records
       WHERE workspace_id = $1 AND resource_type = $2 AND period = $3`,
      [workspaceId, type, period]
    );

    const used = parseInt(usageRes.rows[0]?.amount ?? '0', 10);
    const usedCostUsd = parseFloat(usageRes.rows[0]?.cost_usd ?? '0');
    const remaining = Math.max(0, limit - used);

    if (costUsdCeiling !== null && usedCostUsd >= costUsdCeiling) {
      return { allowed: false, used, limit, remaining };
    }

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
  quotas: Record<ResourceType, { limit: number; used: number; remaining: number; period: string; cost_usd: number }>;
  cost_usd_ceiling: number | null;
}> {
  const p = pool;
  if (!p) return { plan: 'unknown', quotas: {} as any, cost_usd_ceiling: null };

  const limitsRes = await p.query(
    `SELECT plan, ai_tokens_per_month, ai_calls_per_day, agent_runs_per_day, cost_usd_ceiling
     FROM quota_limits WHERE workspace_id = $1`,
    [workspaceId]
  );

  const row = limitsRes.rows[0] ?? {
    plan: 'free',
    ai_tokens_per_month: 100000,
    ai_calls_per_day: 200,
    agent_runs_per_day: 20,
    cost_usd_ceiling: null,
  };

  const resources: ResourceType[] = ['ai_tokens', 'ai_calls', 'agent_runs'];
  const quotas: Record<ResourceType, { limit: number; used: number; remaining: number; period: string; cost_usd: number }> = {
    ai_tokens: { limit: 0, used: 0, remaining: 0, period: '', cost_usd: 0 },
    ai_calls: { limit: 0, used: 0, remaining: 0, period: '', cost_usd: 0 },
    agent_runs: { limit: 0, used: 0, remaining: 0, period: '', cost_usd: 0 },
  };

  for (const type of resources) {
    const period = periodForResource(type);
    const usageRes = await p.query(
      `SELECT COALESCE(amount, 0) as amount, COALESCE(cost_usd, 0) as cost_usd
       FROM usage_records
       WHERE workspace_id = $1 AND resource_type = $2 AND period = $3`,
      [workspaceId, type, period]
    );
    const used = parseInt(usageRes.rows[0]?.amount ?? '0', 10);
    const cost_usd = parseFloat(usageRes.rows[0]?.cost_usd ?? '0');
    const limitMap: Record<ResourceType, number> = {
      ai_tokens: row.ai_tokens_per_month,
      ai_calls: row.ai_calls_per_day,
      agent_runs: row.agent_runs_per_day,
    };
    const limit = limitMap[type];
    quotas[type] = { limit, used, remaining: Math.max(0, limit - used), period, cost_usd };
  }

  return { plan: row.plan, quotas, cost_usd_ceiling: row.cost_usd_ceiling ?? null };
}

export async function updateQuotaLimits(
  workspaceId: string,
  patch: Partial<{
    ai_tokens_per_month: number;
    ai_calls_per_day: number;
    agent_runs_per_day: number;
    cost_usd_ceiling: number | null;
  }>
): Promise<void> {
  const p = pool;
  if (!p) throw new Error('Database not available');

  const fields: string[] = [];
  const values: unknown[] = [workspaceId];
  let idx = 2;

  if (patch.ai_tokens_per_month !== undefined) {
    fields.push(`ai_tokens_per_month = $${idx++}`);
    values.push(patch.ai_tokens_per_month);
  }
  if (patch.ai_calls_per_day !== undefined) {
    fields.push(`ai_calls_per_day = $${idx++}`);
    values.push(patch.ai_calls_per_day);
  }
  if (patch.agent_runs_per_day !== undefined) {
    fields.push(`agent_runs_per_day = $${idx++}`);
    values.push(patch.agent_runs_per_day);
  }
  if ('cost_usd_ceiling' in patch) {
    fields.push(`cost_usd_ceiling = $${idx++}`);
    values.push(patch.cost_usd_ceiling);
  }

  if (fields.length === 0) return;

  await p.query(
    `INSERT INTO quota_limits (workspace_id)
     VALUES ($1)
     ON CONFLICT (workspace_id) DO NOTHING`,
    [workspaceId]
  );

  await p.query(
    `UPDATE quota_limits SET ${fields.join(', ')}, updated_at = NOW() WHERE workspace_id = $1`,
    values
  );
}
