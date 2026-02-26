import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function runMigrations(): Promise<void> {
  if (!pool) {
    console.warn('[migrations] No database connection, skipping migrations');
    return;
  }

  try {
    const schemaSql = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
    await pool.query(schemaSql);
    console.log('[migrations] Database schema initialized successfully');
    await initDefaultRoles();
  } catch (error) {
    console.error('[migrations] Failed to run migrations:', error);
    throw error;
  }
}

export async function initDefaultRoles(): Promise<void> {
  if (!pool) return;

  const defaultRoles = [
    {
      name: 'admin',
      description: 'Full access to the workspace and members',
      permissions: JSON.stringify([
        'workspace:admin',
        'collection:create', 'collection:edit', 'collection:delete', 'collection:view',
        'document:create', 'document:edit', 'document:delete', 'document:view'
      ])
    },
    {
      name: 'editor',
      description: 'Can create and edit content',
      permissions: JSON.stringify([
        'collection:create', 'collection:edit', 'collection:view',
        'document:create', 'document:edit', 'document:view'
      ])
    },
    {
      name: 'viewer',
      description: 'Read-only access',
      permissions: JSON.stringify(['collection:view', 'document:view'])
    }
  ];

  try {
    for (const role of defaultRoles) {
      await pool.query(`
        INSERT INTO roles (workspace_id, name, description, permissions)
        VALUES (NULL, $1, $2, $3)
        ON CONFLICT (workspace_id, name) WHERE workspace_id IS NULL DO NOTHING
      `, [role.name, role.description, role.permissions]);
    }
    console.log('[migrations] Default system roles initialized');
  } catch (error) {
    console.error('[migrations] Failed to initialize default roles:', error);
  }
}

export async function checkSchema(): Promise<boolean> {
  if (!pool) return false;

  try {
    const result = await pool.query(`
      SELECT COUNT(*) as count FROM information_schema.tables 
      WHERE table_name IN ('workspaces', 'documents', 'blocks', 'document_snapshots', 'search_index', 'collections', 'collection_views', 'roles')
    `);
    return parseInt(result.rows[0].count) >= 8;
  } catch (error) {
    console.error('[migrations] Failed to check schema:', error);
    return false;
  }
}
