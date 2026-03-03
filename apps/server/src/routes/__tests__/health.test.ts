import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// P2-3: health route 回歸測試矩陣
// GET /health → 200 { status: 'ok' }
// GET /health/snapshot-drill → 400 (missing param), 200/503 (valid param)

const mockValidateSnapshotRecovery = vi.fn();

vi.mock('../../services/snapshot.js', () => ({
  snapshotService: {
    validateSnapshotRecovery: mockValidateSnapshotRecovery,
  },
}));

async function createApp() {
  const { registerHealthRoutes } = await import('../health.js');
  const app = express();
  app.use(express.json());
  registerHealthRoutes(app);
  return app;
}

describe('health routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const app = await createApp();
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: 'ok' });
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
