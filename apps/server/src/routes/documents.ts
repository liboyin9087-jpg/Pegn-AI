import type { Express, Response } from 'express';
import { DocumentModel } from '../models/document.js';
import { BlockModel } from '../models/block.js';
import { WorkspaceModel } from '../models/workspace.js';
import { observability } from '../services/observability.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { searchService } from '../services/search.js';
import {
  getIdempotencyKeyFromRequest,
  getIdempotentReplay,
  storeIdempotentReplay
} from '../services/idempotency.js';

export function registerDocumentRoutes(app: Express): void {

  // Create document
  app.post('/api/v1/documents', authMiddleware, checkPermission('collection:edit'), async (req: AuthRequest, res: Response) => {
    try {
      const workspace_id = req.body?.workspace_id || req.body?.workspaceId;
      const { title, content, yjs_state, metadata, collection_id, properties } = req.body;
      if (!workspace_id || !title) {
        res.status(400).json({ error: 'workspace_id and title are required' });
        return;
      }

      const document = await DocumentModel.create({
        workspace_id,
        title,
        content,
        yjs_state: yjs_state ? Buffer.from(yjs_state) : undefined,
        created_by: req.userId,
        metadata,
        collection_id,
        properties
      });

      // Reindex for search
      searchService.reindexDocument(document.id).catch(e =>
        observability.error('Auto-reindex failed', { error: e, documentId: document.id })
      );
      observability.info('Document created', { documentId: document.id });
      res.status(201).json(document);
    } catch {
      res.status(500).json({ error: 'Failed to create document' });
    }
  });

  // Get document by ID
  app.get('/api/v1/documents/:id', authMiddleware, checkPermission('collection:view', 'document'), async (req: AuthRequest, res: Response) => {
    try {
      const document = await DocumentModel.findById(req.params.id);
      if (!document) { res.status(404).json({ error: 'Document not found' }); return; }
      res.json({
        ...document,
        yjs_state: document.yjs_state ? document.yjs_state.toString('base64') : null,
      });
    } catch {
      res.status(500).json({ error: 'Failed to get document' });
    }
  });

  // List documents in workspace
  app.get('/api/v1/workspaces/:workspaceId/documents', authMiddleware, checkPermission('collection:view'), async (req: AuthRequest, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const { limit = 50, offset = 0 } = req.query;
      const documents = await DocumentModel.findByWorkspace(
        workspaceId, parseInt(limit as string), parseInt(offset as string)
      );
      res.json({ documents });
    } catch {
      res.status(500).json({ error: 'Failed to list documents' });
    }
  });

  // Update document (title rename + content)
  app.put('/api/v1/documents/:id', authMiddleware, checkPermission('collection:edit', 'document'), async (req: AuthRequest, res: Response) => {
    try {
      const idempotencyKey = getIdempotencyKeyFromRequest(req);
      let workspaceIdForReplay: string | undefined;
      if (idempotencyKey && req.userId) {
        const existing = await DocumentModel.findById(req.params.id);
        if (!existing) {
          res.status(404).json({ error: 'Document not found' });
          return;
        }
        workspaceIdForReplay = existing.workspace_id;
        const replay = await getIdempotentReplay({
          userId: req.userId,
          workspaceId: workspaceIdForReplay,
          operation: 'document_update',
          idempotencyKey
        });
        if (replay) {
          res.status(replay.status_code).json(replay.response);
          return;
        }
      }

      const { title, content, yjs_state, metadata, collection_id, properties } = req.body;
      const document = await DocumentModel.update(req.params.id, {
        title,
        content,
        yjs_state: yjs_state ? Buffer.from(yjs_state) : undefined,
        last_modified_by: req.userId,
        metadata,
        collection_id,
        properties
      });
      if (!document) { res.status(404).json({ error: 'Document not found' }); return; }

      // Reindex for search
      searchService.reindexDocument(document.id).catch(e =>
        observability.error('Auto-reindex failed', { error: e, documentId: document.id })
      );
      const responseBody = { ...document, yjs_state: document.yjs_state ? document.yjs_state.toString('base64') : null };
      if (idempotencyKey && req.userId) {
        await storeIdempotentReplay(
          {
            userId: req.userId,
            workspaceId: workspaceIdForReplay ?? document.workspace_id,
            operation: 'document_update',
            idempotencyKey
          },
          200,
          responseBody
        );
      }
      res.json(responseBody);
    } catch {
      res.status(500).json({ error: 'Failed to update document' });
    }
  });

  // Rename document (PATCH for just title)
  app.patch('/api/v1/documents/:id/rename', authMiddleware, checkPermission('collection:edit', 'document'), async (req: AuthRequest, res: Response) => {
    try {
      const { title } = req.body;
      if (!title || typeof title !== 'string') {
        res.status(400).json({ error: 'title is required' });
        return;
      }
      const document = await DocumentModel.update(req.params.id, {
        title: title.trim(),
        last_modified_by: req.userId,
      });
      if (!document) { res.status(404).json({ error: 'Document not found' }); return; }

      // Reindex for search
      searchService.reindexDocument(document.id).catch(e =>
        observability.error('Auto-reindex failed', { error: e, documentId: document.id })
      );

      res.json({ id: document.id, title: document.title });
    } catch {
      res.status(500).json({ error: 'Failed to rename document' });
    }
  });

  // Set document parent (for nested pages)
  app.patch('/api/v1/documents/:id/parent', authMiddleware, checkPermission('collection:edit', 'document'), async (req: AuthRequest, res: Response) => {
    try {
      const { parent_id } = req.body;
      const existing = await DocumentModel.findById(req.params.id);
      if (!existing) { res.status(404).json({ error: 'Document not found' }); return; }
      const currentMeta = (existing.metadata as Record<string, any>) ?? {};
      const newMeta = { ...currentMeta, parent_id: parent_id ?? null };
      const document = await DocumentModel.update(req.params.id, {
        metadata: newMeta,
        last_modified_by: req.userId,
      });
      if (!document) { res.status(404).json({ error: 'Document not found' }); return; }
      res.json({ id: document.id, metadata: document.metadata });
    } catch {
      res.status(500).json({ error: 'Failed to set parent' });
    }
  });

  // Move document (change parent + position for sidebar DnD)
  app.patch('/api/v1/documents/:id/move', authMiddleware, checkPermission('collection:edit', 'document'), async (req: AuthRequest, res: Response) => {
    try {
      const { parent_id, position } = req.body;
      const existing = await DocumentModel.findById(req.params.id);
      if (!existing) { res.status(404).json({ error: 'Document not found' }); return; }
      const newMeta = { ...(existing.metadata as Record<string, any> ?? {}), parent_id: parent_id ?? null };
      const document = await DocumentModel.update(req.params.id, {
        metadata: newMeta,
        position: typeof position === 'number' ? position : undefined,
        last_modified_by: req.userId,
      });
      if (!document) { res.status(404).json({ error: 'Document not found' }); return; }
      res.json({ id: document.id, metadata: document.metadata, position: document.position });
    } catch {
      res.status(500).json({ error: 'Failed to move document' });
    }
  });

  // Delete document
  app.delete('/api/v1/documents/:id', authMiddleware, checkPermission('collection:delete', 'document'), async (req: AuthRequest, res: Response) => {
    try {
      const deleted = await DocumentModel.delete(req.params.id);
      if (!deleted) { res.status(404).json({ error: 'Document not found' }); return; }
      observability.info('Document deleted', { documentId: req.params.id });
      res.json({ message: 'Document deleted', documentId: req.params.id });
    } catch {
      res.status(500).json({ error: 'Failed to delete document' });
    }
  });

  // Get document blocks
  app.get('/api/v1/documents/:id/blocks', authMiddleware, checkPermission('collection:view', 'document'), async (req: AuthRequest, res: Response) => {
    try {
      const blocks = await BlockModel.findByDocument(req.params.id);
      res.json({ blocks });
    } catch {
      res.status(500).json({ error: 'Failed to get blocks' });
    }
  });

  // Search documents in workspace
  app.get('/api/v1/workspaces/:workspaceId/documents/search', authMiddleware, checkPermission('collection:view'), async (req: AuthRequest, res: Response) => {
    try {
      const { q: query, limit = 20 } = req.query;
      if (!query || typeof query !== 'string') {
        res.status(400).json({ error: 'Query "q" is required' });
        return;
      }
      const documents = await DocumentModel.search(req.params.workspaceId, query, parseInt(limit as string));
      res.json({ documents, query, count: documents.length });
    } catch {
      res.status(500).json({ error: 'Failed to search documents' });
    }
  });
}
