import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { pool } from '../db/client.js';
import { observability } from './observability.js';
import { graphRAGQuery } from './graphrag.js';
import { searchService } from './search.js';
import { sanitizeUserInput } from './inputSanitizer.js';

// ── Agent LLM abstraction (Gemini / OpenAI / Claude) ────────────────────────

interface AgentLLM {
  readonly provider: string;
  generate(prompt: string): Promise<string>;
  stream(prompt: string, onToken: (token: string) => void): Promise<string>;
}

class GeminiAgentLLM implements AgentLLM {
  readonly provider = 'gemini';
  private model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>;

  constructor() {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    this.model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' });
  }

  async generate(prompt: string): Promise<string> {
    const result = await this.model.generateContent(prompt);
    return result.response.text();
  }

  async stream(prompt: string, onToken: (token: string) => void): Promise<string> {
    const result = await this.model.generateContentStream(prompt);
    let full = '';
    for await (const chunk of result.stream) {
      const t = chunk.text();
      if (t) { full += t; onToken(t); }
    }
    return full;
  }
}

class OpenAIAgentLLM implements AgentLLM {
  readonly provider = 'openai';
  private client: OpenAI;
  private modelName: string;

  constructor() {
    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.modelName = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
  }

  async generate(prompt: string): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.modelName,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.choices[0]?.message?.content ?? '';
  }

  async stream(prompt: string, onToken: (token: string) => void): Promise<string> {
    const res = await this.client.chat.completions.create({
      model: this.modelName,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    });
    let full = '';
    for await (const chunk of res) {
      const t = chunk.choices[0]?.delta?.content ?? '';
      if (t) { full += t; onToken(t); }
    }
    return full;
  }
}

class ClaudeAgentLLM implements AgentLLM {
  readonly provider = 'claude';
  private client: Anthropic;
  private modelName: string;

  constructor() {
    this.client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.modelName = process.env.CLAUDE_MODEL ?? 'claude-3-5-sonnet-20241022';
  }

  async generate(prompt: string): Promise<string> {
    const msg = await this.client.messages.create({
      model: this.modelName,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const block = msg.content[0];
    return block?.type === 'text' ? block.text : '';
  }

  async stream(prompt: string, onToken: (token: string) => void): Promise<string> {
    let full = '';
    const stream = await this.client.messages.create({
      model: this.modelName,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
      stream: true,
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        const t = event.delta.text;
        if (t) { full += t; onToken(t); }
      }
    }
    return full;
  }
}

function createAgentLLM(): AgentLLM | null {
  const preferred = String(process.env.AGENT_LLM_PROVIDER ?? 'auto').toLowerCase();

  if ((preferred === 'gemini' || preferred === 'auto') && process.env.GEMINI_API_KEY) {
    observability.info('Agent LLM provider', { provider: 'gemini' });
    return new GeminiAgentLLM();
  }
  if ((preferred === 'openai' || preferred === 'auto') && process.env.OPENAI_API_KEY) {
    observability.info('Agent LLM provider', { provider: 'openai' });
    return new OpenAIAgentLLM();
  }
  if ((preferred === 'claude' || preferred === 'auto') && process.env.ANTHROPIC_API_KEY) {
    observability.info('Agent LLM provider', { provider: 'claude' });
    return new ClaudeAgentLLM();
  }

  observability.warn('Agent LLM: no provider configured, running in fallback mode');
  return null;
}

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

// Fixed orchestration steps — worker steps are created dynamically after planning
const STEP_TEMPLATES = [
  { step_key: 'planner',  name: '規劃任務', worker: 'planner',  position: 1  },
  { step_key: 'analyst',  name: '分析整合', worker: 'analyst',  position: 30 },
  { step_key: 'writer',   name: '產出結果', worker: 'writer',   position: 40 },
] as const;

// P1-3: Agent 模板 DSL Registry — 將硬編碼字串整合為一個可經兩本維護的設定物件
interface TemplateConfig {
  /** 給 planner LLM 的路由提示 */
  plannerHint: string;
  /** writer 輸出指令 */
  basePrompt: string;
  /** LLM 不可用時的预設子任務 */
  fallbackTasks: (query: string) => string[];
}

const TEMPLATE_REGISTRY: Record<AgentTemplate, TemplateConfig> = {
  supervisor: {
    plannerHint: '通用任務拆解',
    basePrompt: '請輸出結構化答案，包含重點與可執行建議。',
    fallbackTasks: (query) => [
      `界定問題範圍：${query}`,
      '收集與問題直接相關的證據與來源',
      '整合證據並輸出可執行結論',
    ],
  },
  research: {
    plannerHint: '深度研究拆解',
    basePrompt: '請輸出結構化答案，包含重點與可執行建議。',
    fallbackTasks: (query) => [
      `界定問題範圍：${query}`,
      '收集與問題直接相關的證據與來源',
      '整合證據並輸出可執行結論',
    ],
  },
  summarize: {
    plannerHint: '摘要任務拆解',
    basePrompt: '請輸出精簡摘要與行動重點。',
    fallbackTasks: () => ['抽取重點主題', '壓縮內容為精簡摘要', '整理可執行結論'],
  },
  brainstorm: {
    plannerHint: '創意發想拆解',
    basePrompt: '請輸出多角度創意想法，以發散思考為主，條列各方向及其潛力。',
    fallbackTasks: (query) => [
      `從不同角度拆解主題：${query}`,
      '發散思考：列出非顯而易見的創意方向',
      '歸納並評估各想法的可行性與潛力',
    ],
  },
  outline: {
    plannerHint: '大綱結構拆解',
    basePrompt: '請輸出層次清晰的結構化大綱，包含章節標題與各章節的核心要點提示。',
    fallbackTasks: (query) => [
      `分析主題核心架構：${query}`,
      '規劃層次化大綱（章節 / 小節 / 要點）',
      '補充每個章節的關鍵內容提示',
    ],
  },
};

function approxTokenUsage(content: unknown): number {
  const text = typeof content === 'string' ? content : JSON.stringify(content ?? '');
  return Math.max(1, Math.ceil(text.length / 4));
}

// Lazy singleton — created once on first use so env vars are available
let _agentLLM: AgentLLM | null | undefined = undefined;
function getAgentLLM(): AgentLLM | null {
  if (_agentLLM === undefined) _agentLLM = createAgentLLM();
  return _agentLLM;
}

async function getModel() {
  return getAgentLLM();
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
  return (TEMPLATE_REGISTRY[template] ?? TEMPLATE_REGISTRY.supervisor).fallbackTasks(query);
}

async function plannerWorker(query: string, template: AgentTemplate): Promise<{ tasks: string[]; intent: string }> {
  // P0 Security: sanitize user query before sending to LLM
  const sanitized = sanitizeUserInput(query);
  if (sanitized.blocked) {
    observability.warn('plannerWorker: input blocked by sanitizer', { reason: sanitized.reason });
    return { tasks: fallbackTaskPlan(query, template), intent: query };
  }
  const safeQuery = sanitized.safe;

  const model = await getModel();
  if (!model) {
    return { tasks: fallbackTaskPlan(safeQuery, template), intent: safeQuery };
  }

  const prompt = `你是任務規劃器。請把使用者需求拆成 2-4 個可執行子任務，回傳 JSON：{"intent":"...","tasks":["...",...]}
Template: ${TEMPLATE_REGISTRY[template]?.plannerHint ?? template}
User query: ${safeQuery}`;

  try {
    const rawText = await model.generate(prompt);
    const raw = rawText.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
    const parsed = JSON.parse(raw);
    const tasks = Array.isArray(parsed.tasks)
      ? parsed.tasks.map((t: any) => String(t)).filter(Boolean).slice(0, 4)
      : [];

    if (tasks.length === 0) {
      return { tasks: fallbackTaskPlan(safeQuery, template), intent: safeQuery };
    }

    return {
      tasks,
      intent: parsed.intent ? String(parsed.intent) : safeQuery,
    };
  } catch {
    return { tasks: fallbackTaskPlan(safeQuery, template), intent: safeQuery };
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
    const rawText = await model.generate(prompt);
    const raw = rawText.trim().replace(/^```json\n?/, '').replace(/\n?```$/, '');
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
  const { basePrompt } = TEMPLATE_REGISTRY[template] ?? TEMPLATE_REGISTRY.supervisor;

  if (!model) {
    const answer = `${basePrompt}\n\n問題：${query}\n\n${analysis.analysis ?? ''}`;
    return { answer, citations: [] };
  }

  const prompt = `${basePrompt}\n\n請用繁體中文回答。\n問題：${query}\n\n分析：${analysis.analysis}`;
  try {
    const answer = await model.stream(prompt, (token) => onToken?.(token));
    const citations = [...new Set(answer.match(/\[(\d+)\]/g) ?? [])];
    return { answer, citations };
  } catch {
    const answer = `${basePrompt}\n\n問題：${query}\n\n${analysis.analysis ?? ''}`;
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

// P2-1: 遞迴 Worker — 複雜任務可拆解為 sub-worker 並行執行
// MAX_RECURSION_DEPTH = 1 表示 workers 可再拆一層 sub-workers（防止無限遞迴）
const MAX_RECURSION_DEPTH = 1;
const RECURSION_WORD_THRESHOLD = 12; // 任務說明超過此字數才考慮拆解

async function runWorkerWithRecursion(
  runId: string,
  parentStepKey: string,
  task: string,
  workspaceId: string,
  mode: 'auto' | 'hybrid' | 'graph',
  parentPosition: number,
  depth = 0
): Promise<any> {
  // Depth guard - 達到上限直接做普通 retrieval
  if (depth >= MAX_RECURSION_DEPTH) {
    return retrieveForTask(task, workspaceId, mode);
  }

  const llm = getAgentLLM();
  const words = task.trim().split(/\s+/).length;

  // 若任務夠短或 LLM 不可用，不做遞迴
  if (words < RECURSION_WORD_THRESHOLD || !llm) {
    return retrieveForTask(task, workspaceId, mode);
  }

  // 請 LLM 判斷是否值得拆解 (max 2 sub-tasks)
  const decompositionPrompt = `你是一個 Agent 排程器。請判斷以下任務是否能有效拆成 2 個更具體的子任務（各自獨立可平行執行），若可以回傳 JSON：{"decompose":true,"sub_tasks":["...","..."]}；若不需要拆解則回傳：{"decompose":false}

任務：${task}`;

  let subTasks: string[] = [];
  try {
    const raw = await llm.generate(decompositionPrompt);
    const parsed = JSON.parse(raw.trim().replace(/^```json\n?/, '').replace(/\n?```$/, ''));
    if (parsed.decompose === true && Array.isArray(parsed.sub_tasks) && parsed.sub_tasks.length >= 2) {
      subTasks = parsed.sub_tasks.slice(0, 2).map(String).filter(Boolean);
    }
  } catch { /* LLM 解析失敗 → 不拆解 */ }

  if (subTasks.length < 2) {
    return retrieveForTask(task, workspaceId, mode);
  }

  // 插入 sub-worker DB 步驟（position = parentPosition * 10 + i）
  const subBasePos = parentPosition * 10;
  await Promise.all(subTasks.map((st, i) =>
    insertWorkerStep(runId, `${parentStepKey}_sub_${i + 1}`, `Sub-Worker ${i + 1}: ${st.slice(0, 40)}`, subBasePos + i)
  ));

  observability.info('Recursive worker decomposing task', { runId, parentStepKey, depth, subCount: subTasks.length });

  // 平行執行 sub-workers（depth + 1，不再遞迴）
  const subSettled = await Promise.allSettled(
    subTasks.map(async (subTask, i) => {
      const subKey = `${parentStepKey}_sub_${i + 1}`;
      await updateStep(runId, subKey, { status: 'running', input: { task: subTask, mode }, started_at: new Date().toISOString() });
      try {
        const result = await runWorkerWithRecursion(runId, subKey, subTask, workspaceId, mode, subBasePos + i, depth + 1);
        await updateStep(runId, subKey, {
          status: 'done',
          output: result,
          token_usage: approxTokenUsage(result),
          finished_at: new Date().toISOString(),
        });
        return result;
      } catch (err) {
        await updateStep(runId, subKey, {
          status: 'error',
          error: err instanceof Error ? err.message : 'Sub-worker failed',
          finished_at: new Date().toISOString(),
        });
        throw err;
      }
    })
  );

  const fulfilled = subSettled
    .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled')
    .map(r => r.value);

  if (fulfilled.length === 0) {
    // 全部失敗，回退到普通 retrieval
    return retrieveForTask(task, workspaceId, mode);
  }

  // 合併 sub-worker 結果
  return {
    task,
    mode_used: 'recursive' as const,
    routing_reason: `recursive_decomposition(depth=${depth},sub_tasks=${subTasks.length})`,
    answer: fulfilled.map(r => r.answer ?? '').join('\n\n'),
    sources: fulfilled.flatMap(r => r.sources ?? []),
    entities: fulfilled.flatMap(r => r.entities ?? []),
    citations: [...new Set(fulfilled.flatMap(r => r.citations ?? []))],
    hybrid_top_score: Math.max(0, ...fulfilled.map(r => r.hybrid_top_score ?? 0)),
    sub_tasks: subTasks,
  };
}

async function runSupervisorPipeline(
  runId: string,
  query: string,
  workspaceId: string,
  mode: 'auto' | 'hybrid' | 'graph',
  template: AgentTemplate
): Promise<void> {
  emitEvent(runId, { type: 'meta', run_id: runId, mode });

  // ── 1. Planner (position 1) ────────────────────────────────
  const planned = await runStep(runId, 'planner', { query, template }, async ({ query: q }) => {
    return plannerWorker(q, template);
  });

  // ── 2. Parallel worker agents (positions 10, 11, 12…) ──────
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
        // P2-1: 支援遞迴拆解 — 複雜任務會遞迴分解為 sub-workers
        const result = await runWorkerWithRecursion(runId, stepKey, task, workspaceId, mode, 10 + i, 0);
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
    return analystWorker(r, q);
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

