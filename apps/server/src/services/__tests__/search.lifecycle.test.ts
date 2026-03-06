import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPool = {
  query: vi.fn(),
};

vi.mock('../../db/client.js', () => ({
  pool: mockPool,
}));

describe('SearchService lifecycle helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns workspace-scoped lifecycle summary', async () => {
    mockPool.query.mockResolvedValue({
      rows: [{
        total_documents: '4',
        pending_documents: '1',
        indexed_documents: '2',
        stale_documents: '1',
        failed_documents: '0',
        last_indexed_at: new Date('2026-03-07T10:20:00.000Z'),
      }],
      rowCount: 1,
    });

    const { searchService } = await import('../search.js');
    const summary = await searchService.getIndexStatusSummary('ws-1');

    expect(mockPool.query).toHaveBeenCalledWith(expect.stringContaining('FROM documents'), ['ws-1']);
    expect(summary).toEqual({
      totalDocuments: 4,
      pendingDocuments: 1,
      indexedDocuments: 2,
      staleDocuments: 1,
      failedDocuments: 0,
      lastIndexedAt: '2026-03-07T10:20:00.000Z',
    });
  });

  it('marks indexed documents as stale without changing pending semantics', async () => {
    const { searchService } = await import('../search.js');
    await searchService.markDocumentIndexStale('doc-1', 'ws-1');

    const [sql, params] = mockPool.query.mock.calls[0];
    expect(String(sql)).toContain("WHEN index_status = 'pending' THEN 'pending'");
    expect(String(sql)).toContain("ELSE 'stale'");
    expect(params).toEqual(['doc-1', 'ws-1']);
  });

  it('cleans up search_index rows for one document within one workspace', async () => {
    const { searchService } = await import('../search.js');
    await searchService.cleanupDocumentIndex('doc-1', 'ws-1');

    expect(mockPool.query).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM search_index si'),
      ['doc-1', 'ws-1']
    );
  });
});
