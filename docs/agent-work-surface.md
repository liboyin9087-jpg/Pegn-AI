# Agent Work Surface

## Canonical routes

- `GET /api/v1/agents/runs`
- `GET /api/v1/agents/runs/:runId`
- `GET /api/v1/agents/runs/:runId/artifacts`
- `POST /api/v1/agents/runs/:runId/rerun`

Legacy create and template routes stay in place, but they delegate to the same runtime/service flow and return `runId` plus `jobId`.

## Truth boundaries

- `agent_runs` is the agent domain truth for run status, input/output, thread grouping, rerun linkage, and prompt trace fields.
- `jobs` and `job_events` remain execution trace truth only.
- The agent service shapes list/detail/artifacts/citations responses for UI consumption.

## Run list and detail

Run list is ordered by:

1. `created_at DESC`
2. `id DESC`

Each run list item returns:

- `runId`
- `threadId`
- `status`
- `title`
- `inputPreview`
- `outputPreview`
- `errorSummary`
- `jobId`
- `promptVersion`
- `promptLabel`
- `templateId`
- `templateVersion`
- `createdAt`
- `startedAt`
- `finishedAt`
- `rerunOfRunId`

Run detail returns:

- `runId`
- `workspaceId`
- `threadId`
- `status`
- `input`
- `output`
- `errorCode`
- `errorSummary`
- `jobId`
- `promptVersion`
- `promptLabel`
- `templateId`
- `templateVersion`
- `citations`
- `relatedArtifacts`
- `createdAt`
- `startedAt`
- `finishedAt`
- `rerunOfRunId`

## Rerun rules

- Rerun always creates a new business run.
- The original run is never overwritten.
- The new run stores `rerun_of_run_id = oldRunId`.
- Rerun inherits:
  - `workspace_id`
  - `thread_id`
  - `template_id`
  - `template_version`
  - original input snapshot
- Rerun does not inherit:
  - old run status
  - old run output
  - old job id
  - old artifacts

Rerun is not the same thing as job retry.

## Prompt trace

Prompt trace is intentionally small in this batch:

- `promptVersion`
- `promptLabel`
- `templateId`
- `templateVersion`

This patch does not introduce a prompt registry or template version platform.

## Citations and artifacts

Citations are shaped on the backend. The canonical citation fields are:

- `id`
- `title`
- `sourceType`
- `sourceId`
- `snippet`
- `href`

Artifacts come from `agent_artifacts`, not by ad-hoc parsing of `run.result`.

Artifact metadata is summary-only in this batch:

- `artifactId`
- `type`
- `title`
- `mimeType`
- `size`
- `metadata`
- `createdAt`

`metadata` may already hold future storage pointers such as `storageKey`, `url`, and `provider`, but this batch does not implement download flows.

## UI permissions

- viewer:
  - can read run list
  - can read run detail
  - cannot rerun
  - cannot manually invoke
- editor/admin:
  - can read list/detail
  - can rerun
  - can manually invoke

Failure UX should always show:

- `errorSummary`
- `jobId` trace entry point
- rerun action when permission allows it

## Out of scope

- prompt registry platform
- workflow builder
- agent memory system
- multimodal artifact storage redesign
- new page shell or router overhaul
