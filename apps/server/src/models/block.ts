import { pool } from '../db/client.js';

export interface Block {
  id: string;
  document_id: string;
  block_id: string;
  block_type: string;
  content: Record<string, any>;
  yjs_data?: Buffer;
  parent_id?: string;
  position: number;
  created_at: Date;
  updated_at: Date;
}

export interface CreateBlockRequest {
  document_id: string;
  block_id: string;
  block_type: string;
  content?: Record<string, any>;
  yjs_data?: Buffer;
  parent_id?: string;
  position?: number;
}

export class BlockModel {
  static async create(data: CreateBlockRequest): Promise<Block> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      `INSERT INTO blocks (document_id, block_id, block_type, content, yjs_data, parent_id, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        data.document_id,
        data.block_id,
        data.block_type,
        data.content || {},
        data.yjs_data,
        data.parent_id,
        data.position || 0
      ]
    );

    return result.rows[0];
  }

  static async findById(id: string): Promise<Block | null> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      'SELECT * FROM blocks WHERE id = $1',
      [id]
    );

    return result.rows[0] || null;
  }

  static async findByDocument(documentId: string): Promise<Block[]> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      'SELECT * FROM blocks WHERE document_id = $1 ORDER BY position ASC, created_at ASC',
      [documentId]
    );

    return result.rows;
  }

  static async findByBlockId(documentId: string, blockId: string): Promise<Block | null> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      'SELECT * FROM blocks WHERE document_id = $1 AND block_id = $2',
      [documentId, blockId]
    );

    return result.rows[0] || null;
  }

  static async update(id: string, data: Partial<CreateBlockRequest>): Promise<Block | null> {
    if (!pool) throw new Error('Database not available');

    const fields = [];
    const values = [];
    let paramIndex = 1;

    if (data.block_type !== undefined) {
      fields.push(`block_type = $${paramIndex++}`);
      values.push(data.block_type);
    }
    if (data.content !== undefined) {
      fields.push(`content = $${paramIndex++}`);
      values.push(data.content);
    }
    if (data.yjs_data !== undefined) {
      fields.push(`yjs_data = $${paramIndex++}`);
      values.push(data.yjs_data);
    }
    if (data.parent_id !== undefined) {
      fields.push(`parent_id = $${paramIndex++}`);
      values.push(data.parent_id);
    }
    if (data.position !== undefined) {
      fields.push(`position = $${paramIndex++}`);
      values.push(data.position);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);

    const p = pool;
    if (!p) throw new Error('Database not available');
    const result = await p.query(
      `UPDATE blocks SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  static async upsert(documentId: string, blockId: string, data: Omit<CreateBlockRequest, 'document_id' | 'block_id'>): Promise<Block> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      `INSERT INTO blocks (document_id, block_id, block_type, content, yjs_data, parent_id, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (document_id, block_id)
       DO UPDATE SET
         block_type = EXCLUDED.block_type,
         content = EXCLUDED.content,
         yjs_data = EXCLUDED.yjs_data,
         parent_id = EXCLUDED.parent_id,
         position = EXCLUDED.position,
         updated_at = NOW()
       RETURNING *`,
      [
        documentId,
        blockId,
        data.block_type,
        data.content || {},
        data.yjs_data,
        data.parent_id,
        data.position || 0
      ]
    );

    return result.rows[0];
  }

  static async delete(id: string): Promise<boolean> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      'DELETE FROM blocks WHERE id = $1',
      [id]
    );

    return (result.rowCount ?? 0) > 0;
  }

  static async deleteByDocument(documentId: string): Promise<boolean> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      'DELETE FROM blocks WHERE document_id = $1',
      [documentId]
    );

    return (result.rowCount ?? 0) > 0;
  }

  static async findByType(documentId: string, blockType: string): Promise<Block[]> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      'SELECT * FROM blocks WHERE document_id = $1 AND block_type = $2 ORDER BY position ASC',
      [documentId, blockType]
    );

    return result.rows;
  }
}
