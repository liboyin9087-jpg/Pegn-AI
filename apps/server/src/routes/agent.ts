import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { getWorkspaceIdFromBody } from '../services/request.js';
import { getRunById, startSupervisorRun, subscribeToRun } from '../services/agent.js';
import { isFeatureEnabled } from '../services/featureFlags.js';
import { checkQuota, recordUsage } from '../services/quota.js';
import { pool } from '../db/client.js';

function sendSse(res: Response, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendDone(res: Response) {
  res.write('event: done\ndata: {}\n\n');
}

function registerRunReadRoutes(app: Express, path: string) {
  app.get(path, authMiddleware, async (req: AuthRequest, res: Response) => {
    const runId = req.params.run_id || req.params.runId;
    if (!runId) {
      res.status(400).json({ error: 'run_id is required' });
      return;
    }

    const run = await getRunById(runId);
    if (!run) {
      res.status(404).json({ error: 'run not found' });
      return;
    }

    if (run.user_id !== req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    res.json(run);
  });
}

function registerRunStreamRoutes(app: Express, path: string) {
  app.get(path, authMiddleware, async (req: AuthRequest, res: Response) => {
    const runId = req.params.run_id || req.params.runId;
    if (!runId) {
      res.status(400).json({ error: 'run_id is required' });
      return;
    }

    const run = await getRunById(runId);
    if (!run) {
      res.status(404).json({ error: 'run not found' });
      return;
    }

    if (run.user_id !== req.userId) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    sendSse(res, { type: 'meta', run_id: runId, mode: run.mode, template: run.type });
    for (const step of run.steps || []) {
      sendSse(res, { type: 'step', step });
    }

    if (run.status !== 'running') {
      sendSse(res, { type: 'run', run });
      sendSse(res, { type: 'done' });
      sendDone(res);
      res.end();
      return;
    }

    const unsubscribe = subscribeToRun(runId, (event) => {
      sendSse(res, event);
      if (event.type === 'done') {
        sendDone(res);
        unsubscribe();
        clearInterval(poller);
        res.end();
      }
    });

    const poller = setInterval(async () => {
      const latest = await getRunById(runId);
      if (!latest) return;
      if (latest.status !== 'running') {
        sendSse(res, { type: 'run', run: latest });
        sendSse(res, { type: 'done' });
        sendDone(res);
        clearInterval(poller);
        unsubscribe();
        res.end();
      }
    }, 800);

    req.on('close', () => {
      clearInterval(poller);
      unsubscribe();
    });
  });
}

export function registerAgentRoutes(app: Express): void {
  // Start Supervisor run.
  app.post('/api/v1/agents/supervisor', authMiddleware, checkPermission('collection:view'), async (req: AuthRequest, res: Response) => {
    if (!isFeatureEnabled('SUPERVISOR_V1')) {
      res.status(404).json({ error: 'Not found' });
      return;
    }

    const query = String(req.body?.query ?? '').trim();
    const workspaceId = getWorkspaceIdFromBody(req.body);
    const mode = (req.body?.mode ?? 'auto') as 'auto' | 'hybrid' | 'graph';

    if (!query || !workspaceId) {
      res.status(400).json({ error: 'query and workspace_id are required' });
      return;
    }

    const quota = await checkQuota(workspaceId, 'agent_runs');
    if (!quota.allowed) {
      res.status(429).json({ error: 'Daily agent run quota exceeded', quota });
      return;
    }

    try {
      const runId = crypto.randomUUID();
      await startSupervisorRun({
        runId,
        query,
        workspace_id: workspaceId,
        user_id: req.userId!,
        mode,
        template: 'supervisor',
      });
      await recordUsage(workspaceId, req.userId!, 'agent_runs', 1);
      res.json({ run_id: runId, status: 'started' });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to start supervisor run',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Compatibility route: research template.
  app.post('/api/v1/agents/research', authMiddleware, checkPermission('collection:view'), async (req: AuthRequest, res: Response) => {
    const query = String(req.body?.query ?? '').trim();
    const workspaceId = getWorkspaceIdFromBody(req.body);
    if (!query || !workspaceId) {
      res.status(400).json({ error: 'query and workspace_id are required' });
      return;
    }

    const quota = await checkQuota(workspaceId, 'agent_runs');
    if (!quota.allowed) {
      res.status(429).json({ error: 'Daily agent run quota exceeded', quota });
      return;
    }

    try {
      const runId = crypto.randomUUID();
      await startSupervisorRun({
        runId,
        query,
        workspace_id: workspaceId,
        user_id: req.userId!,
        mode: 'auto',
        template: 'research',
      });
      await recordUsage(workspaceId, req.userId!, 'agent_runs', 1);
      res.json({ run_id: runId, status: 'started' });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to start research run',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Compatibility route: summarize template.
  app.post('/api/v1/agents/summarize', authMiddleware, checkPermission('collection:view'), async (req: AuthRequest, res: Response) => {
    const text = String(req.body?.text ?? '').trim();
    const workspaceId = getWorkspaceIdFromBody(req.body);
    if (!text || !workspaceId) {
      res.status(400).json({ error: 'text and workspace_id are required' });
      return;
    }

    const quota = await checkQuota(workspaceId, 'agent_runs');
    if (!quota.allowed) {
      res.status(429).json({ error: 'Daily agent run quota exceeded', quota });
      return;
    }

    try {
      const runId = crypto.randomUUID();
      await startSupervisorRun({
        runId,
        query: text,
        workspace_id: workspaceId,
        user_id: req.userId!,
        mode: 'hybrid',
        template: 'summarize',
      });
      await recordUsage(workspaceId, req.userId!, 'agent_runs', 1);
      res.json({ run_id: runId, status: 'started' });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to start summarize run',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Brainstorm template.
  app.post('/api/v1/agents/brainstorm', authMiddleware, checkPermission('collection:view'), async (req: AuthRequest, res: Response) => {
    const query = String(req.body?.query ?? '').trim();
    const workspaceId = getWorkspaceIdFromBody(req.body);
    if (!query || !workspaceId) {
      res.status(400).json({ error: 'query and workspace_id are required' });
      return;
    }

    const quota = await checkQuota(workspaceId, 'agent_runs');
    if (!quota.allowed) {
      res.status(429).json({ error: 'Daily agent run quota exceeded', quota });
      return;
    }

    try {
      const runId = crypto.randomUUID();
      await startSupervisorRun({
        runId,
        query,
        workspace_id: workspaceId,
        user_id: req.userId!,
        mode: 'auto',
        template: 'brainstorm',
      });
      await recordUsage(workspaceId, req.userId!, 'agent_runs', 1);
      res.json({ run_id: runId, status: 'started' });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to start brainstorm run',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Outline template.
  app.post('/api/v1/agents/outline', authMiddleware, checkPermission('collection:view'), async (req: AuthRequest, res: Response) => {
    const query = String(req.body?.query ?? '').trim();
    const workspaceId = getWorkspaceIdFromBody(req.body);
    if (!query || !workspaceId) {
      res.status(400).json({ error: 'query and workspace_id are required' });
      return;
    }

    const quota = await checkQuota(workspaceId, 'agent_runs');
    if (!quota.allowed) {
      res.status(429).json({ error: 'Daily agent run quota exceeded', quota });
      return;
    }

    try {
      const runId = crypto.randomUUID();
      await startSupervisorRun({
        runId,
        query,
        workspace_id: workspaceId,
        user_id: req.userId!,
        mode: 'hybrid',
        template: 'outline',
      });
      await recordUsage(workspaceId, req.userId!, 'agent_runs', 1);
      res.json({ run_id: runId, status: 'started' });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to start outline run',
        details: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  });

  // Read run state (snake + camel compatibility)
  registerRunReadRoutes(app, '/api/v1/agents/runs/:run_id');
  registerRunReadRoutes(app, '/api/v1/agents/runs/:runId');

  // Stream run events (snake + camel compatibility)
  registerRunStreamRoutes(app, '/api/v1/agents/runs/:run_id/stream');
  registerRunStreamRoutes(app, '/api/v1/agents/runs/:runId/stream');

  /**
   * GET /api/v1/agents/runs/:run_id/tree
   * P2-1: Returns the full recursive run tree rooted at this run or its root ancestor.
   * Uses a recursive CTE to traverse parent_run_id / root_run_id linkage.
   */
  app.get('/api/v1/agents/runs/:run_id/tree', authMiddleware, async (req: AuthRequest, res: Response) => {
    const runId = req.params.run_id;
    if (!runId || !pool) {
      res.status(400).json({ error: 'run_id required' });
      return;
    }

    const run = await getRunById(runId);
    if (!run) { res.status(404).json({ error: 'run not found' }); return; }
    if (run.user_id !== req.userId) { res.status(403).json({ error: 'Forbidden' }); return; }

    try {
      // Resolve the root of the tree
      const rootRes = await pool.query(
        `SELECT COALESCE(root_run_id, id) AS root_id FROM agent_runs WHERE id = $1`,
        [runId]
      );
      const rootId: string = rootRes.rows[0]?.root_id ?? runId;

      // Recursive CTE: collect every run in the tree
      const treeRes = await pool.query(
        `WITH RECURSIVE run_tree AS (
           SELECT id, parent_run_id, root_run_id, depth, type, query, status, token_usage,
                  started_at, finished_at, created_at
           FROM agent_runs WHERE id = $1
           UNION ALL
           SELECT r.id, r.parent_run_id, r.root_run_id, r.depth, r.type, r.query, r.status,
                  r.token_usage, r.started_at, r.finished_at, r.created_at
           FROM agent_runs r
           INNER JOIN run_tree rt ON r.parent_run_id = rt.id
         )
         SELECT * FROM run_tree ORDER BY depth ASC, created_at ASC`,
        [rootId]
      );

      // Build nested tree structure
      const rows: any[] = treeRes.rows;
      const nodeMap = new Map<string, any>();
      for (const row of rows) {
        nodeMap.set(row.id, { ...row, children: [] });
      }
      let root: any = null;
      for (const row of rows) {
        const node = nodeMap.get(row.id)!;
        if (row.parent_run_id && nodeMap.has(row.parent_run_id)) {
          nodeMap.get(row.parent_run_id)!.children.push(node);
        } else {
          root = node;
        }
      }

      res.json({ root_run_id: rootId, tree: root ?? { ...run, children: [] } });
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch run tree' });
    }
  });
}
