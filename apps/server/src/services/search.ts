import { pool } from '../db/client.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

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
  hybrid?: boolean; // Enable both BM25 and vector search
  vectorWeight?: number; // Weight for vector search (0-1)
}

export class SearchService {
  private defaultVectorWeight = 0.5; // Equal weight for BM25 and vector search

  async search(options: SearchOptions): Promise<{ results: SearchResult[], total: number }> {
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
      vectorWeight = this.defaultVectorWeight
    } = options;

    try {
      if (hybrid && this.hasVectorSupport()) {
        return this.hybridSearch(query, workspaceId, limit, offset, filters, vectorWeight);
      } else {
        return this.bm25Search(query, workspaceId, limit, offset, filters);
      }
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
  ): Promise<{ results: SearchResult[], total: number }> {
    const p = pool;
    if (!p) return { results: [], total: 0 };
    const bm25Weight = 1 - vectorWeight;

    // Fixed params layout for main query:
    // $1=query_string, $2=embedding_vector, $3=bm25Weight, $4=vectorWeight, $5=limit, $6=offset, $7+=where conditions
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
        const k1 = paramIndex++;
        const k2 = paramIndex++;
        whereConditions.push(`d.properties->>$${k1} = $${k2}`);
        whereValues.push(key, value);
      }
    }

    const whereClause = whereConditions.length > 0 ? `AND ${whereConditions.join(' AND ')}` : '';

    const queryEmbedding = await this.getQueryEmbedding(query);
    // Format embedding as pgvector literal string
    const embeddingStr = `[${queryEmbedding.join(',')}]`;

    // Hybrid search query combining BM25 and vector similarity
    const searchQuery = `
      WITH bm25_rank AS (
        SELECT
          si.document_id,
          si.block_id,
          si.content,
          si.title,
          si.metadata,
          si.created_at,
          d.title as document_title,
          ts_rank(to_tsvector('english', si.content), plainto_tsquery('english', $1)) as bm25_score
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
          d.title as document_title,
          1 - (si.content_vector <=> $2::vector) as vector_score
        FROM search_index si
        JOIN documents d ON si.document_id = d.id
        WHERE si.content_vector IS NOT NULL
        ${whereClause}
      )
      SELECT
        COALESCE(b.document_id, v.document_id) as document_id,
        COALESCE(b.document_title, v.document_title) as document_title,
        COALESCE(b.block_id, v.block_id) as block_id,
        COALESCE(b.content, v.content) as content,
        COALESCE(b.title, v.title) as title,
        COALESCE(b.metadata, v.metadata) as metadata,
        COALESCE(b.created_at, v.created_at) as created_at,
        (COALESCE(b.bm25_score, 0) * $3 + COALESCE(v.vector_score, 0) * $4) as score
      FROM bm25_rank b
      FULL OUTER JOIN vector_rank v ON (
        b.document_id = v.document_id AND
        (b.block_id IS NULL AND v.block_id IS NULL OR b.block_id = v.block_id)
      )
      WHERE COALESCE(b.bm25_score, 0) > 0 OR COALESCE(v.vector_score, 0) > 0
      ORDER BY score DESC
      LIMIT $5 OFFSET $6
    `;

    // Params: [$1=query, $2=embedding, $3=bm25Weight, $4=vectorWeight, $5=limit, $6=offset, $7+=where values]
    const params: any[] = [query, embeddingStr, bm25Weight, vectorWeight, limit, offset, ...whereValues];
    const result = await p.query(searchQuery, params);

    // Count query uses its own independent param indexing starting from $1
    const countConditions: string[] = [];
    const countValues: any[] = [query];
    let countIdx = 2;

    if (workspaceId) {
      countConditions.push(`d.workspace_id = $${countIdx++}`);
      countValues.push(workspaceId);
    }
    if (filters?.blockType) {
      countConditions.push(`si.title = $${countIdx++}`);
      countValues.push(filters.blockType);
    }
    if (filters?.dateFrom) {
      countConditions.push(`si.created_at >= $${countIdx++}`);
      countValues.push(filters.dateFrom);
    }
    if (filters?.dateTo) {
      countConditions.push(`si.created_at <= $${countIdx++}`);
      countValues.push(filters.dateTo);
    }
    const countWhereClause = countConditions.length > 0 ? `AND ${countConditions.join(' AND ')}` : '';

    const countQuery = `
      SELECT COUNT(DISTINCT si.document_id) as total
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
        created_at: row.created_at
      })),
      total: parseInt(countResult.rows[0].total)
    };
  }

  private async bm25Search(
    query: string,
    workspaceId: string | undefined,
    limit: number,
    offset: number,
    filters: SearchOptions['filters']
  ): Promise<{ results: SearchResult[], total: number }> {
    const p = pool;
    if (!p) return { results: [], total: 0 };
    const whereConditions = ['to_tsvector(\'english\', si.content) @@ plainto_tsquery(\'english\', $1)'];
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
        d.title as document_title,
        si.block_id,
        si.content,
        si.title,
        si.metadata,
        si.created_at,
        ts_rank(to_tsvector('english', si.content), plainto_tsquery('english', $1)) as score
      FROM search_index si
      JOIN documents d ON si.document_id = d.id
      WHERE ${whereConditions.join(' AND ')}
      ORDER BY score DESC
      LIMIT $${paramIndex++} OFFSET $${paramIndex++}
    `;

    params.push(limit, offset);

    const result = await p.query(searchQuery, params);

    // Get total count
    const countQuery = `
      SELECT COUNT(DISTINCT si.document_id) as total
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
        created_at: row.created_at
      })),
      total: parseInt(countResult.rows[0].total)
    };
  }

  private async getQueryEmbedding(query: string): Promise<number[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn('[search] GEMINI_API_KEY 未設定，使用零向量');
      return new Array(768).fill(0);
    }
    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
      const result = await model.embedContent(query);
      return result.embedding.values;
    } catch (error) {
      console.error('[search] Embedding 失敗，使用零向量', error);
      return new Array(768).fill(0);
    }
  }

  private hasVectorSupport(): boolean {
    // Check if pgvector extension is available
    return true; // Assume it's available based on schema
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
        SELECT DISTINCT LEFT(si.content, 100) as suggestion
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

  async reindexDocument(documentId: string): Promise<void> {
    const p = pool;
    if (!p) return;

    try {
      // 1. Fetch document title and properties
      const docResult = await p.query(
        'SELECT title, properties, workspace_id FROM documents WHERE id = $1',
        [documentId]
      );

      if (docResult.rowCount === 0) return;
      const { title, properties, workspace_id } = docResult.rows[0];

      // 2. Extract text from properties
      // Properties is a JSONB object like { "Status": "Todo", "Tags": ["UI", "Fix"] }
      const propertyTextSegments: string[] = [];
      if (properties && typeof properties === 'object') {
        for (const [key, value] of Object.entries(properties)) {
          if (typeof value === 'string') {
            propertyTextSegments.push(`${key}: ${value}`);
          } else if (Array.isArray(value)) {
            propertyTextSegments.push(`${key}: ${value.join(', ')}`);
          } else if (value && typeof value === 'object' && (value as any).name) {
            // Handle complex objects like { name: 'High' }
            propertyTextSegments.push(`${key}: ${(value as any).name}`);
          }
        }
      }

      const combinedContent = [title, ...propertyTextSegments].filter(Boolean).join('\n');
      const embedding = await this.getQueryEmbedding(combinedContent);

      // 3. Upsert into search_index (document level, block_id = NULL)
      // We use document_id and block_id NULL as the unique key for document-level indexing
      await p.query(`
        INSERT INTO search_index (document_id, block_id, content, content_vector, title, metadata)
        VALUES ($1, NULL, $2, $3, $4, $5)
        ON CONFLICT (document_id, block_id) WHERE block_id IS NULL
        DO UPDATE SET 
          content = EXCLUDED.content,
          content_vector = EXCLUDED.content_vector,
          title = EXCLUDED.title,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `, [documentId, combinedContent, embedding, 'document', { workspace_id }]);

      console.log(`[search] Reindexed document ${documentId} with properties`);
    } catch (error) {
      console.error(`[search] Failed to reindex document ${documentId}:`, error);
    }
  }
}

export const searchService = new SearchService();
