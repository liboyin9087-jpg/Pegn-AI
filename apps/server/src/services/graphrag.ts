import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from '../db/client.js';
import { getEntityNeighbors } from './kg.js';
import { observability } from './observability.js';

const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const EMBEDDING_MODEL = 'text-embedding-004';
const GENERATION_MODEL = process.env.GEMINI_MODEL ?? 'gemini-2.5-flash';

export interface GraphRAGProfile {
  timing_ms: {
    embedding: number;
    vector_search: number;
    bm25_search: number;
    entity_search: number;
    neighbor_expand: number;
    fusion: number;
    generation: number;
    total: number;
  };
  hit_counts: {
    vector: number;
    bm25: number;
    entities: number;
    graph_chunks: number;
    fused: number;
  };
  model: {
    embedding_model: string;
    generation_model: string;
    used_generation: boolean;
  };
}

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
  debug?: {
    profile: GraphRAGProfile;
  };
}

export interface GraphRAGQueryOptions {
  includeProfile?: boolean;
}

interface RankedChunk {
  id: string;
  content: string;
  document_id: string;
  score: number;
  type: 'vector' | 'bm25' | 'graph';
}

function nowMs(): number {
  return Date.now();
}

function emptyProfile(): GraphRAGProfile {
  return {
    timing_ms: {
      embedding: 0,
      vector_search: 0,
      bm25_search: 0,
      entity_search: 0,
      neighbor_expand: 0,
      fusion: 0,
      generation: 0,
      total: 0,
    },
    hit_counts: {
      vector: 0,
      bm25: 0,
      entities: 0,
      graph_chunks: 0,
      fused: 0,
    },
    model: {
      embedding_model: EMBEDDING_MODEL,
      generation_model: GENERATION_MODEL,
      used_generation: false,
    },
  };
}

function toLikePatterns(query: string): string[] {
  const words = query.trim().split(/\s+/).filter((word) => word.length >= 2).slice(0, 6);
  if (words.length > 0) {
    return words.map((word) => `%${word}%`);
  }
  const fallback = query.trim();
  return fallback ? [`%${fallback}%`] : ['%'];
}

function rrf<T extends { id: string }>(lists: T[][], k = 60): Array<T & { rrf_score: number }> {
  const scores = new Map<string, { rrf_score: number; data: T }>();

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
    .map((row) => ({ ...row.data, rrf_score: row.rrf_score }));
}

async function getEmbedding(text: string): Promise<number[]> {
  if (!genAI) return [];
  try {
    const model = genAI.getGenerativeModel({ model: EMBEDDING_MODEL });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch {
    return [];
  }
}

function recordProfileMetrics(workspaceId: string, profile: GraphRAGProfile): void {
  const tags = { workspace_id: workspaceId };
  observability.recordMetric('graphrag_query_duration_ms', profile.timing_ms.total, tags);
  observability.recordMetric('graphrag_stage_duration_ms', profile.timing_ms.embedding, { ...tags, stage: 'embedding' });
  observability.recordMetric('graphrag_stage_duration_ms', profile.timing_ms.vector_search, { ...tags, stage: 'vector_search' });
  observability.recordMetric('graphrag_stage_duration_ms', profile.timing_ms.bm25_search, { ...tags, stage: 'bm25_search' });
  observability.recordMetric('graphrag_stage_duration_ms', profile.timing_ms.entity_search, { ...tags, stage: 'entity_search' });
  observability.recordMetric('graphrag_stage_duration_ms', profile.timing_ms.neighbor_expand, { ...tags, stage: 'neighbor_expand' });
  observability.recordMetric('graphrag_stage_duration_ms', profile.timing_ms.fusion, { ...tags, stage: 'fusion' });
  observability.recordMetric('graphrag_stage_duration_ms', profile.timing_ms.generation, { ...tags, stage: 'generation' });
  observability.recordMetric('graphrag_hits_count', profile.hit_counts.vector, { ...tags, source: 'vector' });
  observability.recordMetric('graphrag_hits_count', profile.hit_counts.bm25, { ...tags, source: 'bm25' });
  observability.recordMetric('graphrag_hits_count', profile.hit_counts.entities, { ...tags, source: 'entities' });
  observability.recordMetric('graphrag_hits_count', profile.hit_counts.graph_chunks, { ...tags, source: 'graph_chunks' });
  observability.recordMetric('graphrag_hits_count', profile.hit_counts.fused, { ...tags, source: 'fused' });
}

export async function graphRAGQuery(
  query: string,
  workspaceId: string,
  topK = 10,
  options: GraphRAGQueryOptions = {}
): Promise<GraphRAGResult> {
  const profile = emptyProfile();
  const totalStart = nowMs();

  if (!pool) {
    profile.timing_ms.total = nowMs() - totalStart;
    const fallback: GraphRAGResult = {
      answer: 'DB unavailable',
      sources: [],
      entities: [],
      citations: [],
    };
    if (options.includeProfile) {
      fallback.debug = { profile };
    }
    return fallback;
  }

  observability.info('GraphRAG query started', {
    query: query.slice(0, 120),
    workspace_id: workspaceId,
    top_k: topK
  });

  const embeddingStart = nowMs();
  const embedding = await getEmbedding(query);
  profile.timing_ms.embedding = nowMs() - embeddingStart;

  const vectorStart = nowMs();
  const vectorResults = embedding.length > 0
    ? (await pool.query(
      `SELECT id, document_id, content,
              1 - (content_vector <=> $1::vector) AS score
       FROM search_index
       WHERE document_id IN (
         SELECT id FROM documents WHERE workspace_id = $2
       ) AND content_vector IS NOT NULL
       ORDER BY score DESC LIMIT $3`,
      [`[${embedding.join(',')}]`, workspaceId, topK]
    )).rows
    : [];
  profile.timing_ms.vector_search = nowMs() - vectorStart;
  profile.hit_counts.vector = vectorResults.length;

  const bm25Start = nowMs();
  const bm25Results = (await pool.query(
    `SELECT id, document_id, content,
            ts_rank(to_tsvector('english', content), plainto_tsquery('english', $1)) AS score
     FROM search_index
     WHERE document_id IN (
       SELECT id FROM documents WHERE workspace_id = $2
     ) AND to_tsvector('english', content) @@ plainto_tsquery('english', $1)
     ORDER BY score DESC LIMIT $3`,
    [query, workspaceId, topK]
  )).rows;
  profile.timing_ms.bm25_search = nowMs() - bm25Start;
  profile.hit_counts.bm25 = bm25Results.length;

  const entityStart = nowMs();
  const entityResults = (await pool.query(
    `SELECT id, name, entity_type, document_id
     FROM kg_entities
     WHERE workspace_id = $1
       AND (name ILIKE ANY($2::text[]) OR description ILIKE ANY($2::text[]))
     LIMIT 5`,
    [workspaceId, toLikePatterns(query)]
  )).rows;
  profile.timing_ms.entity_search = nowMs() - entityStart;
  profile.hit_counts.entities = entityResults.length;

  const neighborStart = nowMs();
  const graphChunksRaw = await Promise.all(
    entityResults.map(async (entity: any) => {
      const graph = await getEntityNeighbors(entity.id, workspaceId, 2);
      if (!graph.entities.length) return null;
      const entityNames = graph.entities.map((item: any) => `${item.name}(${item.entity_type})`).join(', ');
      const relationTypes = graph.relationships.map((item: any) => item.relation_type).join(', ');
      return {
        id: `kg-${entity.id}`,
        score: 0.8,
        content: `${entity.name} (${entity.entity_type}) neighbors: ${entityNames}. Relations: ${relationTypes}`,
        document_id: entity.document_id ?? '',
        type: 'graph' as const,
      };
    })
  );
  const graphChunks = graphChunksRaw.filter((item): item is NonNullable<typeof item> => Boolean(item));
  profile.timing_ms.neighbor_expand = nowMs() - neighborStart;
  profile.hit_counts.graph_chunks = graphChunks.length;

  const fusionStart = nowMs();
  const vectorList: RankedChunk[] = vectorResults.map((row: any) => ({
    id: row.id,
    content: row.content,
    document_id: row.document_id,
    score: Number(row.score ?? 0),
    type: 'vector',
  }));
  const bm25List: RankedChunk[] = bm25Results.map((row: any) => ({
    id: row.id,
    content: row.content,
    document_id: row.document_id,
    score: Number(row.score ?? 0),
    type: 'bm25',
  }));
  const fused = rrf([vectorList, bm25List, graphChunks]).slice(0, topK);
  profile.timing_ms.fusion = nowMs() - fusionStart;
  profile.hit_counts.fused = fused.length;

  const generationStart = nowMs();
  let answer = 'No answer generated.';
  const citations: string[] = [];
  if (genAI && fused.length > 0) {
    const context = fused
      .slice(0, 6)
      .map((row, index) => `[${index + 1}] ${row.content}`)
      .join('\n\n');

    const prompt = `Use context to answer the query with citations like [1], [2].
Query: ${query}

Context:
${context}
`;

    try {
      const model = genAI.getGenerativeModel({ model: GENERATION_MODEL });
      const result = await model.generateContent(prompt);
      answer = result.response.text();
      const matches = answer.match(/\[(\d+)\]/g) ?? [];
      citations.push(...new Set(matches));
      profile.model.used_generation = true;
    } catch (error) {
      observability.error('GraphRAG answer generation failed', {
        error,
        workspace_id: workspaceId,
      });
      answer = context;
    }
  } else if (fused.length > 0) {
    answer = fused.slice(0, 3).map((row) => row.content).join('\n');
  }
  profile.timing_ms.generation = nowMs() - generationStart;
  profile.timing_ms.total = nowMs() - totalStart;

  recordProfileMetrics(workspaceId, profile);
  observability.info('GraphRAG query finished', {
    workspace_id: workspaceId,
    top_k: topK,
    timing_ms: profile.timing_ms,
    hit_counts: profile.hit_counts,
  });

  const response: GraphRAGResult = {
    answer,
    sources: fused.map((row) => ({
      content: row.content,
      document_id: row.document_id,
      score: row.rrf_score,
      type: row.type,
    })),
    entities: entityResults.map((row: any) => ({
      id: row.id,
      name: row.name,
      entity_type: row.entity_type,
    })),
    citations,
  };

  if (options.includeProfile) {
    response.debug = { profile };
  }

  return response;
}
