import React from 'react';
import type { CollaborationThread } from '../api/client';

const STATUS_LABELS: Record<CollaborationThread['status'], string> = {
  open: 'Open',
  in_progress: 'In progress',
  resolved: 'Resolved',
};

export default function ThreadStatusBar({
  thread,
  canCollaborate,
  onResolve,
  onReopen,
  onOpenSource,
}: {
  thread: CollaborationThread;
  canCollaborate: boolean;
  onResolve: () => void;
  onReopen: () => void;
  onOpenSource?: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-panel px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">{thread.title}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-text-tertiary">
            <span className="rounded-full bg-surface-secondary px-2 py-0.5">
              {STATUS_LABELS[thread.status]}
            </span>
            <span>{thread.targetType}</span>
            <span>Last activity {new Date(thread.lastActivityAt).toLocaleString()}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {onOpenSource ? (
            <button
              type="button"
              onClick={onOpenSource}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-tertiary"
            >
              Open source
            </button>
          ) : null}
          {canCollaborate ? (
            thread.status === 'resolved' ? (
              <button
                type="button"
                onClick={onReopen}
                className="rounded-lg border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent-light"
              >
                Reopen
              </button>
            ) : (
              <button
                type="button"
                onClick={onResolve}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-tertiary"
              >
                Resolve
              </button>
            )
          ) : null}
        </div>
      </div>
    </div>
  );
}
