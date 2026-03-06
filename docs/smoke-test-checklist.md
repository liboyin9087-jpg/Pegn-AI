# Smoke Test Checklist

## A. Documents
- login succeeds
- create workspace succeeds
- create document succeeds
- edit document content
- refresh and confirm content still exists

## B. Search
- create or update a document with searchable text
- trigger indexing or reindex
- `/api/v1/search` returns the document
- `/api/v1/search/index-status?workspace_id=...` returns without SQL error

## C. Inbox
- create a mention and confirm a `mention` notification appears
- trigger quota usage over threshold and confirm a `quota_alert` notification appears
- trigger an automation notify action and confirm an `automation` notification appears
- mark one notification read
- mark all notifications read

## D. Agent
- start an agent run
- confirm SSE emits `step`, `token`, and `run`
- confirm UI leaves loading state on `done`
- confirm SSE error leaves partial answer intact and marks the run as errored
