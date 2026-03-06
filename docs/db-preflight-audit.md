# Database Preflight Audit

Run these checks against the target PostgreSQL database before shipping the P0 contract-alignment patch.

## Green Conditions
- `workspace_members` has both `role` and `role_id`
- global `roles.name` includes `admin`, `editor`, `viewer`
- `inbox_notifications.type` contains only `mention`, `quota_alert`, `automation`
- there are no orphaned `workspace_members.role_id` references
- there are no orphaned `search_index.document_id` references
- `search_index.content_vector` and `documents.workspace_id` exist

## Stop-Ship Conditions
- missing `workspace_members.role`, `workspace_members.role_id`, `roles.name`, `search_index.document_id`, `search_index.content_vector`, or `documents.workspace_id`
- non-null `workspace_members.role_id` rows that do not join `roles.id`
- `inbox_notifications.type` values outside `mention`, `quota_alert`, `automation`
- orphaned `search_index.document_id` rows

Do not auto-clean production data during app startup. Fix bad rows manually first, then rerun this audit.

## Audit SQL

### 1. `workspace_members` columns
```sql
SELECT column_name
FROM information_schema.columns
WHERE table_name = 'workspace_members'
  AND column_name IN ('role', 'role_id')
ORDER BY column_name;
```

### 2. `workspace_members.role_id` null / orphan counts
```sql
SELECT COUNT(*) AS null_role_id_count
FROM workspace_members
WHERE role_id IS NULL;

SELECT COUNT(*) AS orphan_role_id_count
FROM workspace_members wm
LEFT JOIN roles r ON wm.role_id = r.id
WHERE wm.role_id IS NOT NULL
  AND r.id IS NULL;
```

### 3. Legacy role values still present
```sql
SELECT role, COUNT(*) AS row_count
FROM workspace_members
GROUP BY role
ORDER BY role;
```

### 4. Global role names
```sql
SELECT name, COUNT(*) AS row_count
FROM roles
WHERE workspace_id IS NULL
GROUP BY name
ORDER BY name;
```

### 5. `inbox_notifications.type` values
```sql
SELECT type, COUNT(*) AS row_count
FROM inbox_notifications
GROUP BY type
ORDER BY type;

SELECT COUNT(*) AS null_type_count
FROM inbox_notifications
WHERE type IS NULL;
```

### 6. Search/index contract columns
```sql
SELECT table_name, column_name
FROM information_schema.columns
WHERE (table_name = 'search_index' AND column_name IN ('document_id', 'content_vector'))
   OR (table_name = 'documents' AND column_name = 'workspace_id')
ORDER BY table_name, column_name;
```

### 7. Orphaned search-index rows
```sql
SELECT COUNT(*) AS orphan_search_document_count
FROM search_index si
LEFT JOIN documents d ON si.document_id = d.id
WHERE d.id IS NULL;
```
