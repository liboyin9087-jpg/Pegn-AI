import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from '../db/client.js';
import type { DocumentIndexStatus } from '../models/document.js';
import {
  appendJobEvent,
  createJob,
  failJob,
  isCancelRequested,
  markCancelled,
  startJob,
  succeedJob,
  type JobRecord,
  type JobStatus,
  type JobTriggeredVia,
  type JobType,
} from './jobService.js';
import { createDocumentTarget, createOperationsTarget, type SurfaceLinkTarget } from './surfaceTargets.js';

const DEFAULT_SNIPPET = 'This result does not have a preview available.';
const SNIPPET_WINDOW = 96;
const HIGHLIGHT_WINDOW = 72;
const MAX_HIGHLIGHTS = 3;

export interface SearchHighlight {
  field: 'title' | 'content' | 'source' | 'type';
  text: string;
}

export interface SearchFacetBucket {
  value: string;
  count: number;
}

export interface SearchResultItem {
  documentId: string;
  blockId?: string | null;
  title: string;
  type: string;
  source: string;
  snippet: string;
  highlights: SearchHighlight[];
  matchedFields: Array<'title' | 'content' | 'source' | 'type'>;
  indexedAt: string | null;
  updatedAt: string;
  isStale: boolean;
  staleReason: 'document_updated_after_index' | 'document_marked_stale' | 'index_failed' | 'not_indexed' | null;
  score: number;
  documentTarget: SurfaceLinkTarget;
  traceTarget?: SurfaceLinkTarget | null;
}

export interface SearchResponse {
  items: SearchResultItem[];
  total: number;
  query: string;
  normalizedQuery: string;
  filtersApplied: {
    type: string | null;
    source: string | null;
    updatedFrom: string | null;
    updatedTo: string | null;
    limit: number;
  };
  facets: {
    byType: SearchFacetBucket[];
    bySource: SearchFacetBucket[];
  };
  nextCursor: string | null;
  durationMs: number;
}

export interface SearchIndexStatusSummary {
  totalDocuments: number;
  pendingDocuments: number;
  indexedDocuments: number;
  staleDocuments: number;
  failedDocuments: number;
  lastIndexedAt: string | null;
}

export interface SearchJobDispatchResult {
  jobId: string;
  status: JobStatus;
}

export interface SearchQueryOptions {
  query: string;
  workspaceId: string;
  type?: string | null;
  source?: string | null;
  updatedFrom?: string | null;
  updatedTo?: string | null;
  limit?: number;
  cursor?: string | null;
}

export interface SearchOptions {
  query: string;
  workspaceId?: string;
  limit?: number;
  offset?: number;
  filters?: {
    blockType?: string;
    dateFrom?: string;
    dateTo?: string;
    properties?: Record<string, unknown>;
    type?: string;
    source?: string;
    updatedFrom?: string;
    updatedTo?: string;
  };
  hybrid?: boolean;
  vectorWeight?: number;
}

export interface LegacySearchResult {
  document_id: string;
  document_title: string;
  block_id?: string | null;
  content: string;
  title?: string;
  score: number;
  metadata: Record<string, unknown>;
  created_at: Date;
}

type DocumentIndexUpdate = {
  index_status?: DocumentIndexStatus;
  last_indexed_at?: Date | null;
  index_error?: string | null;
};

interface DocumentReindexOptions {
  triggeredBy?: string | null;
  triggeredVia?: JobTriggeredVia;
  retryOfJobId?: string | null;
  correlationId?: string | null;
  jobType?: JobType;
  metadata?: Record<string, unknown>;
}

interface RankedSearchRow {
  document_id: string;
  document_title: string | null;
  document_type: string | null;
  document_source: string | null;
  block_id: string | null;
  content: string | null;
  block_title: string | null;
  metadata: Record<string, unknown> | null;
  indexed_at: Date | null;
  document_updated_at: Date;
  document_index_status: DocumentIndexStatus;
  score: string | number;
}

type SearchField = 'title' | 'content' | 'source' | 'type';

function normalizeQueryValue(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

function tokenizeQuery(query: string): string[] {
  return normalizeQueryValue(query)
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeFacetValue(value: string | null | undefined): string {
  if (!value || !value.trim()) return 'unknown';
  return value.trim();
}

function buildCursor(offset: number): string | null {
  if (!Number.isFinite(offset) || offset <= 0) return null;
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function parseCursor(cursor?: string | null): number {
  if (!cursor) return 0;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    return typeof decoded?.offset === 'number' && decoded.offset >= 0 ? decoded.offset : 0;
  } catch {
    return 0;
  }
}

function buildPreviewWindow(text: string, startIndex: number, windowSize: number): string {
  if (!text) return '';
  const normalizedStart = Math.max(0, startIndex);
  const left = Math.max(0, normalizedStart - Math.floor(windowSize / 2));
  const right = Math.min(text.length, normalizedStart + Math.ceil(windowSize / 2));
  const prefix = left > 0 ? '...' : '';
  const suffix = right < text.length ? '...' : '';
  return `${prefix}${text.slice(left, right).trim()}${suffix}`.trim();
}

export function buildSearchSnippet(content: string | null | undefined, title: string, tokens: string[]): string {
  const safeContent = (content ?? '').trim();
  if (safeContent) {
    const haystack = safeContent.toLowerCase();
    const firstMatch = tokens
      .map((token) => haystack.indexOf(token))
      .filter((index) => index >= 0)
      .sort((a, b) => a - b)[0];
    if (firstMatch !== undefined) {
      return buildPreviewWindow(safeContent, firstMatch, SNIPPET_WINDOW);
    }
    return buildPreviewWindow(safeContent, 0, SNIPPET_WINDOW);
  }

  if (title.trim()) {
    return title.trim();
  }

  return DEFAULT_SNIPPET;
}

export function buildHighlights(params: {
  title: string;
  content: string;
  type: string;
  source: string;
  tokens: string[];
}): SearchHighlight[] {
  const fields: Array<{ field: SearchField; value: string }> = [
    { field: 'title', value: params.title },
    { field: 'content', value: params.content },
    { field: 'source', value: params.source },
    { field: 'type', value: params.type },
  ];

  const highlights: SearchHighlight[] = [];
  for (const token of params.tokens) {
    for (const field of fields) {
      if (!field.value) continue;
      const matchIndex = field.value.toLowerCase().indexOf(token);
      if (matchIndex < 0) continue;
      highlights.push({
        field: field.field,
        text: buildPreviewWindow(field.value, matchIndex, HIGHLIGHT_WINDOW),
      });
      if (highlights.length >= MAX_HIGHLIGHTS) {
        return highlights;
      }
    }
  }
  return highlights;
}

export function collectMatchedFields(params: {
  title: string;
  content: string;
  type: string;
  source: string;
  tokens: string[];
}): SearchField[] {
  const fields: Array<{ field: SearchField; value: string }> = [
    { field: 'title', value: params.title },
    { field: 'content', value: params.content },
    { field: 'source', value: params.source },
    { field: 'type', value: params.type },
  ];

  const matched = new Set<SearchField>();
  for (const field of fields) {
    const lowerValue = field.value.toLowerCase();
    if (params.tokens.some((token) => lowerValue.includes(token))) {
      matched.add(field.field);
    }
  }
  return [...matched];
}

export function computeFreshnessMetadata(params: {
  indexedAt: Date | null;
  updatedAt: Date;
  indexStatus: DocumentIndexStatus;
}): Pick<SearchResultItem, 'indexedAt' | 'updatedAt' | 'isStale' | 'staleReason'> {
  const indexedAtIso = params.indexedAt ? params.indexedAt.toISOString() : null;
  const updatedAtIso = params.updatedAt.toISOString();

  if (params.indexStatus === 'failed') {
    return {
      indexedAt: indexedAtIso,
      updatedAt: updatedAtIso,
      isStale: true,
      staleReason: 'index_failed',
    };
  }

  if (params.indexStatus === 'stale') {
    return {
      indexedAt: indexedAtIso,
      updatedAt: updatedAtIso,
      isStale: true,
      staleReason: 'document_marked_stale',
    };
  }

  if (!params.indexedAt) {
    return {
      indexedAt: null,
      updatedAt: updatedAtIso,
      isStale: true,
      staleReason: 'not_indexed',
    };
  }

  if (params.updatedAt.getTime() > params.indexedAt.getTime()) {
    return {
      indexedAt: indexedAtIso,
      updatedAt: updatedAtIso,
      isStale: true,
      staleReason: 'document_updated_after_index',
    };
  }

  return {
    indexedAt: indexedAtIso,
    updatedAt: updatedAtIso,
    isStale: false,
    staleReason: null,
  };
}

function buildFacetSql(
  facetField: 'type' | 'source',
  options: SearchQueryOptions,
  normalizedQuery: string
): { sql: string; params: unknown[] } {
  const params: unknown[] = [options.workspaceId, normalizedQuery, `%${normalizedQuery}%`];
  const conditions = [
    `d.workspace_id = $1`,
    `(
      to_tsvector('english', concat_ws(' ', d.title, si.content, COALESCE(d.type, ''), COALESCE(d.source, '')))
      @@ plainto_tsquery('english', $2)
      OR d.title ILIKE $3
      OR COALESCE(si.content, '') ILIKE $3
      OR COALESCE(d.type, '') ILIKE $3
      OR COALESCE(d.source, '') ILIKE $3
    )`,
  ];
  let paramIndex = 4;

  if (facetField !== 'type' && options.type) {
    if (options.type === 'unknown') {
      conditions.push(`COALESCE(NULLIF(d.type, ''), 'unknown') = 'unknown'`);
    } else {
      conditions.push(`d.type = $${paramIndex++}`);
      params.push(options.type);
    }
  }

  if (facetField !== 'source' && options.source) {
    if (options.source === 'unknown') {
      conditions.push(`COALESCE(NULLIF(d.source, ''), 'unknown') = 'unknown'`);
    } else {
      conditions.push(`d.source = $${paramIndex++}`);
      params.push(options.source);
    }
  }

  if (options.updatedFrom) {
    conditions.push(`d.updated_at >= $${paramIndex++}::timestamptz`);
    params.push(options.updatedFrom);
  }
  if (options.updatedTo) {
    conditions.push(`d.updated_at <= $${paramIndex++}::timestamptz`);
    params.push(options.updatedTo);
  }

  const column = facetField === 'type' ? 'd.type' : 'd.source';
  return {
    sql: `
      SELECT
        COALESCE(NULLIF(${column}, ''), 'unknown') AS value,
        COUNT(DISTINCT d.id)::int AS count
      FROM search_index si
      JOIN documents d ON d.id = si.document_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY COALESCE(NULLIF(${column}, ''), 'unknown')
      ORDER BY count DESC, value ASC
    `,
    params,
  };
}

export class SearchService {
  private defaultVectorWeight = 0.5;

  private async createIndexJob(
    documentId: string,
    workspaceId: string,
    options: DocumentReindexOptions = {}
  ) {
    return createJob({
      workspaceId,
      jobType: options.jobType ?? 'document_reindex',
      resourceType: 'document',
      resourceId: documentId,
      sourceDomain: 'search',
      triggeredBy: options.triggeredBy ?? null,
      triggeredVia: options.triggeredVia ?? 'system',
      retryOfJobId: options.retryOfJobId ?? null,
      correlationId: options.correlationId ?? null,
      metadata: options.metadata ?? {},
    });
  }

  private async abortIfCancelled(jobId: string, workspaceId: string): Promise<void> {
    if (!(await isCancelRequested(jobId, workspaceId))) return;
    await markCancelled(jobId, workspaceId, { reason: 'cancel_requested' });
    throw new Error('JOB_CANCELLED');
  }

  async searchWorkspaceDocuments(options: SearchQueryOptions): Promise<SearchResponse> {
    if (!pool) {
      throw new Error('Database not available');
    }

    const startTime = Date.now();
    const query = options.query;
    const normalizedQuery = normalizeQueryValue(query);
    const limit = Math.max(1, Math.min(50, options.limit ?? 10));
    const offset = parseCursor(options.cursor);
    const tokens = tokenizeQuery(query);

    const params: unknown[] = [options.workspaceId, normalizedQuery, `%${normalizedQuery}%`];
    const conditions = [
      `d.workspace_id = $1`,
      `(
        to_tsvector('english', concat_ws(' ', d.title, si.content, COALESCE(d.type, ''), COALESCE(d.source, '')))
        @@ plainto_tsquery('english', $2)
        OR d.title ILIKE $3
        OR COALESCE(si.content, '') ILIKE $3
        OR COALESCE(d.type, '') ILIKE $3
        OR COALESCE(d.source, '') ILIKE $3
      )`,
    ];
    let paramIndex = 4;

    if (options.type) {
      if (options.type === 'unknown') {
        conditions.push(`COALESCE(NULLIF(d.type, ''), 'unknown') = 'unknown'`);
      } else {
        conditions.push(`d.type = $${paramIndex++}`);
        params.push(options.type);
      }
    }

    if (options.source) {
      if (options.source === 'unknown') {
        conditions.push(`COALESCE(NULLIF(d.source, ''), 'unknown') = 'unknown'`);
      } else {
        conditions.push(`d.source = $${paramIndex++}`);
        params.push(options.source);
      }
    }

    if (options.updatedFrom) {
      conditions.push(`d.updated_at >= $${paramIndex++}::timestamptz`);
      params.push(options.updatedFrom);
    }
    if (options.updatedTo) {
      conditions.push(`d.updated_at <= $${paramIndex++}::timestamptz`);
      params.push(options.updatedTo);
    }

    const whereSql = conditions.join(' AND ');
    const scoreSql = `
      ts_rank(
        to_tsvector('english', concat_ws(' ', d.title, si.content, COALESCE(d.type, ''), COALESCE(d.source, ''))),
        plainto_tsquery('english', $2)
      )
      + CASE WHEN d.title ILIKE $3 THEN 0.35 ELSE 0 END
      + CASE WHEN COALESCE(d.type, '') ILIKE $3 THEN 0.1 ELSE 0 END
      + CASE WHEN COALESCE(d.source, '') ILIKE $3 THEN 0.1 ELSE 0 END
    `;

    const resultRows = await pool.query<RankedSearchRow>(
      `
        SELECT
          si.document_id,
          d.title AS document_title,
          d.type AS document_type,
          d.source AS document_source,
          si.block_id::text AS block_id,
          si.content,
          si.title AS block_title,
          si.metadata,
          COALESCE(si.indexed_at, si.updated_at, si.created_at) AS indexed_at,
          d.updated_at AS document_updated_at,
          d.index_status AS document_index_status,
          ${scoreSql} AS score
        FROM search_index si
        JOIN documents d ON d.id = si.document_id
        WHERE ${whereSql}
        ORDER BY score DESC, d.updated_at DESC, si.document_id ASC, COALESCE(si.block_id::text, '') ASC
        LIMIT $${paramIndex++} OFFSET $${paramIndex++}
      `,
      [...params, limit + 1, offset]
    );

    const countResult = await pool.query<{ total: string }>(
      `
        SELECT COUNT(*)::text AS total
        FROM search_index si
        JOIN documents d ON d.id = si.document_id
        WHERE ${whereSql}
      `,
      params
    );

    const [typeFacets, sourceFacets] = await Promise.all([
      this.buildSearchFacets('type', options, normalizedQuery),
      this.buildSearchFacets('source', options, normalizedQuery),
    ]);

    const rows = resultRows.rows.slice(0, limit);
    const items = rows.map((row) => {
      const title = row.document_title?.trim() || row.block_title?.trim() || 'Untitled document';
      const type = normalizeFacetValue(row.document_type);
      const source = normalizeFacetValue(row.document_source);
      const content = (row.content ?? '').trim();
      const matchedFields = collectMatchedFields({
        title,
        content,
        type,
        source,
        tokens,
      });
      const highlights = buildHighlights({
        title,
        content,
        type,
        source,
        tokens,
      });
      const snippet = buildSearchSnippet(content, title, tokens);
      const freshness = computeFreshnessMetadata({
        indexedAt: row.indexed_at,
        updatedAt: row.document_updated_at,
        indexStatus: row.document_index_status,
      });

      return {
        documentId: row.document_id,
        blockId: row.block_id,
        title,
        type,
        source,
        snippet,
        highlights,
        matchedFields,
        indexedAt: freshness.indexedAt,
        updatedAt: freshness.updatedAt,
        isStale: freshness.isStale,
        staleReason: freshness.staleReason,
        score: typeof row.score === 'number' ? row.score : parseFloat(row.score),
        documentTarget: createDocumentTarget({
          documentId: row.document_id,
        }),
        traceTarget: freshness.isStale
          ? createOperationsTarget({
              jobType: freshness.staleReason === 'index_failed' ? 'document_index' : 'document_reindex',
              resourceType: 'document',
              resourceId: row.document_id,
              filter: freshness.staleReason ?? 'stale',
            })
          : null,
      } satisfies SearchResultItem;
    });

    return {
      items,
      total: parseInt(countResult.rows[0]?.total ?? '0', 10),
      query,
      normalizedQuery,
      filtersApplied: {
        type: options.type ?? null,
        source: options.source ?? null,
        updatedFrom: options.updatedFrom ?? null,
        updatedTo: options.updatedTo ?? null,
        limit,
      },
      facets: {
        byType: typeFacets,
        bySource: sourceFacets,
      },
      nextCursor: resultRows.rows.length > limit ? buildCursor(offset + limit) : null,
      durationMs: Date.now() - startTime,
    };
  }

  async buildSearchFacets(
    facetField: 'type' | 'source',
    options: SearchQueryOptions,
    normalizedQuery: string
  ): Promise<SearchFacetBucket[]> {
    if (!pool) return [];
    const { sql, params } = buildFacetSql(facetField, options, normalizedQuery);
    const result = await pool.query<{ value: string; count: number | string }>(sql, params);
    return result.rows.map((row) => ({
      value: normalizeFacetValue(row.value),
      count: typeof row.count === 'number' ? row.count : parseInt(row.count, 10),
    }));
  }

  async search(options: SearchOptions): Promise<{ results: LegacySearchResult[]; total: number }> {
    if (!options.workspaceId) {
      throw new Error('workspaceId is required');
    }

    const response = await this.searchWorkspaceDocuments({
      query: options.query,
      workspaceId: options.workspaceId,
      type: options.filters?.type ?? null,
      source: options.filters?.source ?? null,
      updatedFrom: options.filters?.updatedFrom ?? options.filters?.dateFrom ?? null,
      updatedTo: options.filters?.updatedTo ?? options.filters?.dateTo ?? null,
      limit: options.limit,
      cursor: options.offset ? buildCursor(options.offset) : null,
    });

    return {
      results: response.items.map((item) => ({
        document_id: item.documentId,
        document_title: item.title,
        block_id: item.blockId,
        content: item.snippet,
        title: item.title,
        score: item.score,
        metadata: {
          type: item.type,
          source: item.source,
          matchedFields: item.matchedFields,
          indexedAt: item.indexedAt,
          updatedAt: item.updatedAt,
          isStale: item.isStale,
          staleReason: item.staleReason,
        },
        created_at: new Date(item.updatedAt),
      })),
      total: response.total,
    };
  }

  private async getQueryEmbedding(query: string): Promise<number[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Array(768).fill(0);
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
      const result = await model.embedContent(query);
      return result.embedding.values;
    } catch {
      return new Array(768).fill(0);
    }
  }

  private hasVectorSupport(): boolean {
    return true;
  }

  private async updateDocumentIndexState(
    documentId: string,
    workspaceId: string,
    updates: DocumentIndexUpdate
  ): Promise<void> {
    const p = pool;
    if (!p) return;

    const fields: string[] = [];
    const values: Array<string | Date | null> = [];
    let paramIndex = 1;

    if (updates.index_status !== undefined) {
      fields.push(`index_status = $${paramIndex++}`);
      values.push(updates.index_status);
    }
    if (updates.last_indexed_at !== undefined) {
      fields.push(`last_indexed_at = $${paramIndex++}`);
      values.push(updates.last_indexed_at);
    }
    if (updates.index_error !== undefined) {
      fields.push(`index_error = $${paramIndex++}`);
      values.push(updates.index_error);
    }

    if (fields.length === 0) return;

    values.push(documentId, workspaceId);
    await p.query(
      `UPDATE documents
       SET ${fields.join(', ')}
       WHERE id = $${paramIndex++}
         AND workspace_id = $${paramIndex}`,
      values
    );
  }

  async getSuggestions(query: string, workspaceId?: string, limit = 5): Promise<string[]> {
    const p = pool;
    if (!p) return [];

    const whereConditions = ['si.content ILIKE $1'];
    const params: unknown[] = [`%${query}%`];
    let paramIndex = 2;

    if (workspaceId) {
      whereConditions.push(`d.workspace_id = $${paramIndex++}`);
      params.push(workspaceId);
    }

    const result = await p.query<{ suggestion: string }>(
      `
        SELECT DISTINCT LEFT(si.content, 100) AS suggestion
        FROM search_index si
        JOIN documents d ON si.document_id = d.id
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY suggestion ASC
        LIMIT $${paramIndex}
      `,
      [...params, limit]
    );

    return result.rows.map((row) => row.suggestion);
  }

  async markDocumentIndexStale(documentId: string, workspaceId: string): Promise<void> {
    const p = pool;
    if (!p) return;

    await p.query(
      `UPDATE documents
       SET index_status = CASE
         WHEN index_status = 'pending' THEN 'pending'
         ELSE 'stale'
       END,
       index_error = NULL
       WHERE id = $1
         AND workspace_id = $2`,
      [documentId, workspaceId]
    );
  }

  async markDocumentIndexFailed(documentId: string, workspaceId: string, errorMessage?: string): Promise<void> {
    await this.updateDocumentIndexState(documentId, workspaceId, {
      index_status: 'failed',
      index_error: errorMessage?.slice(0, 1000) ?? 'Document indexing failed',
    });
  }

  async markDocumentIndexed(documentId: string, workspaceId: string): Promise<void> {
    await this.updateDocumentIndexState(documentId, workspaceId, {
      index_status: 'indexed',
      last_indexed_at: new Date(),
      index_error: null,
    });
  }

  async enqueueDocumentReindex(
    documentId: string,
    workspaceId: string,
    options: DocumentReindexOptions = {}
  ): Promise<SearchJobDispatchResult> {
    const job = await this.createIndexJob(documentId, workspaceId, options);

    void Promise.resolve()
      .then(async () => {
        await this.processDocumentReindex(documentId, workspaceId, job);
      })
      .catch((error) => {
        console.error(`[search] Failed background reindex for document ${documentId}:`, error);
      });

    return { jobId: job.id, status: job.status };
  }

  async cleanupDocumentIndex(documentId: string, workspaceId: string): Promise<void> {
    const p = pool;
    if (!p) return;

    await p.query(
      `DELETE FROM search_index si
       USING documents d
       WHERE si.document_id = d.id
         AND d.id = $1
         AND d.workspace_id = $2`,
      [documentId, workspaceId]
    );
  }

  async getIndexStatusSummary(workspaceId: string): Promise<SearchIndexStatusSummary> {
    const p = pool;
    if (!p) {
      return {
        totalDocuments: 0,
        pendingDocuments: 0,
        indexedDocuments: 0,
        staleDocuments: 0,
        failedDocuments: 0,
        lastIndexedAt: null,
      };
    }

    const result = await p.query<{
      total_documents: string;
      pending_documents: string;
      indexed_documents: string;
      stale_documents: string;
      failed_documents: string;
      last_indexed_at: Date | null;
    }>(
      `SELECT
         COUNT(*) AS total_documents,
         COUNT(*) FILTER (WHERE index_status = 'pending') AS pending_documents,
         COUNT(*) FILTER (WHERE index_status = 'indexed') AS indexed_documents,
         COUNT(*) FILTER (WHERE index_status = 'stale') AS stale_documents,
         COUNT(*) FILTER (WHERE index_status = 'failed') AS failed_documents,
         MAX(last_indexed_at) AS last_indexed_at
       FROM documents
       WHERE workspace_id = $1`,
      [workspaceId]
    );

    const row = result.rows[0];
    return {
      totalDocuments: parseInt(row?.total_documents ?? '0', 10),
      pendingDocuments: parseInt(row?.pending_documents ?? '0', 10),
      indexedDocuments: parseInt(row?.indexed_documents ?? '0', 10),
      staleDocuments: parseInt(row?.stale_documents ?? '0', 10),
      failedDocuments: parseInt(row?.failed_documents ?? '0', 10),
      lastIndexedAt: row?.last_indexed_at ? row.last_indexed_at.toISOString() : null,
    };
  }

  async retryDocumentJob(
    job: Pick<JobRecord, 'id' | 'workspaceId' | 'resourceId' | 'metadata'>,
    userId: string
  ): Promise<SearchJobDispatchResult> {
    if (!job.resourceId) {
      throw new Error('Document retry job is missing resource_id');
    }
    return this.enqueueDocumentReindex(job.resourceId, job.workspaceId, {
      triggeredBy: userId,
      triggeredVia: 'manual',
      retryOfJobId: job.id,
      correlationId: job.id,
      jobType: 'document_reindex',
      metadata: job.metadata,
    });
  }

  async reindexDocument(
    documentId: string,
    workspaceId?: string,
    options: DocumentReindexOptions = {}
  ): Promise<SearchJobDispatchResult> {
    if (!workspaceId) {
      throw new Error('workspaceId is required');
    }
    return this.enqueueDocumentReindex(documentId, workspaceId, options);
  }

  private async processDocumentReindex(
    documentId: string,
    workspaceId: string,
    job: JobRecord
  ): Promise<void> {
    const p = pool;
    if (!p) return;

    try {
      await this.abortIfCancelled(job.id, workspaceId);
      await startJob(job.id, workspaceId);
      await appendJobEvent({
        jobId: job.id,
        eventType: 'progress',
        message: 'Loading document content for indexing',
        payload: { phase: 'load_document', documentId },
      });

      const docResult = await p.query<{
        title: string;
        properties: Record<string, unknown> | null;
        workspace_id: string;
        type: string | null;
        source: string | null;
      }>(
        `SELECT title, properties, workspace_id, type, source
         FROM documents
         WHERE id = $1
           AND workspace_id = $2`,
        [documentId, workspaceId]
      );

      if (docResult.rowCount === 0) {
        await failJob(job.id, workspaceId, {
          errorCode: 'document_not_found',
          errorSummary: 'Document not found for indexing',
        });
        return;
      }

      const { title, properties, workspace_id, type, source } = docResult.rows[0];
      await appendJobEvent({
        jobId: job.id,
        eventType: 'progress',
        message: 'Generating search embedding',
        payload: { phase: 'embedding', documentTitle: title },
      });
      await this.abortIfCancelled(job.id, workspace_id);

      const propertyTextSegments: string[] = [];
      if (properties && typeof properties === 'object') {
        for (const [key, value] of Object.entries(properties)) {
          if (typeof value === 'string') {
            propertyTextSegments.push(`${key}: ${value}`);
          } else if (Array.isArray(value)) {
            propertyTextSegments.push(`${key}: ${value.join(', ')}`);
          } else if (value && typeof value === 'object' && 'name' in value) {
            propertyTextSegments.push(`${key}: ${String((value as { name: unknown }).name)}`);
          }
        }
      }

      const combinedContent = [title, type, source, ...propertyTextSegments].filter(Boolean).join('\n');
      const embedding = await this.getQueryEmbedding(combinedContent);

      await appendJobEvent({
        jobId: job.id,
        eventType: 'progress',
        message: 'Persisting search index entry',
        payload: { phase: 'persist_index', contentLength: combinedContent.length },
      });
      await this.abortIfCancelled(job.id, workspace_id);

      await p.query(
        `INSERT INTO search_index (document_id, block_id, content, content_vector, title, metadata, indexed_at)
         VALUES ($1, NULL, $2, $3, $4, $5, NOW())
         ON CONFLICT (document_id, block_id) WHERE block_id IS NULL
         DO UPDATE SET
           content = EXCLUDED.content,
           content_vector = EXCLUDED.content_vector,
           title = EXCLUDED.title,
           metadata = EXCLUDED.metadata,
           indexed_at = NOW(),
           updated_at = NOW()`,
        [
          documentId,
          combinedContent,
          embedding,
          'document',
          { workspace_id, type: normalizeFacetValue(type), source: normalizeFacetValue(source) },
        ]
      );

      await this.markDocumentIndexed(documentId, workspace_id);
      await succeedJob(job.id, workspace_id, {
        ...job.metadata,
        documentTitle: title,
        indexedAt: new Date().toISOString(),
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'JOB_CANCELLED') {
        return;
      }

      const message = error instanceof Error ? error.message : 'Document indexing failed';
      await this.markDocumentIndexFailed(documentId, workspaceId, message);
      await failJob(job.id, workspaceId, {
        errorCode: 'indexing_failed',
        errorSummary: message.slice(0, 240),
      }).catch(() => undefined);
      throw error;
    }
  }
}

export const searchService = new SearchService();
