import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from '../db/client.js';
import { SearchService } from './search.js';
import { getEntityNeighbors } from './kg.js';
import { observability } from './observability.js';
import { generateTextWithFallback } from './llm.js';

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

function createGeminiClient(): GoogleGenerativeAI | null {
  return process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
}

function rrf(
  lists: Array<Array<{ id: string; score: number; [key: string]: any }>>,
  k = 60
): Array<{ id: string; rrf_score: number; [key: string]: any }> {
  const scores = new Map<string, { rrf_score: number; data: any }>();

  for (const list of lists) {
    list.forEach((item, rank) => {
      const previous = scores.get(item.id) ?? { rrf_score: 0, data: item };
      scores.set(item.id, {
        rrf_score: previous.rrf_score + 1 / (k + rank + 1),
        data: item,
      });
    });
  }

  return Array.from(scores.values())
    .sort((left, right) => right.rrf_score - left.rrf_score)
    .map((value) => ({ ...value.data, rrf_score: value.rrf_score }));
}

async function getEmbedding(text: string): Promise<number[]> {
  const client = createGeminiClient();
  if (!client) return [];

  try {
    const model = client.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch {
    return [];
  }
}

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
    total_ms: 0,
    embedding_ms: 0,
    vector_search_ms: 0,
    bm25_search_ms: 0,
    kg_search_ms: 0,
    rrf_ms: 0,
    llm_ms: 0,
    result_count: 0,
  };

  observability.info('GraphRAG query started', { query: query.slice(0, 80), workspaceId });

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
       )
         AND content_vector IS NOT NULL
       ORDER BY score DESC
       LIMIT $3`,
      [`[${embedding.join(',')}]`, workspaceId, topK]
    )).rows
    : [];
  timing.vector_search_ms = Date.now() - t2;

  const t3 = Date.now();
  const bm25Results = (await pool.query(
    `SELECT id, document_id, content, title,
            ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) AS score
     FROM search_index
     WHERE document_id IN (
       SELECT id FROM documents WHERE workspace_id = $2
     )
       AND to_tsvector('english', content) @@ plainto_tsquery('english', $1)
     ORDER BY score DESC
     LIMIT $3`,
    [query, workspaceId, topK]
  )).rows;
  timing.bm25_search_ms = Date.now() - t3;

  const t4 = Date.now();
  const queryWords = query.trim().split(/\s+/).filter((word) => word.length >= 2).slice(0, 6);
  const likePatterns = queryWords.map((word) => `%${word}%`);
  const entityResults = likePatterns.length > 0
    ? (await pool.query(
      `SELECT id, name, entity_type, document_id
       FROM kg_entities
       WHERE workspace_id = $1
         AND (name ILIKE ANY($2::text[]) OR description ILIKE ANY($2::text[]))
       LIMIT 5`,
      [workspaceId, likePatterns]
    )).rows
    : [];

  const graphChunks: Array<{ id: string; score: number; content: string; document_id: string }> = [];
  for (const entity of entityResults) {
    const { entities, relationships } = await getEntityNeighbors(entity.id, 2);
    if (entities.length === 0) continue;
    const summary = `Entity ${entity.name} (${entity.entity_type}) is connected to ${entities.map((item) => `${item.name} (${item.entity_type})`).join(', ')} via ${relationships.map((item) => item.relation_type).join(', ')}.`;
    graphChunks.push({
      id: `kg-${entity.id}`,
      score: 0.8,
      content: summary,
      document_id: entity.document_id ?? '',
    });
  }
  timing.kg_search_ms = Date.now() - t4;

  const t5 = Date.now();
  const vectorList = vectorResults.map((row: any) => ({
    id: row.id,
    score: row.score,
    content: row.content,
    document_id: row.document_id,
    type: 'vector' as const,
  }));
  const bm25List = bm25Results.map((row: any) => ({
    id: row.id,
    score: row.score,
    content: row.content,
    document_id: row.document_id,
    type: 'bm25' as const,
  }));
  const graphList = graphChunks.map((row) => ({ ...row, type: 'graph' as const }));
  const fused = rrf([vectorList, bm25List, graphList]).slice(0, topK);
  timing.rrf_ms = Date.now() - t5;
  timing.result_count = fused.length;

  const t6 = Date.now();
  const context = fused
    .slice(0, 6)
    .map((row, index) => `[${index + 1}] ${row.content}`)
    .join('\n\n');
  const answerResult = fused.length > 0
    ? await generateTextWithFallback({
      feature: 'graphrag_answer',
      prompt: `Answer the user query using only the cited evidence. Include citations like [1] when grounded.\n\nQuery:\n${query}\n\nEvidence:\n${context}`,
      fallbackText: context || 'No grounded evidence found.',
      onError: (error) => observability.error('GraphRAG answer generation failed', { error }),
    })
    : { text: 'No grounded evidence found.', provider: 'mock', degraded: true };
  timing.llm_ms = Date.now() - t6;
  timing.total_ms = Date.now() - t0;

  observability.info('GraphRAG query completed', {
    query: query.slice(0, 80),
    workspaceId,
    ...timing,
    llmProvider: answerResult.provider,
    llmDegraded: answerResult.degraded,
  });

  return {
    answer: answerResult.text,
    sources: fused.map((row) => ({
      content: row.content,
      document_id: row.document_id,
      score: row.rrf_score,
      type: row.type,
    })),
    entities: entityResults.map((row) => ({
      id: row.id,
      name: row.name,
      entity_type: row.entity_type,
    })),
    citations: [...new Set(answerResult.text.match(/\[(\d+)\]/g) ?? [])],
    ...(debug ? { _timing: timing } : {}),
  };
}
