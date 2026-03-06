import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from '../db/client.js';
import type { DocumentIndexStatus } from '../models/document.js';

export interface SearchResult {
  document_id: string;
  document_title: string;
  block_id?: string;
  content: string;
  title?: string;
  score: number;
  metadata: Record<string, any>;
  created_at: Date;
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
    properties?: Record<string, any>;
  };
  hybrid?: boolean;
  vectorWeight?: number;
}

export interface SearchIndexStatusSummary {
  totalDocuments: number;
  pendingDocuments: number;
  indexedDocuments: number;
  staleDocuments: number;
  failedDocuments: number;
  lastIndexedAt: string | null;
}

type DocumentIndexUpdate = {
  index_status?: DocumentIndexStatus;
  last_indexed_at?: Date | null;
  index_error?: string | null;
};

export class SearchService {
  private defaultVectorWeight = 0.5;

  async search(options: SearchOptions): Promise<{ results: SearchResult[]; total: number }> {
    if (!pool) {
      throw new Error('Database not available');
    }

    const {
      query,
      workspaceId,
      limit = 20,
      offset = 0,
      filters,
      hybrid = true,
      vectorWeight = this.defaultVectorWeight,
    } = options;

    try {
      if (hybrid && this.hasVectorSupport()) {
        return this.hybridSearch(query, workspaceId, limit, offset, filters, vectorWeight);
      }
      return this.bm25Search(query, workspaceId, limit, offset, filters);
    } catch (error) {
      console.error('[search] Search failed:', error);
      throw error;
    }
  }

  private async hybridSearch(
    query: string,
    workspaceId: string | undefined,
    limit: number,
    offset: number,
    filters: SearchOptions['filters'],
    vectorWeight: number
  ): Promise<{ results: SearchResult[]; total: number }> {
    const p = pool;
    if (!p) return { results: [], total: 0 };
    const bm25Weight = 1 - vectorWeight;

    const whereConditions: string[] = [];
    const whereValues: any[] = [];
    let paramIndex = 7;

    if (workspaceId) {
      whereConditions.push(`d.workspace_id = $${paramIndex++}`);
      whereValues.push(workspaceId);
    }

    if (filters?.blockType) {
      whereConditions.push(`si.title = $${paramIndex++}`);
      whereValues.push(filters.blockType);
    }

    if (filters?.dateFrom) {
      whereConditions.push(`si.created_at >= $${paramIndex++}`);
      whereValues.push(filters.dateFrom);
    }

    if (filters?.dateTo) {
      whereConditions.push(`si.created_at <= $${paramIndex++}`);
      whereValues.push(filters.dateTo);
    }

    if (filters?.properties) {
      for (const [key, value] of Object.entries(filters.properties)) {
        const keyIndex = paramIndex++;
        const valueIndex = paramIndex++;
        whereConditions.push(`d.properties->>$${keyIndex} = $${valueIndex}`);
        whereValues.push(key, value);
      }
    }

    const whereClause = whereConditions.length > 0 ? `AND ${whereConditions.join(' AND ')}` : '';
    const queryEmbedding = await this.getQueryEmbedding(query);
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    const searchQuery = `
      WITH bm25_rank AS (
        SELECT
          si.document_id,
          si.block_id,
          si.content,
          si.title,
          si.metadata,
          si.created_at,
          d.title AS document_title,
          ts_rank(to_tsvector('english', si.content), plainto_tsquery('english', $1)) AS bm25_score
        FROM search_index si
        JOIN documents d ON si.document_id = d.id
        WHERE to_tsvector('english', si.content) @@ plainto_tsquery('english', $1)
        ${whereClause}
      ),
      vector_rank AS (
        SELECT
          si.document_id,
          si.block_id,
          si.content,
          si.title,
          si.metadata,
          si.created_at,
          d.title AS document_title,
          1 - (si.content_vector <=> $2::vector) AS vector_score
        FROM search_index si
        JOIN documents d ON si.document_id = d.id
        WHERE si.content_vector IS NOT NULL
        ${whereClause}
      )
      SELECT
        COALESCE(b.document_id, v.document_id) AS document_id,
        COALESCE(b.document_title, v.document_title) AS document_title,
        COALESCE(b.block_id, v.block_id) AS block_id,
        COALESCE(b.content, v.content) AS content,
        COALESCE(b.title, v.title) AS title,
        COALESCE(b.metadata, v.metadata) AS metadata,
        COALESCE(b.created_at, v.created_at) AS created_at,
        (COALESCE(b.bm25_score, 0) * $3 + COALESCE(v.vector_score, 0) * $4) AS score
      FROM bm25_rank b
      FULL OUTER JOIN vector_rank v ON (
        b.document_id = v.document_id AND
        (b.block_id IS NULL AND v.block_id IS NULL OR b.block_id = v.block_id)
      )
      WHERE COALESCE(b.bm25_score, 0) > 0 OR COALESCE(v.vector_score, 0) > 0
      ORDER BY score DESC
      LIMIT $5 OFFSET $6
    `;

    const params: any[] = [query, embeddingStr, bm25Weight, vectorWeight, limit, offset, ...whereValues];
    const result = await p.query(searchQuery, params);

    const countConditions: string[] = [];
    const countValues: any[] = [query];
    let countIndex = 2;

    if (workspaceId) {
      countConditions.push(`d.workspace_id = $${countIndex++}`);
      countValues.push(workspaceId);
    }
    if (filters?.blockType) {
      countConditions.push(`si.title = $${countIndex++}`);
      countValues.push(filters.blockType);
    }
    if (filters?.dateFrom) {
      countConditions.push(`si.created_at >= $${countIndex++}`);
      countValues.push(filters.dateFrom);
    }
    if (filters?.dateTo) {
      countConditions.push(`si.created_at <= $${countIndex++}`);
      countValues.push(filters.dateTo);
    }
    const countWhereClause = countConditions.length > 0 ? `AND ${countConditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(DISTINCT si.document_id) AS total
      FROM search_index si
      JOIN documents d ON si.document_id = d.id
      WHERE (to_tsvector('english', si.content) @@ plainto_tsquery('english', $1) OR si.content_vector IS NOT NULL)
      ${countWhereClause}
    `;

    const countResult = await p.query(countQuery, countValues);

    return {
      results: result.rows.map((row: any) => ({
        document_id: row.document_id,
        document_title: row.document_title,
        block_id: row.block_id,
        content: row.content,
        title: row.title,
        score: parseFloat(row.score),
        metadata: row.metadata || {},
        created_at: row.created_at,
      })),
      total: parseInt(countResult.rows[0].total, 10),
    };
  }

  private async bm25Search(
    query: string,
    workspaceId: string | undefined,
    limit: number,
    offset: number,
    filters: SearchOptions['filters']
  ): Promise<{ results: SearchResult[]; total: number }> {
    const p = pool;
    if (!p) return { results: [], total: 0 };

    const whereConditions = [`to_tsvector('english', si.content) @@ plainto_tsquery('english', $1)`];
    const params: any[] = [query];
    let paramIndex = 2;

    if (workspaceId) {
      whereConditions.push(`d.workspace_id = $${paramIndex++}`);
      params.push(workspaceId);
    }

    if (filters?.blockType) {
      whereConditions.push(`si.title = $${paramIndex++}`);
      params.push(filters.blockType);
    }

    if (filters?.dateFrom) {
      whereConditions.push(`si.created_at >= $${paramIndex++}`);
      params.push(filters.dateFrom);
    }

    if (filters?.dateTo) {
      whereConditions.push(`si.created_at <= $${paramIndex++}`);
      params.push(filters.dateTo);
    }

    if (filters?.properties) {
      for (const [key, value] of Object.entries(filters.properties)) {
        whereConditions.push(`d.properties->>$${paramIndex++} = $${paramIndex++}`);
        params.push(key, value);
      }
    }

    const searchQuery = `
      SELECT
        si.document_id,
        d.title AS document_title,
        si.block_id,
        si.content,
        si.title,
        si.metadata,
        si.created_at,
        ts_rank(to_tsvector('english', si.content), plainto_tsquery('english', $1)) AS score
      FROM search_index si
      JOIN documents d ON si.document_id = d.id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY score DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    params.push(limit, offset);
    const result = await p.query(searchQuery, params);

    const countQuery = `
      SELECT COUNT(DISTINCT si.document_id) AS total
      FROM search_index si
      JOIN documents d ON si.document_id = d.id
      WHERE ${whereConditions.join(' AND ')}
    `;
    const countResult = await p.query(countQuery, params.slice(0, -2));

    return {
      results: result.rows.map((row: any) => ({
        document_id: row.document_id,
        document_title: row.document_title,
        block_id: row.block_id,
        content: row.content,
        title: row.title,
        score: parseFloat(row.score),
        metadata: row.metadata || {},
        created_at: row.created_at,
      })),
      total: parseInt(countResult.rows[0].total, 10),
    };
  }

  private async getQueryEmbedding(query: string): Promise<number[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('[search] GEMINI_API_KEY is not configured; using zero-vector fallback');
      return new Array(768).fill(0);
    }

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
      const result = await model.embedContent(query);
      return result.embedding.values;
    } catch (error) {
      console.error('[search] Failed to generate embedding:', error);
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

    try {
      const whereConditions = ['si.content ILIKE $1'];
      const params = [`%${query}%`];
      let paramIndex = 2;

      if (workspaceId) {
        whereConditions.push(`d.workspace_id = $${paramIndex++}`);
        params.push(workspaceId);
      }

      const suggestionsQuery = `
        SELECT DISTINCT LEFT(si.content, 100) AS suggestion
        FROM search_index si
        JOIN documents d ON si.document_id = d.id
        WHERE ${whereConditions.join(' AND ')}
        ORDER BY si.created_at DESC
        LIMIT $${paramIndex++}
      `;

      params.push(limit.toString());
      const result = await p.query(suggestionsQuery, params);
      return result.rows.map((row: any) => row.suggestion);
    } catch (error) {
      console.error('[search] Failed to get suggestions:', error);
      return [];
    }
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

  async enqueueDocumentReindex(documentId: string, workspaceId: string): Promise<void> {
    await this.reindexDocument(documentId, workspaceId);
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

  async reindexDocument(documentId: string, workspaceId?: string): Promise<void> {
    const p = pool;
    if (!p) return;

    try {
      const docResult = await p.query<{
        title: string;
        properties: Record<string, unknown> | null;
        workspace_id: string;
      }>(
        `SELECT title, properties, workspace_id
         FROM documents
         WHERE id = $1
         ${workspaceId ? 'AND workspace_id = $2' : ''}`,
        workspaceId ? [documentId, workspaceId] : [documentId]
      );

      if (docResult.rowCount === 0) return;

      const { title, properties, workspace_id } = docResult.rows[0];
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

      const combinedContent = [title, ...propertyTextSegments].filter(Boolean).join('\n');
      const embedding = await this.getQueryEmbedding(combinedContent);

      await p.query(
        `INSERT INTO search_index (document_id, block_id, content, content_vector, title, metadata)
         VALUES ($1, NULL, $2, $3, $4, $5)
         ON CONFLICT (document_id, block_id) WHERE block_id IS NULL
         DO UPDATE SET
           content = EXCLUDED.content,
           content_vector = EXCLUDED.content_vector,
           title = EXCLUDED.title,
           metadata = EXCLUDED.metadata,
           updated_at = NOW()`,
        [documentId, combinedContent, embedding, 'document', { workspace_id }]
      );

      await this.markDocumentIndexed(documentId, workspace_id);
      console.log(`[search] Reindexed document ${documentId} with properties`);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Document indexing failed';
      if (workspaceId) {
        await this.markDocumentIndexFailed(documentId, workspaceId, message);
      }
      console.error(`[search] Failed to reindex document ${documentId}:`, error);
      throw error;
    }
  }
}

export const searchService = new SearchService();
