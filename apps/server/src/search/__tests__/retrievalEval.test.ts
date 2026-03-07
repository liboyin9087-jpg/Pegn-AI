import { describe, expect, it } from 'vitest';
import { retrievalDataset } from '../__fixtures__/retrievalDataset.js';

function precisionScore(expected: string[], actual: string[]) {
  if (actual.length === 0) return expected.length === 0 ? 1 : 0;
  const hits = actual.filter((id) => expected.includes(id)).length;
  return hits / actual.length;
}

describe('retrieval evaluation dataset', () => {
  it('keeps precision-ish quality above the minimum threshold', () => {
    const precisionScores = retrievalDataset.map((entry) => precisionScore(entry.expectedDocumentIds, entry.actualDocumentIds));
    const averagePrecision = precisionScores.reduce((sum, value) => sum + value, 0) / precisionScores.length;
    expect(averagePrecision).toBeGreaterThanOrEqual(0.8);
  });

  it('keeps stale result rate under control', () => {
    const totalReturned = retrievalDataset.reduce((sum, entry) => sum + entry.actualDocumentIds.length, 0);
    const staleReturned = retrievalDataset.reduce((sum, entry) => sum + entry.actualStaleCount, 0);
    const staleRate = totalReturned === 0 ? 0 : staleReturned / totalReturned;
    expect(staleRate).toBeLessThanOrEqual(0.25);
  });

  it('keeps no-result behavior aligned with the dataset expectations', () => {
    const alignedCases = retrievalDataset.filter(
      (entry) => entry.expectedHasResults === (entry.actualDocumentIds.length > 0)
    );
    expect(alignedCases).toHaveLength(retrievalDataset.length);
  });
});
