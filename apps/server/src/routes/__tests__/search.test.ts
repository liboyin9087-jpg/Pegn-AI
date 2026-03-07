import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchService = {
  searchWorkspaceDocuments: vi.fn(),
  getSuggestions: vi.fn(),
  enqueueDocumentReindex: vi.fn(),
  getIndexStatusSummary: vi.fn(),
};

const findById = vi.fn();

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../middleware/rbac.js', () => ({
  checkPermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  checkWorkspaceCapability: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../services/search.js', () => ({
  searchService,
}));

vi.mock('../../models/document.js', () => ({
  DocumentModel: {
    findById,
  },
}));

function createSearchResponse(overrides: Partial<any> = {}) {
  return {
    items: [
      {
        documentId: 'doc-1',
        blockId: 'block-1',
        title: 'Pricing Spec',
        type: 'spec',
        source: 'manual',
        snippet: 'Pricing Spec v2 now includes annual discounts.',
        highlights: [{ field: 'content', text: '...includes annual discounts...' }],
        matchedFields: ['title', 'content'],
        indexedAt: '2026-03-07T08:00:00.000Z',
        updatedAt: '2026-03-07T08:10:00.000Z',
        isStale: true,
        staleReason: 'document_updated_after_index',
        score: 0.91,
      },
    ],
    total: 1,
    query: 'Pricing',
    normalizedQuery: 'pricing',
    filtersApplied: {
      type: null,
      source: null,
      updatedFrom: null,
      updatedTo: null,
      limit: 20,
    },
    facets: {
      byType: [{ value: 'spec', count: 1 }],
      bySource: [{ value: 'manual', count: 1 }],
    },
    nextCursor: null,
    durationMs: 18,
    ...overrides,
  };
}

async function createApp() {
  const { registerSearchRoutes } = await import('../search.js');
  const app = express();
  app.use(express.json());
  registerSearchRoutes(app);
  return app;
}

describe('search routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the canonical GET search response shape', async () => {
    searchService.searchWorkspaceDocuments.mockResolvedValue(createSearchResponse());
    const app = await createApp();

    const response = await request(app).get('/api/v1/search?q=Pricing&workspace_id=ws-1&type=spec&source=manual&updatedFrom=2026-03-01&updatedTo=2026-03-07&limit=20&cursor=opaque');

    expect(response.status).toBe(200);
    expect(searchService.searchWorkspaceDocuments).toHaveBeenCalledWith({
      query: 'Pricing',
      workspaceId: 'ws-1',
      type: 'spec',
      source: 'manual',
      updatedFrom: '2026-03-01',
      updatedTo: '2026-03-07',
      limit: 20,
      cursor: 'opaque',
    });
    expect(response.body).toMatchObject({
      items: [
        expect.objectContaining({
          documentId: 'doc-1',
          snippet: expect.any(String),
          highlights: expect.any(Array),
          matchedFields: expect.any(Array),
          indexedAt: '2026-03-07T08:00:00.000Z',
          updatedAt: '2026-03-07T08:10:00.000Z',
          isStale: true,
          staleReason: 'document_updated_after_index',
        }),
      ],
      total: 1,
      query: 'Pricing',
      normalizedQuery: 'pricing',
      filtersApplied: {
        type: null,
        source: null,
        updatedFrom: null,
        updatedTo: null,
        limit: 20,
      },
      facets: {
        byType: [{ value: 'spec', count: 1 }],
        bySource: [{ value: 'manual', count: 1 }],
      },
      nextCursor: null,
      durationMs: 18,
    });
  });

  it('keeps empty search results in the full response envelope', async () => {
    searchService.searchWorkspaceDocuments.mockResolvedValue(
      createSearchResponse({
        items: [],
        total: 0,
        facets: { byType: [], bySource: [] },
      })
    );
    const app = await createApp();

    const response = await request(app).get('/api/v1/search?q=unknown&workspace_id=ws-1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      items: [],
      total: 0,
      query: 'Pricing',
      normalizedQuery: 'pricing',
      filtersApplied: {
        type: null,
        source: null,
        updatedFrom: null,
        updatedTo: null,
        limit: 20,
      },
      facets: {
        byType: [],
        bySource: [],
      },
      nextCursor: null,
      durationMs: 18,
    });
  });

  it('supports the POST compatibility wrapper with the same service input', async () => {
    searchService.searchWorkspaceDocuments.mockResolvedValue(createSearchResponse());
    const app = await createApp();

    const response = await request(app)
      .post('/api/v1/search')
      .send({
        query: 'Pricing',
        workspace_id: 'ws-1',
        type: 'spec',
        source: 'manual',
        updatedFrom: '2026-03-01',
        updatedTo: '2026-03-07',
        limit: 10,
      });

    expect(response.status).toBe(200);
    expect(searchService.searchWorkspaceDocuments).toHaveBeenCalledWith({
      query: 'Pricing',
      workspaceId: 'ws-1',
      type: 'spec',
      source: 'manual',
      updatedFrom: '2026-03-01',
      updatedTo: '2026-03-07',
      limit: 10,
      cursor: undefined,
    });
  });

  it('returns lifecycle summary scoped to one workspace', async () => {
    searchService.getIndexStatusSummary.mockResolvedValue({
      totalDocuments: 3,
      pendingDocuments: 1,
      indexedDocuments: 1,
      staleDocuments: 1,
      failedDocuments: 0,
      lastIndexedAt: '2026-03-07T10:20:00.000Z',
    });

    const app = await createApp();
    const response = await request(app).get('/api/v1/search/index-status?workspace_id=ws-1');

    expect(response.status).toBe(200);
    expect(searchService.getIndexStatusSummary).toHaveBeenCalledWith('ws-1');
    expect(response.body).toEqual({
      totalDocuments: 3,
      pendingDocuments: 1,
      indexedDocuments: 1,
      staleDocuments: 1,
      failedDocuments: 0,
      lastIndexedAt: '2026-03-07T10:20:00.000Z',
    });
  });

  it('returns a bad request error when workspace_id is missing', async () => {
    const app = await createApp();
    const response = await request(app).get('/api/v1/search/index-status');

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message: 'workspace_id required',
        details: null,
      },
    });
  });

  it('returns jobId and indexStatus when a document reindex is queued', async () => {
    findById.mockResolvedValue({ id: 'doc-1', workspace_id: 'ws-1', index_status: 'stale' });
    searchService.enqueueDocumentReindex.mockResolvedValue({
      jobId: 'job-search-1',
      status: 'queued',
    });

    const app = await createApp();
    const response = await request(app).post('/api/v1/search/reindex/doc-1');

    expect(response.status).toBe(200);
    expect(searchService.enqueueDocumentReindex).toHaveBeenCalledWith(
      'doc-1',
      'ws-1',
      expect.objectContaining({
        triggeredVia: 'manual',
      })
    );
    expect(response.body).toEqual({
      documentId: 'doc-1',
      jobId: 'job-search-1',
      status: 'queued',
      indexStatus: 'stale',
    });
  });
});
