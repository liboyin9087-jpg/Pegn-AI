# Cloud Run deployment (Web + API + Sync)

This project deploys as 3 Cloud Run services:
- `pegn-api` (Express API on port 8080)
- `pegn-sync` (Hocuspocus sync websocket on port 8080)
- `pegn-web` (Nginx static web on port 80)

## Prerequisites

1. Install Google Cloud SDK (`gcloud`).
2. Authenticate:
   - `gcloud auth login`
   - `gcloud auth application-default login`
3. Prepare server env file:
   - Copy `apps/server/.env.cloudrun.example` to `apps/server/.env.cloudrun`
   - Fill production values (`DATABASE_URL`, `JWT_SECRET`, OAuth keys, etc.)

## Deploy command (PowerShell)

From repo root:

`powershell -ExecutionPolicy Bypass -File deploy/cloudrun/deploy.ps1 -ProjectId <YOUR_GCP_PROJECT_ID> -Region asia-east1`

Optional flags:
- `-Repo pegn-ai`
- `-ApiService pegn-api -SyncService pegn-sync -WebService pegn-web`
- `-ServerEnvFile apps/server/.env.cloudrun`
- `-Tag 20260303-1`

## Notes

- First deploy sets web build-time API URL automatically.
- After web URL is available, set `CORS_ORIGIN` and `FRONTEND_URL` in `.env.cloudrun` to that web URL and redeploy API for strict CORS.
- WebSocket URLs are injected at web build time (`VITE_WS_URL`, `VITE_SYNC_URL`).
