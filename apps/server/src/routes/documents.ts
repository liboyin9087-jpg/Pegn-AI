import type { Express, Response } from 'express';
import { BlockModel } from '../models/block.js';
import { DocumentModel } from '../models/document.js';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { emitAutomationEvent } from '../services/automation.js';
import {
  getIdempotencyKeyFromRequest,
  getIdempotentReplay,
  storeIdempotentReplay,
} from '../services/idempotency.js';
import { observability } from '../services/observability.js';
import { searchService } from '../services/search.js';

function sendApiError(res: Response, status: number, code: string, message: string, details: unknown = null) {
  res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

export function registerDocumentRoutes(app: Express): void {
  app.post('/api/v1/documents', authMiddleware, checkPermission('collection:edit'), async (req: AuthRequest, res: Response) => {
    try {
      const workspaceId = req.body?.workspace_id || req.body?.workspaceId;
      const { title, content, yjs_state, metadata, collection_id, properties } = req.body;
      if (!workspaceId || !title) {
        sendApiError(res, 400, 'BAD_REQUEST', 'workspace_id and title are required');
        return;
      }

      const document = await DocumentModel.create({
        workspace_id: workspaceId,
        title,
        content,
        yjs_state: yjs_state ? Buffer.from(yjs_state) : undefined,
        created_by: req.userId,
        metadata,
        collection_id,
        properties,
        index_status: 'pending',
      });

      searchService.enqueueDocumentReindex(document.id, workspaceId).catch((error) => {
        observability.error('Auto-reindex failed', {
          error,
          documentId: document.id,
          workspaceId,
        });
      });

      emitAutomationEvent({
        type: 'doc_created',
        workspaceId,
        entityType: 'document',
        entityId: document.id,
        payload: { title: document.title, collection_id: collection_id ?? null },
        triggeredBy: req.userId,
      });

      observability.info('Document created', { documentId: document.id });
      res.status(201).json(document);
    } catch {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to create document');
    }
  });

  app.get('/api/v1/documents/:id', authMiddleware, checkPermission('collection:view', 'document'), async (req: AuthRequest, res: Response) => {
    try {
      const document = await DocumentModel.findById(req.params.id);
      if (!document) {
        sendApiError(res, 404, 'NOT_FOUND', 'Document not found');
        return;
      }

      res.json({
        ...document,
        yjs_state: document.yjs_state ? document.yjs_state.toString('base64') : null,
      });
    } catch {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to get document');
    }
  });

  app.get('/api/v1/workspaces/:workspaceId/documents', authMiddleware, checkPermission('collection:view'), async (req: AuthRequest, res: Response) => {
    try {
      const { workspaceId } = req.params;
      const { limit = 50, offset = 0 } = req.query;
      const documents = await DocumentModel.findByWorkspace(
        workspaceId,
        parseInt(limit as string, 10),
        parseInt(offset as string, 10)
      );
      res.json({ documents });
    } catch {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to list documents');
    }
  });

  app.put('/api/v1/documents/:id', authMiddleware, checkPermission('collection:edit', 'document'), async (req: AuthRequest, res: Response) => {
    try {
      const idempotencyKey = getIdempotencyKeyFromRequest(req);
      let workspaceIdForReplay: string | undefined;

      if (idempotencyKey && req.userId) {
        const existing = await DocumentModel.findById(req.params.id);
        if (!existing) {
          sendApiError(res, 404, 'NOT_FOUND', 'Document not found');
          return;
        }

        workspaceIdForReplay = existing.workspace_id;
        const replay = await getIdempotentReplay({
          userId: req.userId,
          workspaceId: workspaceIdForReplay,
          operation: 'document_update',
          idempotencyKey,
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
        properties,
      });

      if (!document) {
        sendApiError(res, 404, 'NOT_FOUND', 'Document not found');
        return;
      }

      await searchService.markDocumentIndexStale(document.id, document.workspace_id);

      emitAutomationEvent({
        type: 'doc_updated',
        workspaceId: document.workspace_id,
        entityType: 'document',
        entityId: document.id,
        payload: { title: document.title },
        triggeredBy: req.userId,
      });

      const responseBody = {
        ...document,
        yjs_state: document.yjs_state ? document.yjs_state.toString('base64') : null,
      };

      if (idempotencyKey && req.userId) {
        await storeIdempotentReplay(
          {
            userId: req.userId,
            workspaceId: workspaceIdForReplay ?? document.workspace_id,
            operation: 'document_update',
            idempotencyKey,
          },
          200,
          responseBody
        );
      }

      res.json(responseBody);
    } catch {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to update document');
    }
  });

  app.patch('/api/v1/documents/:id/rename', authMiddleware, checkPermission('collection:edit', 'document'), async (req: AuthRequest, res: Response) => {
    try {
      const { title } = req.body;
      if (!title || typeof title !== 'string') {
        sendApiError(res, 400, 'BAD_REQUEST', 'title is required');
        return;
      }

      const document = await DocumentModel.update(req.params.id, {
        title: title.trim(),
        last_modified_by: req.userId,
      });
      if (!document) {
        sendApiError(res, 404, 'NOT_FOUND', 'Document not found');
        return;
      }

      await searchService.markDocumentIndexStale(document.id, document.workspace_id);
      res.json({ id: document.id, title: document.title });
    } catch {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to rename document');
    }
  });

  app.patch('/api/v1/documents/:id/parent', authMiddleware, checkPermission('collection:edit', 'document'), async (req: AuthRequest, res: Response) => {
    try {
      const { parent_id } = req.body;
      const existing = await DocumentModel.findById(req.params.id);
      if (!existing) {
        sendApiError(res, 404, 'NOT_FOUND', 'Document not found');
        return;
      }

      const currentMeta = (existing.metadata as Record<string, any>) ?? {};
      const newMeta = { ...currentMeta, parent_id: parent_id ?? null };
      const document = await DocumentModel.update(req.params.id, {
        metadata: newMeta,
        last_modified_by: req.userId,
      });
      if (!document) {
        sendApiError(res, 404, 'NOT_FOUND', 'Document not found');
        return;
      }

      res.json({ id: document.id, metadata: document.metadata });
    } catch {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to set parent');
    }
  });

  app.patch('/api/v1/documents/:id/move', authMiddleware, checkPermission('collection:edit', 'document'), async (req: AuthRequest, res: Response) => {
    try {
      const { parent_id, position } = req.body;
      const existing = await DocumentModel.findById(req.params.id);
      if (!existing) {
        sendApiError(res, 404, 'NOT_FOUND', 'Document not found');
        return;
      }

      const newMeta = { ...((existing.metadata as Record<string, any>) ?? {}), parent_id: parent_id ?? null };
      const document = await DocumentModel.update(req.params.id, {
        metadata: newMeta,
        position: typeof position === 'number' ? position : undefined,
        last_modified_by: req.userId,
      });
      if (!document) {
        sendApiError(res, 404, 'NOT_FOUND', 'Document not found');
        return;
      }

      res.json({ id: document.id, metadata: document.metadata, position: document.position });
    } catch {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to move document');
    }
  });

  app.delete('/api/v1/documents/:id', authMiddleware, checkPermission('collection:delete', 'document'), async (req: AuthRequest, res: Response) => {
    try {
      const existing = await DocumentModel.findById(req.params.id);
      if (!existing) {
        sendApiError(res, 404, 'NOT_FOUND', 'Document not found');
        return;
      }

      await searchService.cleanupDocumentIndex(existing.id, existing.workspace_id);
      const deleted = await DocumentModel.delete(req.params.id);
      if (!deleted) {
        sendApiError(res, 404, 'NOT_FOUND', 'Document not found');
        return;
      }

      observability.info('Document deleted', { documentId: req.params.id });

      emitAutomationEvent({
        type: 'doc_deleted',
        workspaceId: existing.workspace_id,
        entityType: 'document',
        entityId: req.params.id,
        payload: { title: existing.title },
        triggeredBy: req.userId,
      });

      res.json({ message: 'Document deleted', documentId: req.params.id });
    } catch {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to delete document');
    }
  });

  app.get('/api/v1/documents/:id/blocks', authMiddleware, checkPermission('collection:view', 'document'), async (req: AuthRequest, res: Response) => {
    try {
      const blocks = await BlockModel.findByDocument(req.params.id);
      res.json({ blocks });
    } catch {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to get blocks');
    }
  });

  app.get('/api/v1/workspaces/:workspaceId/documents/search', authMiddleware, checkPermission('collection:view'), async (req: AuthRequest, res: Response) => {
    try {
      const { q: query, limit = 20 } = req.query;
      if (!query || typeof query !== 'string') {
        sendApiError(res, 400, 'BAD_REQUEST', 'Query "q" is required');
        return;
      }

      const documents = await DocumentModel.search(req.params.workspaceId, query, parseInt(limit as string, 10));
      res.json({ documents, query, count: documents.length });
    } catch {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to search documents');
    }
  });
}
