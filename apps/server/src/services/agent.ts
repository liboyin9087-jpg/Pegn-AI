import { GoogleGenerativeAI } from '@google/generative-ai';
import { observability } from './observability.js';
import { graphRAGQuery } from './graphrag.js';
import { extractEntities } from './kg.js';

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

export type StepStatus = 'pending' | 'running' | 'done' | 'error';

export interface AgentStep {
  id: string;
  name: string;
  status: StepStatus;
  input?: any;
  output?: any;
  error?: string;
  startedAt?: Date;
  finishedAt?: Date;
}

export interface AgentRun {
  id: string;
  type: string;
  query: string;
  workspaceId: string;
  steps: AgentStep[];
  result?: any;
  status: 'running' | 'done' | 'error';
  createdAt: Date;
}

// ── 進度廣播（SSE 用）───────────────────────────────────────
const runListeners = new Map<string, Array<(step: AgentStep) => void>>();

export function subscribeToRun(runId: string, cb: (step: AgentStep) => void): () => void {
  if (!runListeners.has(runId)) runListeners.set(runId, []);
  runListeners.get(runId)!.push(cb);
  return () => {
    const list = runListeners.get(runId) ?? [];
    runListeners.set(runId, list.filter(fn => fn !== cb));
  };
}

function emit(runId: string, step: AgentStep) {
  (runListeners.get(runId) ?? []).forEach(cb => cb(step));
}

// ── 通用 step 執行器 ─────────────────────────────────────────
async function runStep(
  run: AgentRun,
  step: AgentStep,
  fn: (input: any) => Promise<any>
): Promise<any> {
  step.status = 'running';
  step.startedAt = new Date();
  emit(run.id, step);
  try {
    const output = await fn(step.input);
    step.output = output;
    step.status = 'done';
    step.finishedAt = new Date();
    emit(run.id, step);
    return output;
  } catch (error) {
    step.status = 'error';
    step.error = error instanceof Error ? error.message : 'Unknown';
    step.finishedAt = new Date();
    emit(run.id, step);
    throw error;
  }
}

// ── Agent 模板 1：Research Agent ─────────────────────────────
export async function runResearchAgent(
  query: string,
  workspaceId: string,
  runId: string
): Promise<AgentRun> {
  const run: AgentRun = {
    id: runId,
    type: 'research',
    query,
    workspaceId,
    status: 'running',
    createdAt: new Date(),
    steps: [
      { id: 's1', name: '理解問題', status: 'pending' },
      { id: 's2', name: 'GraphRAG 檢索', status: 'pending' },
      { id: 's3', name: '抽取相關實體', status: 'pending' },
      { id: 's4', name: '合成最終答案', status: 'pending' },
    ]
  };

  observability.info('Research agent started', { runId, query: query.slice(0, 80) });

  try {
    // Step 1: 理解問題
    run.steps[0].input = { query };
    const understanding = await runStep(run, run.steps[0], async ({ query }) => {
      if (!genAI) return { intent: query, keywords: [query] };
      const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' });
      const result = await model.generateContent(
        `分析以下問題的意圖和關鍵字，以 JSON 回覆 {intent, keywords:[]}。只回傳 JSON。\n問題：${query}`
      );
      const raw = result.response.text().replace(/```json\n?/, '').replace(/\n?```/, '');
      return JSON.parse(raw);
    });

    // Step 2: GraphRAG 檢索
    run.steps[1].input = { query, workspaceId };
    const ragResult = await runStep(run, run.steps[1], async ({ query, workspaceId }) => {
      return graphRAGQuery(query, workspaceId, 8);
    });

    // Step 3: 抽取實體
    run.steps[2].input = { text: ragResult.sources.map((s: any) => s.content).join('\n').slice(0, 3000) };
    const entities = await runStep(run, run.steps[2], async ({ text }) => {
      return extractEntities(text, workspaceId);
    });

    // Step 4: 合成答案
    run.steps[3].input = { ragResult, entities, understanding };
    const finalAnswer = await runStep(run, run.steps[3], async ({ ragResult, entities }) => {
      return {
        answer: ragResult.answer,
        sources: ragResult.sources,
        entities: entities.slice(0, 10),
        citations: ragResult.citations
      };
    });

    run.result = finalAnswer;
    run.status = 'done';
    observability.info('Research agent completed', { runId });
  } catch (error) {
    run.status = 'error';
    observability.error('Research agent failed', { runId, error });
  }

  return run;
}

// ── Agent 模板 2：Summarize Agent ────────────────────────────
export async function runSummarizeAgent(
  text: string,
  workspaceId: string,
  runId: string
): Promise<AgentRun> {
  const run: AgentRun = {
    id: runId,
    type: 'summarize',
    query: text.slice(0, 80),
    workspaceId,
    status: 'running',
    createdAt: new Date(),
    steps: [
      { id: 's1', name: '分段切割', status: 'pending' },
      { id: 's2', name: '各段摘要', status: 'pending' },
      { id: 's3', name: '合併摘要', status: 'pending' },
    ]
  };

  try {
    // Step 1: 分段
    run.steps[0].input = { text };
    const chunks = await runStep(run, run.steps[0], async ({ text }) => {
      const size = 1500;
      const segments: string[] = [];
      for (let i = 0; i < text.length; i += size) segments.push(text.slice(i, i + size));
      return segments;
    });

    // Step 2: 各段摘要
    run.steps[1].input = { chunks };
    const summaries = await runStep(run, run.steps[1], async ({ chunks }) => {
      if (!genAI) return chunks.map((c: string) => c.slice(0, 200));
      const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' });
      const results: string[] = [];
      for (const chunk of chunks) {
        const r = await model.generateContent(`用 2-3 句話摘要以下內容：\n${chunk}`);
        results.push(r.response.text());
      }
      return results;
    });

    // Step 3: 合併
    run.steps[2].input = { summaries };
    const finalSummary = await runStep(run, run.steps[2], async ({ summaries }) => {
      if (!genAI) return summaries.join(' ');
      const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' });
      const r = await model.generateContent(`將以下多段摘要整合成一份完整摘要：\n${summaries.join('\n')}`);
      return r.response.text();
    });

    run.result = { summary: finalSummary };
    run.status = 'done';
  } catch (error) {
    run.status = 'error';
  }

  return run;
}
