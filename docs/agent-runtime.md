# Agent Runtime

## Overview

The agent runtime is run-centric.

- Every execution creates a persisted `run_id`
- `agent_runs` is the source of truth
- SSE is only an event transport layer

This means the UI can restore state after reload, inspect recent history, and render structured failures without relying on an uninterrupted stream connection.

## Run Model

Each run stores:

- `id`
- `workspace_id`
- `user_id`
- `status`
- `input_summary`
- `output_summary`
- `error_summary`
- `created_at`
- `started_at`
- `finished_at`

Existing operational fields such as `type`, `mode`, `result`, `parent_run_id`, `root_run_id`, and `depth` remain available for orchestration and debug use.

## Statuses

Public run statuses are:

- `queued`
- `running`
- `completed`
- `failed`

`queued` is a valid status but may be very short-lived. UI and tests must not depend on it remaining visible for a specific duration.

## State Transitions

### Create

- `POST /api/v1/agents/runs`
- Inserts a queued run
- Returns the newly created run

### Start

- Internal runtime step
- `queued -> running`
- Sets `started_at`

### Complete

- Internal runtime step
- `running -> completed`
- Sets `finished_at`
- Writes `output_summary`

### Fail

- Internal runtime step
- `queued/running -> failed`
- Sets `finished_at`
- Writes `error_summary`

Retry does not reuse the failed run. It always creates a new run.

## API Contract

### Create and Start

`POST /api/v1/agents/runs`

Request:

```json
{
  "workspace_id": "ws-1",
  "input": "Summarize the latest project notes",
  "mode": "hybrid",
  "template": "summarize"
}
```

Response:

```json
{
  "id": "run-uuid",
  "workspaceId": "ws-1",
  "userId": "user-1",
  "status": "queued",
  "inputSummary": "Summarize the latest project notes",
  "createdAt": "2026-03-07T10:00:00.000Z",
  "steps": []
}
```

### Read One Run

`GET /api/v1/agents/runs/:id?workspace_id=ws-1`

- Requires both `workspace_id` and authenticated `user_id`
- Only returns runs owned by that user in that workspace

### List Recent Runs

`GET /api/v1/agents/runs?workspace_id=ws-1&limit=10`

- Recent run history for the current user within the workspace

### Stream Existing Run

`GET /api/v1/agents/runs/:id/stream?workspace_id=ws-1`

- Attaches to an existing run only
- Never creates or starts a run implicitly
- Sends `meta`, `step`, `token`, `run`, `error`, and `done` events

## SSE Role

SSE is not the source of truth.

- `run` events are authoritative snapshots
- `token` events are incremental UI updates only
- If the stream disconnects, the client can recover with `GET /api/v1/agents/runs/:id`

## Error Summary Rules

`error_summary` should be:

- safe for product UI
- short
- stable enough for history and retry UX

Good examples:

- `Provider timeout`
- `Model unavailable`
- `Malformed model response`
- `Run interrupted by server restart`

Avoid:

- raw stack traces
- internal secret-bearing payloads
- massive prompt dumps

## Legacy Compatibility

Legacy template routes may remain:

- `/api/v1/agents/supervisor`
- `/api/v1/agents/research`
- `/api/v1/agents/summarize`
- `/api/v1/agents/brainstorm`
- `/api/v1/agents/outline`

They are compatibility wrappers only. Execution truth still lives in the unified run lifecycle.

## Future Extensions

Out of scope for this batch:

- cancel
- timed_out
- partial_success
- queue / scheduler
- billing integration
- richer step-level monitoring UI
