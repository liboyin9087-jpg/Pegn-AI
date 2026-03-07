# Admin Trust, Audit & Quota

## Scope

This patch adds a workspace-scoped governance surface for admins without changing domain truth ownership.

- `workspaces` remain workspace settings truth
- `workspace_members` and `workspace_invites` remain membership truth
- `documents`, `search_index`, `agent_runs`, `jobs`, and `agent_artifacts` remain domain truth for their own areas
- `audit_logs` is append-only governance/audit truth
- usage/quota summary is derived by service aggregation in this batch

## Canonical Routes

All routes below are workspace-scoped and require `canManageSettings`.

- `GET /api/v1/workspaces/:workspaceId/admin/summary`
- `GET /api/v1/workspaces/:workspaceId/audit-logs`
- `GET /api/v1/workspaces/:workspaceId/usage`
- `GET /api/v1/workspaces/:workspaceId/admin/alerts`

Legacy compatibility:

- `GET /api/v1/billing/usage`
- `PUT /api/v1/billing/quota`

The billing routes remain available, but they delegate to the same usage/quota aggregation logic.

## Audit Events

`audit_logs` is append-only. There is no update or delete API.

Fixed event types in this batch:

- `workspace_updated`
- `member_invited`
- `invite_revoked`
- `member_role_changed`
- `member_removed`
- `document_deleted`
- `document_reindexed`
- `agent_run_rerun`
- `automation_triggered`
- `quota_alert_raised`

Every audit item exposes:

- `id`
- `actorId`
- `actorDisplay`
- `eventType`
- `targetType`
- `targetId`
- `summary`
- `metadata`
- `createdAt`

Actor rules:

- user action: `actorId = user.id`, `actorDisplay = user.email` in the current implementation
- system action: `actorId = null`, `actorDisplay = 'System'`

## Audit Write Points

This batch records audit logs for:

- workspace settings update
- invite creation
- invite revoke
- document delete
- manual document reindex
- agent rerun
- automation manual trigger
- quota alert raise

`member_role_changed` and `member_removed` are reserved in the event type contract, but this repo does not yet expose canonical routes for those actions.

## Usage and Quota Summary

`GET /usage` returns workspace-level aggregation only.

Current fields:

- `documentsCount`
- `indexedDocumentsCount`
- `agentRunsLast7d`
- `agentRunsLast30d`
- `failedJobsLast7d`
- `failedJobsLast30d`
- `artifactsBytes`
- `quota`
- `quotaStatus`

`quota` currently includes:

- `documentsLimit`
- `storageBytesLimit`
- `agentRunsMonthlyLimit`
- `percentUsed`
- `thresholdReached`

This batch does not introduce snapshot storage. Values are aggregated from live tables:

- `documents`
- `search_index`
- `jobs`
- `agent_runs`
- `agent_artifacts`
- `quota_limits`
- `usage_records`

## Alerts

Fixed alert types in this batch:

- `recent_failed_jobs_spike`
- `stale_documents_present`
- `indexing_failures_present`
- `quota_threshold_reached`

Each alert item returns:

- `id`
- `type`
- `severity`
- `title`
- `description`
- `relatedTargetType`
- `relatedTargetId`
- `createdAt`

Deep-link behavior in the UI:

- failed jobs alert -> operations tab
- stale/indexing alert -> search tab
- quota alert -> usage/quota section in admin tab

## UI Rules

Admin surface is mounted in the existing `AiSheet` as an `admin` tab.

- `owner` and `admin`: can see admin summary, usage/quota, audit logs, alerts
- `editor` and `viewer`: admin tab is hidden
- if a non-admin reaches the surface indirectly, the UI renders `ForbiddenState`

## Out of Scope

This batch does not implement:

- org-level governance
- SCIM / SSO
- billing engine redesign
- workspace config versioning
- audit event editing or redaction
- usage snapshot/materialized storage
