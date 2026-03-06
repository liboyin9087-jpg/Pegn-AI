# Search Lifecycle

## Scope

This document defines the minimum document indexing lifecycle used by the current search stack.

Production data flow:

1. `documents`
2. `blocks`
3. `search_index`
4. `content_vector` on `search_index`

This patch does not introduce a queue, repair job, or document-level debug endpoint. It only establishes a consistent lifecycle contract.

## Status Model

`documents.index_status` is the single source of truth for search lifecycle state.

- `pending`
  - The document exists but has not completed its first successful index yet.
- `indexed`
  - The current search data matches the latest document state.
- `stale`
  - The document changed after the last successful index and needs a rebuild.
- `failed`
  - The latest indexing attempt failed.

Related document fields:

- `last_indexed_at`
- `index_error`

## State Transitions

### Document create

- New document rows start as `pending`.
- The route may trigger `enqueueDocumentReindex(documentId, workspaceId)` immediately.

### Initial indexing success

- `pending -> indexed`
- `last_indexed_at` is updated
- `index_error` is cleared

### Document update

- `indexed -> stale`
- `failed -> stale`
- `pending` stays `pending`

Routes do not update `documents.index_status` directly. They call `searchService.markDocumentIndexStale(...)`.

### Block mutation

- Block create, update, and delete must mark the owning document as stale through the search lifecycle service.
- If the document has never been indexed, it remains `pending`.

Current repo status:

- A thin helper exists in `apps/server/src/services/blocks.ts` for future block mutation integration.
- Existing production routing in this patch is focused on document-level lifecycle wiring.

### Indexing failure

- `pending -> failed`
- `stale -> failed`
- `index_error` stores a trimmed message for diagnostics

### Document delete

- `searchService.cleanupDocumentIndex(documentId, workspaceId)` removes search rows before the document is deleted
- Deleted documents must not remain in search results or lifecycle summaries

## Service Responsibilities

`apps/server/src/services/search.ts` owns lifecycle transitions:

- `markDocumentIndexStale(documentId, workspaceId)`
- `markDocumentIndexFailed(documentId, workspaceId, errorMessage?)`
- `markDocumentIndexed(documentId, workspaceId)`
- `enqueueDocumentReindex(documentId, workspaceId)`
- `cleanupDocumentIndex(documentId, workspaceId)`
- `getIndexStatusSummary(workspaceId)`

Route layer responsibilities are limited to:

- request validation
- permission checks
- service calls
- response formatting

## API Contract

`GET /api/v1/search/index-status?workspace_id=...`

Response shape:

```json
{
  "totalDocuments": 120,
  "pendingDocuments": 8,
  "indexedDocuments": 95,
  "staleDocuments": 14,
  "failedDocuments": 3,
  "lastIndexedAt": "2026-03-07T10:20:00.000Z"
}
```

Rules:

- workspace scoped only
- summary is sourced from `documents`
- deleted documents are excluded

## Cleanup Rules

- Document deletion must clean `search_index` rows in the same workspace before removing the document record.
- This patch does not auto-repair orphaned data during application startup.
- Use the preflight audit before shipping lifecycle changes to an existing database.

## Future Extensions

- async indexing queue
- retry / repair flows
- coalescing for repeated block mutations
- document-level debug endpoint
