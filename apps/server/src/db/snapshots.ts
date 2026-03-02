import { pool } from './client.js';

function getBufferLike():
  | { from(input: Uint8Array): Uint8Array; isBuffer(input: unknown): boolean }
  | null {
  const maybeBuffer = (globalThis as { Buffer?: unknown }).Buffer as {
    from?: (input: Uint8Array) => Uint8Array;
    isBuffer?: (input: unknown) => boolean;
  } | undefined;

  if (!maybeBuffer || typeof maybeBuffer.from !== 'function' || typeof maybeBuffer.isBuffer !== 'function') {
    return null;
  }

  return {
    from: maybeBuffer.from,
    isBuffer: maybeBuffer.isBuffer,
  };
}

export async function storeSnapshot(docName: string, update: Uint8Array): Promise<void> {
  if (!pool) {
    return;
  }

  const bufferLike = getBufferLike();
  const byteaPayload = bufferLike ? bufferLike.from(update) : update;

  await pool.query(
    `
    INSERT INTO yjs_snapshots (doc_name, snapshot, updated_at)
    VALUES ($1, $2, now())
    ON CONFLICT (doc_name)
    DO UPDATE SET snapshot = EXCLUDED.snapshot, updated_at = now()
    `,
    [docName, byteaPayload]
  );
}

export async function getLatestStoredSnapshot(docName: string): Promise<Uint8Array | null> {
  if (!pool) return null;

  const result = await pool.query(
    `SELECT snapshot
     FROM yjs_snapshots
     WHERE doc_name = $1
     LIMIT 1`,
    [docName]
  );

  const snapshot = result.rows[0]?.snapshot;
  if (!snapshot) return null;
  if (snapshot instanceof Uint8Array) return snapshot;
  const bufferLike = getBufferLike();
  if (bufferLike?.isBuffer(snapshot)) return new Uint8Array(snapshot as Uint8Array);
  if (Array.isArray(snapshot)) return new Uint8Array(snapshot);

  const fallback = snapshot as { data?: unknown } | null;
  if (fallback?.data && Array.isArray(fallback.data)) {
    return new Uint8Array(fallback.data as number[]);
  }

  return null;
}
