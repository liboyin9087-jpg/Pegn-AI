import React from 'react';
import type { AdminSummary } from '../api/client';

export default function AdminSummaryPanel({ summary }: { summary: AdminSummary }) {
  const cards = [
    { label: 'Members', value: summary.memberCounts.membersTotal },
    { label: 'Documents', value: summary.documentsSummary.documentsTotal },
    { label: 'Indexed', value: summary.documentsSummary.indexedDocumentsTotal },
    { label: 'Stale', value: summary.documentsSummary.staleDocumentsTotal },
    { label: 'Agent Runs (7d)', value: summary.agentSummary.agentRunsLast7d },
    { label: 'Failed Jobs (7d)', value: summary.usageSummary.failedJobsLast7d },
  ];

  return (
    <div className="rounded-xl border border-border bg-panel p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">Admin summary</p>
          <p className="mt-1 text-xs text-text-tertiary">
            {summary.workspace?.name ?? 'Workspace'} governance snapshot
          </p>
        </div>
        <div className="rounded-lg bg-surface-secondary px-2 py-1 text-[11px] text-text-secondary">
          Quota: {summary.usageSummary.quotaStatus}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {cards.map((card) => (
          <div key={card.label} className="rounded-lg border border-border bg-surface px-3 py-2">
            <p className="text-[11px] uppercase tracking-wide text-text-tertiary">{card.label}</p>
            <p className="mt-1 text-lg font-semibold text-text-primary">{card.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
