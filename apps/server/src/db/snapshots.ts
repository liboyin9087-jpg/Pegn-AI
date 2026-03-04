import { pool } from './client.js';

export async function storeSnapshot(docName: string, update: Uint8Array): Promise<void> {
  if (!pool) {
    return;
  }

  await pool.query(
    `
    INSERT INTO yjs_snapshots (doc_name, snapshot, updated_at)
    VALUES ($1, $2, now())
    ON CONFLICT (doc_name)
    DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = now()
    `,
    [docName, Buffer.from(update)]
  );
}
