import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from '../db/client.js';
import { SearchService } from './search.js';
import { getEntityNeighbors } from './kg.js';
import { observability } from './observability.js';

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const searchService = new SearchService();

export interface GraphRAGResult {
  answer: string;
  sources: Array<{
    content: string;
    document_id: string;
    score: number;
    type: 'vector' | 'bm25' | 'graph';
  }>;
  entities: Array<{ id: string; name: string; entity_type: string }>;
  citations: string[];
  // Performance profiling — populated when debug=true
  _timing?: {
    total_ms: number;
    embedding_ms: number;
    vector_search_ms: number;
    bm25_search_ms: number;
    kg_search_ms: number;
    rrf_ms: number;
    llm_ms: number;
    result_count: number;
  };
}

// ── Reciprocal Rank Fusion ───────────────────────────────────
function rrf(
  lists: Array<Array<{ id: string; score: number; [key: string]: any }>>,
  k = 60
): Array<{ id: string; rrf_score: number; [key: string]: any }> {
  const scores = new Map<string, { rrf_score: number; data: any }>();

  for (const list of lists) {
    list.forEach((item, rank) => {
      const prev = scores.get(item.id) ?? { rrf_score: 0, data: item };
      scores.set(item.id, {
        rrf_score: prev.rrf_score + 1 / (k + rank + 1),
        data: item
      });
    });
  }

  return Array.from(scores.values())
    .sort((a, b) => b.rrf_score - a.rrf_score)
    .map(v => ({ ...v.data, rrf_score: v.rrf_score }));
}

// ── Embedding 查詢 ───────────────────────────────────────────
async function getEmbedding(text: string): Promise<number[]> {
  if (!genAI) return [];
  try {
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch { return []; }
}

// ── GraphRAG 主查詢 ──────────────────────────────────────────
export async function graphRAGQuery(
  query: string,
  workspaceId: string,
  topK = 10,
  debug = false
): Promise<GraphRAGResult> {
  if (!pool) {
    return { answer: 'DB unavailable', sources: [], entities: [], citations: [] };
  }

  const t0 = Date.now();
  const timing = {
    total_ms: 0, embedding_ms: 0, vector_search_ms: 0,
    bm25_search_ms: 0, kg_search_ms: 0, rrf_ms: 0, llm_ms: 0,
    result_count: 0,
  };

  observability.info('GraphRAG query started', { query: query.slice(0, 80), workspaceId });

  // 1. 向量搜尋
  const t1 = Date.now();
  const embedding = await getEmbedding(query);
  timing.embedding_ms = Date.now() - t1;

  const t2 = Date.now();
  const vectorResults = embedding.length > 0
    ? (await pool.query(
        `SELECT id, document_id, content, title,
                1 - (content_vector <=> $1::vector) AS score
         FROM search_index
         WHERE document_id IN (
           SELECT id FROM documents WHERE workspace_id = $2
         ) AND content_vector IS NOT NULL
         ORDER BY score DESC LIMIT $3`,
        [`[${embedding.join(',')}]`, workspaceId, topK]
      )).rows
    : [];
  timing.vector_search_ms = Date.now() - t2;

  // 2. BM25 全文搜尋
  const t3 = Date.now();
  const bm25Results = (await pool.query(
    `SELECT id, document_id, content, title,
            ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) AS score
     FROM search_index
     WHERE document_id IN (
       SELECT id FROM documents WHERE workspace_id = $2
     ) AND to_tsvector('english', content) @@ plainto_tsquery('english', $1)
     ORDER BY score DESC LIMIT $3`,
    [query, workspaceId, topK]
  )).rows;
  timing.bm25_search_ms = Date.now() - t3;

  // 3. KG 實體搜尋（根據 query 所有詞找相關實體，再取鄰居）
  const t4 = Date.now();
  // Fix 6: 改用全詞匹配（ILIKE ANY），避免只取第一個詞而漏掉相關實體
  const queryWords = query.trim().split(/\s+/).filter(w => w.length >= 2).slice(0, 6);
  const likePatterns = queryWords.map(w => `%${w}%`);
  const entityResults = (await pool.query(
    `SELECT id, name, entity_type, document_id FROM kg_entities
     WHERE workspace_id = $1
       AND (name ILIKE ANY($2::text[]) OR description ILIKE ANY($2::text[]))
     LIMIT 5`,
    [workspaceId, likePatterns]
  )).rows;

  // 取 KG 鄰居並轉成 search chunk
  const graphChunks: Array<{ id: string; score: number; content: string; document_id: string }> = [];
  for (const entity of entityResults) {
    const { entities, relationships } = await getEntityNeighbors(entity.id, 2);
    if (entities.length > 0) {
      const summary = `${entity.name}（${entity.entity_type}）相關聯的實體：` +
        entities.map(e => `${e.name}(${e.entity_type})`).join('、') +
        '。關係：' + relationships.map(r => r.relation_type).join('、');
      graphChunks.push({ id: `kg-${entity.id}`, score: 0.8, content: summary, document_id: entity.document_id ?? '' });
    }
  }
  timing.kg_search_ms = Date.now() - t4;

  // 4. RRF 融合三個結果清單
  const t5 = Date.now();
  const vectorList = vectorResults.map((r: any) => ({ id: r.id, score: r.score, content: r.content, document_id: r.document_id, type: 'vector' as const }));
  const bm25List = bm25Results.map((r: any) => ({ id: r.id, score: r.score, content: r.content, document_id: r.document_id, type: 'bm25' as const }));
  const graphList = graphChunks.map(r => ({ ...r, type: 'graph' as const }));

  const fused = rrf([vectorList, bm25List, graphList]).slice(0, topK);
  timing.rrf_ms = Date.now() - t5;
  timing.result_count = fused.length;

  // 5. 用 Gemini 合成答案
  const t6 = Date.now();
  let answer = '（無法生成答案，請確認 Gemini API Key）';
  const citations: string[] = [];

  if (genAI && fused.length > 0) {
    const context = fused
      .slice(0, 6)
      .map((r, i) => `[${i + 1}] ${r.content}`)
      .join('\n\n');

    const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash' });
    const prompt = `根據以下參考資料，回答問題。回答時請引用 [數字] 標記來源。

問題：${query}

參考資料：
${context}

請用繁體中文回答，簡潔但完整，並在最後列出引用的 [數字]。`;

    try {
      const result = await model.generateContent(prompt);
      answer = result.response.text();
      // 抽取引用編號
      const matches = answer.match(/\[(\d+)\]/g) ?? [];
      citations.push(...[...new Set(matches)]);
    } catch (error) {
      observability.error('GraphRAG answer generation failed', { error });
    }
  }
  timing.llm_ms = Date.now() - t6;
  timing.total_ms = Date.now() - t0;

  observability.info('GraphRAG query completed', {
    query: query.slice(0, 80),
    workspaceId,
    ...timing,
  });

  return {
    answer,
    sources: fused.map(r => ({ content: r.content, document_id: r.document_id, score: r.rrf_score, type: r.type })),
    entities: entityResults.map(e => ({ id: e.id, name: e.name, entity_type: e.entity_type })),
    citations,
    ...(debug ? { _timing: timing } : {}),
  };
}
