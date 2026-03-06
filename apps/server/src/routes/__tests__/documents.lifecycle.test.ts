import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const create = vi.fn();
const findById = vi.fn();
const findByWorkspace = vi.fn();
const update = vi.fn();
const deleteDocument = vi.fn();
const searchDocuments = vi.fn();
const findBlocksByDocument = vi.fn();

const searchService = {
  enqueueDocumentReindex: vi.fn(),
  markDocumentIndexStale: vi.fn(),
  cleanupDocumentIndex: vi.fn(),
};

const emitAutomationEvent = vi.fn();
const observability = {
  info: vi.fn(),
  error: vi.fn(),
};

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: unknown, next: () => void) => {
    req.userId = 'user-1';
    next();
  },
}));

vi.mock('../../middleware/rbac.js', () => ({
  checkPermission: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock('../../models/document.js', () => ({
  DocumentModel: {
    create,
    findById,
    findByWorkspace,
    update,
    delete: deleteDocument,
    search: searchDocuments,
  },
}));

vi.mock('../../models/block.js', () => ({
  BlockModel: {
    findByDocument: findBlocksByDocument,
  },
}));

vi.mock('../../services/search.js', () => ({
  searchService,
}));

vi.mock('../../services/automation.js', () => ({
  emitAutomationEvent,
}));

vi.mock('../../services/observability.js', () => ({
  observability,
}));

vi.mock('../../services/idempotency.js', () => ({
  getIdempotencyKeyFromRequest: vi.fn(() => null),
  getIdempotentReplay: vi.fn(),
  storeIdempotentReplay: vi.fn(),
}));

async function createApp() {
  const { registerDocumentRoutes } = await import('../documents.js');
  const app = express();
  app.use(express.json());
  registerDocumentRoutes(app);
  return app;
}

describe('document lifecycle routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findByWorkspace.mockResolvedValue([]);
    searchDocuments.mockResolvedValue([]);
    findBlocksByDocument.mockResolvedValue([]);
    searchService.enqueueDocumentReindex.mockResolvedValue(undefined);
    searchService.markDocumentIndexStale.mockResolvedValue(undefined);
    searchService.cleanupDocumentIndex.mockResolvedValue(undefined);
  });

  it('creates documents as pending and enqueues reindex', async () => {
    create.mockResolvedValue({
      id: 'doc-1',
      workspace_id: 'ws-1',
      title: 'Doc 1',
      index_status: 'pending',
    });

    const app = await createApp();
    const response = await request(app)
      .post('/api/v1/documents')
      .send({ workspace_id: 'ws-1', title: 'Doc 1' });

    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      workspace_id: 'ws-1',
      title: 'Doc 1',
      index_status: 'pending',
    }));
    expect(searchService.enqueueDocumentReindex).toHaveBeenCalledWith('doc-1', 'ws-1');
  });

  it('marks updated documents as stale', async () => {
    update.mockResolvedValue({
      id: 'doc-1',
      workspace_id: 'ws-1',
      title: 'Doc 1',
      yjs_state: null,
    });

    const app = await createApp();
    const response = await request(app)
      .put('/api/v1/documents/doc-1')
      .send({ title: 'Doc 1 updated' });

    expect(response.status).toBe(200);
    expect(searchService.markDocumentIndexStale).toHaveBeenCalledWith('doc-1', 'ws-1');
  });

  it('cleans search state before deleting documents', async () => {
    findById.mockResolvedValue({
      id: 'doc-1',
      workspace_id: 'ws-1',
      title: 'Doc 1',
    });
    deleteDocument.mockResolvedValue(true);

    const app = await createApp();
    const response = await request(app).delete('/api/v1/documents/doc-1');

    expect(response.status).toBe(200);
    expect(searchService.cleanupDocumentIndex).toHaveBeenCalledWith('doc-1', 'ws-1');
    expect(deleteDocument).toHaveBeenCalledWith('doc-1');
  });
});
