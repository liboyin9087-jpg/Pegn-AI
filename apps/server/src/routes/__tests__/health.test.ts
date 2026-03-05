import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// P2-3: health route 回歸測試矩陣
// GET /health → 200 { status: 'ok' }
// GET /health/detailed → 200 (SLO + latency stats)
// GET /health/snapshot-drill → 400 (missing param), 200/503 (valid param)

const mockValidateSnapshotRecovery = vi.fn();
const mockGetLatencyStats = vi.fn();

vi.mock('../../services/snapshot.js', () => ({
  snapshotService: {
    validateSnapshotRecovery: mockValidateSnapshotRecovery,
  },
}));

vi.mock('../../services/observability.js', () => ({
  getLatencyStats: mockGetLatencyStats,
  latencyBuffer: { push: vi.fn() },
  observability: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), recordRequestDuration: vi.fn(), recordDatabaseQuery: vi.fn() },
  requestTracker: (_req: any, _res: any, next: any) => next(),
}));

async function createApp() {
  const { registerHealthRoutes } = await import('../health.js');
  const app = express();
  app.use(express.json());
  registerHealthRoutes(app);
  return app;
}

const defaultStats = {
  http: { p50: 45,  p95: 120, sample_count: 200 },
  ai:   { p50: 800, p95: 2100, sample_count: 50 },
};

describe('health routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetLatencyStats.mockReturnValue(defaultStats);
  });

  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const app = await createApp();
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
    });
  });

  describe('GET /health/detailed', () => {
    it('returns 200 with SLO and latency stats', async () => {
      const app = await createApp();
      const res = await request(app).get('/health/detailed');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.slo).toBeDefined();
      expect(res.body.slo.status).toBe('ok');  // p95=120 < 500 target
      expect(res.body.slo.http_p95_target_ms).toBe(500);
      expect(res.body.slo.http_p95_actual_ms).toBe(120);
      expect(res.body.latency.http.p95).toBe(120);
      expect(res.body.timestamp).toBeDefined();
    });

    it('reports slo breach when http P95 exceeds target', async () => {
      mockGetLatencyStats.mockReturnValue({
        http: { p50: 400, p95: 650, sample_count: 100 },
        ai:   { p50: 500, p95: 1000, sample_count: 20 },
      });
      const app = await createApp();
      const res = await request(app).get('/health/detailed');
      expect(res.status).toBe(200); // HTTP status always 200
      expect(res.body.slo.status).toBe('breach');
      expect(res.body.slo.http_breached).toBe(true);
    });

    it('shows ok when no samples exist yet', async () => {
      mockGetLatencyStats.mockReturnValue({
        http: { p50: 0, p95: 0, sample_count: 0 },
        ai:   { p50: 0, p95: 0, sample_count: 0 },
      });
      const app = await createApp();
      const res = await request(app).get('/health/detailed');
      expect(res.body.slo.status).toBe('ok'); // no samples = no breach
    });
  });

  describe('GET /health/snapshot-drill', () => {
    it('returns 400 when document_id is missing', async () => {
      const app = await createApp();
      const res = await request(app).get('/health/snapshot-drill');
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('document_id');
    });

    it('returns 400 when document_id is empty string', async () => {
      const app = await createApp();
      const res = await request(app).get('/health/snapshot-drill?document_id=');
      expect(res.status).toBe(400);
    });

    it('returns 200 when snapshot recovery succeeds', async () => {
      mockValidateSnapshotRecovery.mockResolvedValue({
        ok: true,
        document_id: 'doc-1',
        snapshot_count: 3,
        recovered: true,
        duration_ms: 42,
        checked_at: new Date().toISOString(),
      });

      const app = await createApp();
      const res = await request(app).get('/health/snapshot-drill?document_id=doc-1');
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.document_id).toBe('doc-1');
      expect(mockValidateSnapshotRecovery).toHaveBeenCalledWith('doc-1');
    });

    it('returns 503 when snapshot recovery fails', async () => {
      mockValidateSnapshotRecovery.mockResolvedValue({
        ok: false,
        document_id: 'doc-missing',
        snapshot_count: 0,
        recovered: false,
        error: 'No snapshots found',
        duration_ms: 5,
        checked_at: new Date().toISOString(),
      });

      const app = await createApp();
      const res = await request(app).get('/health/snapshot-drill?document_id=doc-missing');
      expect(res.status).toBe(503);
      expect(res.body.ok).toBe(false);
      expect(res.body.error).toContain('No snapshots');
    });
  });
});

