import type { AgentRunListItem } from '../api/client';

const STATUS_COPY = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
} as const;

export default function AgentRunHistoryList({
  items,
  activeRunId,
  onSelectRun,
}: {
  items: AgentRunListItem[];
  activeRunId?: string | null;
  onSelectRun: (runId: string) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-panel p-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-text-secondary">Recent runs</p>
        <span className="text-[11px] text-text-tertiary">{items.length}</span>
      </div>
      <div className="mt-2 space-y-2">
        {items.length === 0 ? (
          <p className="text-xs text-text-tertiary">No runs yet.</p>
        ) : items.map((run) => (
          <button
            key={run.runId}
            onClick={() => onSelectRun(run.runId)}
            className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
              activeRunId === run.runId
                ? 'border-accent bg-accent-light'
                : 'border-border bg-surface hover:bg-surface-tertiary'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-text-primary">{run.title}</p>
              <span className="text-[11px] text-text-tertiary">{STATUS_COPY[run.status]}</span>
            </div>
            <p className="mt-1 text-xs text-text-secondary">{run.inputPreview}</p>
            <p className="mt-1 text-[11px] text-text-tertiary">{new Date(run.createdAt).toLocaleString()}</p>
            {run.rerunOfRunId ? (
              <p className="mt-1 text-[11px] text-text-tertiary">Rerun of {run.rerunOfRunId.slice(0, 8)}</p>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
