import React, { useEffect, useState } from 'react';
import { listAgentRuns, type AgentRun } from '../api/client';

function formatTimestamp(value?: string | null): string {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleString();
}

export default function AgentRunHistory({
  workspaceId,
  activeRunId,
  onSelectRun,
}: {
  workspaceId: string;
  activeRunId?: string | null;
  onSelectRun: (runId: string) => void;
}) {
  const [runs, setRuns] = useState<AgentRun[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    listAgentRuns(workspaceId, 8)
      .then((response) => setRuns(response.runs))
      .catch(() => setRuns([]));
  }, [workspaceId, activeRunId]);

  if (!workspaceId) return null;

  return (
    <div className="rounded-xl border border-border bg-panel p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-text-secondary">Recent Runs</p>
        <span className="text-[11px] text-text-tertiary">{runs.length}</span>
      </div>
      <div className="space-y-2">
        {runs.length === 0 && (
          <p className="text-xs text-text-tertiary">No run history yet.</p>
        )}

        {runs.map((run) => (
          <button
            key={run.id}
            onClick={() => onSelectRun(run.id)}
            className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
              activeRunId === run.id
                ? 'border-accent bg-accent-light'
                : 'border-border bg-surface hover:bg-surface-tertiary'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-text-primary">{run.inputSummary}</span>
              <span className="flex-shrink-0 text-[11px] text-text-tertiary">{run.status}</span>
            </div>
            <p className="mt-1 text-[11px] text-text-tertiary">{formatTimestamp(run.createdAt)}</p>
            {run.status === 'failed' && run.errorSummary && (
              <p className="mt-1 text-[11px] text-error">{run.errorSummary}</p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
