import { GoogleGenerativeAI } from '@google/generative-ai';
import crypto from 'node:crypto';
import { pool } from '../db/client.js';
import { observability } from './observability.js';
import { graphRAGQuery } from './graphrag.js';
import { searchService } from './search.js';
import { getAgentTemplate } from './agent-templates.js';

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'aborted';
export type RunStatus = 'running' | 'done' | 'error' | 'aborted';

export interface AgentStep {
  id: string;
  step_key: string;
  name: string;
  worker: string;
  position: number;
  status: StepStatus;
  input?: any;
  output?: any;
  error?: string;
  token_usage?: number;
  started_at?: string;
  finished_at?: string;
}

export interface AgentRun {
  id: string;
  type: string;
  query: string;
  workspace_id: string;
  user_id: string;
  mode: 'auto' | 'hybrid' | 'graph';
  status: RunStatus;
  result?: any;
  error?: string;
  token_usage?: number;
  /** P2-1: Recursive sub-run linkage */
  parent_run_id?: string | null;
  root_run_id?: string | null;
  depth: number;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  steps: AgentStep[];
}

type AgentEvent =
  | { type: 'meta'; run_id: string; mode: string }
  | { type: 'step'; step: AgentStep }
  | { type: 'token'; token: string }
  | { type: 'run'; run: AgentRun }
  | { type: 'error'; message: string }
  | { type: 'done' };

/** AgentTemplate 定義已移至 agent-templates.ts；此處保留本地別名以相容現有型別標注 */
type AgentTemplate = 'supervisor' | 'research' | 'summarize' | 'brainstorm' | 'outline';

/** P2-1: Maximum recursion depth for sub-pipeline spawning */
const MAX_RECURSION_DEPTH = 2;

const runListeners = new Map<string, Set<(event: AgentEvent) => void>>();

function emitEvent(runId: string, event: AgentEvent): void {
  const listeners = runListeners.get(runId);
  if (!listeners) return;
  for (const cb of listeners) cb(event);
}

export function subscribeToRun(runId: string, cb: (event: AgentEvent) => void): () => void {
  if (!runListeners.has(runId)) runListeners.set(runId, new Set());
  runListeners.get(runId)!.add(cb);
  return () => {
    runListeners.get(runId)?.delete(cb);
  };
}

// Fixed orchestration steps — worker steps are created dynamically after planning
const STEP_TEMPLATES = [
  { step_key: 'planner',  name: '規劃任務', worker: 'planner',  position: 1  },
  { step_key: 'analyst',  name: '分析整合', worker: 'analyst',  position: 30 },
  { step_key: 'writer',   name: '產出結果', worker: 'writer',   position: 40 },
] as const;

function approxTokenUsage(content: unknown): number {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
  return Math.max(1, Math.ceil(text.length / 4));
}

async function getModel() {
  if (!genAI) return null;
  return genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' });
}

async function loadRun(runId: string): Promise<AgentRun | null> {
  const p = pool;
  if (!p) return null;

  const runRes = await p.query('SELECT * FROM agent_runs WHERE id = $1 LIMIT 1', [runId]);
  if ((runRes.rowCount ?? 0) === 0) return null;

  const run = runRes.rows[0];
  const stepsRes = await p.query(
    'SELECT * FROM agent_steps WHERE run_id = $1 ORDER BY position ASC',
    [runId]
  );

  return {
    ...run,
    steps: stepsRes.rows,
  } as AgentRun;
}

async function markRun(
  runId: string,
  status: RunStatus,
  patch?: { result?: any; error?: string; token_usage?: number }
): Promise<AgentRun | null> {
  const p = pool;
  if (!p) return null;

  await p.query(
    `UPDATE agent_runs
     SET status = $2,
         result = COALESCE($3::jsonb, result),
         error = COALESCE($4, error),
         token_usage = COALESCE($5, token_usage),
         finished_at = CASE WHEN $2 = 'running' THEN finished_at ELSE NOW() END,
         updated_at = NOW()
     WHERE id = $1`,
    [runId, status, patch?.result ? JSON.stringify(patch.result) : null, patch?.error ?? null, patch?.token_usage ?? null]
  );

  const run = await loadRun(runId);
  if (run) emitEvent(runId, { type: 'run', run });
  return run;
}

async function updateStep(runId: string, stepKey: string, patch: Partial<AgentStep>): Promise<AgentStep | null> {
  const p = pool;
  if (!p) return null;

  const res = await p.query(
    `UPDATE agent_steps
     SET status = COALESCE($3, status),
         input = COALESCE($4::jsonb, input),
         output = COALESCE($5::jsonb, output),
         error = COALESCE($6, error),
         token_usage = COALESCE($7, token_usage),
         started_at = COALESCE($8::timestamptz, started_at),
         finished_at = COALESCE($9::timestamptz, finished_at),
         updated_at = NOW()
     WHERE run_id = $1 AND step_key = $2
     RETURNING *`,
    [
      runId,
      stepKey,
      patch.status ?? null,
      patch.input ? JSON.stringify(patch.input) : null,
      patch.output ? JSON.stringify(patch.output) : null,
      patch.error ?? null,
      patch.token_usage ?? null,
      patch.started_at ?? null,
      patch.finished_at ?? null,
    ]
  );

  const step = res.rows[0] as AgentStep | undefined;
  if (step) emitEvent(runId, { type: 'step', step });
  return step ?? null;
}

async function runStep<TInput, TOutput>(
  runId: string,
  stepKey: string,
  input: TInput,
  fn: (input: TInput) => Promise<TOutput>
): Promise<TOutput> {
  await updateStep(runId, stepKey, {
    status: 'running',
    input,
    started_at: new Date().toISOString(),
  });

  try {
    const output = await fn(input);
    await updateStep(runId, stepKey, {
      status: 'done',
      output,
      token_usage: approxTokenUsage(output),
      finished_at: new Date().toISOString(),
    });
    return output;
  } catch (error) {
    await updateStep(runId, stepKey, {
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown error',
      finished_at: new Date().toISOString(),
    });
    throw error;
  }
}

/** Fallback 任務清單 — 委派至 agent-templates.ts 中的 Registry */
function fallbackTaskPlan(query: string, template: AgentTemplate): string[] {
  return getAgentTemplate(template).fallbackTasks(query);
}

async function plannerWorker(query: string, template: AgentTemplate): Promise<{ tasks: string[]; intent: string }> {
  const model = await getModel();
  if (!model) {
    return { tasks: fallbackTaskPlan(query, template), intent: query };
  }

  const prompt = getAgentTemplate(template).plannerPrompt(query);

  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(raw);
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks.map((t: any) => String(t)).filter(Boolean).slice(0, 4)
      : [];

    if (tasks.length === 0) {
      return { tasks: fallbackTaskPlan(query, template), intent: query };
    }

    return {
      tasks,
      intent: parsed.intent ? String(parsed.intent) : query,
    };
  } catch {
    return { tasks: fallbackTaskPlan(query, template), intent: query };
  }
}

async function retrieveForTask(task: string, workspaceId: string, mode: 'auto' | 'hybrid' | 'graph') {
  if (mode === 'graph') {
    const graph = await graphRAGQuery(task, workspaceId, 6);
    return {
      mode_used: 'graph' as const,
      routing_reason: 'forced_graph_mode',
      answer: graph.answer,
      sources: graph.sources,
      entities: graph.entities,
      citations: graph.citations,
      hybrid_top_score: 0,
    };
  }

  const hybrid = await searchService.search({
    query: task,
    workspaceId,
    limit: 6,
    offset: 0,
    hybrid: true,
  });

  const topHybridScore = hybrid.results[0]?.score ?? 0;
  if (mode === 'hybrid' || topHybridScore >= 0.45) {
    return {
      mode_used: 'hybrid' as const,
      routing_reason: mode === 'hybrid' ? 'forced_hybrid_mode' : `auto_hybrid_high_score(${topHybridScore.toFixed(2)})`,
      answer: hybrid.results.slice(0, 3).map(r => r.content).join('\n'),
      sources: hybrid.results.map(r => ({
        content: r.content,
        document_id: r.document_id,
        score: r.score,
        type: 'hybrid',
      })),
      entities: [],
      citations: [],
      hybrid_top_score: topHybridScore,
    };
  }

  const graph = await graphRAGQuery(task, workspaceId, 6);
  return {
    mode_used: 'graph' as const,
    routing_reason: `auto_graph_fallback(${topHybridScore.toFixed(2)})`,
    answer: graph.answer,
    sources: graph.sources,
    entities: graph.entities,
    citations: graph.citations,
    hybrid_top_score: topHybridScore,
  };
}

async function analystWorker(retrieved: any, query: string, template: AgentTemplate = 'supervisor'): Promise<{ analysis: string; key_points: string[] }> {
  const model = await getModel();
  const evidenceText = retrieved
    .map((r: any, idx: number) => `#${idx + 1} task=${r.task}\nmode=${r.mode_used}\nanswer=${r.answer}`)
    .join('\n\n');

  if (!model) {
    return {
      analysis: evidenceText.slice(0, 3000),
      key_points: retrieved.slice(0, 3).map((r: any) => `${r.task} -> ${r.mode_used}`),
    };
  }

  const analystHint = getAgentTemplate(template).analystHint
    ?? '請整理各 Worker 的關鍵洞察，並指出結論之間的一致性與矛盾點。';
  const prompt = `你是分析員。${analystHint}\n回傳 JSON：{"analysis":"...","key_points":["..."]}\n\nUser query: ${query}\n\nEvidence:\n${evidenceText}`;
  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(raw);
    return {
      analysis: String(parsed.analysis ?? evidenceText.slice(0, 3000)),
      key_points: Array.isArray(parsed.key_points)
        ? parsed.key_points.map((x: any) => String(x)).slice(0, 8)
        : [],
    };
  } catch {
    return {
      analysis: evidenceText.slice(0, 3000),
      key_points: retrieved.slice(0, 3).map((r: any) => `${r.task} -> ${r.mode_used}`),
    };
  }
}

// Fix 7: 使用真正的 LLM 串流輸出，onToken callback 在生成過程中即時推送 token
async function writerWorker(
  query: string,
  analysis: any,
  template: AgentTemplate,
  onToken?: (token: string) => void
): Promise<{ answer: string; citations: string[] }> {
  const model = await getModel();
  const basePrompt = getAgentTemplate(template).writerInstruction;

  if (!model) {
    const answer = `${basePrompt}\n\n問題：${query}\n\n${analysis.analysis ?? ''}`;
    return { answer, citations: [] };
  }

  const prompt = `${basePrompt}\n\n請用繁體中文回答。\n問題：${query}\n\n分析：${analysis.analysis}`;
  try {
    const stream = await model.generateContentStream(prompt);
    let answer = '';
    for await (const chunk of stream.stream) {
      const text = chunk.text();
      if (text) {
        answer += text;
        onToken?.(text);
      }
    }
    const citations = [...new Set(answer.match(/\[(\d+)\]/g) ?? [])];
    return { answer, citations };
  } catch {
    const answer = `${basePrompt}\n\n問題：${query}\n\n${analysis.analysis ?? ''}`;
    return { answer, citations: [] };
  }
}

async function insertWorkerStep(runId: string, stepKey: string, name: string, position: number, depth = 0): Promise<void> {
  const p = pool;
  if (!p) return;
  await p.query(
    `INSERT INTO agent_steps (run_id, step_key, name, worker, position, status, depth)
     VALUES ($1, $2, $3, 'retriever_worker', $4, 'pending', $5)
     ON CONFLICT (run_id, step_key) DO NOTHING`,
    [runId, stepKey, name, position, depth]
  );
}

/**
 * P2-1: If the task is complex and we're below MAX_RECURSION_DEPTH, spawn a mini
 * sub-pipeline (planner + parallel workers only, no analyst/writer) in a child run.
 * Falls back to plain `retrieveForTask` when at depth limit.
 */
async function retrieveOrSpawn(
  task: string,
  workspaceId: string,
  userId: string,
  mode: 'auto' | 'hybrid' | 'graph',
  template: AgentTemplate,
  parentRunId: string,
  rootRunId: string,
  depth: number
): Promise<ReturnType<typeof retrieveForTask>> {
  // Spawn a sub-pipeline only for complex tasks at depth < MAX_RECURSION_DEPTH
  if (depth < MAX_RECURSION_DEPTH && task.length > 80) {
    const subRunId = crypto.randomUUID();
    try {
      // Create child run (planner + workers only, no analyst/writer)
      await createRunAndSteps({
        runId: subRunId,
        workspace_id: workspaceId,
        user_id: userId,
        query: task,
        mode,
        type: template,
        parentRunId,
        rootRunId,
        depth: depth + 1,
      });

      // Run planner on sub-task
      const planned = await plannerWorker(task, template);
      const subRetrieved = await Promise.allSettled(
        planned.tasks.map((subTask) => retrieveForTask(subTask, workspaceId, mode))
      );
      const results = subRetrieved
        .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
        .map(r => r.value);

      // Merge sub-results: combine answers into a single context blob
      const mergedAnswer = results.map(r => r.answer).filter(Boolean).join('

');
      const mergedSources = results.flatMap(r => r.sources ?? []);

      await pool!.query(
        `UPDATE agent_runs SET status = 'done', result = $2::jsonb, finished_at = NOW() WHERE id = $1`,
        [subRunId, JSON.stringify({ answer: mergedAnswer, sub_tasks: planned.tasks })]
      );

      return {
        mode_used: results[0]?.mode_used ?? 'hybrid',
        routing_reason: `sub_pipeline_depth${depth + 1}`,
        answer: mergedAnswer,
        sources: mergedSources,
        entities: results.flatMap(r => r.entities ?? []),
        citations: results.flatMap(r => r.citations ?? []),
        hybrid_top_score: Math.max(...results.map(r => r.hybrid_top_score ?? 0), 0),
      };
    } catch (err) {
      observability.warn('Sub-pipeline failed, falling back to direct retrieval', { subRunId, task, err });
      // Graceful fallback
      await pool?.query(
        `UPDATE agent_runs SET status = 'error', error = $2, finished_at = NOW() WHERE id = $1`,
        [subRunId, err instanceof Error ? err.message : 'Sub-pipeline error']
      );
    }
  }
  return retrieveForTask(task, workspaceId, mode);
}

async function runSupervisorPipeline(
  runId: string,
  query: string,
  workspaceId: string,
  mode: 'auto' | 'hybrid' | 'graph',
  template: AgentTemplate,
  depth = 0
): Promise<void> {
  emitEvent(runId, { type: 'meta', run_id: runId, mode });

  // Need userId for sub-pipeline spawning — read from DB
  const userId: string = await (async () => {
    const r = await pool?.query('SELECT user_id FROM agent_runs WHERE id = $1 LIMIT 1', [runId]);
    return r?.rows[0]?.user_id ?? '';
  })();
  const rootRunId: string = await (async () => {
    const r = await pool?.query('SELECT COALESCE(root_run_id, id) AS root FROM agent_runs WHERE id = $1 LIMIT 1', [runId]);
    return r?.rows[0]?.root ?? runId;
  })();

  // ── 1. Planner (position 1) ────────────────────────────────
  const planned = await runStep(runId, 'planner', { query, template }, async ({ query: q }) => {
    return plannerWorker(q, template);
  });

  // ── 2. Parallel worker agents (positions 10, 11, 12…) ──────
  // Insert a DB step for each task so the UI can track per-task progress
  await Promise.all(planned.tasks.map((task, i) =>
    insertWorkerStep(runId, `worker_${i + 1}`, `Worker ${i + 1}: ${task.slice(0, 40)}`, 10 + i, depth)
  ));

  // Run all retrieval workers concurrently (may spawn sub-pipelines for complex tasks)
  const workerSettled = await Promise.allSettled(
    planned.tasks.map(async (task, i) => {
      const stepKey = `worker_${i + 1}`;
      await updateStep(runId, stepKey, { status: 'running', input: { task, mode }, started_at: new Date().toISOString() });
      try {
        const result = await retrieveOrSpawn(task, workspaceId, userId, mode, template, runId, rootRunId, depth);
        const workerResult = { task, ...result };
        await updateStep(runId, stepKey, {
          status: 'done',
          output: workerResult,
          token_usage: approxTokenUsage(workerResult),
          finished_at: new Date().toISOString(),
        });
        return workerResult;
      } catch (err) {
        await updateStep(runId, stepKey, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Worker failed',
          finished_at: new Date().toISOString(),
        });
        throw err;
      }
    })
  );

  // Collect successful worker results (partial results still feed the analyst)
  const retrieved = workerSettled
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
    .map(r => r.value);

  const failedWorkers = workerSettled.filter(r => r.status === 'rejected').length;
  if (failedWorkers > 0) {
    observability.warn('Some worker agents failed', { runId, failed: failedWorkers, total: planned.tasks.length });
  }

  // ── 3. Analyst (position 30) ───────────────────────────────
  const analysis = await runStep(runId, 'analyst', { query, retrieved }, async ({ query: q, retrieved: r }) => {
    return analystWorker(r, q, template);
  });

  // ── 4. Writer (position 40) — real LLM streaming ──────────
  const finalResult = await runStep(runId, 'writer', { query, analysis, template }, async ({ query: q, analysis: a }) => {
    return writerWorker(q, a, template, (token) => {
      emitEvent(runId, { type: 'token', token });
    });
  });

  await markRun(runId, 'done', {
    result: {
      answer: finalResult.answer,
      citations: finalResult.citations,
      analysis,
      tasks: planned.tasks,
      retrieved,
    },
    token_usage: approxTokenUsage(finalResult.answer ?? ''),
  });

  emitEvent(runId, { type: 'done' });
}

async function createRunAndSteps(params: {
  runId: string;
  workspace_id: string;
  user_id: string;
  query: string;
  mode: 'auto' | 'hybrid' | 'graph';
  type: string;
  parentRunId?: string;
  rootRunId?: string;
  depth?: number;
}) {
  const p = pool;
  if (!p) throw new Error('Database not available');

  const depth = params.depth ?? 0;
  const rootRunId = params.rootRunId ?? (params.parentRunId ? null : params.runId);

  await p.query(
    `INSERT INTO agent_runs (id, workspace_id, user_id, type, query, mode, status, parent_run_id, root_run_id, depth)
     VALUES ($1, $2, $3, $4, $5, $6, 'running', $7, $8, $9)`,
    [params.runId, params.workspace_id, params.user_id, params.type, params.query, params.mode,
     params.parentRunId ?? null, rootRunId, depth]
  );

  for (const step of STEP_TEMPLATES) {
    await p.query(
      `INSERT INTO agent_steps (run_id, step_key, name, worker, position, status, depth)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
      [params.runId, step.step_key, step.name, step.worker, step.position, depth]
    );
  }
}

export async function startSupervisorRun(params: {
  runId: string;
  workspace_id: string;
  user_id: string;
  query: string;
  mode?: 'auto' | 'hybrid' | 'graph';
  template?: AgentTemplate;
  parentRunId?: string;
  rootRunId?: string;
  depth?: number;
}): Promise<void> {
  const mode = params.mode ?? 'auto';
  const template = params.template ?? 'supervisor';
  const depth = params.depth ?? 0;

  await createRunAndSteps({
    runId: params.runId,
    workspace_id: params.workspace_id,
    user_id: params.user_id,
    query: params.query,
    mode,
    type: template,
    parentRunId: params.parentRunId,
    rootRunId: params.rootRunId,
    depth,
  });

  runSupervisorPipeline(params.runId, params.query, params.workspace_id, mode, template, depth)    .catch(async (error) => {
      observability.error('Supervisor pipeline failed', { error, runId: params.runId });
      await markRun(params.runId, 'error', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      emitEvent(params.runId, {
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      emitEvent(params.runId, { type: 'done' });
    });
}

export async function getRunById(runId: string): Promise<AgentRun | null> {
  return loadRun(runId);
}

export async function recoverRunningRunsOnBoot(): Promise<number> {
  const p = pool;
  if (!p) return 0;

  const runningRuns = await p.query(
    `SELECT id FROM agent_runs WHERE status = 'running'`
  );

  if ((runningRuns.rowCount ?? 0) === 0) return 0;

  const runIds = runningRuns.rows.map((r: any) => r.id);
  await p.query(
    `UPDATE agent_runs
     SET status = 'aborted', error = 'Run aborted due to server restart', finished_at = NOW(), updated_at = NOW()
     WHERE id = ANY($1::uuid[])`,
    [runIds]
  );

  await p.query(
    `UPDATE agent_steps
     SET status = 'aborted', error = 'Step aborted due to server restart', finished_at = NOW(), updated_at = NOW()
     WHERE run_id = ANY($1::uuid[]) AND status = 'running'`,
    [runIds]
  );

  return runIds.length;
}

