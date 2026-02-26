import { Pool } from 'pg';
import { runMigrations } from './migrations.js';

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

    // Always run idempotent SQL migrations to keep schema up to date.
    console.log('[db] Running database migrations...');
    await runMigrations();
  } catch (error) {
    console.error('[db] connection failed', error);
    throw error;
  }
}
