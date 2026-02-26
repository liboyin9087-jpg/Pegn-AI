import type { Express, Request, Response } from 'express';
import { indexDocument, indexFromYjsState, removeDocumentFromIndex, reindexWorkspace } from '../db/indexer.js';
import { observability } from '../services/observability.js';

export function registerIndexerRoutes(app: Express): void {
  // Index document with blocks
  app.post('/api/v1/indexer/index', async (req: Request, res: Response) => {
    const startTime = Date.now();
    
    try {
      const {
        workspaceId,
        documentId,
        title,
        blocks,
        yjsState,
        createdBy
      } = req.body;

      if (!workspaceId || !Array.isArray(blocks)) {
        res.status(400).json({ 
          error: 'workspaceId and blocks array are required' 
        });
        return;
      }

      const resultDocumentId = await indexDocument({
        workspaceId,
        documentId,
        title,
        blocks,
        yjsState,
        createdBy
      });

      const duration = Date.now() - startTime;
      observability.info('Document indexed', {
        documentId: resultDocumentId,
        blockCount: blocks.length,
        duration
      });

      res.json({
        documentId: resultDocumentId,
        blockCount: blocks.length,
        duration
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      observability.error('Document indexing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });
      
      res.status(500).json({
        error: 'Failed to index document',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Index from Yjs state
  app.post('/api/v1/indexer/yjs', async (req: Request, res: Response) => {
    const startTime = Date.now();
    
    try {
      const {
        workspaceId,
        documentId,
        yjsState,
        title,
        createdBy
      } = req.body;

      if (!workspaceId || !documentId || !yjsState) {
        res.status(400).json({ 
          error: 'workspaceId, documentId, and yjsState are required' 
        });
        return;
      }

      await indexFromYjsState(
        workspaceId,
        documentId,
        new Uint8Array(yjsState.data),
        title,
        createdBy
      );

      const duration = Date.now() - startTime;
      observability.info('Yjs state indexed', {
        documentId,
        workspaceId,
        duration
      });

      res.json({
        documentId,
        workspaceId,
        duration,
        message: 'Yjs state indexed successfully'
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      observability.error('Yjs indexing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        duration
      });
      
      res.status(500).json({
        error: 'Failed to index Yjs state',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Remove document from index
  app.delete('/api/v1/indexer/document/:documentId', async (req: Request, res: Response) => {
    try {
      const { documentId } = req.params;

      await removeDocumentFromIndex(documentId);

      observability.info('Document removed from index', { documentId });

      res.json({
        documentId,
        message: 'Document removed from index successfully'
      });
    } catch (error) {
      observability.error('Document removal from index failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        documentId: req.params.documentId
      });
      
      res.status(500).json({
        error: 'Failed to remove document from index',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Reindex entire workspace
  app.post('/api/v1/indexer/workspace/:workspaceId/reindex', async (req: Request, res: Response) => {
    const startTime = Date.now();
    
    try {
      const { workspaceId } = req.params;

      await reindexWorkspace(workspaceId);

      const duration = Date.now() - startTime;
      observability.info('Workspace reindexed', { workspaceId, duration });

      res.json({
        workspaceId,
        duration,
        message: 'Workspace reindexed successfully'
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      observability.error('Workspace reindexing failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
        workspaceId: req.params.workspaceId,
        duration
      });
      
      res.status(500).json({
        error: 'Failed to reindex workspace',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get indexing status
  app.get('/api/v1/indexer/status', async (req: Request, res: Response) => {
    try {
      const { workspaceId } = req.query;

      // This would typically return indexing statistics
      // For now, return basic status
      const status = {
        status: 'healthy',
        workspaceId: workspaceId || 'all',
        timestamp: new Date().toISOString(),
        indexedDocuments: 0, // Would be calculated from database
        totalBlocks: 0 // Would be calculated from database
      };

      res.json(status);
    } catch (error) {
      observability.error('Failed to get indexer status', {
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      
      res.status(500).json({
        error: 'Failed to get indexer status',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });
}
