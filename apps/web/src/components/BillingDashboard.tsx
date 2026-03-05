import React, { useEffect, useState, useCallback } from 'react';
import { Zap, TrendingUp, AlertTriangle, ChevronRight, Loader2, RefreshCw } from 'lucide-react';
import { getBillingUsage, getCostAlert, getBillingPlans, startCheckout } from '../api/client';
import { trackViewBilling, trackCheckoutStarted } from '../lib/analytics';

interface BillingDashboardProps {
  workspaceId: string;
  onClose?: () => void;
}

interface UsageData {
  plan: string;
  period: string;
  ai_tokens: { used: number; limit: number; pct: number };
  ai_calls: { used: number; limit: number; pct: number };
  agent_runs: { used: number; limit: number; pct: number };
  cost_estimate_usd: number;
}

interface CostAlert {
  pct: number;
  warning: boolean;
  cost_usd: number;
  budget_usd: number;
  remaining_usd: number;
  period: string;
}

function ProgressBar({ pct, warning }: { pct: number; warning?: boolean }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const color = warning || clamped >= 80
    ? 'bg-amber-500'
    : clamped >= 60
    ? 'bg-blue-500'
    : 'bg-emerald-500';

  return (
    <div className="h-1.5 bg-neutral-200 dark:bg-neutral-700 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

function MetricRow({ label, used, limit, unit, pct }: { label: string; used: number; limit: number; unit: string; pct: number }) {
  const fmtNum = (n: number) => n >= 1000000 ? `${(n / 1000000).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n);
  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center">
        <span className="text-xs text-neutral-500 dark:text-neutral-400">{label}</span>
        <span className="text-xs font-mono text-neutral-700 dark:text-neutral-300">
          {fmtNum(used)} / {fmtNum(limit)} {unit}
        </span>
      </div>
      <ProgressBar pct={pct} warning={pct >= 80} />
    </div>
  );
}

export default function BillingDashboard({ workspaceId, onClose }: BillingDashboardProps) {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [costAlert, setCostAlert] = useState<CostAlert | null>(null);
  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [upgrading, setUpgrading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usageRes, alertRes, plansRes] = await Promise.allSettled([
        getBillingUsage(workspaceId),
        getCostAlert(workspaceId),
        getBillingPlans(),
      ]);
      if (usageRes.status === 'fulfilled') setUsage(usageRes.value as UsageData);
      if (alertRes.status === 'fulfilled') setCostAlert(alertRes.value as CostAlert);
      if (plansRes.status === 'fulfilled') setPlans((plansRes.value as any).plans ?? []);
    } catch {
      setError('無法載入用量資料');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    load();
    trackViewBilling('settings');
  }, [load]);

  const handleUpgrade = async (plan: string) => {
    setUpgrading(plan);
    trackCheckoutStarted(plan);
    try {
      const origin = window.location.origin;
      const res = await startCheckout(
        workspaceId,
        plan,
        `${origin}/?billing=success&plan=${plan}`,
        `${origin}/?billing=cancelled`
      );
      if (res.url) window.location.href = res.url;
    } catch {
      setError('無法啟動結帳流程，請稍後再試。');
    } finally {
      setUpgrading(null);
    }
  };

  const currentPlan = usage?.plan ?? 'free';

  return (
    <div className="w-full max-w-lg mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Zap size={18} className="text-amber-500" />
          <h2 className="font-semibold text-neutral-900 dark:text-neutral-100">用量與方案</h2>
        </div>
        <div className="flex gap-2 items-center">
          <button onClick={load} disabled={loading} className="text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors" aria-label="重新整理">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
          {onClose && (
            <button onClick={onClose} className="text-xs text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200">關閉</button>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-3 py-2">
          <AlertTriangle size={14} />
          {error}
        </div>
      )}

      {/* Cost Alert Banner */}
      {costAlert?.warning && (
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3">
          <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-300">已使用 {Math.round(costAlert.pct * 100)}% 月度 Token 預算</p>
            <p className="text-amber-600 dark:text-amber-400 text-xs mt-0.5">
              本月已花費 ${costAlert.cost_usd.toFixed(4)} USD，剩餘 ${costAlert.remaining_usd.toFixed(4)} USD
            </p>
          </div>
        </div>
      )}

      {loading && !usage ? (
        <div className="flex justify-center py-8">
          <Loader2 size={24} className="animate-spin text-neutral-400" />
        </div>
      ) : usage ? (
        <>
          {/* Current Plan Badge */}
          <div className="flex items-center justify-between bg-neutral-50 dark:bg-neutral-800 rounded-xl px-4 py-3">
            <div>
              <p className="text-xs text-neutral-500">目前方案</p>
              <p className="font-semibold capitalize text-neutral-900 dark:text-neutral-100">{currentPlan}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-neutral-500">本月預估成本</p>
              <p className="font-mono font-semibold text-neutral-900 dark:text-neutral-100">
                ${usage.cost_estimate_usd.toFixed(4)} USD
              </p>
            </div>
          </div>

          {/* Usage Metrics */}
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 space-y-4">
            <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide">本期用量</p>
            <MetricRow
              label="AI Tokens（月）"
              used={usage.ai_tokens.used}
              limit={usage.ai_tokens.limit}
              unit="tokens"
              pct={usage.ai_tokens.pct * 100}
            />
            <MetricRow
              label="AI 呼叫（日）"
              used={usage.ai_calls.used}
              limit={usage.ai_calls.limit}
              unit="calls"
              pct={usage.ai_calls.pct * 100}
            />
            <MetricRow
              label="Agent 執行（日）"
              used={usage.agent_runs.used}
              limit={usage.agent_runs.limit}
              unit="runs"
              pct={usage.agent_runs.pct * 100}
            />
          </div>

          {/* Upgrade Plans (only if not on highest plan) */}
          {currentPlan !== 'team' && plans.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-neutral-500 uppercase tracking-wide flex items-center gap-1">
                <TrendingUp size={12} /> 升級方案
              </p>
              {plans
                .filter((p: any) => p.id !== currentPlan && p.id !== 'free')
                .map((p: any) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3"
                  >
                    <div>
                      <p className="font-medium capitalize text-neutral-900 dark:text-neutral-100">{p.name ?? p.id}</p>
                      <p className="text-xs text-neutral-500">
                        {(p.ai_tokens_per_month / 1000000).toFixed(0)}M tokens · {p.agent_runs_per_day} agent runs/day
                      </p>
                    </div>
                    <button
                      onClick={() => handleUpgrade(p.id)}
                      disabled={upgrading !== null}
                      className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg
                                 bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900
                                 hover:bg-neutral-700 dark:hover:bg-neutral-300 transition-colors disabled:opacity-50"
                    >
                      {upgrading === p.id ? <Loader2 size={12} className="animate-spin" /> : null}
                      升級 <ChevronRight size={12} />
                    </button>
                  </div>
                ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
