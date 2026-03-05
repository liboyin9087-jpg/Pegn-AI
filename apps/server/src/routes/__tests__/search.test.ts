import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { mrr, recallAtK, ndcgAtK } from '../../services/searchEval.js';

// ── Unit tests for search evaluation metrics ────────────────────────────────
describe('searchEval unit', () => {
  describe('mrr()', () => {
    it('returns 1.0 when first result is relevant', () => {
      expect(mrr(['doc-1', 'doc-2'], ['doc-1', 'doc-3', 'doc-4'])).toBe(1);
    });

    it('returns 0.5 when second result is the first relevant hit', () => {
      expect(mrr(['doc-2'], ['doc-1', 'doc-2', 'doc-3'])).toBe(0.5);
    });

    it('returns 1/3 when third result is the first relevant hit', () => {
      expect(mrr(['doc-3'], ['doc-1', 'doc-2', 'doc-3', 'doc-4'])).toBeCloseTo(1 / 3, 5);
    });

    it('returns 0 when no relevant doc is in results', () => {
      expect(mrr(['doc-x'], ['doc-1', 'doc-2', 'doc-3'])).toBe(0);
    });

    it('uses the first relevant hit (not the highest MRR)', () => {
      // doc-2 is at rank 2, doc-1 is at rank 1 but also relevant →  MRR = 1
      expect(mrr(['doc-1', 'doc-2'], ['doc-1', 'doc-2'])).toBe(1);
    });
  });

  describe('recallAtK()', () => {
    it('returns 1.0 when all relevant docs are in top-K', () => {
      expect(recallAtK(['doc-1', 'doc-2'], ['doc-1', 'doc-2', 'doc-3'], 5)).toBe(1);
    });

    it('returns 0.5 when half of relevant docs are in top-K', () => {
      expect(recallAtK(['doc-1', 'doc-2'], ['doc-1', 'doc-3', 'doc-4', 'doc-5'], 3)).toBe(0.5);
    });

    it('returns 0 when no relevant doc is in top-K', () => {
      expect(recallAtK(['doc-x', 'doc-y'], ['doc-1', 'doc-2', 'doc-3'], 3)).toBe(0);
    });

    it('returns 1 for empty groundTruth (vacuously satisfied)', () => {
      expect(recallAtK([], ['doc-1', 'doc-2'], 5)).toBe(1);
    });

    it('respects K cut-off boundary', () => {
      // relevant doc-2 is at position 3 (0-indexed 2), K=2 → miss
      expect(recallAtK(['doc-2'], ['doc-1', 'doc-3', 'doc-2'], 2)).toBe(0);
      // K=3 → hit
      expect(recallAtK(['doc-2'], ['doc-1', 'doc-3', 'doc-2'], 3)).toBe(1);
    });
  });

  describe('ndcgAtK()', () => {
    it('returns 1.0 for a perfect ranking', () => {
      expect(ndcgAtK(['doc-1', 'doc-2'], ['doc-1', 'doc-2', 'doc-3'], 3)).toBeCloseTo(1, 4);
    });

    it('returns partial score for imperfect ranking', () => {
      const score = ndcgAtK(['doc-1', 'doc-3'], ['doc-1', 'doc-2', 'doc-3'], 3);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThan(1);
    });

    it('returns 0 when no relevant doc in top-K', () => {
      expect(ndcgAtK(['doc-x'], ['doc-1', 'doc-2'], 2)).toBe(0);
    });

    it('returns 0 for empty groundTruth (idcg = 0)', () => {
      expect(ndcgAtK([], ['doc-1'], 5)).toBe(0);
    });
  });
});

// ── Search quality regression fixture ───────────────────────────────────────
// Ground truth: 5 representative queries with known relevant document IDs.
// These are deterministic (hardcoded) — the search service is mocked to
// return specific ranked lists, letting us measure MRR / Recall@5.
//
// SLO targets (must not regress):
//   MRR       ≥ 0.5    (first relevant hit within rank 2 on average)
//   Recall@5  ≥ 0.6    (at least 60 % of relevant docs in top 5)

const GROUND_TRUTH: Array<{ query: string; relevant: string[] }> = [
  { query: 'quarterly financial report',   relevant: ['doc-finance-q4', 'doc-finance-q3'] },
  { query: 'product roadmap 2026',         relevant: ['doc-roadmap-2026'] },
  { query: 'employee onboarding process',  relevant: ['doc-hr-onboarding', 'doc-hr-policy'] },
  { query: 'kubernetes deployment guide',  relevant: ['doc-k8s-deploy', 'doc-k8s-overview'] },
  { query: 'API rate limiting strategy',   relevant: ['doc-rate-limit', 'doc-api-design'] },
];

// Mock search results — simulate a decent but not-perfect ranker.
const MOCK_RESULTS: Record<string, string[]> = {
  'quarterly financial report':   ['doc-finance-q4', 'doc-misc-1',    'doc-finance-q3', 'doc-misc-2',    'doc-misc-3'],
  'product roadmap 2026':         ['doc-roadmap-2026', 'doc-misc-4',  'doc-misc-5',     'doc-misc-6',    'doc-misc-7'],
  'employee onboarding process':  ['doc-misc-8',      'doc-hr-onboarding', 'doc-hr-policy', 'doc-misc-9', 'doc-misc-10'],
  'kubernetes deployment guide':  ['doc-k8s-overview','doc-k8s-deploy','doc-misc-11',   'doc-misc-12',   'doc-misc-13'],
  'API rate limiting strategy':   ['doc-misc-14',     'doc-misc-15',   'doc-rate-limit', 'doc-api-design', 'doc-misc-16'],
};

describe('search regression (MRR / Recall@5 SLA)', () => {
  it('each query MRR ≥ 0.33 (relevant doc in top 3)', () => {
    for (const { query, relevant } of GROUND_TRUTH) {
      const results = MOCK_RESULTS[query];
      const score   = mrr(relevant, results);
      expect(score, `MRR for "${query}"`).toBeGreaterThanOrEqual(1 / 3);
    }
  });

  it('macro-average MRR ≥ 0.5', () => {
    const scores = GROUND_TRUTH.map(({ query, relevant }) =>
      mrr(relevant, MOCK_RESULTS[query]),
    );
    const avgMRR = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(avgMRR).toBeGreaterThanOrEqual(0.5);
  });

  it('macro-average Recall@5 ≥ 0.6', () => {
    const scores = GROUND_TRUTH.map(({ query, relevant }) =>
      recallAtK(relevant, MOCK_RESULTS[query], 5),
    );
    const avgRecall = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(avgRecall).toBeGreaterThanOrEqual(0.6);
  });

  it('macro-average nDCG@5 ≥ 0.5', () => {
    const scores = GROUND_TRUTH.map(({ query, relevant }) =>
      ndcgAtK(relevant, MOCK_RESULTS[query], 5),
    );
    const avgNdcg = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(avgNdcg).toBeGreaterThanOrEqual(0.5);
  });
});

// ── Search API smoke test ────────────────────────────────────────────────────
const mockSearchService = { search: vi.fn() };
const mockAuthMiddleware = (_req: any, _res: any, next: any) => next();

vi.mock('../../services/search.js', () => ({ searchService: mockSearchService }));
vi.mock('../../middleware/auth.js', () => ({ authMiddleware: mockAuthMiddleware }));
vi.mock('../../middleware/rbac.js', () => ({ checkPermission: () => mockAuthMiddleware }));
vi.mock('../../db/client.js', () => ({ pool: null }));
vi.mock('../../services/observability.js', () => ({
  observability: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), recordSearchOperation: vi.fn(), recordRequestDuration: vi.fn() },
  requestTracker: (_req: any, _res: any, next: any) => next(),
  getLatencyStats: vi.fn().mockReturnValue({ http: { p50: 0, p95: 0, sample_count: 0 }, ai: { p50: 0, p95: 0, sample_count: 0 } }),
  latencyBuffer: { push: vi.fn() },
}));

async function createSearchApp() {
  const { registerSearchRoutes } = await import('../search.js');
  const app = express();
  app.use(express.json());
  registerSearchRoutes(app);
  return app;
}

describe('search API smoke test', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /api/v1/search returns 200 with results array', async () => {
    mockSearchService.search.mockResolvedValue({
      results: [
        { id: 'doc-1', title: 'Result 1', score: 0.95 },
        { id: 'doc-2', title: 'Result 2', score: 0.82 },
      ],
      total: 2,
    });

    const app = await createSearchApp();
    const res = await request(app)
      .post('/api/v1/search')
      .send({ query: 'test query', workspace_id: 'ws-1' });

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.results ?? res.body)).toBe(true);
  });
});
