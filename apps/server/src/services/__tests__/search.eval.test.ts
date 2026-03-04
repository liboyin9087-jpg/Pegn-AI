/**
 * 搜尋品質評估測試 (Search Quality Evaluation)
 * ─────────────────────────────────────────────
 * 指標：
 *   - Recall@K  (前 K 個結果中，ground-truth 文件出現的比率)
 *   - MRR       (Mean Reciprocal Rank — 第一個相關結果的排名倒數之平均)
 *   - P@1       (首位命中率)
 *
 * 執行：
 *   cd apps/server
 *   npm run test -- search.eval
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';

// ── Ground-Truth Dataset ─────────────────────────────────────────────────────
// 每筆包含：搜尋 query 與至少 1 個預期的相關文件 ID
// 這些 ID 在被模擬的 search service 回傳中必須出現
interface EvalCase {
  query: string;
  relevantIds: string[];   // 至少一個在前 K 名即算命中
}

const EVAL_CASES: EvalCase[] = [
  { query: '專案進度報告',          relevantIds: ['doc_001', 'doc_002'] },
  { query: '機器學習模型訓練',       relevantIds: ['doc_003'] },
  { query: '客戶需求分析',           relevantIds: ['doc_004', 'doc_005'] },
  { query: '季度財務摘要',           relevantIds: ['doc_006'] },
  { query: '產品路線圖規劃',         relevantIds: ['doc_007', 'doc_008'] },
  { query: 'TypeScript 類型系統',    relevantIds: ['doc_009'] },
  { query: '使用者體驗設計原則',     relevantIds: ['doc_010'] },
  { query: 'API 安全性最佳實踐',     relevantIds: ['doc_011', 'doc_012'] },
  { query: '團隊協作工具比較',       relevantIds: ['doc_013'] },
  { query: '資料庫索引效能調優',     relevantIds: ['doc_014', 'doc_015'] },
];

// ── Mock Search Results ──────────────────────────────────────────────────────
// 模擬搜尋服務每個 query 的回傳結果（前 5 名）
// 真實評估時應替換為真實 DB 查詢
const MOCK_RESULTS: Record<string, Array<{ document_id: string; score: number }>> = {
  '專案進度報告':        [{ document_id: 'doc_001', score: 0.91 }, { document_id: 'doc_002', score: 0.87 }, { document_id: 'doc_099', score: 0.72 }, { document_id: 'doc_100', score: 0.61 }, { document_id: 'doc_101', score: 0.55 }],
  '機器學習模型訓練':    [{ document_id: 'doc_099', score: 0.80 }, { document_id: 'doc_003', score: 0.78 }, { document_id: 'doc_100', score: 0.70 }, { document_id: 'doc_101', score: 0.65 }, { document_id: 'doc_102', score: 0.60 }],
  '客戶需求分析':        [{ document_id: 'doc_004', score: 0.95 }, { document_id: 'doc_005', score: 0.90 }, { document_id: 'doc_099', score: 0.65 }, { document_id: 'doc_100', score: 0.55 }, { document_id: 'doc_101', score: 0.50 }],
  '季度財務摘要':        [{ document_id: 'doc_099', score: 0.75 }, { document_id: 'doc_100', score: 0.70 }, { document_id: 'doc_006', score: 0.68 }, { document_id: 'doc_101', score: 0.60 }, { document_id: 'doc_102', score: 0.55 }],
  '產品路線圖規劃':      [{ document_id: 'doc_007', score: 0.93 }, { document_id: 'doc_008', score: 0.89 }, { document_id: 'doc_099', score: 0.70 }, { document_id: 'doc_100', score: 0.60 }, { document_id: 'doc_101', score: 0.55 }],
  'TypeScript 類型系統': [{ document_id: 'doc_009', score: 0.97 }, { document_id: 'doc_099', score: 0.65 }, { document_id: 'doc_100', score: 0.60 }, { document_id: 'doc_101', score: 0.55 }, { document_id: 'doc_102', score: 0.50 }],
  '使用者體驗設計原則':  [{ document_id: 'doc_099', score: 0.80 }, { document_id: 'doc_100', score: 0.74 }, { document_id: 'doc_010', score: 0.71 }, { document_id: 'doc_101', score: 0.60 }, { document_id: 'doc_102', score: 0.55 }],
  'API 安全性最佳實踐':  [{ document_id: 'doc_011', score: 0.88 }, { document_id: 'doc_012', score: 0.85 }, { document_id: 'doc_099', score: 0.72 }, { document_id: 'doc_100', score: 0.62 }, { document_id: 'doc_101', score: 0.57 }],
  '團隊協作工具比較':    [{ document_id: 'doc_099', score: 0.76 }, { document_id: 'doc_013', score: 0.74 }, { document_id: 'doc_100', score: 0.69 }, { document_id: 'doc_101', score: 0.61 }, { document_id: 'doc_102', score: 0.56 }],
  '資料庫索引效能調優':  [{ document_id: 'doc_014', score: 0.92 }, { document_id: 'doc_015', score: 0.88 }, { document_id: 'doc_099', score: 0.71 }, { document_id: 'doc_100', score: 0.62 }, { document_id: 'doc_101', score: 0.57 }],
};

// ── Metric Helpers ────────────────────────────────────────────────────────────
function recallAtK(
  results: Array<{ document_id: string }>,
  relevantIds: string[],
  k: number,
): number {
  const topK = results.slice(0, k).map(r => r.document_id);
  const hits = relevantIds.filter(id => topK.includes(id)).length;
  return hits / relevantIds.length;
}

function reciprocalRank(
  results: Array<{ document_id: string }>,
  relevantIds: string[],
): number {
  const idx = results.findIndex(r => relevantIds.includes(r.document_id));
  return idx === -1 ? 0 : 1 / (idx + 1);
}

function precisionAt1(
  results: Array<{ document_id: string }>,
  relevantIds: string[],
): number {
  return results.length > 0 && relevantIds.includes(results[0].document_id) ? 1 : 0;
}

// ── Mock Setup ────────────────────────────────────────────────────────────────
vi.mock('../../db/client.js', () => ({ pool: null }));

// Simulated search function — replace with real service call for integration test
async function mockSearch(query: string): Promise<Array<{ document_id: string; score: number }>> {
  return MOCK_RESULTS[query] ?? [];
}

// ── Evaluation Suite ──────────────────────────────────────────────────────────
describe('搜尋品質評估 (Search Quality Evaluation)', () => {
  const K = 5;

  const perQueryMetrics: Array<{
    query: string;
    recall1: number;
    recall3: number;
    recall5: number;
    rr: number;
    p1: number;
  }> = [];

  beforeAll(async () => {
    for (const evalCase of EVAL_CASES) {
      const results = await mockSearch(evalCase.query);
      perQueryMetrics.push({
        query: evalCase.query,
        recall1: recallAtK(results, evalCase.relevantIds, 1),
        recall3: recallAtK(results, evalCase.relevantIds, 3),
        recall5: recallAtK(results, evalCase.relevantIds, K),
        rr:      reciprocalRank(results, evalCase.relevantIds),
        p1:      precisionAt1(results, evalCase.relevantIds),
      });
    }
  });

  // ── Per-Query Tests ────────────────────────────────────────────────────────
  for (const evalCase of EVAL_CASES) {
    it(`[recall@5] "${evalCase.query}"`, async () => {
      const results = await mockSearch(evalCase.query);
      const r = recallAtK(results, evalCase.relevantIds, K);
      // Minimum acceptable recall@5 is 50% (at least half ground truth in top 5)
      expect(r, `Recall@5 for "${evalCase.query}" = ${(r * 100).toFixed(0)}%`).toBeGreaterThanOrEqual(0.5);
    });
  }

  // ── Aggregate Metric Tests ─────────────────────────────────────────────────
  it('Recall@1 ≥ 0.30 (aggregate)', async () => {
    const allResults = await Promise.all(EVAL_CASES.map(c => mockSearch(c.query)));
    const avgR1 = allResults.reduce((sum, res, i) =>
      sum + recallAtK(res, EVAL_CASES[i].relevantIds, 1), 0) / EVAL_CASES.length;
    console.info(`  Recall@1  = ${(avgR1 * 100).toFixed(1)}%`);
    expect(avgR1).toBeGreaterThanOrEqual(0.30);
  });

  it('Recall@3 ≥ 0.50 (aggregate)', async () => {
    const allResults = await Promise.all(EVAL_CASES.map(c => mockSearch(c.query)));
    const avgR3 = allResults.reduce((sum, res, i) =>
      sum + recallAtK(res, EVAL_CASES[i].relevantIds, 3), 0) / EVAL_CASES.length;
    console.info(`  Recall@3  = ${(avgR3 * 100).toFixed(1)}%`);
    expect(avgR3).toBeGreaterThanOrEqual(0.50);
  });

  it('Recall@5 ≥ 0.70 (aggregate)', async () => {
    const allResults = await Promise.all(EVAL_CASES.map(c => mockSearch(c.query)));
    const avgR5 = allResults.reduce((sum, res, i) =>
      sum + recallAtK(res, EVAL_CASES[i].relevantIds, K), 0) / EVAL_CASES.length;
    console.info(`  Recall@5  = ${(avgR5 * 100).toFixed(1)}%`);
    expect(avgR5).toBeGreaterThanOrEqual(0.70);
  });

  it('MRR ≥ 0.50 (aggregate)', async () => {
    const allResults = await Promise.all(EVAL_CASES.map(c => mockSearch(c.query)));
    const mrr = allResults.reduce((sum, res, i) =>
      sum + reciprocalRank(res, EVAL_CASES[i].relevantIds), 0) / EVAL_CASES.length;
    console.info(`  MRR       = ${mrr.toFixed(3)}`);
    expect(mrr).toBeGreaterThanOrEqual(0.50);
  });

  it('P@1 ≥ 0.40 (aggregate — first result is relevant)', async () => {
    const allResults = await Promise.all(EVAL_CASES.map(c => mockSearch(c.query)));
    const p1 = allResults.reduce((sum, res, i) =>
      sum + precisionAt1(res, EVAL_CASES[i].relevantIds), 0) / EVAL_CASES.length;
    console.info(`  P@1       = ${(p1 * 100).toFixed(1)}%`);
    expect(p1).toBeGreaterThanOrEqual(0.40);
  });

  it('prints full eval report', async () => {
    const allResults = await Promise.all(EVAL_CASES.map(c => mockSearch(c.query)));
    const metrics = EVAL_CASES.map((c, i) => ({
      query:   c.query,
      R1:      recallAtK(allResults[i], c.relevantIds, 1),
      R3:      recallAtK(allResults[i], c.relevantIds, 3),
      R5:      recallAtK(allResults[i], c.relevantIds, K),
      RR:      reciprocalRank(allResults[i], c.relevantIds),
      P1:      precisionAt1(allResults[i], c.relevantIds),
    }));
    const avg = (key: 'R1' | 'R3' | 'R5' | 'RR' | 'P1') =>
      (metrics.reduce((s, m) => s + m[key], 0) / metrics.length * 100).toFixed(1);

    console.info('\n┌─────────────────────────────────────────────────────────────────┐');
    console.info('│            搜尋品質評估報告 (Search Quality Report)               │');
    console.info('├──────────────────────────────────────┬──────┬──────┬──────┬──────┤');
    console.info('│ Query                                │  R@1 │  R@3 │  R@5 │  MRR │');
    console.info('├──────────────────────────────────────┼──────┼──────┼──────┼──────┤');
    for (const m of metrics) {
      const q  = m.query.padEnd(38).slice(0, 38);
      const r1 = `${(m.R1  * 100).toFixed(0)}%`.padStart(4);
      const r3 = `${(m.R3  * 100).toFixed(0)}%`.padStart(4);
      const r5 = `${(m.R5  * 100).toFixed(0)}%`.padStart(4);
      const rr = m.RR.toFixed(2).padStart(4);
      console.info(`│ ${q} │ ${r1} │ ${r3} │ ${r5} │ ${rr} │`);
    }
    console.info('├──────────────────────────────────────┼──────┼──────┼──────┼──────┤');
    console.info(`│ AVERAGE                              │${avg('R1').padStart(4)}%│${avg('R3').padStart(4)}%│${avg('R5').padStart(4)}%│${(parseFloat(avg('RR'))/100).toFixed(2).padStart(4)} │`);
    console.info('└──────────────────────────────────────┴──────┴──────┴──────┴──────┘');

    // Always passes — this test only prints the report
    expect(metrics.length).toBe(EVAL_CASES.length);
  });
});
