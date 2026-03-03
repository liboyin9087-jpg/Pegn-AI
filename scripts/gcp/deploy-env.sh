#!/usr/bin/env bash
set -euo pipefail

ENV_NAME="${1:-}"
if [[ -z "$ENV_NAME" ]]; then
  echo "Usage: scripts/gcp/deploy-env.sh <stg|prod>"
  exit 1
fi

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-asia-east1}"
AR_REPO="${AR_REPO:-pegn-artifacts}"
APP_NAME="${APP_NAME:-pegn}"
SQL_INSTANCE="${SQL_INSTANCE:-pegn-shared-pg}"
ALLOW_UNAUTHENTICATED="${ALLOW_UNAUTHENTICATED:-true}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "[ERROR] PROJECT_ID is required"
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "[ERROR] gcloud is not installed"
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null

UPPER_ENV="$(echo "$ENV_NAME" | tr '[:lower:]' '[:upper:]')"
API_SERVICE="${APP_NAME}-api-${ENV_NAME}"
SYNC_SERVICE="${APP_NAME}-sync-${ENV_NAME}"
WEB_SERVICE="${APP_NAME}-web-${ENV_NAME}"

SERVER_IMAGE="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/server:${ENV_NAME}-$(date +%Y%m%d%H%M%S)"
WEB_IMAGE_TMP="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/web:${ENV_NAME}-tmp-$(date +%Y%m%d%H%M%S)"
WEB_IMAGE_FINAL="${REGION}-docker.pkg.dev/${PROJECT_ID}/${AR_REPO}/web:${ENV_NAME}-$(date +%Y%m%d%H%M%S)"

INSTANCE_CONNECTION_NAME="$(gcloud sql instances describe "$SQL_INSTANCE" --format='value(connectionName)')"
if [[ -z "$INSTANCE_CONNECTION_NAME" ]]; then
  echo "[ERROR] Unable to resolve Cloud SQL connection name for: $SQL_INSTANCE"
  exit 1
fi

if [[ "$ALLOW_UNAUTHENTICATED" == "true" ]]; then
  AUTH_FLAG=(--allow-unauthenticated)
else
  AUTH_FLAG=(--no-allow-unauthenticated)
fi

SECRET_ARGS=(
  "DATABASE_URL=DATABASE_URL_${UPPER_ENV}:latest"
  "JWT_SECRET=JWT_SECRET_${UPPER_ENV}:latest"
  "SESSION_SECRET=SESSION_SECRET_${UPPER_ENV}:latest"
  "GEMINI_API_KEY=GEMINI_API_KEY_${UPPER_ENV}:latest"
)

if gcloud secrets describe "OPENAI_API_KEY_${UPPER_ENV}" >/dev/null 2>&1; then
  SECRET_ARGS+=("OPENAI_API_KEY=OPENAI_API_KEY_${UPPER_ENV}:latest")
fi

join_by_comma() {
  local IFS=,
  echo "$*"
}

SECRETS_ARG="$(join_by_comma "${SECRET_ARGS[@]}")"

echo "[1/6] Build server image"
gcloud builds submit ./apps/server --tag "$SERVER_IMAGE"

echo "[2/6] Deploy temporary web to get stable web origin"
cat << 'YAML' > cloudbuild.yaml
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - -t
      - ${_IMAGE}
      - --build-arg
      - VITE_API_URL=${_VITE_API_URL}
      - --build-arg
      - VITE_SYNC_URL=${_VITE_SYNC_URL}
      - .
images:
  - ${_IMAGE}
YAML

gcloud builds submit ./apps/web \
  --config=cloudbuild.yaml \
  --substitutions="_IMAGE=${WEB_IMAGE_TMP},_VITE_API_URL=https://example.invalid,_VITE_SYNC_URL=wss://example.invalid"

gcloud run deploy "$WEB_SERVICE" \
  --image "$WEB_IMAGE_TMP" \
  --region "$REGION" \
  --platform managed \
  --port 80 \
  "${AUTH_FLAG[@]}"

WEB_URL="$(gcloud run services describe "$WEB_SERVICE" --region "$REGION" --format='value(status.url)')"
if [[ -z "$WEB_URL" ]]; then
  echo "[ERROR] Unable to resolve web URL"
  exit 1
fi

echo "[3/6] Deploy API service"
gcloud run deploy "$API_SERVICE" \
  --image "$SERVER_IMAGE" \
  --region "$REGION" \
  --platform managed \
  --port 8080 \
  --add-cloudsql-instances "$INSTANCE_CONNECTION_NAME" \
  --set-env-vars "NODE_ENV=production,APP_ROLE=api,API_PORT=8080,CORS_ORIGIN=${WEB_URL},FRONTEND_URL=${WEB_URL}" \
  --set-secrets "$SECRETS_ARG" \
  "${AUTH_FLAG[@]}"

API_URL="$(gcloud run services describe "$API_SERVICE" --region "$REGION" --format='value(status.url)')"
if [[ -z "$API_URL" ]]; then
  echo "[ERROR] Unable to resolve API URL"
  exit 1
fi

echo "[4/6] Deploy Sync service"
gcloud run deploy "$SYNC_SERVICE" \
  --image "$SERVER_IMAGE" \
  --region "$REGION" \
  --platform managed \
  --port 8080 \
  --add-cloudsql-instances "$INSTANCE_CONNECTION_NAME" \
  --set-env-vars "NODE_ENV=production,APP_ROLE=sync,SYNC_PORT=8080" \
  --set-secrets "$SECRETS_ARG" \
  "${AUTH_FLAG[@]}"

SYNC_URL="$(gcloud run services describe "$SYNC_SERVICE" --region "$REGION" --format='value(status.url)')"
if [[ -z "$SYNC_URL" ]]; then
  echo "[ERROR] Unable to resolve Sync URL"
  exit 1
fi

SYNC_WS_URL="${SYNC_URL/https:\/\//wss://}"

echo "[5/6] Rebuild web with real API/SYNC URLs"
cat << 'YAML' > cloudbuild.yaml
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - -t
      - ${_IMAGE}
      - --build-arg
      - VITE_API_URL=${_VITE_API_URL}
      - --build-arg
      - VITE_SYNC_URL=${_VITE_SYNC_URL}
      - .
images:
  - ${_IMAGE}
YAML

gcloud builds submit ./apps/web \
  --config=cloudbuild.yaml \
  --substitutions="_IMAGE=${WEB_IMAGE_FINAL},_VITE_API_URL=${API_URL},_VITE_SYNC_URL=${SYNC_WS_URL}"

gcloud run deploy "$WEB_SERVICE" \
  --image "$WEB_IMAGE_FINAL" \
  --region "$REGION" \
  --platform managed \
  --port 80 \
  "${AUTH_FLAG[@]}"

FINAL_WEB_URL="$(gcloud run services describe "$WEB_SERVICE" --region "$REGION" --format='value(status.url)')"

echo "[6/6] Summary"
echo "ENV         : $ENV_NAME"
echo "WEB URL     : $FINAL_WEB_URL"
echo "API URL     : $API_URL"
echo "SYNC URL    : $SYNC_WS_URL"
echo "CORS_ORIGIN : $WEB_URL"
