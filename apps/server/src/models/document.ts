import { pool } from '../db/client.js';

export interface Document {
  id: string;
  workspace_id: string;
  title: string;
  content: Record<string, any>;
  yjs_state?: Buffer;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
  last_modified_by?: string;
  version: number;
  metadata: Record<string, any>;
  collection_id?: string;
  properties?: Record<string, any>;
  position?: number;
}

export interface CreateDocumentRequest {
  workspace_id: string;
  title: string;
  content?: Record<string, any>;
  yjs_state?: Buffer;
  created_by?: string;
  metadata?: Record<string, any>;
  collection_id?: string;
  properties?: Record<string, any>;
  position?: number;
}

export class DocumentModel {
  static async create(data: CreateDocumentRequest): Promise<Document> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      `INSERT INTO documents (workspace_id, title, content, yjs_state, created_by, metadata, collection_id, properties)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        data.workspace_id,
        data.title,
        data.content || {},
        data.yjs_state,
        data.created_by,
        data.metadata || {},
        data.collection_id,
        data.properties || {}
      ]
    );

    return result.rows[0];
  }

  static async findById(id: string): Promise<Document | null> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      'SELECT * FROM documents WHERE id = $1',
      [id]
    );

    return result.rows[0] || null;
  }

  static async findByWorkspace(workspaceId: string, limit = 50, offset = 0): Promise<Document[]> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      'SELECT * FROM documents WHERE workspace_id = $1 ORDER BY COALESCE(position, 0) ASC, created_at ASC LIMIT $2 OFFSET $3',
      [workspaceId, limit, offset]
    );

    return result.rows;
  }

  static async update(id: string, data: Partial<CreateDocumentRequest> & { last_modified_by?: string }): Promise<Document | null> {
    if (!pool) throw new Error('Database not available');

    const fields = [];
    const values = [];
    let paramIndex = 1;

    if (data.title !== undefined) {
      fields.push(`title = $${paramIndex++}`);
      values.push(data.title);
    }
    if (data.content !== undefined) {
      fields.push(`content = $${paramIndex++}`);
      values.push(data.content);
    }
    if (data.yjs_state !== undefined) {
      fields.push(`yjs_state = $${paramIndex++}`);
      values.push(data.yjs_state);
    }
    if (data.last_modified_by !== undefined) {
      fields.push(`last_modified_by = $${paramIndex++}`);
      values.push(data.last_modified_by);
    }
    if (data.metadata !== undefined) {
      fields.push(`metadata = $${paramIndex++}`);
      values.push(data.metadata);
    }
    if (data.collection_id !== undefined) {
      fields.push(`collection_id = $${paramIndex++}`);
      values.push(data.collection_id);
    }
    if (data.properties !== undefined) {
      fields.push(`properties = $${paramIndex++}`);
      values.push(data.properties);
    }
    if (data.position !== undefined) {
      fields.push(`position = $${paramIndex++}`);
      values.push(data.position);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    // Increment version
    fields.push(`version = version + 1`);
    values.push(id);

    const p = pool;
    if (!p) throw new Error('Database not available');
    const result = await p.query(
      `UPDATE documents SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  static async updateYjsState(id: string, yjsState: Buffer, lastModifiedBy?: string): Promise<Document | null> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      `UPDATE documents 
       SET yjs_state = $1, last_modified_by = $2, version = version + 1, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [yjsState, lastModifiedBy, id]
    );

    return result.rows[0] || null;
  }

  static async delete(id: string): Promise<boolean> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      'DELETE FROM documents WHERE id = $1',
      [id]
    );

    return (result.rowCount ?? 0) > 0;
  }

  static async search(workspaceId: string, query: string, limit = 20): Promise<Document[]> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      `SELECT DISTINCT d.* FROM documents d
       LEFT JOIN search_index si ON d.id = si.document_id
       WHERE d.workspace_id = $1 
       AND (d.title ILIKE $2 OR si.content ILIKE $2)
       ORDER BY d.updated_at DESC
       LIMIT $3`,
      [workspaceId, `%${query}%`, limit]
    );

    return result.rows;
  }
}
