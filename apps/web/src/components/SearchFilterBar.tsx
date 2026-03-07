import React from 'react';
import type { SearchFacetBucket } from '../api/client';

export type SearchTimePreset = 'all' | '7d' | '30d';

interface Props {
  type: string;
  source: string;
  timePreset: SearchTimePreset;
  typeOptions: SearchFacetBucket[];
  sourceOptions: SearchFacetBucket[];
  disabled?: boolean;
  onTypeChange: (value: string) => void;
  onSourceChange: (value: string) => void;
  onTimePresetChange: (value: SearchTimePreset) => void;
  onClear: () => void;
}

export default function SearchFilterBar({
  type,
  source,
  timePreset,
  typeOptions,
  sourceOptions,
  disabled = false,
  onTypeChange,
  onSourceChange,
  onTimePresetChange,
  onClear,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Type filter"
        value={type}
        disabled={disabled}
        onChange={(event) => onTypeChange(event.target.value)}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-secondary outline-none"
      >
        <option value="">All types</option>
        {typeOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.value} ({option.count})
          </option>
        ))}
      </select>

      <select
        aria-label="Source filter"
        value={source}
        disabled={disabled}
        onChange={(event) => onSourceChange(event.target.value)}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-secondary outline-none"
      >
        <option value="">All sources</option>
        {sourceOptions.map((option) => (
          <option key={option.value} value={option.value}>
            {option.value} ({option.count})
          </option>
        ))}
      </select>

      <select
        aria-label="Updated time filter"
        value={timePreset}
        disabled={disabled}
        onChange={(event) => onTimePresetChange(event.target.value as SearchTimePreset)}
        className="rounded-lg border border-border bg-surface px-3 py-2 text-xs text-text-secondary outline-none"
      >
        <option value="all">All time</option>
        <option value="7d">Last 7 days</option>
        <option value="30d">Last 30 days</option>
      </select>

      <button
        type="button"
        disabled={disabled}
        onClick={onClear}
        className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-tertiary disabled:opacity-60"
      >
        Clear filters
      </button>
    </div>
  );
}
