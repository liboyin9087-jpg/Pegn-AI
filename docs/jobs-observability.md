# Jobs Observability

## Purpose

`jobs` and `job_events` provide a shared observability layer for async work across search, agent, and automation flows.

They do not replace domain truth:

- `documents.index_status` and `search_index` remain the search truth
- `agent_runs` remain the agent truth
- `automation_runs` remain the automation truth
- `jobs` only track execution state, failure summary, retry or cancel requests, and event timelines

## Job Types

Supported `job_type` values in this batch:

- `document_index`
- `document_reindex`
- `agent_run`
- `automation_trigger`

## Job Status

Supported `status` values:

- `queued`
- `running`
- `succeeded`
- `failed`
- `cancelled`
- `timeout`

Legal transitions:

- `queued -> running`
- `queued -> cancelled`
- `queued -> failed`
- `running -> succeeded`
- `running -> failed`
- `running -> timeout`
- `running -> cancelled`

Retry is not a status transition. Retry always creates a new job and links it back with `retry_of_job_id`.

## Job Events

Supported `job_events.event_type` values:

- `queued`
- `started`
- `progress`
- `retry_requested`
- `retry_started`
- `cancel_requested`
- `cancelled`
- `failed`
- `completed`
- `timed_out`

`sequence_no` is unique per job and defines timeline order. API responses always return events sorted ascending by `sequenceNo`.

## Permissions

Read APIs always use `canViewWorkspace`:

- jobs list
- jobs summary
- job detail
- job events

Retry and cancel map back to the original domain capability:

- `document_index` / `document_reindex` -> `canEditDocuments`
- `agent_run` -> `canRunAutomation`
- `automation_trigger` -> `canRunAutomation`

## API Surface

Workspace-level APIs:

- `GET /api/v1/workspaces/:workspaceId/jobs`
- `GET /api/v1/workspaces/:workspaceId/jobs/summary`
- `GET /api/v1/workspaces/:workspaceId/jobs/:jobId`
- `GET /api/v1/workspaces/:workspaceId/jobs/:jobId/events`
- `POST /api/v1/workspaces/:workspaceId/jobs/:jobId/retry`
- `POST /api/v1/workspaces/:workspaceId/jobs/:jobId/cancel`

Retry rules:

- only `failed` and `timeout` jobs are retryable
- retry returns a new `jobId`
- original job history remains immutable

Cancel rules:

- only `queued` and `running` jobs accept cancel requests
- this batch uses `cancel_requested_at` instead of a dedicated `cancelling` status
- runtimes mark the final job state as `cancelled` once execution stops cooperatively

## UI Surface

Operations UI lives inside `apps/web/src/components/AiSheet.tsx` as the `operations` tab.

Existing domain panels expose the trace surface:

- AgentPanel stores and opens `jobId`
- SearchPanel links to indexing jobs
- AutomationPanel exposes the most recent trigger trace

## Out of Scope

This batch does not add:

- public create job APIs
- distributed queue or worker redesign
- APM replacement
- billing or usage pipelines
- a new `cancelling` status
- a dedicated operations router or page shell
