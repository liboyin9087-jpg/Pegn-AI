# Workspace Permissions

## Roles

- `owner`: legacy-compatible highest access
- `admin`: full workspace management
- `editor`: can edit and delete documents, can run agent and automation actions, cannot manage members or settings
- `viewer`: read-only workspace access

## Permission Matrix

| Role | canViewWorkspace | canManageMembers | canManageSettings | canEditDocuments | canDeleteDocuments | canRunAutomation |
| --- | --- | --- | --- | --- | --- | --- |
| owner | true | true | true | true | true | true |
| admin | true | true | true | true | true | true |
| editor | true | false | false | true | true | true |
| viewer | true | false | false | false | false | false |

## Backend Guard Rules

- `GET /api/v1/workspaces` and `GET /api/v1/workspaces/:workspaceId` return `effectiveRole`, `permissions`, and `permissionSummary`.
- workspace settings update and delete require `canManageSettings`.
- invite create/list/revoke require `canManageMembers`.
- members list requires `canViewWorkspace`.
- document create/update/rename/move/parent-set require `canEditDocuments`.
- document delete requires `canDeleteDocuments`.
- agent run creation and legacy template run endpoints require `canRunAutomation`.
- automation create/update/delete/manual trigger require `canRunAutomation`.
- capability guard failures return:

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to perform this action"
  }
}
```

## Frontend Display Rules

- UI is driven by `permissionSummary`, not by raw role string checks.
- `ShareModal` always shows members for readable workspaces, but invite and revoke controls only render for `canManageMembers`.
- `Sidebar` shows a read-only workspace state when `canEditDocuments` is false.
- `AgentPanel` keeps run history readable for viewers, but run and retry actions require `canRunAutomation`.

## Legacy Fallback

- `workspace_members.role_id -> roles.name` is the primary source of role resolution.
- `workspace_members.role` remains the legacy fallback.
- `owner` is supported for compatibility only and maps to full permissions.
- compatibility `permissions: string[]` remain in API responses so existing code paths can phase out gradually.

## Out of Scope

- custom roles
- field-level ACL
- guest or public share models
- org-level governance
