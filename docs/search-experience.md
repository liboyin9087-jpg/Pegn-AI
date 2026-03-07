# Search Experience

## Response schema

Canonical search reads use `GET /api/v1/search`. The response always keeps the full envelope:

- `items`
- `total`
- `query`
- `normalizedQuery`
- `filtersApplied`
- `facets`
- `nextCursor`
- `durationMs`

Each result item returns:

- `documentId`
- `title`
- `type`
- `source`
- `snippet`
- `highlights`
- `matchedFields`
- `indexedAt`
- `updatedAt`
- `isStale`
- `staleReason`
- `score`

`query` is the original user input. `normalizedQuery` is the normalized version used by the search service after trimming and whitespace normalization.

`score is an internal ranking signal for within-response ordering/debug only and must not be treated as a stable cross-query or cross-version metric.`

`duration is returned as durationMs in milliseconds.`

## Cursor contract

`cursor is an opaque base64 token and must be treated as non-decodable client-side pagination state.`

Clients must only pass `nextCursor` back to the server. They must not decode, mutate, or reconstruct the token.

## Freshness and stale rules

Search freshness is computed on the backend.

`isStale` becomes `true` when:

- `documents.index_status = 'stale'`
- `documents.index_status = 'failed'`
- the document was updated after `search_index.indexed_at`
- the result has not been indexed yet

`staleReason` is one of:

- `document_updated_after_index`
- `document_marked_stale`
- `index_failed`
- `not_indexed`

## Snippet and highlights

The backend owns snippet and highlight generation.

- snippet uses the first content hit with a fixed preview window
- if no content snippet can be built, it falls back to title
- if title is also unavailable, it falls back to the fixed default message: `此結果目前沒有可顯示的摘要`

`When no content snippet can be generated, snippet falls back to title, and then to a fixed default preview message.`

`Each result returns at most 3 highlights, and each highlight is trimmed to a fixed preview window.`

## Filters and facets

Supported filters:

- `type`
- `source`
- `updatedFrom`
- `updatedTo`

Supported facets:

- `byType`
- `bySource`

Facet counts reflect `query + other filters` after the current search input is applied. The facet for the same field is not self-trimmed.

`Facet buckets normalize NULL / empty values to unknown on the backend; frontend must not remap them.`

## Reindex refresh behavior

Reindex endpoints return:

- `jobId`
- `status`
- `documentId`
- `indexStatus`

After a reindex action, the UI should refresh the active query instead of patching local result state manually.

## Retrieval eval dataset

The retrieval regression gate lives in:

- `apps/server/src/search/__fixtures__/retrievalDataset.ts`
- `apps/server/src/search/__tests__/retrievalEval.test.ts`

The fixture covers:

- title hit
- content hit
- stale document case
- mixed type/source case
- no-result case

The eval gate checks:

- average precision-ish threshold
- stale result rate
- no-result expectation consistency

## Out of scope

This patch does not include:

- ranking model retraining
- embedding strategy changes
- query suggestion overhaul
- router or page-shell redesign
- advanced date histogram facets
