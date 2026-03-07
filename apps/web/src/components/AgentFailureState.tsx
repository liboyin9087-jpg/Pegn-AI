export default function AgentFailureState({
  errorSummary,
  jobId,
  canRerun,
  onRerun,
  onOpenJob,
  onOpenJobTrace,
  readOnlyReason,
}: {
  errorSummary: string;
  jobId?: string | null;
  canRerun: boolean;
  onRerun?: () => void;
  onOpenJob?: (jobId: string) => void;
  onOpenJobTrace?: () => void;
  readOnlyReason?: string;
}) {
  return (
    <div className="rounded-xl border border-error/20 bg-error/5 p-3">
      <p className="text-sm font-medium text-error">Run failed</p>
      <p className="mt-1 text-xs text-error">{errorSummary}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {jobId && onOpenJob ? (
          <button
            onClick={() => {
              if (onOpenJobTrace) {
                onOpenJobTrace();
                return;
              }
              onOpenJob(jobId);
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-tertiary"
          >
            View job trace
          </button>
        ) : null}
        {canRerun ? (
          <button
            onClick={onRerun}
            className="rounded-lg border border-accent px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent-light"
          >
            Rerun
          </button>
        ) : readOnlyReason ? (
          <span className="text-xs text-text-tertiary">{readOnlyReason}</span>
        ) : null}
      </div>
    </div>
  );
}
