import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from '../db/client.js';
import { observability } from './observability.js';
import { graphRAGQuery } from './graphrag.js';
import { searchService } from './search.js';
import {
  AGENT_RETRIEVAL_STRATEGY,
  type AgentMode,
  type AgentTemplate,
  decideRetrievalMode,
  getTemplateConfig,
  renderFallbackTasks,
} from './agentConfig.js';

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

export type StepStatus = 'pending' | 'running' | 'done' | 'error' | 'aborted';
export type RunStatus = 'running' | 'done' | 'error' | 'aborted';

export interface AgentStep {
  id: string;
  run_id: string;
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
  mode: AgentMode;
  status: RunStatus;
  result?: any;
  error?: string;
  token_usage?: number;
  created_at: string;
  started_at?: string;
  finished_at?: string;
  steps: AgentStep[];
}

export interface AgentStepArtifact {
  id: string;
  run_id: string;
  step_id: string;
  step_key: string;
  artifact_type: 'status' | 'input' | 'output' | 'error';
  payload: any;
  created_at: string;
}

type AgentEvent =
  | { type: 'meta'; run_id: string; mode: string }
  | { type: 'step'; step: AgentStep }
  | { type: 'token'; token: string }
  | { type: 'run'; run: AgentRun }
  | { type: 'error'; message: string }
  | { type: 'done' };

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

// Fixed orchestration steps ??worker steps are created dynamically after planning
const STEP_TEMPLATES = [
  { step_key: 'planner',  name: '閬?隞餃?', worker: 'planner',  position: 1  },
  { step_key: 'analyst',  name: '???游?', worker: 'analyst',  position: 30 },
  { step_key: 'writer',   name: '?Ｗ蝯?', worker: 'writer',   position: 40 },
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

async function persistStepArtifacts(step: AgentStep, patch: Partial<AgentStep>): Promise<void> {
  const p = pool;
  if (!p) return;

  const artifacts: Array<{ artifact_type: 'status' | 'input' | 'output' | 'error'; payload: any }> = [];

  if (patch.status !== undefined) {
    artifacts.push({
      artifact_type: 'status',
      payload: {
        status: step.status,
        started_at: step.started_at ?? null,
        finished_at: step.finished_at ?? null,
        token_usage: step.token_usage ?? 0,
      },
    });
  }

  if (patch.input !== undefined) {
    artifacts.push({ artifact_type: 'input', payload: patch.input });
  }

  if (patch.output !== undefined) {
    artifacts.push({ artifact_type: 'output', payload: patch.output });
  }

  if (patch.error !== undefined && patch.error !== null) {
    artifacts.push({
      artifact_type: 'error',
      payload: { message: patch.error },
    });
  }

  if (artifacts.length === 0) return;

  try {
    for (const artifact of artifacts) {
      await p.query(
        `INSERT INTO agent_step_artifacts (run_id, step_id, step_key, artifact_type, payload)
         VALUES ($1, $2, $3, $4, $5::jsonb)`,
        [
          step.run_id,
          step.id,
          step.step_key,
          artifact.artifact_type,
          JSON.stringify(artifact.payload ?? {}),
        ]
      );
    }
  } catch (error) {
    observability.warn('Failed to persist step artifacts', {
      runId: step.run_id,
      stepKey: step.step_key,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
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
  if (step) {
    await persistStepArtifacts(step, patch);
    emitEvent(runId, { type: 'step', step });
  }
  return step ?? null;
}

export async function getRunArtifacts(
  runId: string,
  options?: { limit?: number; offset?: number }
): Promise<{ timeline: AgentStepArtifact[]; by_step: Record<string, AgentStepArtifact[]> }> {
  const p = pool;
  if (!p) return { timeline: [], by_step: {} };

  const limit = Math.max(1, Math.min(500, options?.limit ?? 200));
  const offset = Math.max(0, options?.offset ?? 0);
  const res = await p.query(
    `SELECT id::text, run_id::text, step_id::text, step_key, artifact_type, payload, created_at
     FROM agent_step_artifacts
     WHERE run_id = $1
     ORDER BY created_at ASC, id ASC
     LIMIT $2 OFFSET $3`,
    [runId, limit, offset]
  );

  const timeline = res.rows as AgentStepArtifact[];
  const byStep: Record<string, AgentStepArtifact[]> = {};
  for (const artifact of timeline) {
    const key = artifact.step_key;
    if (!byStep[key]) byStep[key] = [];
    byStep[key].push(artifact);
  }

  return {
    timeline,
    by_step: byStep,
  };
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

function fallbackTaskPlan(query: string, template: AgentTemplate): string[] {
  return renderFallbackTasks(template, query);
}

async function plannerWorker(query: string, template: AgentTemplate): Promise<{ tasks: string[]; intent: string }> {
  const model = await getModel();
  if (!model) {
    return { tasks: fallbackTaskPlan(query, template), intent: query };
  }

  const templateConfig = getTemplateConfig(template);
  const prompt = `You are a planning agent. Return 2-4 concise retrieval tasks in strict JSON format:
{"intent":"...","tasks":["...", "..."]}

Planner hint: ${templateConfig.plannerHint}
Template: ${template}
User query: ${query}`;

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

async function retrieveForTask(task: string, workspaceId: string, mode: AgentMode) {
  if (mode === 'graph') {
    const graph = await graphRAGQuery(task, workspaceId, AGENT_RETRIEVAL_STRATEGY.graphTopK);
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
    limit: AGENT_RETRIEVAL_STRATEGY.hybridTopK,
    offset: 0,
    hybrid: true,
  });

  const topHybridScore = hybrid.results[0]?.score ?? 0;
  const decision = decideRetrievalMode(mode, topHybridScore, AGENT_RETRIEVAL_STRATEGY);

  if (decision.modeUsed === 'hybrid') {
    return {
      mode_used: 'hybrid' as const,
      routing_reason: decision.routingReason,
      answer: hybrid.results.slice(0, AGENT_RETRIEVAL_STRATEGY.answerSourceLimit).map(r => r.content).join('\n'),
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

  const graph = await graphRAGQuery(task, workspaceId, AGENT_RETRIEVAL_STRATEGY.graphTopK);
  return {
    mode_used: 'graph' as const,
    routing_reason: decision.routingReason,
    answer: graph.answer,
    sources: graph.sources,
    entities: graph.entities,
    citations: graph.citations,
    hybrid_top_score: topHybridScore,
  };
}

async function analystWorker(retrieved: any, query: string): Promise<{ analysis: string; key_points: string[] }> {
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

  const prompt = `雿???～?炎蝝Ｙ?????菜?撖?? JSON嚗"analysis":"...","key_points":["..."]}\n\nUser query: ${query}\n\nEvidence:\n${evidenceText}`;
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

// Fix 7: 雿輻?迤??LLM 銝脫?頛詨嚗nToken callback ?函???蝔葉?單??券?token
async function writerWorker(
  query: string,
  analysis: any,
  template: AgentTemplate,
  onToken?: (token: string) => void
): Promise<{ answer: string; citations: string[] }> {
  const model = await getModel();
  const basePrompt = getTemplateConfig(template).writerPrompt;

  if (!model) {
    const answer = `${basePrompt}\n\nQuery: ${query}\n\n${analysis.analysis ?? ''}`;
    return { answer, citations: [] };
  }

  const prompt = `${basePrompt}\n\nQuery: ${query}\n\nAnalysis:\n${analysis.analysis ?? ''}`;
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
    const answer = `${basePrompt}\n\nQuery: ${query}\n\n${analysis.analysis ?? ''}`;
    return { answer, citations: [] };
  }
}

async function insertWorkerStep(runId: string, stepKey: string, name: string, position: number): Promise<void> {
  const p = pool;
  if (!p) return;
  await p.query(
    `INSERT INTO agent_steps (run_id, step_key, name, worker, position, status)
     VALUES ($1, $2, $3, 'retriever_worker', $4, 'pending')
     ON CONFLICT (run_id, step_key) DO NOTHING`,
    [runId, stepKey, name, position]
  );
}

async function runSupervisorPipeline(
  runId: string,
  query: string,
  workspaceId: string,
  mode: AgentMode,
  template: AgentTemplate
): Promise<void> {
  emitEvent(runId, { type: 'meta', run_id: runId, mode });

  // ?? 1. Planner (position 1) ????????????????????????????????
  const planned = await runStep(runId, 'planner', { query, template }, async ({ query: q }) => {
    return plannerWorker(q, template);
  });

  // ?? 2. Parallel worker agents (positions 10, 11, 12?? ??????
  // Insert a DB step for each task so the UI can track per-task progress
  await Promise.all(planned.tasks.map((task, i) =>
    insertWorkerStep(runId, `worker_${i + 1}`, `Worker ${i + 1}: ${task.slice(0, 40)}`, 10 + i)
  ));

  // Run all retrieval workers concurrently
  const workerSettled = await Promise.allSettled(
    planned.tasks.map(async (task, i) => {
      const stepKey = `worker_${i + 1}`;
      await updateStep(runId, stepKey, { status: 'running', input: { task, mode }, started_at: new Date().toISOString() });
      try {
        const result = await retrieveForTask(task, workspaceId, mode);
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

  // ?? 3. Analyst (position 30) ???????????????????????????????
  const analysis = await runStep(runId, 'analyst', { query, retrieved }, async ({ query: q, retrieved: r }) => {
    return analystWorker(r, q);
  });

  // ?? 4. Writer (position 40) ??real LLM streaming ??????????
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
  mode: AgentMode;
  type: string;
}) {
  const p = pool;
  if (!p) throw new Error('Database not available');

  await p.query(
    `INSERT INTO agent_runs (id, workspace_id, user_id, type, query, mode, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'running')`,
    [params.runId, params.workspace_id, params.user_id, params.type, params.query, params.mode]
  );

  for (const step of STEP_TEMPLATES) {
    await p.query(
      `INSERT INTO agent_steps (run_id, step_key, name, worker, position, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')`,
      [params.runId, step.step_key, step.name, step.worker, step.position]
    );
  }
}

export async function startSupervisorRun(params: {
  runId: string;
  workspace_id: string;
  user_id: string;
  query: string;
  mode?: AgentMode;
  template?: AgentTemplate;
}): Promise<void> {
  const mode = params.mode ?? 'auto';
  const template = params.template ?? 'supervisor';

  await createRunAndSteps({
    runId: params.runId,
    workspace_id: params.workspace_id,
    user_id: params.user_id,
    query: params.query,
    mode,
    type: template,
  });

  runSupervisorPipeline(params.runId, params.query, params.workspace_id, mode, template)
    .catch(async (error) => {
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




