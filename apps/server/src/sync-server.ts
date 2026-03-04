import 'dotenv/config';
import { createHocuspocusServer } from './sync/hocuspocus.js';
import { initDb } from './db/client.js';

const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret === 'dev-secret') {
  if (process.env.NODE_ENV === 'production') {
    console.error('[FATAL] JWT_SECRET must be set in production and cannot be "dev-secret".');
    process.exit(1);
  } else {
    console.warn('[WARN] JWT_SECRET is using default "dev-secret".');
  }
}

if (!process.env.SYNC_PORT && process.env.PORT) {
  process.env.SYNC_PORT = process.env.PORT;
}

await initDb();

const syncServer = createHocuspocusServer();
syncServer.listen();
console.log(`[sync] listening on ws://localhost:${syncServer.configuration.port}`);

process.on('SIGTERM', () => {
  process.exit(0);
});

process.on('SIGINT', () => {
  process.exit(0);
});
