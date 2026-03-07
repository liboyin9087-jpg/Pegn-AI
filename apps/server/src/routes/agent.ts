import type { Express, Response } from 'express';
import { authMiddleware, type AuthRequest } from '../middleware/auth.js';
import { checkWorkspaceCapability } from '../middleware/rbac.js';
import {
  createAndStartAgentRun,
  getAgentRunArtifacts,
  getAgentRunById,
  getAgentRunDetail,
  listAgentRuns,
  rerunAgentRun,
  startSupervisorRun,
  subscribeToRun,
} from '../services/agent.js';
import { isFeatureEnabled } from '../services/featureFlags.js';
import { checkQuota, recordUsage } from '../services/quota.js';
import { getWorkspaceIdFromRequest } from '../services/request.js';
import { pool } from '../db/client.js';
import { recordAuditLog } from '../services/admin.js';

function sendApiError(res: Response, status: number, code: string, message: string, details: unknown = null) {
  res.status(status).json({
    error: {
      code,
      message,
      details,
    },
  });
}

function sendSse(res: Response, payload: unknown) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function sendDone(res: Response) {
  res.write('event: done\ndata: {}\n\n');
}

async function createTemplateRun(params: {
  req: AuthRequest;
  input: string;
  workspaceId: string;
  template: 'supervisor' | 'research' | 'summarize' | 'brainstorm' | 'outline';
  mode: 'auto' | 'hybrid' | 'graph';
}) {
  const quota = await checkQuota(params.workspaceId, 'agent_runs');
  if (!quota.allowed) {
    return {
      error: { status: 429, code: 'FORBIDDEN', message: 'Daily agent run quota exceeded', details: quota },
    };
  }

  const run = await startSupervisorRun({
    workspace_id: params.workspaceId,
    user_id: params.req.userId!,
    query: params.input,
    mode: params.mode,
    template: params.template,
  });

  await recordUsage(params.workspaceId, params.req.userId!, 'agent_runs', 1);
  return { run };
}

function attachRunReadRoute(app: Express, path: string) {
  app.get(path, authMiddleware, checkWorkspaceCapability('canViewWorkspace'), async (req: AuthRequest, res: Response) => {
    const runId = req.params.run_id || req.params.runId;
    const workspaceId = getWorkspaceIdFromRequest(req);

    if (!runId || !workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'run_id and workspace_id are required');
      return;
    }

    const run = await getAgentRunDetail(runId, workspaceId, req.userId!);
    if (!run) {
      sendApiError(res, 404, 'NOT_FOUND', 'Run not found');
      return;
    }

    res.json(run);
  });
}

function attachRunStreamRoute(app: Express, path: string) {
  app.get(path, authMiddleware, checkWorkspaceCapability('canViewWorkspace'), async (req: AuthRequest, res: Response) => {
    const runId = req.params.run_id || req.params.runId;
    const workspaceId = getWorkspaceIdFromRequest(req);

    if (!runId || !workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'run_id and workspace_id are required');
      return;
    }

    const run = await getAgentRunById(runId, workspaceId, req.userId!);
    if (!run) {
      sendApiError(res, 404, 'NOT_FOUND', 'Run not found');
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    let closed = false;
    const finish = () => {
      if (closed) return;
      closed = true;
      sendDone(res);
      res.end();
    };

    sendSse(res, { type: 'meta', run_id: run.id, mode: run.mode, template: run.type });
    sendSse(res, { type: 'run', run });
    for (const step of run.steps ?? []) {
      sendSse(res, { type: 'step', step });
    }

    if (run.status === 'completed' || run.status === 'failed') {
      sendSse(res, { type: 'done' });
      finish();
      return;
    }

    const unsubscribe = subscribeToRun(runId, (event) => {
      if (closed) return;
      sendSse(res, event);
      if (event.type === 'done') {
        unsubscribe();
        clearInterval(poller);
        finish();
      }
    });

    const poller = setInterval(async () => {
      const latest = await getAgentRunById(runId, workspaceId, req.userId!);
      if (!latest || closed) return;
      if (latest.status === 'completed' || latest.status === 'failed') {
        sendSse(res, { type: 'run', run: latest });
        sendSse(res, { type: 'done' });
        clearInterval(poller);
        unsubscribe();
        finish();
      }
    }, 800);

    req.on('close', () => {
      clearInterval(poller);
      unsubscribe();
      closed = true;
    });
  });
}

export function registerAgentRoutes(app: Express): void {
  app.post('/api/v1/agents/runs', authMiddleware, checkWorkspaceCapability('canRunAutomation'), async (req: AuthRequest, res: Response) => {
    const input = String(req.body?.input ?? req.body?.query ?? req.body?.text ?? '').trim();
    const workspaceId = getWorkspaceIdFromRequest(req);
    const mode = (req.body?.mode ?? 'auto') as 'auto' | 'hybrid' | 'graph';
    const template = (req.body?.template ?? 'supervisor') as 'supervisor' | 'research' | 'summarize' | 'brainstorm' | 'outline';

    if (template === 'supervisor' && !isFeatureEnabled('SUPERVISOR_V1')) {
      sendApiError(res, 404, 'NOT_FOUND', 'Not found');
      return;
    }

    if (!input || !workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'input and workspace_id are required');
      return;
    }

    try {
      const quota = await checkQuota(workspaceId, 'agent_runs');
      if (!quota.allowed) {
        sendApiError(res, 429, 'FORBIDDEN', 'Daily agent run quota exceeded', quota);
        return;
      }

      const run = await createAndStartAgentRun({
        workspaceId,
        userId: req.userId!,
        input,
        mode,
        template,
        threadId: typeof req.body?.thread_id === 'string' ? req.body.thread_id : null,
        templateId: typeof req.body?.template_id === 'string' ? req.body.template_id : template,
        templateVersion: typeof req.body?.template_version === 'string' ? req.body.template_version : 'v1',
        promptVersion: typeof req.body?.prompt_version === 'string' ? req.body.prompt_version : 'v1',
        promptLabel: typeof req.body?.prompt_label === 'string' ? req.body.prompt_label : template,
      });

      await recordUsage(workspaceId, req.userId!, 'agent_runs', 1);
      res.status(201).json({ ...run, runId: run.id });
    } catch (error) {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to create agent run', error instanceof Error ? error.message : 'Unknown error');
    }
  });

  app.get('/api/v1/agents/runs', authMiddleware, checkWorkspaceCapability('canViewWorkspace'), async (req: AuthRequest, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    if (!workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'workspace_id is required');
      return;
    }

    const limit = Math.max(1, Math.min(50, parseInt(String(req.query.limit ?? '10'), 10) || 10));
    const status = typeof req.query.status === 'string' ? req.query.status : null;
    const threadId = typeof req.query.threadId === 'string' ? req.query.threadId : null;
    const agentType = typeof req.query.agentType === 'string' ? req.query.agentType : null;
    const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;

    try {
      const runs = await listAgentRuns(workspaceId, req.userId!, {
        limit,
        cursor,
        threadId,
        status: status as any,
        agentType,
      });
      res.json(runs);
    } catch (error) {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to list agent runs', error instanceof Error ? error.message : 'Unknown error');
    }
  });

  attachRunReadRoute(app, '/api/v1/agents/runs/:run_id');
  attachRunReadRoute(app, '/api/v1/agents/runs/:runId');

  app.get('/api/v1/agents/runs/:run_id/artifacts', authMiddleware, checkWorkspaceCapability('canViewWorkspace'), async (req: AuthRequest, res: Response) => {
    const runId = req.params.run_id;
    const workspaceId = getWorkspaceIdFromRequest(req);
    if (!runId || !workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'run_id and workspace_id are required');
      return;
    }

    const run = await getAgentRunById(runId, workspaceId, req.userId!);
    if (!run) {
      sendApiError(res, 404, 'NOT_FOUND', 'Run not found');
      return;
    }

    const items = await getAgentRunArtifacts(runId, workspaceId, req.userId!);
    res.json({ items });
  });

  app.get('/api/v1/agents/runs/:runId/artifacts', authMiddleware, checkWorkspaceCapability('canViewWorkspace'), async (req: AuthRequest, res: Response) => {
    const runId = req.params.runId;
    const workspaceId = getWorkspaceIdFromRequest(req);
    if (!runId || !workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'run_id and workspace_id are required');
      return;
    }

    const run = await getAgentRunById(runId, workspaceId, req.userId!);
    if (!run) {
      sendApiError(res, 404, 'NOT_FOUND', 'Run not found');
      return;
    }

    const items = await getAgentRunArtifacts(runId, workspaceId, req.userId!);
    res.json({ items });
  });

  app.post('/api/v1/agents/runs/:run_id/rerun', authMiddleware, checkWorkspaceCapability('canRunAutomation'), async (req: AuthRequest, res: Response) => {
    const runId = req.params.run_id;
    const workspaceId = getWorkspaceIdFromRequest(req);
    if (!runId || !workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'run_id and workspace_id are required');
      return;
    }

    try {
      const run = await rerunAgentRun(runId, workspaceId, req.userId!);
      await recordAuditLog({
        workspaceId,
        actorId: req.userId ?? null,
        actorDisplay: req.userEmail ?? req.userId ?? 'Unknown user',
        eventType: 'agent_run_rerun',
        targetType: 'agent_run',
        targetId: run.id,
        summary: `Reran agent run ${runId}`,
        metadata: {
          rerunOfRunId: runId,
          newRunId: run.id,
          jobId: run.jobId ?? null,
        },
      });
      res.status(201).json({
        runId: run.id,
        jobId: run.jobId ?? null,
        status: run.status,
        rerunOfRunId: run.rerunOfRunId ?? runId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const code = message === 'Run not found' ? 'NOT_FOUND' : 'INVALID_STATE';
      const statusCode = message === 'Run not found' ? 404 : 500;
      sendApiError(res, statusCode, code, message);
    }
  });

  app.post('/api/v1/agents/runs/:runId/rerun', authMiddleware, checkWorkspaceCapability('canRunAutomation'), async (req: AuthRequest, res: Response) => {
    const runId = req.params.runId;
    const workspaceId = getWorkspaceIdFromRequest(req);
    if (!runId || !workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'run_id and workspace_id are required');
      return;
    }

    try {
      const run = await rerunAgentRun(runId, workspaceId, req.userId!);
      await recordAuditLog({
        workspaceId,
        actorId: req.userId ?? null,
        actorDisplay: req.userEmail ?? req.userId ?? 'Unknown user',
        eventType: 'agent_run_rerun',
        targetType: 'agent_run',
        targetId: run.id,
        summary: `Reran agent run ${runId}`,
        metadata: {
          rerunOfRunId: runId,
          newRunId: run.id,
          jobId: run.jobId ?? null,
        },
      });
      res.status(201).json({
        runId: run.id,
        jobId: run.jobId ?? null,
        status: run.status,
        rerunOfRunId: run.rerunOfRunId ?? runId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      const code = message === 'Run not found' ? 'NOT_FOUND' : 'INVALID_STATE';
      const statusCode = message === 'Run not found' ? 404 : 500;
      sendApiError(res, statusCode, code, message);
    }
  });

  attachRunStreamRoute(app, '/api/v1/agents/runs/:run_id/stream');
  attachRunStreamRoute(app, '/api/v1/agents/runs/:runId/stream');

  app.post('/api/v1/agents/supervisor', authMiddleware, checkWorkspaceCapability('canRunAutomation'), async (req: AuthRequest, res: Response) => {
    if (!isFeatureEnabled('SUPERVISOR_V1')) {
      sendApiError(res, 404, 'NOT_FOUND', 'Not found');
      return;
    }

    const workspaceId = getWorkspaceIdFromRequest(req);
    const input = String(req.body?.query ?? '').trim();
    if (!input || !workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'query and workspace_id are required');
      return;
    }

    const result = await createTemplateRun({
      req,
      input,
      workspaceId,
      template: 'supervisor',
      mode: (req.body?.mode ?? 'auto') as 'auto' | 'hybrid' | 'graph',
    });

    if ('error' in result) {
      const error = result.error!;
      sendApiError(res, error.status, error.code, error.message, error.details);
      return;
    }
    res.json({ runId: result.run.id, run_id: result.run.id, jobId: result.run.jobId ?? null, status: result.run.status });
  });

  app.post('/api/v1/agents/research', authMiddleware, checkWorkspaceCapability('canRunAutomation'), async (req: AuthRequest, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    const input = String(req.body?.query ?? '').trim();
    if (!input || !workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'query and workspace_id are required');
      return;
    }

    const result = await createTemplateRun({
      req,
      input,
      workspaceId,
      template: 'research',
      mode: 'auto',
    });

    if ('error' in result) {
      const error = result.error!;
      sendApiError(res, error.status, error.code, error.message, error.details);
      return;
    }
    res.json({ runId: result.run.id, run_id: result.run.id, jobId: result.run.jobId ?? null, status: result.run.status });
  });

  app.post('/api/v1/agents/summarize', authMiddleware, checkWorkspaceCapability('canRunAutomation'), async (req: AuthRequest, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    const input = String(req.body?.text ?? '').trim();
    if (!input || !workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'text and workspace_id are required');
      return;
    }

    const result = await createTemplateRun({
      req,
      input,
      workspaceId,
      template: 'summarize',
      mode: 'hybrid',
    });

    if ('error' in result) {
      const error = result.error!;
      sendApiError(res, error.status, error.code, error.message, error.details);
      return;
    }
    res.json({ runId: result.run.id, run_id: result.run.id, jobId: result.run.jobId ?? null, status: result.run.status });
  });

  app.post('/api/v1/agents/brainstorm', authMiddleware, checkWorkspaceCapability('canRunAutomation'), async (req: AuthRequest, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    const input = String(req.body?.query ?? '').trim();
    if (!input || !workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'query and workspace_id are required');
      return;
    }

    const result = await createTemplateRun({
      req,
      input,
      workspaceId,
      template: 'brainstorm',
      mode: 'auto',
    });

    if ('error' in result) {
      const error = result.error!;
      sendApiError(res, error.status, error.code, error.message, error.details);
      return;
    }
    res.json({ runId: result.run.id, run_id: result.run.id, jobId: result.run.jobId ?? null, status: result.run.status });
  });

  app.post('/api/v1/agents/outline', authMiddleware, checkWorkspaceCapability('canRunAutomation'), async (req: AuthRequest, res: Response) => {
    const workspaceId = getWorkspaceIdFromRequest(req);
    const input = String(req.body?.query ?? '').trim();
    if (!input || !workspaceId) {
      sendApiError(res, 400, 'BAD_REQUEST', 'query and workspace_id are required');
      return;
    }

    const result = await createTemplateRun({
      req,
      input,
      workspaceId,
      template: 'outline',
      mode: 'hybrid',
    });

    if ('error' in result) {
      const error = result.error!;
      sendApiError(res, error.status, error.code, error.message, error.details);
      return;
    }
    res.json({ runId: result.run.id, run_id: result.run.id, jobId: result.run.jobId ?? null, status: result.run.status });
  });

  app.get('/api/v1/agents/runs/:run_id/tree', authMiddleware, checkWorkspaceCapability('canViewWorkspace'), async (req: AuthRequest, res: Response) => {
    const runId = req.params.run_id;
    const workspaceId = getWorkspaceIdFromRequest(req);
    if (!runId || !workspaceId || !pool) {
      sendApiError(res, 400, 'BAD_REQUEST', 'run_id and workspace_id are required');
      return;
    }

    const run = await getAgentRunById(runId, workspaceId, req.userId!);
    if (!run) {
      sendApiError(res, 404, 'NOT_FOUND', 'Run not found');
      return;
    }

    try {
      const rootResult = await pool.query<{ root_id: string }>(
        `SELECT COALESCE(root_run_id, id) AS root_id
         FROM agent_runs
         WHERE id = $1 AND workspace_id = $2 AND user_id = $3`,
        [runId, workspaceId, req.userId!]
      );
      const rootId = rootResult.rows[0]?.root_id ?? runId;

      const treeResult = await pool.query(
        `WITH RECURSIVE run_tree AS (
           SELECT id, workspace_id, user_id, parent_run_id, root_run_id, depth, type, query, status, token_usage,
                  input_summary, output_summary, error_summary, started_at, finished_at, created_at
           FROM agent_runs
           WHERE id = $1 AND workspace_id = $2 AND user_id = $3
           UNION ALL
           SELECT r.id, r.workspace_id, r.user_id, r.parent_run_id, r.root_run_id, r.depth, r.type, r.query, r.status, r.token_usage,
                  r.input_summary, r.output_summary, r.error_summary, r.started_at, r.finished_at, r.created_at
           FROM agent_runs r
           INNER JOIN run_tree rt ON r.parent_run_id = rt.id
           WHERE r.workspace_id = $2 AND r.user_id = $3
         )
         SELECT * FROM run_tree ORDER BY depth ASC, created_at ASC`,
        [rootId, workspaceId, req.userId!]
      );

      const rows = treeResult.rows.map((row: any) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        userId: row.user_id,
        parentRunId: row.parent_run_id,
        rootRunId: row.root_run_id,
        depth: row.depth,
        type: row.type,
        inputSummary: row.input_summary ?? row.query,
        outputSummary: row.output_summary,
        errorSummary: row.error_summary,
        status: row.status,
        tokenUsage: row.token_usage,
        startedAt: row.started_at?.toISOString?.() ?? row.started_at ?? null,
        finishedAt: row.finished_at?.toISOString?.() ?? row.finished_at ?? null,
        createdAt: row.created_at?.toISOString?.() ?? row.created_at,
      }));

      const nodeMap = new Map<string, any>();
      for (const row of rows) {
        nodeMap.set(row.id, { ...row, children: [] });
      }

      let root: any = null;
      for (const row of rows) {
        const node = nodeMap.get(row.id)!;
        if (row.parentRunId && nodeMap.has(row.parentRunId)) {
          nodeMap.get(row.parentRunId)!.children.push(node);
        } else {
          root = node;
        }
      }

      res.json({ root_run_id: rootId, tree: root ?? { ...run, children: [] } });
    } catch (error) {
      sendApiError(res, 500, 'INVALID_STATE', 'Failed to fetch run tree', error instanceof Error ? error.message : 'Unknown error');
    }
  });
}
