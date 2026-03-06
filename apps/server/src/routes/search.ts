import type { Express, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { DocumentModel } from '../models/document.js';
import { observability } from '../services/observability.js';
import { searchService } from '../services/search.js';

interface SearchRequest {
  query: string;
  workspace_id?: string;
  workspaceId?: string;
  limit?: number;
  offset?: number;
  filters?: {
    blockType?: string;
    dateFrom?: string;
    dateTo?: string;
  };
  hybrid?: boolean;
  vectorWeight?: number;
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
  app.post('/api/v1/search', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
      const searchRequest: SearchRequest = req.body;
      const workspaceId = searchRequest.workspace_id || searchRequest.workspaceId;

      if (!searchRequest.query || typeof searchRequest.query !== 'string') {
        sendApiError(res, 400, 'BAD_REQUEST', 'Query is required and must be a string');
        return;
      }

      const results = await searchService.search({
        query: searchRequest.query,
        workspaceId,
        limit: searchRequest.limit || 20,
        offset: searchRequest.offset || 0,
        filters: searchRequest.filters,
        hybrid: searchRequest.hybrid !== false,
        vectorWeight: searchRequest.vectorWeight,
      });

      const duration = Date.now() - startTime;
      observability.recordSearchOperation(searchRequest.query, duration, results.results.length);

      res.json({
        results: results.results,
        total: results.total,
        query: searchRequest.query,
        duration,
        limit: searchRequest.limit || 20,
        offset: searchRequest.offset || 0,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      observability.error('Search failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query: req.body?.query,
        duration,
      });

      sendApiError(res, 500, 'INVALID_STATE', 'Search failed', error instanceof Error ? error.message : 'Unknown error');
    }
  });

  app.get('/api/v1/search/suggestions', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
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

  app.post('/api/v1/search/reindex/:documentId', authMiddleware, checkPermission('workspace:admin', 'document'), async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params;
      const document = await DocumentModel.findById(documentId);
      if (!document) {
        sendApiError(res, 404, 'NOT_FOUND', 'Document not found');
        return;
      }

      await searchService.enqueueDocumentReindex(documentId, document.workspace_id);

      observability.info('Document reindexed', { documentId });
      res.json({ message: 'Document reindexed successfully', documentId });
    } catch (error) {
      observability.error('Document reindex failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        documentId: req.params.documentId,
      });

      sendApiError(res, 500, 'INDEXING_FAILED', 'Document indexing failed', error instanceof Error ? error.message : 'Unknown error');
    }
  });

  app.post('/api/v1/search/advanced', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
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

      const results = await searchService.search({
        query,
        workspaceId: resolvedWorkspaceId,
        limit,
        offset,
        filters: {
          ...filters,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
        },
        hybrid: true,
        vectorWeight: 0.5,
      });

      let sortedResults = results.results;
      if (sortBy !== 'relevance') {
        sortedResults = [...results.results].sort((a, b) => {
          let comparison = 0;
          switch (sortBy) {
            case 'date':
              comparison = a.created_at.getTime() - b.created_at.getTime();
              break;
            case 'title':
              comparison = a.document_title.localeCompare(b.document_title);
              break;
            default:
              comparison = a.score - b.score;
          }
          return sortOrder === 'desc' ? -comparison : comparison;
        });
      }

      const duration = Date.now() - startTime;
      observability.recordSearchOperation(query, duration, results.results.length);

      res.json({
        results: sortedResults,
        total: results.total,
        query,
        filters,
        sortBy,
        sortOrder,
        duration,
        limit,
        offset,
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

  app.get('/api/v1/search/index-status', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
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
