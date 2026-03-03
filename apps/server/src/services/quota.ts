import { pool } from '../db/client.js';
import { observability } from './observability.js';

export type ResourceType = 'ai_tokens' | 'ai_calls' | 'agent_runs';
export type BillingPlan = 'free' | 'pro' | 'team';

export interface PlanQuotaPreset {
  ai_tokens_per_month: number;
  ai_calls_per_day: number;
  agent_runs_per_day: number;
}

const PLAN_QUOTA_PRESETS: Record<BillingPlan, PlanQuotaPreset> = {
  free: {
    ai_tokens_per_month: 100000,
    ai_calls_per_day: 200,
    agent_runs_per_day: 20,
  },
  pro: {
    ai_tokens_per_month: 1000000,
    ai_calls_per_day: 2000,
    agent_runs_per_day: 200,
  },
  team: {
    ai_tokens_per_month: 5000000,
    ai_calls_per_day: 10000,
    agent_runs_per_day: 1000,
  },
};

function normalizePlan(plan: string | undefined): BillingPlan | null {
  if (!plan) return null;
  const normalized = plan.toLowerCase();
  if (normalized === 'enterprise') return 'team';
  if (normalized === 'free' || normalized === 'pro' || normalized === 'team') return normalized;
  return null;
}

// P2-2: LLM 成本治理 — 每 1k tokens 的 USD 費用
const LLM_COST_PER_1K_TOKENS: Record<string, number> = {
  gemini: 0.00015,    // Gemini 1.5 Flash
  openai: 0.0003,     // GPT-4o-mini
  claude: 0.009,      // Claude 3.5 Sonnet
  mock: 0,
  default: 0.001,
};

/**
 * 根據 token 數量與 LLM 提供者估算 USD 花費。
 */
export function estimateUsdCost(tokens: number, provider = 'default'): number {
  const rate = LLM_COST_PER_1K_TOKENS[provider] ?? LLM_COST_PER_1K_TOKENS.default;
  return Math.round((tokens / 1000) * rate * 1e6) / 1e6; // 精確到微分
}

// 每月 Token Budget 的 USD 上限（對應 PLAN_QUOTA_PRESETS）
const PLAN_USD_BUDGET: Record<BillingPlan, number> = {
  free: estimateUsdCost(100_000),     // ~$0.10
  pro: estimateUsdCost(1_000_000),    // ~$1.00
  team: estimateUsdCost(5_000_000),   // ~$5.00
};

const COST_ALERT_THRESHOLD_PCT = 0.8; // 達到 80% 即告警

export interface CostAlert {
  workspace_id: string;
  pct: number;
  warning: boolean;
  cost_usd: number;
  budget_usd: number;
  remaining_usd: number;
  period: string;
}

/**
 * 查詢 workspace 當月 ai_tokens 用量，計算成本占比，回傳告警結構。
 */
export async function checkCostAlert(workspaceId: string): Promise<CostAlert> {
  const p = pool;
  const period = periodForResource('ai_tokens');

  const fallback: CostAlert = {
    workspace_id: workspaceId,
    pct: 0,
    warning: false,
    cost_usd: 0,
    budget_usd: 0,
    remaining_usd: 0,
    period,
  };

  if (!p) return fallback;

  try {
    await ensureWorkspaceQuotaRow(workspaceId);

    const [limitsRes, usageRes] = await Promise.all([
      p.query(
        `SELECT plan, ai_tokens_per_month FROM quota_limits WHERE workspace_id = $1`,
        [workspaceId]
      ),
      p.query(
        `SELECT COALESCE(amount, 0) as amount FROM usage_records
         WHERE workspace_id = $1 AND resource_type = 'ai_tokens' AND period = $2`,
        [workspaceId, period]
      ),
    ]);

    const row = limitsRes.rows[0] ?? { plan: 'free', ai_tokens_per_month: PLAN_QUOTA_PRESETS.free.ai_tokens_per_month };
    const plan = normalizePlan(row.plan) ?? 'free';
    const tokenLimit: number = parseInt(row.ai_tokens_per_month, 10);
    const tokenUsed: number = parseInt(usageRes.rows[0]?.amount ?? '0', 10);

    // 取得 agent provider 作為成本基準（fallback 到 default）
    const provider = (process.env.AGENT_LLM_PROVIDER ?? 'default').toLowerCase();
    const cost_usd = estimateUsdCost(tokenUsed, provider);
    const budget_usd = PLAN_USD_BUDGET[plan as BillingPlan] ?? estimateUsdCost(tokenLimit);
    const pct = tokenLimit > 0 ? Math.min(1, tokenUsed / tokenLimit) : 0;
    const warning = pct >= COST_ALERT_THRESHOLD_PCT;

    if (warning) {
      observability.warn('Cost alert threshold reached', { workspaceId, pct, cost_usd, budget_usd, period });
    }

    return {
      workspace_id: workspaceId,
      pct: Math.round(pct * 10000) / 10000,
      warning,
      cost_usd,
      budget_usd,
      remaining_usd: Math.max(0, Math.round((budget_usd - cost_usd) * 1e6) / 1e6),
      period,
    };
  } catch (error) {
    observability.warn('checkCostAlert failed', { workspaceId, error });
    return fallback;
  }
}

function getLimitByResource(type: ResourceType, row: { ai_tokens_per_month: number; ai_calls_per_day: number; agent_runs_per_day: number }): number {
  const limitMap: Record<ResourceType, number> = {
    ai_tokens: row.ai_tokens_per_month,
    ai_calls: row.ai_calls_per_day,
    agent_runs: row.agent_runs_per_day,
  };

  return limitMap[type];
}

async function ensureWorkspaceQuotaRow(workspaceId: string): Promise<void> {
  const p = pool;
  if (!p) return;

  const preset = PLAN_QUOTA_PRESETS.free;
  await p.query(
    `INSERT INTO quota_limits (workspace_id, plan, ai_tokens_per_month, ai_calls_per_day, agent_runs_per_day)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id) DO NOTHING`,
    [workspaceId, 'free', preset.ai_tokens_per_month, preset.ai_calls_per_day, preset.agent_runs_per_day]
  );
}

export function getAvailablePlans(): Record<BillingPlan, PlanQuotaPreset> {
  return PLAN_QUOTA_PRESETS;
}

export async function setWorkspacePlan(workspaceId: string, plan: string): Promise<{ plan: BillingPlan; quotas: PlanQuotaPreset }> {
  const p = pool;
  const normalizedPlan = normalizePlan(plan);

  if (!normalizedPlan) {
    throw new Error('Invalid plan. Must be one of: free, pro, team');
  }

  const preset = PLAN_QUOTA_PRESETS[normalizedPlan];

  if (!p) {
    return { plan: normalizedPlan, quotas: preset };
  }

  await p.query(
    `INSERT INTO quota_limits (workspace_id, plan, ai_tokens_per_month, ai_calls_per_day, agent_runs_per_day)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (workspace_id)
     DO UPDATE SET
       plan = EXCLUDED.plan,
       ai_tokens_per_month = EXCLUDED.ai_tokens_per_month,
       ai_calls_per_day = EXCLUDED.ai_calls_per_day,
       agent_runs_per_day = EXCLUDED.agent_runs_per_day,
       updated_at = NOW()`,
    [workspaceId, normalizedPlan, preset.ai_tokens_per_month, preset.ai_calls_per_day, preset.agent_runs_per_day]
  );

  return { plan: normalizedPlan, quotas: preset };
}

export async function getWorkspacePlan(workspaceId: string): Promise<{ plan: BillingPlan; quotas: PlanQuotaPreset }> {
  const p = pool;

  if (!p) {
    return { plan: 'free', quotas: PLAN_QUOTA_PRESETS.free };
  }

  await ensureWorkspaceQuotaRow(workspaceId);

  const result = await p.query(
    `SELECT plan, ai_tokens_per_month, ai_calls_per_day, agent_runs_per_day
     FROM quota_limits WHERE workspace_id = $1`,
    [workspaceId]
  );

  const row = result.rows[0];
  const normalizedPlan = normalizePlan(row?.plan) ?? 'free';

  return {
    plan: normalizedPlan,
    quotas: {
      ai_tokens_per_month: row?.ai_tokens_per_month ?? PLAN_QUOTA_PRESETS[normalizedPlan].ai_tokens_per_month,
      ai_calls_per_day: row?.ai_calls_per_day ?? PLAN_QUOTA_PRESETS[normalizedPlan].ai_calls_per_day,
      agent_runs_per_day: row?.agent_runs_per_day ?? PLAN_QUOTA_PRESETS[normalizedPlan].agent_runs_per_day,
    },
  };
}

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
  // QUOTA_DISABLED=true → always allow (unlimited API mode)
  if (process.env.QUOTA_DISABLED === 'true') {
    return { allowed: true, used: 0, limit: Infinity, remaining: Infinity };
  }

  const p = pool;
  if (!p) return { allowed: true, used: 0, limit: Infinity, remaining: Infinity };

  try {
    await ensureWorkspaceQuotaRow(workspaceId);

    const limitsRes = await p.query(
      `SELECT ai_tokens_per_month, ai_calls_per_day, agent_runs_per_day
       FROM quota_limits WHERE workspace_id = $1`,
      [workspaceId]
    );

    const limits = limitsRes.rows[0] ?? PLAN_QUOTA_PRESETS.free;
    const limit = getLimitByResource(type, limits);

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
  quotas: Record<ResourceType, { limit: number; used: number; remaining: number; period: string; cost_estimate_usd?: number }>;
}> {
  const p = pool;
  if (!p) return { plan: 'unknown', quotas: {} as any };

  await ensureWorkspaceQuotaRow(workspaceId);

  const limitsRes = await p.query(
    `SELECT plan, ai_tokens_per_month, ai_calls_per_day, agent_runs_per_day
     FROM quota_limits WHERE workspace_id = $1`,
    [workspaceId]
  );

  const row = limitsRes.rows[0] ?? { plan: 'free', ...PLAN_QUOTA_PRESETS.free };

  const resources: ResourceType[] = ['ai_tokens', 'ai_calls', 'agent_runs'];
  const quotas: any = {};
  const provider = (process.env.AGENT_LLM_PROVIDER ?? 'default').toLowerCase();

  for (const type of resources) {
    const period = periodForResource(type);
    const usageRes = await p.query(
      `SELECT COALESCE(amount, 0) as amount FROM usage_records
       WHERE workspace_id = $1 AND resource_type = $2 AND period = $3`,
      [workspaceId, type, period]
    );
    const used = parseInt(usageRes.rows[0]?.amount ?? '0', 10);
    const limit = getLimitByResource(type, row);
    quotas[type] = {
      limit,
      used,
      remaining: Math.max(0, limit - used),
      period,
      // P2-2: 僅對 token 資源附加成本估算
      ...(type === 'ai_tokens' ? { cost_estimate_usd: estimateUsdCost(used, provider) } : {}),
    };
  }

  return { plan: row.plan, quotas };
}
