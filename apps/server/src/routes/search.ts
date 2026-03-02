import type { Express, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { searchService } from '../services/search.js';
import { observability } from '../services/observability.js';

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
  debug?: boolean;
  include_debug?: boolean;
}

function parseBooleanFlag(rawValue: unknown, defaultValue = false): boolean {
  if (rawValue == null) return defaultValue;
  if (typeof rawValue === 'boolean') return rawValue;
  const normalized = String(rawValue).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function registerSearchRoutes(app: Express): void {
  // Main search endpoint
  app.post('/api/v1/search', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
      const searchRequest: SearchRequest = req.body;
      const workspaceId = searchRequest.workspace_id || searchRequest.workspaceId;
      const limit = searchRequest.limit || 20;
      const offset = searchRequest.offset || 0;
      const hybridRequested = searchRequest.hybrid !== false;
      const vectorWeight = searchRequest.vectorWeight ?? 0.5;
      const includeDebug =
        parseBooleanFlag(searchRequest.debug, false) ||
        parseBooleanFlag(searchRequest.include_debug, false) ||
        parseBooleanFlag(req.query.debug, false);

      if (!searchRequest.query || typeof searchRequest.query !== 'string') {
        res.status(400).json({ error: 'Query is required and must be a string' });
        return;
      }

      // Dates are passed as strings to the search service
      const results = await searchService.search({
        query: searchRequest.query,
        workspaceId,
        limit,
        offset,
        filters: searchRequest.filters,
        hybrid: hybridRequested,
        vectorWeight
      });

      const duration = Date.now() - startTime;
      observability.recordSearchOperation(searchRequest.query, duration, results.results.length);

      const responseBody: Record<string, any> = {
        results: results.results,
        total: results.total,
        query: searchRequest.query,
        duration,
        limit,
        offset,
      };
      if (includeDebug) {
        responseBody.debug = {
          hybrid_requested: hybridRequested,
          vector_weight: vectorWeight,
          bm25_weight: 1 - vectorWeight,
          top_components: results.results.slice(0, 5).map((result) => ({
            document_id: result.document_id,
            score: result.score,
            bm25_score: result.bm25_score ?? 0,
            vector_score: result.vector_score ?? 0,
          })),
        };
      }

      res.json(responseBody);
    } catch (error) {
      const duration = Date.now() - startTime;
      observability.error('Search failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query: req.body?.query,
        duration
      });

      res.status(500).json({
        error: 'Search failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Search suggestions endpoint
  app.get('/api/v1/search/suggestions', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
    try {
      const { q: query, workspace_id, workspaceId, limit = 5 } = req.query;
      const resolvedWorkspaceId =
        (typeof workspace_id === 'string' ? workspace_id : undefined) ||
        (typeof workspaceId === 'string' ? workspaceId : undefined);

      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Query parameter "q" is required' });
        return;
      }

      const suggestions = await searchService.getSuggestions(
        query,
        resolvedWorkspaceId as string,
        parseInt(limit as string)
      );

      res.json({ suggestions });
    } catch (error) {
      observability.error('Search suggestions failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query: req.query.q
      });

      res.status(500).json({
        error: 'Failed to get suggestions',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Reindex document endpoint
  app.post('/api/v1/search/reindex/:documentId', authMiddleware, checkPermission('workspace:admin', 'document'), async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params;

      await searchService.reindexDocument(documentId);

      observability.info('Document reindexed', { documentId });
      res.json({ message: 'Document reindexed successfully', documentId });
    } catch (error) {
      observability.error('Document reindex failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        documentId: req.params.documentId
      });

      res.status(500).json({
        error: 'Failed to reindex document',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Advanced search with filters
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
        debug,
        include_debug
      } = req.body;
      const includeDebug =
        parseBooleanFlag(debug, false) ||
        parseBooleanFlag(include_debug, false) ||
        parseBooleanFlag(req.query.debug, false);

      const resolvedWorkspaceId = workspace_id || workspaceId;

      if (!query) {
        res.status(400).json({ error: 'Query is required' });
        return;
      }

      // Enhanced search with additional options
      const searchOptions = {
        query,
        workspaceId: resolvedWorkspaceId,
        limit,
        offset,
        filters: {
          ...filters,
          // Dates are passed as strings to the search service
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo
        },
        hybrid: true,
        vectorWeight: 0.5
      };

      const results = await searchService.search(searchOptions);

      // Apply additional sorting if needed
      let sortedResults = results.results;
      if (sortBy !== 'relevance') {
        sortedResults.sort((a, b) => {
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

      const responseBody: Record<string, any> = {
        results: sortedResults,
        total: results.total,
        query,
        filters,
        sortBy,
        sortOrder,
        duration,
        limit,
        offset
      };

      if (includeDebug) {
        responseBody.debug = {
          hybrid_requested: true,
          vector_weight: 0.5,
          bm25_weight: 0.5,
          top_components: sortedResults.slice(0, 5).map((result) => ({
            document_id: result.document_id,
            score: result.score,
            bm25_score: result.bm25_score ?? 0,
            vector_score: result.vector_score ?? 0,
          })),
        };
      }

      res.json(responseBody);
    } catch (error) {
      const duration = Date.now() - startTime;
      observability.error('Advanced search failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        query: req.body?.query,
        duration
      });

      res.status(500).json({
        error: 'Advanced search failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}
