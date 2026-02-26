import { Pool } from 'pg';
import { runMigrations, checkSchema, initDefaultRoles } from './migrations.js';

const connectionString = process.env.DATABASE_URL;

export const pool = connectionString ? new Pool({ connectionString }) : null;

export async function initDb(): Promise<void> {
  if (!pool) {
    console.warn('[db] DATABASE_URL 未設定，將以無資料庫模式啟動');
    return;
  }

  try {
    await pool.query('SELECT 1');
    console.log('[db] connected');

    // Check if schema exists, run migrations if needed
    const schemaExists = await checkSchema();
    if (!schemaExists) {
      console.log('[db] Running database migrations...');
      await runMigrations();
    } else {
      console.log('[db] Schema already exists');
      await initDefaultRoles(); // Ensure roles exist even if schema was already there
    }
  } catch (error) {
    console.error('[db] connection failed', error);
    throw error;
  }
}
