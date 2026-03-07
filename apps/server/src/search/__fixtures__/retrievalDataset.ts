export interface RetrievalEvalCase {
  name: string;
  query: string;
  expectedDocumentIds: string[];
  actualDocumentIds: string[];
  expectedHasResults: boolean;
  actualStaleCount: number;
}

export const retrievalDataset: RetrievalEvalCase[] = [
  {
    name: 'title hit',
    query: 'pricing spec',
    expectedDocumentIds: ['doc-pricing'],
    actualDocumentIds: ['doc-pricing'],
    expectedHasResults: true,
    actualStaleCount: 0,
  },
  {
    name: 'content hit',
    query: 'annual discounts',
    expectedDocumentIds: ['doc-pricing'],
    actualDocumentIds: ['doc-pricing'],
    expectedHasResults: true,
    actualStaleCount: 0,
  },
  {
    name: 'stale document case',
    query: 'migration checklist',
    expectedDocumentIds: ['doc-migration'],
    actualDocumentIds: ['doc-migration'],
    expectedHasResults: true,
    actualStaleCount: 1,
  },
  {
    name: 'mixed type and source',
    query: 'automation failures',
    expectedDocumentIds: ['doc-automation', 'doc-incidents'],
    actualDocumentIds: ['doc-automation', 'doc-incidents'],
    expectedHasResults: true,
    actualStaleCount: 0,
  },
  {
    name: 'no result',
    query: 'totally unknown phrase',
    expectedDocumentIds: [],
    actualDocumentIds: [],
    expectedHasResults: false,
    actualStaleCount: 0,
  },
];
