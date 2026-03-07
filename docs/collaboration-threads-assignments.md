# Collaboration Threads & Assignments

## Summary

P3-B adds target-based collaboration threads for workspace surfaces without turning the product into a chat system. Threads are canonical per target and support comments, explicit mentions, thread-level assignment, resolve, and reopen.

## Supported Target Types

- `document`
- `agentRun`
- `job`
- `adminAlert`

Each target has at most one canonical thread for a given `(workspace_id, target_type, target_id)`.

## Canonical Routes

- `POST /api/v1/threads`
- `GET /api/v1/threads`
- `GET /api/v1/threads/:threadId`
- `POST /api/v1/threads/:threadId/comments`
- `POST /api/v1/threads/:threadId/assignments`
- `POST /api/v1/threads/:threadId/resolve`
- `POST /api/v1/threads/:threadId/reopen`

## Data Model

### collaboration_threads

- `id`
- `workspace_id`
- `target_type`
- `target_id`
- `status`
- `title`
- `created_by_user_id`
- `last_activity_at`
- `resolved_at`
- `created_at`
- `updated_at`

Thread status is fixed to:

- `open`
- `in_progress`
- `resolved`

### thread_comments

- `id`
- `thread_id`
- `workspace_id`
- `author_user_id`
- `body`
- `mentioned_user_ids`
- `created_at`
- `updated_at`

Mentions are explicit through `mentionedUserIds[]`. Backend validates members and projects mention notifications.

### thread_assignments

- `id`
- `thread_id`
- `workspace_id`
- `assigned_to_user_id`
- `assigned_by_user_id`
- `status`
- `due_at`
- `is_current`
- `created_at`
- `updated_at`
- `resolved_at`

Assignments are thread-level. Each thread may have many assignment records, but only one `is_current = true`.

## Inbox Projection Rules

Thread collaboration only projects two inbox notification types:

- `mention`
- `assignment`

Mention notifications originate from thread comments and point back to the thread source target. Assignment notifications originate from thread-level assignment and point back to the same source target.

## Permissions

- `canViewWorkspace`
  - read thread list/detail
- `canCollaborate`
  - create thread
  - add comment
  - resolve
  - reopen
- `canManageAssignments`
  - assign / reassign

Role mapping:

- `owner` / `admin` / `editor`
  - `canCollaborate = true`
  - `canManageAssignments = true`
- `viewer`
  - read-only

## Status Rules

- New thread starts as `open`
- Adding a comment does not auto-reopen a resolved thread
- Reopen is explicit
- Resolving a thread also resolves the current assignment if one exists

## Fallback Rules

If a thread source target can no longer be opened because the entity is missing:

- `document` → Search default view
- `job` → Operations default list
- `agentRun` → Agent history
- `adminAlert` → Admin alerts section

The thread itself must still remain readable.

## Out of Scope

- Free-form workspace chat
- Comment-on-comment threads
- Rich text comments
- Emoji reactions
- Read receipts
- Typing indicators
- Comment edit history
- Org-level collaboration hub
