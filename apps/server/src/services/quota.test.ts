import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPool = {
  query: vi.fn(),
};

vi.mock('../db/client.js', () => ({
  pool: mockPool,
}));

describe('quota plan management', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns available Free/Pro/Team presets', async () => {
    const { getAvailablePlans } = await import('./quota.js');
    const plans = getAvailablePlans();

    expect(Object.keys(plans)).toEqual(['free', 'pro', 'team']);
    expect(plans.free.ai_tokens_per_month).toBe(100000);
    expect(plans.pro.ai_calls_per_day).toBe(2000);
    expect(plans.team.agent_runs_per_day).toBe(1000);
  });

  it('updates workspace plan with normalized alias enterprise -> team', async () => {
    const { setWorkspacePlan } = await import('./quota.js');

    const result = await setWorkspacePlan('ws-1', 'enterprise');

    expect(result.plan).toBe('team');
    expect(result.quotas.ai_tokens_per_month).toBe(5000000);
    expect(mockPool.query).toHaveBeenCalledTimes(1);
    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO quota_limits'),
      ['ws-1', 'team', 5000000, 10000, 1000]
    );
  });

  it('rejects invalid plans', async () => {
    const { setWorkspacePlan } = await import('./quota.js');

    await expect(setWorkspacePlan('ws-1', 'starter')).rejects.toThrow('Invalid plan');
    expect(mockPool.query).not.toHaveBeenCalled();
  });

  it('reads and normalizes current workspace plan', async () => {
    const { getWorkspacePlan } = await import('./quota.js');

    mockPool.query
      .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      .mockResolvedValueOnce({
        rows: [{
          plan: 'enterprise',
          ai_tokens_per_month: 7000000,
          ai_calls_per_day: 12000,
          agent_runs_per_day: 1200,
        }],
        rowCount: 1,
      });

    const result = await getWorkspacePlan('ws-1');

    expect(result.plan).toBe('team');
    expect(result.quotas.ai_tokens_per_month).toBe(7000000);
    expect(mockPool.query).toHaveBeenCalledTimes(2);
  });
});

// P2-2: checkQuota / recordUsage / estimateUsdCost / checkCostAlert unit tests
describe('checkQuota', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('allows when usage is below limit', async () => {
    // ensureWorkspaceQuotaRow (1 INSERT) + getLimit query (1) + getUsage query (1)
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })   // ensureWorkspaceQuotaRow
      .mockResolvedValueOnce({ rows: [{ ai_tokens_per_month: 100000, ai_calls_per_day: 200, agent_runs_per_day: 20 }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ amount: '50' }], rowCount: 1 });

    const { checkQuota } = await import('./quota.js');
    const result = await checkQuota('ws-1', 'ai_calls');

    expect(result.allowed).toBe(true);
    expect(result.used).toBe(50);
    expect(result.limit).toBe(200);
    expect(result.remaining).toBe(150);
  });

  it('blocks when usage meets or exceeds limit', async () => {
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ ai_tokens_per_month: 100000, ai_calls_per_day: 200, agent_runs_per_day: 20 }] })
      .mockResolvedValueOnce({ rows: [{ amount: '200' }] });

    const { checkQuota } = await import('./quota.js');
    const result = await checkQuota('ws-1', 'ai_calls');

    expect(result.allowed).toBe(false);
    expect(result.used).toBe(200);
    expect(result.remaining).toBe(0);
  });
});

describe('recordUsage', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it('upserts usage_records with the given amount', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [] });

    const { recordUsage } = await import('./quota.js');
    await recordUsage('ws-1', 'u-1', 'ai_tokens', 512);

    expect(mockPool.query).toHaveBeenCalledTimes(1);
    const [sql, params] = mockPool.query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('INSERT INTO usage_records');
    expect(sql).toContain('ON CONFLICT');
    expect(params).toContain('ws-1');
    expect(params).toContain('ai_tokens');
    expect(params).toContain(512);
  });
});

describe('estimateUsdCost', () => {
  it('returns 0 for mock provider', async () => {
    const { estimateUsdCost } = await import('./quota.js');
    expect(estimateUsdCost(1_000_000, 'mock')).toBe(0);
  });

  it('uses per-provider rate correctly', async () => {
    const { estimateUsdCost } = await import('./quota.js');
    // gemini: 0.00015 per 1k → 1000 tokens = 0.00015
    expect(estimateUsdCost(1000, 'gemini')).toBeCloseTo(0.00015, 6);
    // claude: 0.009 per 1k → 1000 tokens = 0.009
    expect(estimateUsdCost(1000, 'claude')).toBeCloseTo(0.009, 6);
  });

  it('falls back to default rate for unknown provider', async () => {
    const { estimateUsdCost } = await import('./quota.js');
    const defaultCost = estimateUsdCost(1000, 'unknown-llm');
    expect(defaultCost).toBeGreaterThan(0);
  });
});

describe('checkCostAlert', () => {
  // NOTE: Do NOT use vi.resetModules here — avoid cross-describe mock contamination.
  // The module-level vi.mock for db/client already ensures pool = mockPool.
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AGENT_LLM_PROVIDER;
  });

  it('returns warning=false when usage is below 80% threshold', async () => {
    const { checkCostAlert } = await import('./quota.js');

    // checkCostAlert calls:
    //   1. ensureWorkspaceQuotaRow → 1 INSERT query
    //   2. Promise.all([limitsQuery, usageQuery]) → 2 queries
    mockPool.query
      .mockResolvedValueOnce({ rows: [] })   // ensure row
      .mockResolvedValueOnce({ rows: [{ plan: 'free', ai_tokens_per_month: 100000 }] })
      .mockResolvedValueOnce({ rows: [{ amount: '70000' }] });  // 70% usage

    const alert = await checkCostAlert('ws-1');

    expect(alert.warning).toBe(false);
    expect(alert.pct).toBeCloseTo(0.7, 2);
    expect(alert.cost_usd).toBeGreaterThanOrEqual(0);
    expect(alert.workspace_id).toBe('ws-1');
  });

  it('returns warning=true when usage reaches 80%+', async () => {
    const { checkCostAlert } = await import('./quota.js');

    mockPool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ plan: 'free', ai_tokens_per_month: 100000 }] })
      .mockResolvedValueOnce({ rows: [{ amount: '85000' }] });  // 85% usage

    const alert = await checkCostAlert('ws-1');

    expect(alert.warning).toBe(true);
    expect(alert.pct).toBeGreaterThanOrEqual(0.8);
    expect(alert.remaining_usd).toBeGreaterThanOrEqual(0);
  });
});
