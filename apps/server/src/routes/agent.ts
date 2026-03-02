import type { Express, Request, Response } from 'express';
import crypto from 'node:crypto';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkPermission } from '../middleware/rbac.js';
import { getWorkspaceIdFromBody } from '../services/request.js';
import { getRunArtifacts, getRunById, startSupervisorRun, subscribeToRun } from '../services/agent.js';
import { isFeatureEnabled } from '../services/featureFlags.js';
import { checkQuota, recordUsage } from '../services/quota.js';

const AGENT_EVENT_SCHEMA_VERSION = 'v1';

function envelopeSsePayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return payload;
  }

  return {
    schema_version: AGENT_EVENT_SCHEMA_VERSION,
    emitted_at: new Date().toISOString(),
    ...(payload as Record<string, unknown>),
  };
}

function sendSse(res: Response, payload: unknown) {
  res.write(`data: ${JSON.stringify(envelopeSsePayload(payload))}\n\n`);
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
    const requestId = String((req as any).requestId ?? res.getHeader('X-Request-ID') ?? '');
    const keepAlive = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 15000);

    sendSse(res, { type: 'meta', run_id: runId, mode: run.mode, template: run.type, request_id: requestId });
    for (const step of run.steps || []) {
      sendSse(res, { type: 'step', step });
    }

    if (run.status !== 'running') {
      sendSse(res, { type: 'run', run });
      sendSse(res, { type: 'done' });
      sendDone(res);
      clearInterval(keepAlive);
      res.end();
      return;
    }

    const unsubscribe = subscribeToRun(runId, (event) => {
      sendSse(res, event);
      if (event.type === 'done') {
        sendDone(res);
        unsubscribe();
        clearInterval(poller);
        clearInterval(keepAlive);
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
        clearInterval(keepAlive);
        unsubscribe();
        res.end();
      }
    }, 800);

    req.on('close', () => {
      clearInterval(poller);
      clearInterval(keepAlive);
      unsubscribe();
    });
  });
}

function registerRunArtifactsRoutes(app: Express, path: string) {
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

    const limitRaw = Number(req.query.limit ?? 200);
    const offsetRaw = Number(req.query.offset ?? 0);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, Math.floor(limitRaw))) : 200;
    const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.floor(offsetRaw)) : 0;

    const artifacts = await getRunArtifacts(runId, { limit, offset });
    res.json({
      run_id: runId,
      limit,
      offset,
      ...artifacts,
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

  // Brainstorm template.
  app.post('/api/v1/agents/brainstorm', authMiddleware, checkPermission('collection:view'), async (req: AuthRequest, res: Response) => {
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
        template: 'brainstorm',
      });
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

  // Replay immutable step artifacts (snake + camel compatibility)
  registerRunArtifactsRoutes(app, '/api/v1/agents/runs/:run_id/artifacts');
  registerRunArtifactsRoutes(app, '/api/v1/agents/runs/:runId/artifacts');
}
