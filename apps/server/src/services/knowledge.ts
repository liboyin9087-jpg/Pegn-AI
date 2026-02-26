import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from '../db/client.js';
import { graphRAGQuery } from './graphrag.js';
import { searchService } from './search.js';

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

export type KnowledgeMode = 'auto' | 'hybrid' | 'graph';
export type KnowledgeModeUsed = 'hybrid' | 'graph';

export interface KnowledgeEntity {
  id?: string;
  name: string;
  entity_type: string;
}

export interface KnowledgeSource {
  content: string;
  document_id: string;
  score: number;
  type: 'hybrid' | 'vector' | 'bm25' | 'graph';
}

export interface KnowledgeResult {
  answer: string;
  sources: KnowledgeSource[];
  entities: KnowledgeEntity[];
  citations: string[];
  mode_used: KnowledgeModeUsed;
  routing_reason: string;
  debug: {
    entity_hits: number;
    hybrid_top_score: number;
  };
}

async function getModel() {
  if (!genAI) return null;
  return genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' });
}

async function getEntityHits(query: string, workspaceId: string): Promise<KnowledgeEntity[]> {
  const p = pool;
  if (!p) return [];

  const keyword = query.trim().split(/\s+/)[0] ?? query;
  if (!keyword) return [];

  const result = await p.query(
    `SELECT id, name, entity_type
     FROM kg_entities
     WHERE workspace_id = $1
       AND (name ILIKE $2 OR description ILIKE $2)
     ORDER BY created_at DESC
     LIMIT 6`,
    [workspaceId, `%${keyword}%`]
  );

  return result.rows;
}

async function synthesizeHybridAnswer(query: string, sources: KnowledgeSource[]): Promise<{ answer: string; citations: string[] }> {
  if (sources.length === 0) {
    return {
      answer: '目前沒有足夠的檢索結果可以回答這個問題。',
      citations: [],
    };
  }

  const context = sources
    .slice(0, 6)
    .map((s, i) => `[${i + 1}] ${s.content}`)
    .join('\n\n');

  const model = await getModel();
  if (!model) {
    return {
      answer: context,
      citations: [],
    };
  }

  const prompt = `根據參考資料回答問題，並使用 [數字] 進行引用。\n\n問題：${query}\n\n參考資料：\n${context}\n\n請用繁體中文回答。`;

  try {
    const result = await model.generateContent(prompt);
    const answer = result.response.text();
    const citations = [...new Set(answer.match(/\[(\d+)\]/g) ?? [])];
    return { answer, citations };
  } catch {
    return {
      answer: context,
      citations: [],
    };
  }
}

function hasGraphIntent(query: string): boolean {
  return /(關係|關聯|脈絡|因果|影響|網絡|graph|network|between|關於.*之間)/i.test(query);
}

function selectModeAuto(input: {
  query: string;
  entityHits: KnowledgeEntity[];
  hybridTopScore: number;
}): { mode_used: KnowledgeModeUsed; routing_reason: string } {
  const { query, entityHits, hybridTopScore } = input;
  if (hasGraphIntent(query)) {
    return { mode_used: 'graph', routing_reason: 'auto_graph_query_intent' };
  }
  if (entityHits.length > 0 && hybridTopScore < 0.55) {
    return { mode_used: 'graph', routing_reason: `auto_graph_entity_hit_low_hybrid(${hybridTopScore.toFixed(2)})` };
  }
  return { mode_used: 'hybrid', routing_reason: `auto_hybrid_top_score(${hybridTopScore.toFixed(2)})` };
}

export async function knowledgeQuery(params: {
  query: string;
  workspace_id: string;
  mode?: KnowledgeMode;
  top_k?: number;
}): Promise<KnowledgeResult> {
  const query = params.query;
  const workspaceId = params.workspace_id;
  const mode = params.mode ?? 'auto';
  const topK = params.top_k ?? 10;

  const entityHits = await getEntityHits(query, workspaceId);
  const hybrid = await searchService.search({
    query,
    workspaceId,
    limit: topK,
    offset: 0,
    hybrid: true,
  });

  const hybridTopScore = hybrid.results[0]?.score ?? 0;

  let modeUsed: KnowledgeModeUsed;
  let routingReason: string;

  if (mode === 'graph') {
    modeUsed = 'graph';
    routingReason = 'forced_graph_mode';
  } else if (mode === 'hybrid') {
    modeUsed = 'hybrid';
    routingReason = 'forced_hybrid_mode';
  } else {
    const selected = selectModeAuto({ query, entityHits, hybridTopScore });
    modeUsed = selected.mode_used;
    routingReason = selected.routing_reason;
  }

  if (modeUsed === 'graph') {
    const graph = await graphRAGQuery(query, workspaceId, topK);
    return {
      answer: graph.answer,
      sources: graph.sources,
      entities: graph.entities,
      citations: graph.citations,
      mode_used: 'graph',
      routing_reason: routingReason,
      debug: {
        entity_hits: entityHits.length,
        hybrid_top_score: hybridTopScore,
      },
    };
  }

  const sources: KnowledgeSource[] = hybrid.results.map((r) => ({
    content: r.content,
    document_id: r.document_id,
    score: r.score,
    type: 'hybrid',
  }));

  const synthesized = await synthesizeHybridAnswer(query, sources);

  return {
    answer: synthesized.answer,
    sources,
    entities: entityHits,
    citations: synthesized.citations,
    mode_used: 'hybrid',
    routing_reason: routingReason,
    debug: {
      entity_hits: entityHits.length,
      hybrid_top_score: hybridTopScore,
    },
  };
}

