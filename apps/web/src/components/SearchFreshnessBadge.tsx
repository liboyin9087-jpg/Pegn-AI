import React from 'react';
import type { SearchResultItem } from '../api/client';

interface Props {
  result: Pick<SearchResultItem, 'isStale' | 'staleReason'>;
}

function getLabel(staleReason: SearchResultItem['staleReason']) {
  switch (staleReason) {
    case 'document_updated_after_index':
      return 'Stale: document updated';
    case 'document_marked_stale':
      return 'Stale: reindex needed';
    case 'index_failed':
      return 'Index failed';
    case 'not_indexed':
      return 'Not indexed';
    default:
      return 'Indexed';
  }
}

export default function SearchFreshnessBadge({ result }: Props) {
  const isStale = result.isStale;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium"
      style={{
        background: isStale ? 'rgba(245, 158, 11, 0.14)' : 'rgba(16, 185, 129, 0.14)',
        color: isStale ? '#b45309' : '#047857',
      }}
    >
      {getLabel(result.staleReason)}
    </span>
  );
}
