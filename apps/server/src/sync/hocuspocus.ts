import { Server } from '@hocuspocus/server';
import * as Y from 'yjs';
import { storeSnapshot } from '../db/snapshots.js';

export function createHocuspocusServer(): Server {
  const port = Number(process.env.SYNC_PORT ?? 1234);

  return new Server({
    port,
    async onStoreDocument(data) {
      const update = Y.encodeStateAsUpdate(data.document);
      await storeSnapshot(data.documentName, update);
    },
  });
}
