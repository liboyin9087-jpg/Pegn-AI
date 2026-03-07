import React from 'react';
import type { SearchIndexStatusResponse } from '../api/client';

interface Props {
  hasFilters: boolean;
  indexStatus: SearchIndexStatusResponse | null;
  canReindex: boolean;
  onClearFilters: () => void;
  onOpenOperations?: () => void;
}

export default function SearchEmptyState({
  hasFilters,
  indexStatus,
  canReindex,
  onClearFilters,
  onOpenOperations,
}: Props) {
  const hasIndexingWork = Boolean(
    indexStatus &&
      (indexStatus.pendingDocuments > 0 || indexStatus.staleDocuments > 0 || indexStatus.failedDocuments > 0)
  );

  return (
    <div className="rounded-2xl border border-dashed border-border bg-panel p-6 text-center">
      <h3 className="text-base font-semibold text-text-primary">No search results</h3>
      <p className="mt-2 text-sm text-text-secondary">
        Try a different keyword, remove filters, or check whether the latest document changes have been indexed.
      </p>

      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {hasFilters ? (
          <button
            type="button"
            onClick={onClearFilters}
            className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-tertiary"
          >
            Clear filters
          </button>
        ) : null}
        {hasIndexingWork && onOpenOperations ? (
          <button
            type="button"
            onClick={onOpenOperations}
            className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-tertiary"
          >
            View indexing jobs
          </button>
        ) : null}
      </div>

      {hasIndexingWork ? (
        <p className="mt-4 text-xs text-text-tertiary">
          Pending {indexStatus?.pendingDocuments ?? 0}, stale {indexStatus?.staleDocuments ?? 0}, failed {indexStatus?.failedDocuments ?? 0}.
          {canReindex ? ' You can trigger reindexing from stale results or the operations tab.' : ' Ask an editor or admin to reindex.'}
        </p>
      ) : null}
    </div>
  );
}
