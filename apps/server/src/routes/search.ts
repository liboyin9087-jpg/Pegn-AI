import type { Express, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { checkWorkspaceCapability } from '../middleware/rbac.js';
import { DocumentModel } from '../models/document.js';
import { observability } from '../services/observability.js';
import { searchService } from '../services/search.js';
import { recordAuditLog } from '../services/admin.js';

interface SearchRequest {
  query: string;
  workspace_id?: string;
  workspaceId?: string;
  q?: string;
  type?: string;
  source?: string;
  updatedFrom?: string;
  updatedTo?: string;
  cursor?: string;
  limit?: number;
  offset?: number;
  filters?: {
    blockType?: string;
    dateFrom?: string;
    dateTo?: string;
    type?: string;
    source?: string;
    updatedFrom?: string;
    updatedTo?: string;
  };
  hybrid?: boolean;
  vectorWeight?: number;
}

function resolveWorkspaceId(req: Request, bodyWorkspaceId?: string, queryWorkspaceId?: string) {
  return bodyWorkspaceId || queryWorkspaceId || ((req as any).workspaceId as string | undefined);
}

function sendApiError(res: Response, status: number, code: string, message: string, details: unknown = null) {
  res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

export function registerSearchRoutes(app: Express): void {
  app.get('/api/v1/search', authMiddleware, checkWorkspaceCapability('canViewWorkspace', 'document'), async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
      const query = typeof req.query.q === 'string' ? req.query.q : '';
      const workspaceId = resolveWorkspaceId(
        req,
        undefined,
        typeof req.query.workspace_id === 'string'
          ? req.query.workspace_id
          : typeof req.query.workspaceId === 'string'
            ? req.query.workspaceId
            : undefined
      );
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;

      if (!query || typeof query !== 'string') {
        sendApiError(res, 400, 'BAD_REQUEST', 'Query is required and must be a string');
        return;
      }
      if (!workspaceId) {
        sendApiError(res, 400, 'BAD_REQUEST', 'workspace_id is required');
        return;
      }

      const response = await searchService.searchWorkspaceDocuments({
        query,
        workspaceId,
        type: typeof req.query.type === 'string' ? req.query.type : undefined,
        source: typeof req.query.source === 'string' ? req.query.source : undefined,
        updatedFrom: typeof req.query.updatedFrom === 'string' ? req.query.updatedFrom : undefined,
        updatedTo: typeof req.query.updatedTo === 'string' ? req.query.updatedTo : undefined,
        limit: Number.isFinite(limit) ? limit : undefined,
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
      });

      observability.recordSearchOperation(query, Date.now() - startTime, response.items.length);
      res.json(response);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      observability.error('Search failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query: req.query?.q,
        durationMs,
      });

      sendApiError(res, 500, 'INVALID_STATE', 'Search failed', error instanceof Error ? error.message : 'Unknown error');
    }
  });

  app.post('/api/v1/search', authMiddleware, checkWorkspaceCapability('canViewWorkspace', 'document'), async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
      const searchRequest: SearchRequest = req.body;
      const query = searchRequest.query || searchRequest.q;
      const workspaceId = resolveWorkspaceId(req, searchRequest.workspace_id || searchRequest.workspaceId, undefined);

      if (!query || typeof query !== 'string') {
        sendApiError(res, 400, 'BAD_REQUEST', 'Query is required and must be a string');
        return;
      }
      if (!workspaceId) {
        sendApiError(res, 400, 'BAD_REQUEST', 'workspace_id is required');
        return;
      }

      const response = await searchService.searchWorkspaceDocuments({
        query,
        workspaceId,
        type: searchRequest.type ?? searchRequest.filters?.type,
        source: searchRequest.source ?? searchRequest.filters?.source,
        updatedFrom: searchRequest.updatedFrom ?? searchRequest.filters?.updatedFrom ?? searchRequest.filters?.dateFrom,
        updatedTo: searchRequest.updatedTo ?? searchRequest.filters?.updatedTo ?? searchRequest.filters?.dateTo,
        limit: searchRequest.limit,
        cursor: searchRequest.cursor,
      });

      observability.recordSearchOperation(query, Date.now() - startTime, response.items.length);
      res.json(response);
    } catch (error) {
      const durationMs = Date.now() - startTime;
      observability.error('Search failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query: req.body?.query,
        durationMs,
      });

      sendApiError(res, 500, 'INVALID_STATE', 'Search failed', error instanceof Error ? error.message : 'Unknown error');
    }
  });

  app.get('/api/v1/search/suggestions', authMiddleware, checkWorkspaceCapability('canViewWorkspace', 'document'), async (req: Request, res: Response) => {
    try {
      const { q: query, workspace_id, workspaceId, limit = 5 } = req.query;
      const resolvedWorkspaceId =
        (typeof workspace_id === 'string' ? workspace_id : undefined) ||
        (typeof workspaceId === 'string' ? workspaceId : undefined);

      if (!query || typeof query !== 'string') {
        sendApiError(res, 400, 'BAD_REQUEST', 'Query parameter "q" is required');
        return;
      }

      const suggestions = await searchService.getSuggestions(
        query,
        resolvedWorkspaceId,
        parseInt(limit as string, 10)
      );

      res.json({ suggestions });
    } catch (error) {
      observability.error('Search suggestions failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query: req.query.q,
      });

      sendApiError(res, 500, 'INVALID_STATE', 'Failed to get suggestions', error instanceof Error ? error.message : 'Unknown error');
    }
  });

  app.post('/api/v1/search/reindex/:documentId', authMiddleware, checkWorkspaceCapability('canEditDocuments', 'document'), async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params;
      const document = await DocumentModel.findById(documentId);
      if (!document) {
        sendApiError(res, 404, 'NOT_FOUND', 'Document not found');
        return;
      }

      const dispatch = await searchService.enqueueDocumentReindex(documentId, document.workspace_id, {
        triggeredBy: (req as any).userId ?? null,
        triggeredVia: 'manual',
      });

      await recordAuditLog({
        workspaceId: document.workspace_id,
        actorId: (req as any).userId ?? null,
        actorDisplay: (req as any).userEmail ?? (req as any).userId ?? 'Unknown user',
        eventType: 'document_reindexed',
        targetType: 'document',
        targetId: documentId,
        summary: `Queued manual reindex for ${document.title}`,
        metadata: {
          documentTitle: document.title,
          jobId: dispatch.jobId,
        },
      });

      observability.info('Document reindex queued', { documentId, jobId: dispatch.jobId });
      res.json({
        documentId,
        jobId: dispatch.jobId,
        status: dispatch.status,
        indexStatus: document.index_status,
      });
    } catch (error) {
      observability.error('Document reindex failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        documentId: req.params.documentId,
      });

      sendApiError(res, 500, 'INDEXING_FAILED', 'Document indexing failed', error instanceof Error ? error.message : 'Unknown error');
    }
  });

  app.post('/api/v1/search/advanced', authMiddleware, checkWorkspaceCapability('canViewWorkspace', 'document'), async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
      const {
        query,
        workspace_id,
        workspaceId,
        filters = {},
        limit = 20,
        offset = 0,
        sortBy = 'relevance',
        sortOrder = 'desc',
      } = req.body;

      const resolvedWorkspaceId = workspace_id || workspaceId;
      if (!query) {
        sendApiError(res, 400, 'BAD_REQUEST', 'Query is required');
        return;
      }

      const response = await searchService.searchWorkspaceDocuments({
        query,
        workspaceId: resolvedWorkspaceId,
        type: filters.type,
        source: filters.source,
        updatedFrom: filters.updatedFrom ?? filters.dateFrom,
        updatedTo: filters.updatedTo ?? filters.dateTo,
        limit,
      });

      let sortedResults = response.items;
      if (sortBy !== 'relevance') {
        sortedResults = [...response.items].sort((a, b) => {
          let comparison = 0;
          switch (sortBy) {
            case 'date':
              comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
              break;
            case 'title':
              comparison = a.title.localeCompare(b.title);
              break;
            default:
              comparison = a.score - b.score;
          }
          return sortOrder === 'desc' ? -comparison : comparison;
        });
      }

      const duration = Date.now() - startTime;
      observability.recordSearchOperation(query, duration, response.items.length);

      res.json({
        ...response,
        items: sortedResults,
        query,
        filtersApplied: {
          ...response.filtersApplied,
          type: filters.type ?? response.filtersApplied.type,
          source: filters.source ?? response.filtersApplied.source,
          updatedFrom: filters.updatedFrom ?? filters.dateFrom ?? response.filtersApplied.updatedFrom,
          updatedTo: filters.updatedTo ?? filters.dateTo ?? response.filtersApplied.updatedTo,
        },
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      observability.error('Advanced search failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query: req.body?.query,
        duration,
      });

      sendApiError(res, 500, 'INVALID_STATE', 'Advanced search failed', error instanceof Error ? error.message : 'Unknown error');
    }
  });

  app.get('/api/v1/search/index-status', authMiddleware, checkWorkspaceCapability('canViewWorkspace', 'document'), async (req: Request, res: Response) => {
    const workspaceId = ((req as any).workspaceId ?? req.query.workspace_id) as string | undefined;
    if (!workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'workspace_id required');
      return;
    }

    try {
      const summary = await searchService.getIndexStatusSummary(workspaceId);
      res.json(summary);
    } catch (error) {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to get index status', error instanceof Error ? error.message : 'Unknown error');
    }
  });
}
