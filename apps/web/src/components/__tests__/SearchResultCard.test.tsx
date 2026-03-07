import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import SearchResultCard from '../SearchResultCard';

const result = {
  documentId: 'doc-1',
  blockId: 'block-1',
  title: 'Pricing Spec',
  type: 'spec',
  source: 'manual',
  snippet: 'Pricing Spec v2 now includes annual discounts.',
  highlights: [{ field: 'content' as const, text: '...annual discounts...' }],
  matchedFields: ['title', 'content'] as Array<'title' | 'content' | 'source' | 'type'>,
  indexedAt: '2026-03-07T08:00:00.000Z',
  updatedAt: '2026-03-07T08:10:00.000Z',
  isStale: true,
  staleReason: 'document_updated_after_index' as const,
  score: 0.91,
};

describe('SearchResultCard', () => {
  it('renders snippet, matched fields, stale reason, and timestamps', () => {
    render(<SearchResultCard result={result} />);

    expect(screen.getByText('Pricing Spec')).toBeInTheDocument();
    expect(screen.getByText('Pricing Spec v2 now includes annual discounts.')).toBeInTheDocument();
    expect(screen.getByText('title')).toBeInTheDocument();
    expect(screen.getAllByText('content').length).toBeGreaterThan(0);
    expect(screen.getByText('Stale: document updated')).toBeInTheDocument();
    expect(screen.getByText(/Indexed/)).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it('calls reindex when the CTA is clicked', () => {
    const onReindex = vi.fn();
    render(<SearchResultCard result={result} onReindex={onReindex} canReindex />);

    fireEvent.click(screen.getByText('Reindex document'));
    expect(onReindex).toHaveBeenCalledWith('doc-1');
  });
});
