# Secret Inventory

## Required at runtime
- `DATABASE_URL`: PostgreSQL connection string.
- `REDIS_URL`: Redis connection string.
- `JWT_SECRET`: required in production; default/dev values are not allowed.
- `SESSION_SECRET`: required for OAuth/session flows.
- `GEMINI_API_KEY`: required for Gemini-backed AI generation and embeddings.

## Deployment controls
- `DATABASE_AUTO_MIGRATE`: default `false` in production deployments.
- `PG_POOL_MAX`
- `PG_POOL_MIN`
- `PG_IDLE_TIMEOUT_MS`
- `PG_CONNECTION_TIMEOUT_MS`
- `PG_MAX_USES`
- `CORS_ORIGIN`
- `FRONTEND_URL`

## Ownership
- Engineering: rotate application/runtime secrets.
- Infra/DevOps: provision Cloud Run secrets and database credentials.
- Product/Operations: maintain status page, incident contacts, and customer comms templates.
