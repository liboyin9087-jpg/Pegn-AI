import type { Express, Request, Response } from 'express';
import { graphRAGQuery } from '../services/graphrag.js';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { getWorkspaceIdFromBody } from '../services/request.js';

const GRAPHRAG_STREAM_SCHEMA_VERSION = 'v1';

function parseBooleanFlag(rawValue: unknown, defaultValue = false): boolean {
  if (rawValue == null) return defaultValue;
  if (typeof rawValue === 'boolean') return rawValue;
  const normalized = String(rawValue).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function registerGraphRAGRoutes(app: Express): void {
  app.post('/api/v1/graphrag/query', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
    const { query, top_k = 10 } = req.body;
    const workspaceId = getWorkspaceIdFromBody(req.body);
    const includeProfile =
      parseBooleanFlag(req.body?.debug, false) ||
      parseBooleanFlag(req.body?.include_profile, false) ||
      parseBooleanFlag(req.query.debug, false);

    if (!query || !workspaceId) {
      res.status(400).json({ error: 'query and workspace_id are required' });
      return;
    }

    try {
      const result = await graphRAGQuery(query, workspaceId, Number(top_k), { includeProfile });
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  app.post('/api/v1/graphrag/stream', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
    const { query, top_k = 10 } = req.body;
    const workspaceId = getWorkspaceIdFromBody(req.body);
    const includeProfile =
      parseBooleanFlag(req.body?.debug, false) ||
      parseBooleanFlag(req.body?.include_profile, false) ||
      parseBooleanFlag(req.query.debug, false);

    if (!query || !workspaceId) {
      res.status(400).json({ error: 'query and workspace_id are required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const result = await graphRAGQuery(query, workspaceId, Number(top_k), { includeProfile });

      res.write(`data: ${JSON.stringify({
        schema_version: GRAPHRAG_STREAM_SCHEMA_VERSION,
        type: 'meta',
        sources: result.sources,
        entities: result.entities,
        profile: result.debug?.profile,
        mode_used: 'graph',
      })}\n\n`);

      for (const token of result.answer) {
        res.write(`data: ${JSON.stringify({
          schema_version: GRAPHRAG_STREAM_SCHEMA_VERSION,
          type: 'token',
          token,
        })}\n\n`);
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      res.write(`data: ${JSON.stringify({
        schema_version: GRAPHRAG_STREAM_SCHEMA_VERSION,
        type: 'done',
        citations: result.citations,
      })}\n\n`);
      res.end();
    } catch (error) {
      res.write(`data: ${JSON.stringify({
        schema_version: GRAPHRAG_STREAM_SCHEMA_VERSION,
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown',
      })}\n\n`);
      res.end();
    }
  });
}
