# Saved Views & Workspace Context

## Summary

Saved views capture a workspace-scoped surface context. They do not duplicate domain truth such as documents, jobs, runs, notifications, or admin summaries.

Supported surfaces:

- `search`
- `operations`
- `agent`
- `inbox`
- `admin`

## Canonical Model

Each saved view stores:

- `surface`
- `scope`
- `name`
- `description`
- `contextVersion`
- `payload`
- `isPinned`
- `isDefault`

`contextVersion` is required for create, update, and detail responses. The current version is `1`.

All saved views must carry `contextVersion`, starting at `1`, and payload normalization must handle missing or legacy versions safely.

## Scope Rules

- `personal`
  - bound to a single user and workspace
  - read/write by the owner only
- `workspace`
  - readable by any workspace member with `canViewWorkspace`
  - create/update/delete requires `canManageSettings`

`canViewWorkspace` only allows reading workspace views.  
`canManageSettings` is required to create, update, or delete workspace views.  
Personal views are always owner-only for mutation.

## Default and Pinned Rules

- `isPinned` may be used on both personal and workspace views
- `isDefault` is always resolved at user level per `(user, workspace, surface)`
- service logic guarantees at most one default per `(user, workspace, surface)`

Saved view list ordering is fixed to:

1. pinned first
2. grouped by scope
3. `updatedAt DESC` within each group

## Payload Schemas

### Search

- `query`
- `filters`
- `type`
- `source`
- `updatedRange`
- `staleOnly`
- `sort`
- `selectedDocumentId`
- `selectedTraceJobId`

### Operations

- `status`
- `jobType`
- `resourceType`
- `selectedJobId`
- `detailOpen`
- `showFailedOnly`

### Agent

- `threadId`
- `status`
- `agentType`
- `selectedRunId`
- `detailOpen`
- `showFailuresOnly`

### Inbox

- `filter`
- `unreadOnly`
- `type`
- `selectedNotificationId`

### Admin

- `section`
- `auditFilter`
- `eventType`
- `targetType`
- `selectedAlertId`

`captureCurrentSurfaceContext(surface)` must only return fields defined by the canonical payload schema for that surface.

## Apply and Fallback Rules

Saved view apply is handled entirely in app-level in-app navigation state. There is no backend apply route.

When a saved view is applied:

1. hydrate `query/filter/tab/section`
2. trigger the surface refresh
3. resolve the optional selected target

When a selected target no longer exists, apply must preserve `query/filter/tab/section` state and only clear the invalid selected target.

Safe fallback examples:

- missing `selectedDocumentId` -> open search with the saved query and filters
- missing `selectedJobId` -> open operations list with saved filters
- missing `selectedRunId` -> open agent history with saved filters
- missing `selectedNotificationId` -> open inbox list with saved filters
- missing `selectedAlertId` -> open admin section with saved filters

## UI Behavior

- `PinnedViewsBar` shows pinned views for the current workspace
- `SavedViewPicker` lists available views for the active surface
- `SaveCurrentViewDialog` saves the current surface context
- applying a saved view routes through the shared app navigation controller

## Out of Scope

- shareable URLs
- org-level shared views
- public links
- router/page shell overhaul
- dashboard layout builder
