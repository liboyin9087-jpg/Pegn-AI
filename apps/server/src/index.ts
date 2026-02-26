import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { registerHealthRoutes } from './routes/health.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAiRoutes } from './routes/ai.js';
import { registerIndexerRoutes } from './routes/indexer.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerWorkspaceRoutes } from './routes/workspaces.js';
import { registerDocumentRoutes } from './routes/documents.js';
import { registerPromptRoutes } from './routes/prompts.js';
import { registerKgRoutes } from './routes/kg.js';
import { registerGraphRAGRoutes } from './routes/graphrag.js';
import { registerAgentRoutes } from './routes/agent.js';
import { registerWebhookRoutes } from './routes/webhook.js';
import { createHocuspocusServer } from './sync/hocuspocus.js';
import { initDb } from './db/client.js';
import { observability, requestTracker } from './services/observability.js';
import { snapshotService } from './services/snapshot.js';
import { generalLimiter, authLimiter, aiLimiter } from './middleware/rateLimit.js';
import { registerUploadRoutes } from './routes/upload.js';
import { registerOAuthRoutes } from './routes/oauth.js';

const app = express();
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5177',
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Rate limiting
app.use('/api/v1/auth', authLimiter);
app.use('/api/v1/ai', aiLimiter);
app.use('/api/v1/graphrag', aiLimiter);
app.use('/api/v1/agents', aiLimiter);
app.use('/api/v1/kg/extract', aiLimiter);
app.use('/api/v1', generalLimiter);

// Add observability middleware
app.use(requestTracker);

// Register routes
registerHealthRoutes(app);
registerAuthRoutes(app);
registerOAuthRoutes(app);
registerUploadRoutes(app);
registerAiRoutes(app);
registerIndexerRoutes(app);
registerSearchRoutes(app);
registerWorkspaceRoutes(app);
registerDocumentRoutes(app);
registerPromptRoutes(app);
registerKgRoutes(app);
registerGraphRAGRoutes(app);
registerAgentRoutes(app);
registerWebhookRoutes(app);
registerCollectionRoutes(app);
registerCollectionViewRoutes(app);

import { registerCollectionRoutes } from './routes/collections.js';
import { registerCollectionViewRoutes } from './routes/collection_views.js';

// ── 全域錯誤處理（必須在所有 route 之後，防止 stack trace 洩漏） ──
app.use((err: any, req: any, res: any, _next: any) => {
  const isDev = process.env.NODE_ENV !== 'production';
  observability.error('Unhandled error', { path: req.path, method: req.method, error: err?.message });
  res.status(err.status ?? 500).json({
    error: err.message ?? 'Internal server error',
    ...(isDev ? { stack: err.stack } : {}),
  });
});

// ── 404 handler ──
app.use((_req: any, res: any) => {
  res.status(404).json({ error: 'Not found' });
});

// Add metrics endpoint
app.get('/metrics', (req, res) => {
  res.set('Content-Type', 'text/plain');
  res.send(observability.exportPrometheusMetrics());
});

// Add logs endpoint for debugging
app.get('/admin/logs', (req, res) => {
  const { level, limit = 100 } = req.query;
  const logs = observability.getLogs(level as any, undefined, parseInt(limit as string));
  res.json({ logs });
});

// Add health check endpoint with detailed status
app.get('/health/detailed', async (req, res) => {
  try {
    const health = await observability.getHealthStatus();
    const statusCode = health.status === 'healthy' ? 200 :
      health.status === 'degraded' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(500).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

const apiPort = Number(process.env.API_PORT ?? 4000);

const httpServer = createServer(app);
httpServer.listen(apiPort, () => {
  console.log(`[api] listening on http://localhost:${apiPort}`);
  observability.info('API server started', { port: apiPort });
});

// Initialize database
await initDb();

// Start Hocuspocus sync server
const syncServer = createHocuspocusServer();
syncServer.listen();
console.log(`[sync] listening on ws://localhost:${syncServer.configuration.port}`);
observability.info('Sync server started', { port: syncServer.configuration.port });

// Graceful shutdown
process.on('SIGTERM', async () => {
  observability.info('Received SIGTERM, shutting down gracefully');

  snapshotService.stopAll();

  httpServer.close(() => {
    observability.info('HTTP server closed');
    process.exit(0);
  });

  // Force close after 30 seconds
  setTimeout(() => {
    observability.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
});

process.on('SIGINT', async () => {
  observability.info('Received SIGINT, shutting down gracefully');

  snapshotService.stopAll();

  httpServer.close(() => {
    observability.info('HTTP server closed');
    process.exit(0);
  });

  // Force close after 30 seconds
  setTimeout(() => {
    observability.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
});
