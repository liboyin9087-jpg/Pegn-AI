interface Props {
  title: string;
  description: string;
  onRetry?: () => void;
}

export default function InlineRetryState({ title, description, onRetry }: Props) {
  return (
    <div className="rounded-xl border border-border bg-panel p-3">
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="mt-1 text-xs text-text-tertiary">{description}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-tertiary"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
