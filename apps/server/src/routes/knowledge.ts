import type { Express, Request, Response } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { getWorkspaceIdFromBody } from '../services/request.js';
import { knowledgeQuery, type KnowledgeMode } from '../services/knowledge.js';
import { isFeatureEnabled } from '../services/featureFlags.js';

export function registerKnowledgeRoutes(app: Express): void {
  app.post('/api/v1/knowledge/query', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
    if (!isFeatureEnabled('KNOWLEDGE_ROUTER_V1')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const query = String(req.body?.query ?? '').trim();
    const workspaceId = getWorkspaceIdFromBody(req.body);
    const mode = (req.body?.mode ?? 'auto') as KnowledgeMode;
    const topK = Number(req.body?.top_k ?? 10);

    if (!query || !workspaceId) {
      res.status(400).json({ error: 'query and workspace_id are required' });
      return;
    }

    try {
      const result = await knowledgeQuery({
        query,
        workspace_id: workspaceId,
        mode,
        top_k: topK,
      });
      res.json(result);
    } catch (error) {
      res.status(500).json({
        error: 'Knowledge query failed',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  app.post('/api/v1/knowledge/stream', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
    if (!isFeatureEnabled('KNOWLEDGE_ROUTER_V1')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const query = String(req.body?.query ?? '').trim();
    const workspaceId = getWorkspaceIdFromBody(req.body);
    const mode = (req.body?.mode ?? 'auto') as KnowledgeMode;
    const topK = Number(req.body?.top_k ?? 10);

    if (!query || !workspaceId) {
      res.status(400).json({ error: 'query and workspace_id are required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const result = await knowledgeQuery({
        query,
        workspace_id: workspaceId,
        mode,
        top_k: topK,
      });

      res.write(`data: ${JSON.stringify({
        type: 'meta',
        mode_used: result.mode_used,
        routing_reason: result.routing_reason,
        sources: result.sources,
        entities: result.entities,
        citations: result.citations,
        debug: result.debug,
      })}\n\n`);

      for (const char of result.answer) {
        res.write(`data: ${JSON.stringify({ type: 'token', token: char })}\n\n`);
      }

      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    } catch (error) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Unknown error' })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    }
  });
}
