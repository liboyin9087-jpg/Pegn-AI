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
export type RunStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface AgentStep {
  id: string;
  stepKey: string;
  name: string;
  worker: string;
  position: number;
  status: StepStatus;
  input?: unknown;
  output?: unknown;
  error?: string | null;
  tokenUsage?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface AgentRun {
  id: string;
  workspaceId: string;
  userId: string;
  type: string;
  mode: 'auto' | 'hybrid' | 'graph';
  status: RunStatus;
  inputSummary: string;
  outputSummary?: string | null;
  errorSummary?: string | null;
  result?: Record<string, unknown> | null;
  createdAt: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  parentRunId?: string | null;
  rootRunId?: string | null;
  depth: number;
  tokenUsage?: number | null;
  steps: AgentStep[];
}

type AgentEvent =
  | { type: 'meta'; run_id: string; mode: string; template: string }
  | { type: 'step'; step: AgentStep }
  | { type: 'token'; token: string }
  | { type: 'run'; run: AgentRun }
  | { type: 'error'; message: string }
  | { type: 'done' };

type AgentTemplate = 'supervisor' | 'research' | 'summarize' | 'brainstorm' | 'outline';

interface AgentRunRow {
  id: string;
  workspace_id: string;
  user_id: string;
  type: string;
  query: string;
  mode: 'auto' | 'hybrid' | 'graph';
  status: string;
  input_summary: string | null;
  output_summary: string | null;
  error_summary: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  token_usage: number | null;
  parent_run_id: string | null;
  root_run_id: string | null;
  depth: number;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
}

interface AgentStepRow {
  id: string;
  step_key: string;
  name: string;
  worker: string;
  position: number;
  status: StepStatus;
  input: unknown;
  output: unknown;
  error: string | null;
  token_usage: number | null;
  started_at: Date | null;
  finished_at: Date | null;
}

interface CreateAgentRunParams {
  runId?: string;
  workspaceId: string;
  userId: string;
  input: string;
  mode?: 'auto' | 'hybrid' | 'graph';
  template?: AgentTemplate;
  parentRunId?: string | null;
  rootRunId?: string | null;
  depth?: number;
}

interface DispatchAgentRunParams {
  runId: string;
  workspaceId: string;
  userId: string;
  input: string;
  mode?: 'auto' | 'hybrid' | 'graph';
  template?: AgentTemplate;
  parentRunId?: string | null;
  rootRunId?: string | null;
  depth?: number;
}

const MAX_RECURSION_DEPTH = 2;
const SUMMARY_LIMIT = 500;
const STEP_TEMPLATES = [
  { stepKey: 'planner', name: 'Planner', worker: 'planner', position: 1 },
  { stepKey: 'analyst', name: 'Analyst', worker: 'analyst', position: 30 },
  { stepKey: 'writer', name: 'Writer', worker: 'writer', position: 40 },
] as const;

const runListeners = new Map<string, Set<(event: AgentEvent) => void>>();

function emitEvent(runId: string, event: AgentEvent): void {
  const listeners = runListeners.get(runId);
  if (!listeners) return;
  for (const listener of listeners) listener(event);
}

export function subscribeToRun(runId: string, cb: (event: AgentEvent) => void): () => void {
  if (!runListeners.has(runId)) runListeners.set(runId, new Set());
  runListeners.get(runId)!.add(cb);
  return () => {
    runListeners.get(runId)?.delete(cb);
  };
}

function normalizeRunStatus(status: string): RunStatus {
  if (status === 'queued' || status === 'running' || status === 'completed' || status === 'failed') {
    return status;
  }
  if (status === 'done') return 'completed';
  return status === 'running' ? 'running' : 'failed';
}

function truncateSummary(value: string, limit = SUMMARY_LIMIT): string {
  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (trimmed.length <= limit) return trimmed;
  return `${trimmed.slice(0, Math.max(0, limit - 1))}…`;
}

function summarizeInput(input: string): string {
  return truncateSummary(input);
}

function summarizeOutput(result: unknown): string {
  if (typeof result === 'string') return truncateSummary(result);
  if (result && typeof result === 'object' && 'answer' in result && typeof result.answer === 'string') {
    return truncateSummary(result.answer);
  }
  return truncateSummary(JSON.stringify(result ?? ''));
}

function summarizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error ?? 'Agent run failed');
  const normalized = raw.toLowerCase();
  if (normalized.includes('timeout')) return 'Provider timeout';
  if (normalized.includes('unavailable') || normalized.includes('overloaded') || normalized.includes('503')) {
    return 'Model unavailable';
  }
  if (normalized.includes('malformed') || normalized.includes('invalid json') || normalized.includes('parse')) {
    return 'Malformed model response';
  }
  if (normalized.includes('restart')) return 'Run interrupted by server restart';
  return truncateSummary(raw, 240);
}

function approxTokenUsage(content: unknown): number {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
  return Math.max(1, Math.ceil(text.length / 4));
}

function normalizeStep(row: AgentStepRow): AgentStep {
  return {
    id: row.id,
    stepKey: row.step_key,
    name: row.name,
    worker: row.worker,
    position: row.position,
    status: row.status,
    input: row.input,
    output: row.output,
    error: row.error,
    tokenUsage: row.token_usage,
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
  };
}

function normalizeRun(row: AgentRunRow, steps: AgentStep[] = []): AgentRun {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    userId: row.user_id,
    type: row.type,
    mode: row.mode,
    status: normalizeRunStatus(row.status),
    inputSummary: row.input_summary ?? summarizeInput(row.query),
    outputSummary: row.output_summary,
    errorSummary: row.error_summary ?? row.error,
    result: row.result,
    createdAt: row.created_at.toISOString(),
    startedAt: row.started_at ? row.started_at.toISOString() : null,
    finishedAt: row.finished_at ? row.finished_at.toISOString() : null,
    parentRunId: row.parent_run_id,
    rootRunId: row.root_run_id,
    depth: row.depth,
    tokenUsage: row.token_usage,
    steps,
  };
}

async function getModel() {
  if (!genAI) return null;
  return genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' });
}

async function loadRunRow(
  runId: string,
  scope?: { workspaceId?: string; userId?: string }
): Promise<AgentRunRow | null> {
  const p = pool;
  if (!p) return null;

  const conditions = ['id = $1'];
  const params: unknown[] = [runId];
  let index = 2;

  if (scope?.workspaceId) {
    conditions.push(`workspace_id = $${index++}`);
    params.push(scope.workspaceId);
  }
  if (scope?.userId) {
    conditions.push(`user_id = $${index++}`);
    params.push(scope.userId);
  }

  const result = await p.query<AgentRunRow>(
    `SELECT * FROM agent_runs WHERE ${conditions.join(' AND ')} LIMIT 1`,
    params
  );
  return result.rows[0] ?? null;
}

async function loadRunSteps(runId: string): Promise<AgentStep[]> {
  const p = pool;
  if (!p) return [];
  const stepsResult = await p.query<AgentStepRow>(
    'SELECT * FROM agent_steps WHERE run_id = $1 ORDER BY position ASC',
    [runId]
  );
  return stepsResult.rows.map(normalizeStep);
}

async function loadRun(runId: string, scope?: { workspaceId?: string; userId?: string }): Promise<AgentRun | null> {
  const row = await loadRunRow(runId, scope);
  if (!row) return null;
  const steps = await loadRunSteps(runId);
  return normalizeRun(row, steps);
}

async function emitRunSnapshot(runId: string): Promise<AgentRun | null> {
  const run = await loadRun(runId);
  if (run) emitEvent(runId, { type: 'run', run });
  return run;
}

async function insertSteps(runId: string, depth: number, steps: Array<{ stepKey: string; name: string; worker: string; position: number }>): Promise<void> {
  const p = pool;
  if (!p) return;
  for (const step of steps) {
    await p.query(
      `INSERT INTO agent_steps (run_id, step_key, name, worker, position, status, depth)
       VALUES ($1, $2, $3, $4, $5, 'pending', $6)
       ON CONFLICT (run_id, step_key) DO NOTHING`,
      [runId, step.stepKey, step.name, step.worker, step.position, depth]
    );
  }
}

async function updateStep(runId: string, stepKey: string, patch: Partial<AgentStep>): Promise<AgentStep | null> {
  const p = pool;
  if (!p) return null;

  const result = await p.query<AgentStepRow>(
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
      patch.input !== undefined ? JSON.stringify(patch.input) : null,
      patch.output !== undefined ? JSON.stringify(patch.output) : null,
      patch.error ?? null,
      patch.tokenUsage ?? null,
      patch.startedAt ?? null,
      patch.finishedAt ?? null,
    ]
  );

  const stepRow = result.rows[0];
  if (!stepRow) return null;
  const step = normalizeStep(stepRow);
  emitEvent(runId, { type: 'step', step });
  return step;
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
    startedAt: new Date().toISOString(),
  });

  try {
    const output = await fn(input);
    await updateStep(runId, stepKey, {
      status: 'done',
      output,
      tokenUsage: approxTokenUsage(output),
      finishedAt: new Date().toISOString(),
    });
    return output;
  } catch (error) {
    await updateStep(runId, stepKey, {
      status: 'error',
      error: summarizeError(error),
      finishedAt: new Date().toISOString(),
    });
    throw error;
  }
}

function fallbackTaskPlan(input: string, template: AgentTemplate): string[] {
  return getAgentTemplate(template).fallbackTasks(input);
}

async function plannerWorker(input: string, template: AgentTemplate): Promise<{ tasks: string[]; intent: string }> {
  const model = await getModel();
  if (!model) {
    return { tasks: fallbackTaskPlan(input, template), intent: input };
  }

  const prompt = getAgentTemplate(template).plannerPrompt(input);
  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(raw);
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks.map((task: unknown) => String(task)).filter(Boolean).slice(0, 4)
      : [];
    if (tasks.length === 0) {
      return { tasks: fallbackTaskPlan(input, template), intent: input };
    }
    return {
      tasks,
      intent: parsed.intent ? String(parsed.intent) : input,
    };
  } catch {
    return { tasks: fallbackTaskPlan(input, template), intent: input };
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
      answer: hybrid.results.slice(0, 3).map((result) => result.content).join('\n'),
      sources: hybrid.results.map((result) => ({
        content: result.content,
        document_id: result.document_id,
        score: result.score,
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

async function analystWorker(retrieved: any[], input: string, template: AgentTemplate = 'supervisor'): Promise<{ analysis: string; key_points: string[] }> {
  const model = await getModel();
  const evidenceText = retrieved
    .map((item: any, index: number) => `#${index + 1} task=${item.task}\nmode=${item.mode_used}\nanswer=${item.answer}`)
    .join('\n\n');

  if (!model) {
    return {
      analysis: evidenceText.slice(0, 3000),
      key_points: retrieved.slice(0, 3).map((item: any) => `${item.task} -> ${item.mode_used}`),
    };
  }

  const analystHint = getAgentTemplate(template).analystHint
    ?? 'Synthesize the worker evidence into a concise, grounded analysis.';
  const prompt = `You are the analyst.\n${analystHint}\nReturn JSON {"analysis":"...","key_points":["..."]}\n\nUser query: ${input}\n\nEvidence:\n${evidenceText}`;
  try {
    const result = await model.generateContent(prompt);
    const raw = result.response.text().trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(raw);
    return {
      analysis: String(parsed.analysis ?? evidenceText.slice(0, 3000)),
      key_points: Array.isArray(parsed.key_points)
        ? parsed.key_points.map((item: unknown) => String(item)).slice(0, 8)
        : [],
    };
  } catch {
    return {
      analysis: evidenceText.slice(0, 3000),
      key_points: retrieved.slice(0, 3).map((item: any) => `${item.task} -> ${item.mode_used}`),
    };
  }
}

async function writerWorker(
  input: string,
  analysis: { analysis?: string },
  template: AgentTemplate,
  onToken?: (token: string) => void
): Promise<{ answer: string; citations: string[] }> {
  const model = await getModel();
  const basePrompt = getAgentTemplate(template).writerInstruction;

  if (!model) {
    const answer = `${basePrompt}\n\nInput: ${input}\n\n${analysis.analysis ?? ''}`;
    return { answer, citations: [] };
  }

  const prompt = `${basePrompt}\n\nInput: ${input}\n\nAnalysis:\n${analysis.analysis ?? ''}`;
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
    const answer = `${basePrompt}\n\nInput: ${input}\n\n${analysis.analysis ?? ''}`;
    return { answer, citations: [] };
  }
}

export async function createAgentRun(params: CreateAgentRunParams): Promise<AgentRun> {
  const p = pool;
  if (!p) throw new Error('Database not available');

  const runId = params.runId ?? crypto.randomUUID();
  const template = params.template ?? 'supervisor';
  const mode = params.mode ?? 'auto';
  const depth = params.depth ?? 0;
  const rootRunId = params.rootRunId ?? (params.parentRunId ? null : runId);

  await p.query(
    `INSERT INTO agent_runs
       (id, workspace_id, user_id, type, query, mode, status, input_summary, parent_run_id, root_run_id, depth, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9, $10, NOW())`,
    [
      runId,
      params.workspaceId,
      params.userId,
      template,
      params.input,
      mode,
      summarizeInput(params.input),
      params.parentRunId ?? null,
      rootRunId,
      depth,
    ]
  );

  const run = await getAgentRunById(runId, params.workspaceId, params.userId);
  if (!run) throw new Error('Failed to load created run');
  emitEvent(runId, { type: 'run', run });
  return run;
}

export async function startAgentRun(runId: string, workspaceId: string, userId: string): Promise<AgentRun> {
  const p = pool;
  if (!p) throw new Error('Database not available');

  const existing = await loadRunRow(runId, { workspaceId, userId });
  if (!existing) throw new Error('Run not found');
  if (normalizeRunStatus(existing.status) !== 'queued') {
    throw new Error(`Invalid run transition from ${existing.status} to running`);
  }

  await p.query(
    `UPDATE agent_runs
     SET status = 'running', started_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2 AND user_id = $3`,
    [runId, workspaceId, userId]
  );

  const run = await getAgentRunById(runId, workspaceId, userId);
  if (!run) throw new Error('Run disappeared after start');
  emitEvent(runId, { type: 'run', run });
  return run;
}

export async function completeAgentRun(
  runId: string,
  workspaceId: string,
  userId: string,
  patch: { result?: Record<string, unknown>; outputSummary?: string; tokenUsage?: number | null }
): Promise<AgentRun> {
  const p = pool;
  if (!p) throw new Error('Database not available');

  const existing = await loadRunRow(runId, { workspaceId, userId });
  if (!existing) throw new Error('Run not found');
  if (normalizeRunStatus(existing.status) !== 'running') {
    throw new Error(`Invalid run transition from ${existing.status} to completed`);
  }

  const outputSummary = patch.outputSummary ?? summarizeOutput(patch.result ?? existing.result ?? '');
  await p.query(
    `UPDATE agent_runs
     SET status = 'completed',
         result = COALESCE($4::jsonb, result),
         output_summary = $5,
         error_summary = NULL,
         error = NULL,
         token_usage = COALESCE($6, token_usage),
         finished_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2 AND user_id = $3`,
    [
      runId,
      workspaceId,
      userId,
      patch.result ? JSON.stringify(patch.result) : null,
      outputSummary,
      patch.tokenUsage ?? null,
    ]
  );

  const run = await getAgentRunById(runId, workspaceId, userId);
  if (!run) throw new Error('Run disappeared after completion');
  emitEvent(runId, { type: 'run', run });
  return run;
}

export async function failAgentRun(runId: string, workspaceId: string, userId: string, errorSummary: string): Promise<AgentRun> {
  const p = pool;
  if (!p) throw new Error('Database not available');

  const existing = await loadRunRow(runId, { workspaceId, userId });
  if (!existing) throw new Error('Run not found');
  const currentStatus = normalizeRunStatus(existing.status);
  if (currentStatus === 'completed' || currentStatus === 'failed') {
    throw new Error(`Invalid run transition from ${existing.status} to failed`);
  }

  const safeError = summarizeError(errorSummary);
  await p.query(
    `UPDATE agent_runs
     SET status = 'failed',
         error_summary = $4,
         error = $4,
         finished_at = NOW(),
         updated_at = NOW()
     WHERE id = $1 AND workspace_id = $2 AND user_id = $3`,
    [runId, workspaceId, userId, safeError]
  );

  const run = await getAgentRunById(runId, workspaceId, userId);
  if (!run) throw new Error('Run disappeared after failure');
  emitEvent(runId, { type: 'run', run });
  return run;
}

export async function getAgentRunById(runId: string, workspaceId: string, userId: string): Promise<AgentRun | null> {
  return loadRun(runId, { workspaceId, userId });
}

export async function getRunById(runId: string): Promise<AgentRun | null> {
  return loadRun(runId);
}

export async function listAgentRuns(workspaceId: string, userId: string, limit = 10): Promise<AgentRun[]> {
  const p = pool;
  if (!p) return [];

  const result = await p.query<AgentRunRow>(
    `SELECT * FROM agent_runs
     WHERE workspace_id = $1 AND user_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [workspaceId, userId, limit]
  );

  return result.rows.map((row) => normalizeRun(row, []));
}

async function dispatchAgentRunExecution(params: DispatchAgentRunParams): Promise<void> {
  const mode = params.mode ?? 'auto';
  const template = params.template ?? 'supervisor';
  const depth = params.depth ?? 0;

  try {
    await startAgentRun(params.runId, params.workspaceId, params.userId);
    await insertSteps(params.runId, depth, STEP_TEMPLATES.map((step) => ({
      stepKey: step.stepKey,
      name: step.name,
      worker: step.worker,
      position: step.position,
    })));

    const finalResult = await runSupervisorPipeline({
      runId: params.runId,
      input: params.input,
      workspaceId: params.workspaceId,
      userId: params.userId,
      mode,
      template,
      depth,
      rootRunId: params.rootRunId ?? params.runId,
    });

    await completeAgentRun(params.runId, params.workspaceId, params.userId, {
      result: finalResult,
      tokenUsage: approxTokenUsage(finalResult.answer ?? ''),
    });
  } catch (error) {
    const safeError = summarizeError(error);
    observability.error('Agent runtime failed', { runId: params.runId, error: safeError });

    try {
      await failAgentRun(params.runId, params.workspaceId, params.userId, safeError);
    } catch (transitionError) {
      observability.warn('Failed to move agent run into failed state', {
        runId: params.runId,
        error: String(transitionError),
      });
    }

    emitEvent(params.runId, { type: 'error', message: safeError });
  } finally {
    emitEvent(params.runId, { type: 'done' });
  }
}

export async function createAndStartAgentRun(params: CreateAgentRunParams): Promise<AgentRun> {
  const run = await createAgentRun(params);
  void dispatchAgentRunExecution({
    runId: run.id,
    workspaceId: params.workspaceId,
    userId: params.userId,
    input: params.input,
    mode: params.mode,
    template: params.template,
    parentRunId: params.parentRunId,
    rootRunId: params.rootRunId ?? run.rootRunId ?? run.id,
    depth: params.depth,
  });
  return run;
}

async function insertWorkerStep(runId: string, stepKey: string, name: string, position: number, depth = 0): Promise<void> {
  await insertSteps(runId, depth, [{ stepKey, name, worker: 'retriever_worker', position }]);
}

async function retrieveOrSpawn(
  task: string,
  workspaceId: string,
  userId: string,
  mode: 'auto' | 'hybrid' | 'graph',
  template: AgentTemplate,
  parentRunId: string,
  rootRunId: string,
  depth: number
): Promise<Awaited<ReturnType<typeof retrieveForTask>>> {
  if (depth < MAX_RECURSION_DEPTH && task.length > 80) {
    const subRun = await createAgentRun({
      runId: crypto.randomUUID(),
      workspaceId,
      userId,
      input: task,
      mode,
      template,
      parentRunId,
      rootRunId,
      depth: depth + 1,
    });

    try {
      await startAgentRun(subRun.id, workspaceId, userId);
      await insertSteps(subRun.id, depth + 1, [STEP_TEMPLATES[0]]);

      const planned = await runStep(subRun.id, 'planner', { input: task, template }, async ({ input: nextInput }) => {
        return plannerWorker(nextInput, template);
      });

      await Promise.all(planned.tasks.map((subTask, index) =>
        insertWorkerStep(subRun.id, `worker_${index + 1}`, `Worker ${index + 1}: ${subTask.slice(0, 40)}`, 10 + index, depth + 1)
      ));

      const subRetrieved = await Promise.allSettled(
        planned.tasks.map(async (subTask, index) => {
          const stepKey = `worker_${index + 1}`;
          await updateStep(subRun.id, stepKey, {
            status: 'running',
            input: { task: subTask, mode },
            startedAt: new Date().toISOString(),
          });
          try {
            const result = await retrieveForTask(subTask, workspaceId, mode);
            const workerResult = { task: subTask, ...result };
            await updateStep(subRun.id, stepKey, {
              status: 'done',
              output: workerResult,
              tokenUsage: approxTokenUsage(workerResult),
              finishedAt: new Date().toISOString(),
            });
            return workerResult;
          } catch (error) {
            await updateStep(subRun.id, stepKey, {
              status: 'error',
              error: summarizeError(error),
              finishedAt: new Date().toISOString(),
            });
            throw error;
          }
        })
      );

      const results = subRetrieved
        .filter((item): item is PromiseFulfilledResult<any> => item.status === 'fulfilled')
        .map((item) => item.value);

      const mergedAnswer = results
        .map((item) => item.answer)
        .filter(Boolean)
        .join('\n\n');

      const mergedResult = {
        answer: mergedAnswer,
        subTasks: planned.tasks,
      };

      await completeAgentRun(subRun.id, workspaceId, userId, {
        result: mergedResult,
        tokenUsage: approxTokenUsage(mergedAnswer),
      });
      emitEvent(subRun.id, { type: 'done' });

      return {
        mode_used: results[0]?.mode_used ?? 'hybrid',
        routing_reason: `sub_pipeline_depth${depth + 1}`,
        answer: mergedAnswer,
        sources: results.flatMap((item) => item.sources ?? []),
        entities: results.flatMap((item) => item.entities ?? []),
        citations: results.flatMap((item) => item.citations ?? []),
        hybrid_top_score: Math.max(...results.map((item) => item.hybrid_top_score ?? 0), 0),
      };
    } catch (error) {
      const safeError = summarizeError(error);
      await failAgentRun(subRun.id, workspaceId, userId, safeError).catch(() => undefined);
      emitEvent(subRun.id, { type: 'error', message: safeError });
      emitEvent(subRun.id, { type: 'done' });
      observability.warn('Sub-pipeline failed, falling back to direct retrieval', {
        subRunId: subRun.id,
        task,
        error: safeError,
      });
    }
  }

  return retrieveForTask(task, workspaceId, mode);
}

async function runSupervisorPipeline(params: {
  runId: string;
  input: string;
  workspaceId: string;
  userId: string;
  mode: 'auto' | 'hybrid' | 'graph';
  template: AgentTemplate;
  depth: number;
  rootRunId: string;
}): Promise<Record<string, unknown>> {
  emitEvent(params.runId, {
    type: 'meta',
    run_id: params.runId,
    mode: params.mode,
    template: params.template,
  });

  const planned = await runStep(params.runId, 'planner', { input: params.input, template: params.template }, async ({ input }) => {
    return plannerWorker(input, params.template);
  });

  await Promise.all(planned.tasks.map((task, index) =>
    insertWorkerStep(params.runId, `worker_${index + 1}`, `Worker ${index + 1}: ${task.slice(0, 40)}`, 10 + index, params.depth)
  ));

  const workerSettled = await Promise.allSettled(
    planned.tasks.map(async (task, index) => {
      const stepKey = `worker_${index + 1}`;
      await updateStep(params.runId, stepKey, {
        status: 'running',
        input: { task, mode: params.mode },
        startedAt: new Date().toISOString(),
      });
      try {
        const result = await retrieveOrSpawn(
          task,
          params.workspaceId,
          params.userId,
          params.mode,
          params.template,
          params.runId,
          params.rootRunId,
          params.depth
        );
        const workerResult = { task, ...result };
        await updateStep(params.runId, stepKey, {
          status: 'done',
          output: workerResult,
          tokenUsage: approxTokenUsage(workerResult),
          finishedAt: new Date().toISOString(),
        });
        return workerResult;
      } catch (error) {
        await updateStep(params.runId, stepKey, {
          status: 'error',
          error: summarizeError(error),
          finishedAt: new Date().toISOString(),
        });
        throw error;
      }
    })
  );

  const retrieved = workerSettled
    .filter((item): item is PromiseFulfilledResult<any> => item.status === 'fulfilled')
    .map((item) => item.value);

  const failedWorkers = workerSettled.filter((item) => item.status === 'rejected').length;
  if (failedWorkers > 0) {
    observability.warn('Some worker agents failed', {
      runId: params.runId,
      failed: failedWorkers,
      total: planned.tasks.length,
    });
  }

  const analysis = await runStep(params.runId, 'analyst', { input: params.input, retrieved }, async ({ input, retrieved: nextRetrieved }) => {
    return analystWorker(nextRetrieved, input, params.template);
  });

  const finalResult = await runStep(params.runId, 'writer', { input: params.input, analysis, template: params.template }, async ({ input, analysis: nextAnalysis }) => {
    return writerWorker(input, nextAnalysis, params.template, (token) => {
      emitEvent(params.runId, { type: 'token', token });
    });
  });

  return {
    answer: finalResult.answer,
    citations: finalResult.citations,
    analysis,
    tasks: planned.tasks,
    retrieved,
  };
}

export async function startSupervisorRun(params: {
  runId?: string;
  workspace_id: string;
  user_id: string;
  query: string;
  mode?: 'auto' | 'hybrid' | 'graph';
  template?: AgentTemplate;
  parentRunId?: string | null;
  rootRunId?: string | null;
  depth?: number;
}): Promise<AgentRun> {
  return createAndStartAgentRun({
    runId: params.runId,
    workspaceId: params.workspace_id,
    userId: params.user_id,
    input: params.query,
    mode: params.mode,
    template: params.template,
    parentRunId: params.parentRunId,
    rootRunId: params.rootRunId,
    depth: params.depth,
  });
}

export async function recoverRunningRunsOnBoot(): Promise<number> {
  const p = pool;
  if (!p) return 0;

  const runningRuns = await p.query<{ id: string }>(
    `SELECT id FROM agent_runs WHERE status = 'running'`
  );

  if ((runningRuns.rowCount ?? 0) === 0) return 0;

  const runIds = runningRuns.rows.map((row) => row.id);
  const errorSummary = 'Run interrupted by server restart';

  await p.query(
    `UPDATE agent_runs
     SET status = 'failed',
         error_summary = $2,
         error = $2,
         finished_at = NOW(),
         updated_at = NOW()
     WHERE id = ANY($1::uuid[])`,
    [runIds, errorSummary]
  );

  await p.query(
    `UPDATE agent_steps
     SET status = 'aborted',
         error = 'Step interrupted by server restart',
         finished_at = NOW(),
         updated_at = NOW()
     WHERE run_id = ANY($1::uuid[]) AND status = 'running'`,
    [runIds]
  );

  return runIds.length;
}
