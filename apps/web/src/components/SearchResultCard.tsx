import React from 'react';
import { FileText, RefreshCcw } from 'lucide-react';
import type { SearchResultItem } from '../api/client';
import SearchFreshnessBadge from './SearchFreshnessBadge';

interface Props {
  result: SearchResultItem;
  onOpenDoc?: (documentId: string) => void;
  onReindex?: (documentId: string) => void;
  canReindex?: boolean;
  reindexing?: boolean;
}

function formatDate(value: string | null) {
  if (!value) return 'Never';
  return new Date(value).toLocaleString();
}

export default function SearchResultCard({
  result,
  onOpenDoc,
  onReindex,
  canReindex = false,
  reindexing = false,
}: Props) {
  return (
    <article className="rounded-2xl border border-border bg-panel p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpenDoc?.(result.documentId)}
            className="block max-w-full truncate text-left text-sm font-semibold text-accent hover:underline"
          >
            {result.title}
          </button>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-text-tertiary">
            <span className="inline-flex items-center gap-1">
              <FileText size={12} />
              {result.type || 'unknown'}
            </span>
            <span>{result.source || 'unknown'}</span>
            <span>Score {result.score.toFixed(3)}</span>
          </div>
        </div>
        <SearchFreshnessBadge result={result} />
      </div>

      <p className="mt-3 text-sm leading-6 text-text-secondary">{result.snippet}</p>

      {result.highlights.length > 0 ? (
        <div className="mt-3 flex flex-col gap-2">
          {result.highlights.map((highlight, index) => (
            <div key={`${highlight.field}-${index}`} className="rounded-xl bg-surface-secondary px-3 py-2 text-xs text-text-secondary">
              <span className="mr-2 font-medium uppercase tracking-wide text-text-tertiary">{highlight.field}</span>
              {highlight.text}
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {result.matchedFields.map((field) => (
          <span key={field} className="rounded-full bg-accent-light px-2 py-0.5 text-[11px] font-medium text-accent">
            {field}
          </span>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-text-tertiary">
        <span>Indexed {formatDate(result.indexedAt)}</span>
        <span>Updated {formatDate(result.updatedAt)}</span>
        {result.staleReason ? <span>Reason {result.staleReason}</span> : null}
      </div>

      {canReindex && result.isStale && onReindex ? (
        <div className="mt-4">
          <button
            type="button"
            onClick={() => onReindex(result.documentId)}
            disabled={reindexing}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-tertiary disabled:cursor-not-allowed disabled:opacity-60"
          >
            <RefreshCcw size={12} />
            {reindexing ? 'Reindexing...' : 'Reindex document'}
          </button>
        </div>
      ) : null}
    </article>
  );
}
