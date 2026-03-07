import { useState } from 'react';

export default function WorkflowApprovalPanel({
  canApprove,
  canReject,
  loading,
  onApprove,
  onReject,
}: {
  canApprove: boolean;
  canReject: boolean;
  loading?: boolean;
  onApprove?: () => Promise<void> | void;
  onReject?: (comment?: string) => Promise<void> | void;
}) {
  const [comment, setComment] = useState('');

  if (!canApprove && !canReject) return null;

  return (
    <div className="space-y-2 rounded-xl border border-border bg-panel p-3">
      <p className="text-xs font-medium text-text-secondary">Approval</p>
      <textarea
        value={comment}
        onChange={(event) => setComment(event.target.value)}
        placeholder="Optional approval or rejection note"
        rows={2}
        className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-primary outline-none"
      />
      <div className="flex gap-2">
        {canApprove ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => void onApprove?.()}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs text-white disabled:opacity-50"
          >
            Approve
          </button>
        ) : null}
        {canReject ? (
          <button
            type="button"
            disabled={loading}
            onClick={() => void onReject?.(comment)}
            className="rounded-lg border border-error/30 px-3 py-1.5 text-xs text-error disabled:opacity-50"
          >
            Reject
          </button>
        ) : null}
      </div>
    </div>
  );
}
