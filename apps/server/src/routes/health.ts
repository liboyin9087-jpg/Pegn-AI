import type { Express } from 'express';
import { snapshotService } from '../services/snapshot.js';
import { getLatencyStats, getAgentSuccessStats } from '../services/observability.js';

const HTTP_P95_SLO_MS = 500;
const AI_P95_SLO_MS  = 3000;
const AGENT_SUCCESS_SLO = 0.9; // 90% success rate target

export function registerHealthRoutes(app: Express): void {
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  // P1-2: SLO / P95 latency 監控端點
  app.get('/health/detailed', (_req, res) => {
    const stats = getLatencyStats();
    const agentStats = getAgentSuccessStats();
    const httpBreached  = stats.http.sample_count > 0 && stats.http.p95 > HTTP_P95_SLO_MS;
    const aiBreached    = stats.ai.sample_count  > 0 && stats.ai.p95  > AI_P95_SLO_MS;
    const agentBreached = agentStats.sample_count > 0 && agentStats.success_rate < AGENT_SUCCESS_SLO;
    const sloStatus     = (httpBreached || aiBreached || agentBreached) ? 'breach' : 'ok';
    res.json({
      status: 'ok',
      slo: {
        status:                    sloStatus,
        http_p95_target_ms:        HTTP_P95_SLO_MS,
        http_p95_actual_ms:        stats.http.p95,
        ai_p95_target_ms:          AI_P95_SLO_MS,
        ai_p95_actual_ms:          stats.ai.p95,
        agent_success_rate_target: AGENT_SUCCESS_SLO,
        agent_success_rate_actual: agentStats.success_rate,
        http_breached:             httpBreached,
        ai_breached:               aiBreached,
        agent_breached:            agentBreached,
      },
      latency:   stats,
      agent:     agentStats,
      timestamp: new Date().toISOString(),
    });
  });

  // P1-1: Snapshot 回放驗證 drill 端點—運維可呈請驗證澥容復原能力
  // GET /health/snapshot-drill?document_id=xxx
  app.get('/health/snapshot-drill', async (req, res) => {
    const documentId = String(req.query.document_id ?? '').trim();
    if (!documentId) {
      res.status(400).json({ error: 'document_id query param required' });
      return;
    }
    const result = await snapshotService.validateSnapshotRecovery(documentId);
    res.status(result.ok ? 200 : 503).json(result);
  });
}
