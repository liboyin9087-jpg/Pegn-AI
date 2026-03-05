import React, { useEffect, useState, useCallback } from 'react';
import { Zap, TrendingUp, AlertTriangle, ChevronRight, Loader2, RefreshCw, ChevronDown, ChevronUp, PackagePlus, Cpu } from 'lucide-react';
import { getBillingUsage, getCostAlert, getBillingPlans, startCheckout, getUsageByModel, getAddonInfo, postAddonCheckout } from '../api/client';
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

interface ModelUsageRow {
  model_name: string;
  tokens: number;
  cost_usd: number;
  calls: number;
}

interface AddonPackage {
  id: string;
  name: string;
  tokens: number;
  price_usd: number;
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
  const [modelBreakdown, setModelBreakdown] = useState<ModelUsageRow[]>([]);
  const [modelOpen, setModelOpen] = useState(true);
  const [addonPackages, setAddonPackages] = useState<AddonPackage[]>([]);
  const [addonSubs, setAddonSubs] = useState<any[]>([]);
  const [addonOpen, setAddonOpen] = useState(false);
  const [purchasingAddon, setPurchasingAddon] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usageRes, alertRes, plansRes, modelRes, addonRes] = await Promise.allSettled([
        getBillingUsage(workspaceId),
        getCostAlert(workspaceId),
        getBillingPlans(),
        getUsageByModel(workspaceId),
        getAddonInfo(workspaceId),
      ]);
      if (usageRes.status === 'fulfilled') setUsage(usageRes.value as UsageData);
      if (alertRes.status === 'fulfilled') setCostAlert(alertRes.value as CostAlert);
      if (plansRes.status === 'fulfilled') setPlans((plansRes.value as any).plans ?? []);
      if (modelRes.status === 'fulfilled') setModelBreakdown((modelRes.value as any).breakdown ?? []);
      if (addonRes.status === 'fulfilled') {
        const r = addonRes.value as any;
        setAddonPackages(r.packages ?? []);
        setAddonSubs(r.subscriptions ?? []);
      }
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

  const handleAddonCheckout = async (pkgId: string) => {
    setPurchasingAddon(pkgId);
    try {
      const origin = window.location.origin;
      const res = await postAddonCheckout(
        workspaceId,
        pkgId,
        `${origin}/?billing=addon-success&package=${pkgId}`,
        `${origin}/?billing=addon-cancelled`
      );
      if (res.url) window.location.href = res.url;
    } catch {
      setError('無法啟動 Add-on 結帳流程，請稍後再試。');
    } finally {
      setPurchasingAddon(null);
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

          {/* By-Model Breakdown */}
          {modelBreakdown.length > 0 && (
            <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden">
              <button
                onClick={() => setModelOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  <Cpu size={12} /> 依模型分類
                </span>
                {modelOpen ? <ChevronUp size={13} className="text-neutral-400" /> : <ChevronDown size={13} className="text-neutral-400" />}
              </button>
              {modelOpen && (
                <div className="px-4 pb-4 space-y-2">
                  {modelBreakdown.map(row => (
                    <div key={row.model_name} className="flex items-center justify-between text-xs">
                      <span className="font-mono text-neutral-700 dark:text-neutral-300 truncate max-w-[180px]" title={row.model_name}>
                        {row.model_name === 'unknown' ? '（未知模型）' : row.model_name}
                      </span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-neutral-500">
                          {row.tokens >= 1000000 ? `${(row.tokens / 1000000).toFixed(1)}M` : row.tokens >= 1000 ? `${(row.tokens / 1000).toFixed(0)}k` : row.tokens} tokens
                        </span>
                        <span className="font-mono text-neutral-700 dark:text-neutral-300">
                          ${row.cost_usd.toFixed(4)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Add-on Token Packages */}
          {addonPackages.length > 0 && (
            <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl overflow-hidden">
              <button
                onClick={() => setAddonOpen(o => !o)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
              >
                <span className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 uppercase tracking-wide">
                  <PackagePlus size={12} /> 購買額外用量
                </span>
                {addonOpen ? <ChevronUp size={13} className="text-neutral-400" /> : <ChevronDown size={13} className="text-neutral-400" />}
              </button>
              {addonOpen && (
                <div className="px-4 pb-4 space-y-2">
                  {addonSubs.length > 0 && (
                    <p className="text-xs text-emerald-600 dark:text-emerald-400 mb-2">
                      已啟用 Add-on：{addonSubs.reduce((s, r) => s + (r.tokens_bought ?? 0), 0).toLocaleString()} 額外 tokens
                    </p>
                  )}
                  {addonPackages.map((pkg: AddonPackage) => (
                    <div key={pkg.id} className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">{pkg.name}</p>
                        <p className="text-[11px] text-neutral-500">
                          {(pkg.tokens / 1000000).toFixed(0)}M tokens — ${pkg.price_usd} USD
                        </p>
                      </div>
                      <button
                        onClick={() => handleAddonCheckout(pkg.id)}
                        disabled={purchasingAddon !== null}
                        className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg
                                   bg-violet-600 text-white hover:bg-violet-700 transition-colors
                                   disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {purchasingAddon === pkg.id ? <Loader2 size={11} className="animate-spin" /> : null}
                        購買
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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
