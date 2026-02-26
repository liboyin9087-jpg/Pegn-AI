import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { runResearchAgent, runSummarizeAgent, subscribeToRun } from '../services/agent.js';

// 暫存執行中的 runs（可改用 Redis）
const runs = new Map<string, any>();

export function registerAgentRoutes(app: Express): void {

  // 啟動 Research Agent
  app.post('/api/v1/agents/research', async (req: Request, res: Response) => {
    const { query, workspace_id } = req.body;
    if (!query || !workspace_id) {
      res.status(400).json({ error: 'query 和 workspace_id 為必填' }); return;
    }
    const runId = crypto.randomUUID();
    res.json({ run_id: runId, status: 'started' });

    // 背景執行
    runResearchAgent(query, workspace_id, runId).then(run => runs.set(runId, run));
  });

  // 啟動 Summarize Agent
  app.post('/api/v1/agents/summarize', async (req: Request, res: Response) => {
    const { text, workspace_id } = req.body;
    if (!text || !workspace_id) {
      res.status(400).json({ error: 'text 和 workspace_id 為必填' }); return;
    }
    const runId = crypto.randomUUID();
    res.json({ run_id: runId, status: 'started' });
    runSummarizeAgent(text, workspace_id, runId).then(run => runs.set(runId, run));
  });

  // 取得 run 狀態
  app.get('/api/v1/agents/runs/:runId', (req: Request, res: Response) => {
    const run = runs.get(req.params.runId);
    if (!run) { res.status(404).json({ error: 'run not found' }); return; }
    res.json(run);
  });

  // SSE 進度訂閱
  app.get('/api/v1/agents/runs/:runId/stream', (req: Request, res: Response) => {
    const { runId } = req.params;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // 如果已完成，直接送結果
    const existing = runs.get(runId);
    if (existing && existing.status !== 'running') {
      res.write(`data: ${JSON.stringify({ type: 'run', run: existing })}\n\n`);
      res.write('event: done\ndata: {}\n\n');
      res.end();
      return;
    }

    // 訂閱即時進度
    const unsubscribe = subscribeToRun(runId, (step) => {
      res.write(`data: ${JSON.stringify({ type: 'step', step })}\n\n`);
    });

    // 定期檢查是否完成
    const timer = setInterval(() => {
      const run = runs.get(runId);
      if (run && run.status !== 'running') {
        res.write(`data: ${JSON.stringify({ type: 'run', run })}\n\n`);
        res.write('event: done\ndata: {}\n\n');
        clearInterval(timer);
        unsubscribe();
        res.end();
      }
    }, 500);

    req.on('close', () => {
      clearInterval(timer);
      unsubscribe();
    });
  });
}
