import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from '../db/client.js';
import { observability } from './observability.js';
import { graphRAGQuery } from './graphrag.js';
import { searchService } from './search.js';

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

type AgentTemplate = 'supervisor' | 'research' | 'summarize' | 'brainstorm' | 'outline';

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

const STEP_TEMPLATES = [
  { step_key: 'planner', name: '規劃任務', worker: 'planner', position: 1 },
  { step_key: 'retriever', name: '檢索證據', worker: 'retriever', position: 2 },
  { step_key: 'analyst', name: '分析整合', worker: 'analyst', position: 3 },
  { step_key: 'writer', name: '產出結果', worker: 'writer', position: 4 },
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

function fallbackTaskPlan(query: string, template: AgentTemplate): string[] {
  if (template === 'summarize') {
    return ['抽取重點主題', '壓縮內容為精簡摘要', '整理可執行結論'];
  }
  if (template === 'brainstorm') {
    return [
      `從不同角度拆解主題：${query}`,
      '發散思考：列出非顯而易見的創意方向',
      '歸納並評估各想法的可行性與潛力',
    ];
  }
  if (template === 'outline') {
    return [
      `分析主題核心架構：${query}`,
      '規劃層次化大綱（章節 / 小節 / 要點）',
      '補充每個章節的關鍵內容提示',
    ];
  }
  return [
    `界定問題範圍：${query}`,
    '收集與問題直接相關的證據與來源',
    '整合證據並輸出可執行結論',
  ];
}

async function plannerWorker(query: string, template: AgentTemplate): Promise<{ tasks: string[]; intent: string }> {
  const model = await getModel();
  if (!model) {
    return { tasks: fallbackTaskPlan(query, template), intent: query };
  }

  const prompt = `你是任務規劃器。請把使用者需求拆成 2-4 個可執行子任務，回傳 JSON：{"intent":"...","tasks":["...",...]}
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

  const prompt = `你是分析員。根據檢索結果整理關鍵洞察，回傳 JSON：{"analysis":"...","key_points":["..."]}\n\nUser query: ${query}\n\nEvidence:\n${evidenceText}`;
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
  const basePrompt =
    template === 'summarize' ? '請輸出精簡摘要與行動重點。' :
    template === 'brainstorm' ? '請輸出多角度創意想法，以發散思考為主，條列各方向及其潛力。' :
    template === 'outline' ? '請輸出層次清晰的結構化大綱，包含章節標題與各章節的核心要點提示。' :
    '請輸出結構化答案，包含重點與可執行建議。';

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

async function runSupervisorPipeline(
  runId: string,
  query: string,
  workspaceId: string,
  mode: 'auto' | 'hybrid' | 'graph',
  template: AgentTemplate
): Promise<void> {
  emitEvent(runId, { type: 'meta', run_id: runId, mode });

  const planned = await runStep(runId, 'planner', { query, template }, async ({ query: q }) => {
    return plannerWorker(q, template);
  });

  const retrieved = await runStep(runId, 'retriever', { tasks: planned.tasks, mode, workspace_id: workspaceId }, async ({ tasks }) => {
    const taskResults = [] as any[];
    for (const task of tasks) {
      const result = await retrieveForTask(task, workspaceId, mode);
      taskResults.push({ task, ...result });
    }
    return taskResults;
  });

  const analysis = await runStep(runId, 'analyst', { query, retrieved }, async ({ query: q, retrieved: r }) => {
    return analystWorker(r, q);
  });

  // Writer step 使用真實串流：token 在 LLM 生成過程中即時透過 SSE 推送給前端
  const finalResult = await runStep(runId, 'writer', { query, analysis, template }, async ({ query: q, analysis: a }) => {
    return writerWorker(q, a, template, (token) => {
      emitEvent(runId, { type: 'token', token });
    });
  });

  const answerText = finalResult.answer ?? '';

  await markRun(runId, 'done', {
    result: {
      answer: finalResult.answer,
      citations: finalResult.citations,
      analysis,
      tasks: planned.tasks,
      retrieved,
    },
    token_usage: approxTokenUsage(answerText),
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
  mode?: 'auto' | 'hybrid' | 'graph';
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

