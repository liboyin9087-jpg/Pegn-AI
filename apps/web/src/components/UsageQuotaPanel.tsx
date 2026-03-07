import React from 'react';
import type { UsageSummary } from '../api/client';

export default function UsageQuotaPanel({
  usage,
  highlighted = false,
}: {
  usage: UsageSummary;
  highlighted?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-panel p-3 ${highlighted ? 'border-accent ring-1 ring-accent/30' : 'border-border'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">Usage & quota</p>
          <p className="mt-1 text-xs text-text-tertiary">Current totals plus 7d / 30d usage.</p>
        </div>
        <div className={`rounded-lg px-2 py-1 text-[11px] ${usage.quotaStatus === 'exceeded' ? 'bg-error/10 text-error' : usage.quotaStatus === 'warning' ? 'bg-yellow-500/10 text-yellow-700' : 'bg-green-500/10 text-green-700'}`}>
          {usage.quota.percentUsed}% used
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-[11px] text-text-tertiary">Documents</p>
          <p className="font-semibold text-text-primary">{usage.documentsCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-[11px] text-text-tertiary">Indexed docs</p>
          <p className="font-semibold text-text-primary">{usage.indexedDocumentsCount}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-[11px] text-text-tertiary">Agent runs (7d)</p>
          <p className="font-semibold text-text-primary">{usage.agentRunsLast7d}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-[11px] text-text-tertiary">Agent runs (30d)</p>
          <p className="font-semibold text-text-primary">{usage.agentRunsLast30d}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-[11px] text-text-tertiary">Failed jobs (7d)</p>
          <p className="font-semibold text-text-primary">{usage.failedJobsLast7d}</p>
        </div>
        <div className="rounded-lg border border-border bg-surface px-3 py-2">
          <p className="text-[11px] text-text-tertiary">Artifacts bytes</p>
          <p className="font-semibold text-text-primary">{usage.artifactsBytes}</p>
        </div>
      </div>
    </div>
  );
}
