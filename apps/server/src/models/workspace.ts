import { pool } from '../db/client.js';

export interface Workspace {
  id: string;
  name: string;
  description?: string;
  created_at: Date;
  updated_at: Date;
  created_by?: string;
  settings: Record<string, any>;
}

export interface CreateWorkspaceRequest {
  name: string;
  description?: string;
  created_by?: string;
  settings?: Record<string, any>;
}

export class WorkspaceModel {
  static async create(data: CreateWorkspaceRequest): Promise<Workspace> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      `INSERT INTO workspaces (name, description, created_by, settings)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [data.name, data.description, data.created_by, data.settings || {}]
    );

    return result.rows[0];
  }

  static async findById(id: string): Promise<Workspace | null> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      'SELECT * FROM workspaces WHERE id = $1',
      [id]
    );

    return result.rows[0] || null;
  }

  static async findAll(limit = 50, offset = 0): Promise<Workspace[]> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      'SELECT * FROM workspaces ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );

    return result.rows;
  }

  static async update(id: string, data: Partial<CreateWorkspaceRequest>): Promise<Workspace | null> {
    if (!pool) throw new Error('Database not available');

    const fields = [];
    const values = [];
    let paramIndex = 1;

    if (data.name !== undefined) {
      fields.push(`name = $${paramIndex++}`);
      values.push(data.name);
    }
    if (data.description !== undefined) {
      fields.push(`description = $${paramIndex++}`);
      values.push(data.description);
    }
    if (data.settings !== undefined) {
      fields.push(`settings = $${paramIndex++}`);
      values.push(data.settings);
    }

    if (fields.length === 0) {
      return this.findById(id);
    }

    values.push(id);

    const p = pool;
    if (!p) throw new Error('Database not available');
    const result = await p.query(
      `UPDATE workspaces SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      values
    );

    return result.rows[0] || null;
  }

  static async delete(id: string): Promise<boolean> {
    const p = pool;
    if (!p) throw new Error('Database not available');

    const result = await p.query(
      'DELETE FROM workspaces WHERE id = $1',
      [id]
    );

    return (result.rowCount ?? 0) > 0;
  }
}
