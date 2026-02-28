import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import jwt from 'jsonwebtoken';
import { pool } from '../db/client.js';
import { storeSnapshot } from '../db/snapshots.js';
import { observability } from '../services/observability.js';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';

export function createHocuspocusServer(): Server {
  const port = Number(process.env.SYNC_PORT ?? 1234);

  return new Server({
    port,

    async onAuthenticate({ token, documentName }) {
      if (!token) {
        throw new Error('Missing authentication token');
      }

      let payload: { userId: string; email: string };
      try {
        payload = jwt.verify(token, JWT_SECRET) as { userId: string; email: string };
      } catch {
        throw new Error('Invalid or expired token');
      }

      // Verify user is a member of the workspace that owns this document
      if (pool) {
        const result = await pool.query(
          `SELECT d.workspace_id
           FROM documents d
           JOIN workspace_members wm ON wm.workspace_id = d.workspace_id
           WHERE d.id = $1 AND wm.user_id = $2
           LIMIT 1`,
          [documentName, payload.userId]
        );

        if ((result.rowCount ?? 0) === 0) {
          observability.warn('Hocuspocus access denied', { userId: payload.userId, documentName });
          throw new Error('Access denied: not a member of this workspace');
        }
      }

      observability.info('Hocuspocus authenticated', { userId: payload.userId, documentName });
      return { userId: payload.userId };
    },

    async onStoreDocument(data) {
      const update = Y.encodeStateAsUpdate(data.document);
      await storeSnapshot(data.documentName, update);
    },
  });
}
