import type { Express, Request, Response } from 'express';
import { searchService } from '../services/search.js';
import { observability } from '../services/observability.js';

interface SearchRequest {
  query: string;
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

export function registerSearchRoutes(app: Express): void {
  // Main search endpoint
  app.post('/api/v1/search', async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
      const searchRequest: SearchRequest = req.body;

      if (!searchRequest.query || typeof searchRequest.query !== 'string') {
        res.status(400).json({ error: 'Query is required and must be a string' });
        return;
      }

      // Dates are passed as strings to the search service
      const results = await searchService.search({
        query: searchRequest.query,
        workspaceId: searchRequest.workspaceId,
        limit: searchRequest.limit || 20,
        offset: searchRequest.offset || 0,
        filters: searchRequest.filters,
        hybrid: searchRequest.hybrid !== false,
        vectorWeight: searchRequest.vectorWeight
      });

      const duration = Date.now() - startTime;
      observability.recordSearchOperation(searchRequest.query, duration, results.results.length);

      res.json({
        results: results.results,
        total: results.total,
        query: searchRequest.query,
        duration,
        limit: searchRequest.limit || 20,
        offset: searchRequest.offset || 0
      });
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
  app.get('/api/v1/search/suggestions', async (req: Request, res: Response) => {
    try {
      const { q: query, workspaceId, limit = 5 } = req.query;

      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Query parameter "q" is required' });
        return;
      }

      const suggestions = await searchService.getSuggestions(
        query,
        workspaceId as string,
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
  app.post('/api/v1/search/reindex/:documentId', async (req: Request, res: Response) => {
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
  app.post('/api/v1/search/advanced', async (req: Request, res: Response) => {
    const startTime = Date.now();

    try {
      const {
        query,
        workspaceId,
        filters = {},
        limit = 20,
        offset = 0,
        sortBy = 'relevance',
        sortOrder = 'desc'
      } = req.body;

      if (!query) {
        res.status(400).json({ error: 'Query is required' });
        return;
      }

      // Enhanced search with additional options
      const searchOptions = {
        query,
        workspaceId,
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

      res.json({
        results: sortedResults,
        total: results.total,
        query,
        filters,
        sortBy,
        sortOrder,
        duration,
        limit,
        offset
      });
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
