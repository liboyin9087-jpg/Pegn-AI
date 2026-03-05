/**
 * searchEval.ts — Search quality evaluation metrics
 *
 * Three functions for offline regression testing:
 *   mrr()       — Mean Reciprocal Rank  (focus: first relevant hit)
 *   recallAtK() — Recall@K             (focus: coverage in top-K)
 *   ndcgAtK()   — nDCG@K               (focus: rank-weighted quality)
 *
 * Usage:
 *   import { mrr, recallAtK, ndcgAtK } from './searchEval.js';
 *   const score = mrr(['doc-1', 'doc-3'], results.map(r => r.id));
 */

/**
 * Mean Reciprocal Rank — returns 1/rank_of_first_relevant_hit, or 0 if none.
 * @param groundTruth  IDs of all relevant documents for this query
 * @param results      Ordered list of returned document IDs (best first)
 */
export function mrr(groundTruth: string[], results: string[]): number {
  const relevant = new Set(groundTruth);
  for (let i = 0; i < results.length; i++) {
    if (relevant.has(results[i])) return 1 / (i + 1);
  }
  return 0;
}

/**
 * Recall@K — fraction of relevant docs found in the top-K results.
 * @param groundTruth  IDs of all relevant documents
 * @param results      Ordered list of returned document IDs
 * @param k            Cut-off rank
 */
export function recallAtK(groundTruth: string[], results: string[], k: number): number {
  if (groundTruth.length === 0) return 1;          // vacuously 100 %
  const relevant = new Set(groundTruth);
  const topK     = results.slice(0, k);
  const hits     = topK.filter(id => relevant.has(id)).length;
  return hits / groundTruth.length;
}

/**
 * nDCG@K — Normalised Discounted Cumulative Gain (binary relevance).
 * @param groundTruth  IDs of all relevant documents
 * @param results      Ordered list of returned document IDs
 * @param k            Cut-off rank
 */
export function ndcgAtK(groundTruth: string[], results: string[], k: number): number {
  const relevant = new Set(groundTruth);
  const topK     = results.slice(0, k);

  // DCG — actual order
  let dcg = 0;
  for (let i = 0; i < topK.length; i++) {
    if (relevant.has(topK[i])) dcg += 1 / Math.log2(i + 2); // log2(rank+1)
  }

  // ideal DCG — all relevant docs at the top
  const idealHits = Math.min(groundTruth.length, k);
  let idcg = 0;
  for (let i = 0; i < idealHits; i++) idcg += 1 / Math.log2(i + 2);

  return idcg === 0 ? 0 : dcg / idcg;
}
