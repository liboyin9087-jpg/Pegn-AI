import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { getWorkspaceIdFromBody } from '../services/request.js';
import { getRunById, startSupervisorRun, subscribeToRun } from '../services/agent.js';
import { isFeatureEnabled } from '../services/featureFlags.js';

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

      res.json({ run_id: runId, status: 'started' });
    } catch (error) {
      res.status(500).json({
        error: 'Failed to start summarize run',
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
}
