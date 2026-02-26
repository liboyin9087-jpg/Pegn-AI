import type { Express, Request, Response } from 'express';
import { graphRAGQuery } from '../services/graphrag.js';
import { authMiddleware } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { getWorkspaceIdFromBody } from '../services/request.js';

export function registerGraphRAGRoutes(app: Express): void {

  // GraphRAG 查詢（向量 + BM25 + KG 圖遍歷 + RRF + Gemini 合成）
  app.post('/api/v1/graphrag/query', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
    const { query, top_k = 10 } = req.body;
    const workspace_id = getWorkspaceIdFromBody(req.body);
    if (!query || !workspace_id) {
      res.status(400).json({ error: 'query and workspace_id are required' });
      return;
    }
    try {
      const result = await graphRAGQuery(query, workspace_id, Number(top_k));
      res.json(result);
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
    }
  });

  // SSE 串流版 GraphRAG（逐字輸出答案）
  app.post('/api/v1/graphrag/stream', authMiddleware, checkPermission('collection:view'), async (req: Request, res: Response) => {
    const { query, top_k = 10 } = req.body;
    const workspace_id = getWorkspaceIdFromBody(req.body);
    if (!query || !workspace_id) {
      res.status(400).json({ error: 'query and workspace_id are required' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    try {
      const result = await graphRAGQuery(query, workspace_id, Number(top_k));

      // 先送 sources 和 entities metadata
      res.write(`data: ${JSON.stringify({ type: 'meta', sources: result.sources, entities: result.entities, mode_used: 'graph' })}\n\n`);

      // 逐字送出答案
      for (const char of result.answer) {
        res.write(`data: ${JSON.stringify({ type: 'token', token: char })}\n\n`);
        await new Promise(r => setTimeout(r, 5));
      }

      res.write(`data: ${JSON.stringify({ type: 'done', citations: result.citations })}\n\n`);
      res.end();
    } catch (error) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: error instanceof Error ? error.message : 'Unknown' })}\n\n`);
      res.end();
    }
  });
}
