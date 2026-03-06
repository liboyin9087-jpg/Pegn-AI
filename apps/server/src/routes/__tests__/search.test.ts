import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const searchService = {
  search: vi.fn(),
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
}));

vi.mock('../../services/search.js', () => ({
  searchService,
}));

vi.mock('../../models/document.js', () => ({
  DocumentModel: {
    findById,
  },
}));

async function createApp() {
  const { registerSearchRoutes } = await import('../search.js');
  const app = express();
  app.use(express.json());
  registerSearchRoutes(app);
  return app;
}

describe('GET /api/v1/search/index-status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
