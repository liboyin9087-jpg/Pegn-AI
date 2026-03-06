#!/usr/bin/env bash
# setup-neon.sh — Bootstrap GCP for Pegn-AI using Neon (external Postgres)
# Usage:
#   PROJECT_ID=my-project NEON_DATABASE_URL="postgresql://..." \
#     JWT_SECRET=... bash scripts/gcp/setup-neon.sh [stg|prod]
#
# Required env vars:
#   PROJECT_ID        GCP project ID
#   NEON_DATABASE_URL Neon connection string (postgresql://...)
#   JWT_SECRET        JWT signing secret
#
# Optional env vars:
#   ENV_NAME          stg or prod (default: prod)
#   REGION            GCP region (default: asia-east1)
#   AR_REPO           Artifact Registry repo name (default: pegn-artifacts)
#   BILLING_ACCOUNT   GCP billing account ID (if project needs linking)
#   GEMINI_API_KEY    Gemini API key
#   OPENAI_API_KEY    OpenAI API key (optional)
#   ANTHROPIC_API_KEY Anthropic API key (optional)

set -euo pipefail

ENV_NAME="${1:-prod}"
REGION="${REGION:-asia-east1}"
AR_REPO="${AR_REPO:-pegn-artifacts}"
PROJECT_ID="${PROJECT_ID:-}"
NEON_DATABASE_URL="${NEON_DATABASE_URL:-}"
JWT_SECRET="${JWT_SECRET:-}"

# ── Validation ────────────────────────────────────────────────────────────────
if [[ -z "$PROJECT_ID" ]]; then
  echo "[ERROR] PROJECT_ID is required"
  echo "  e.g. PROJECT_ID=my-gcp-project NEON_DATABASE_URL='postgresql://...' JWT_SECRET='...' bash scripts/gcp/setup-neon.sh prod"
  exit 1
fi

if [[ -z "$NEON_DATABASE_URL" ]]; then
  echo "[ERROR] NEON_DATABASE_URL is required"
  echo "  Get it from console.neon.tech → your project → Connection string"
  exit 1
fi

if [[ -z "$JWT_SECRET" ]]; then
  echo "[ERROR] JWT_SECRET is required"
  echo "  Generate one: openssl rand -base64 48"
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "[ERROR] gcloud CLI not found. Install from https://cloud.google.com/sdk/docs/install"
  exit 1
fi

UPPER_ENV="$(echo "$ENV_NAME" | tr '[:lower:]' '[:upper:]')"
echo "[INFO] Environment : $ENV_NAME"
echo "[INFO] Project     : $PROJECT_ID"
echo "[INFO] Region      : $REGION"

# ── GCP project setup ─────────────────────────────────────────────────────────
gcloud config set project "$PROJECT_ID" >/dev/null

if [[ -n "${BILLING_ACCOUNT:-}" ]]; then
  echo "[INFO] Linking billing account"
  gcloud beta billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
fi

echo "[INFO] Enabling GCP services"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com

# ── Artifact Registry ─────────────────────────────────────────────────────────
if ! gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1; then
  echo "[INFO] Creating Artifact Registry repo: $AR_REPO"
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Pegn-AI images"
else
  echo "[INFO] Artifact Registry repo already exists: $AR_REPO"
fi

# ── Secret Manager helper ─────────────────────────────────────────────────────
upsert_secret() {
  local name="$1"
  local value="$2"
  if gcloud secrets describe "$name" --project="$PROJECT_ID" >/dev/null 2>&1; then
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
    echo "[INFO] Updated secret: $name"
  else
    gcloud secrets create "$name" \
      --project="$PROJECT_ID" \
      --replication-policy=automatic >/dev/null
    printf '%s' "$value" | gcloud secrets versions add "$name" --data-file=- >/dev/null
    echo "[INFO] Created secret: $name"
  fi
}

# ── Seed secrets ──────────────────────────────────────────────────────────────
echo "[INFO] Seeding Secret Manager secrets for $ENV_NAME..."

upsert_secret "DATABASE_URL_${UPPER_ENV}"    "$NEON_DATABASE_URL"
upsert_secret "JWT_SECRET_${UPPER_ENV}"      "$JWT_SECRET"
upsert_secret "SESSION_SECRET_${UPPER_ENV}"  "$JWT_SECRET"   # reuse JWT secret if not set separately

if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  upsert_secret "GEMINI_API_KEY_${UPPER_ENV}" "$GEMINI_API_KEY"
fi
if [[ -n "${OPENAI_API_KEY:-}" ]]; then
  upsert_secret "OPENAI_API_KEY_${UPPER_ENV}" "$OPENAI_API_KEY"
fi
if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  upsert_secret "ANTHROPIC_API_KEY_${UPPER_ENV}" "$ANTHROPIC_API_KEY"
fi

# ── Grant Cloud Run SA access to secrets ──────────────────────────────────────
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
CR_SA="service-${PROJECT_NUMBER}@serverless-robot-prod.iam.gserviceaccount.com"
CB_SA="${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com"

echo "[INFO] Granting secret access to Cloud Run SA: $CR_SA"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CR_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null

echo "[INFO] Granting secret access to Cloud Build SA: $CB_SA"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/secretmanager.secretAccessor" \
  --quiet >/dev/null

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/run.admin" \
  --quiet >/dev/null

gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${CB_SA}" \
  --role="roles/iam.serviceAccountUser" \
  --quiet >/dev/null

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "[DONE] GCP setup complete (Neon database, no Cloud SQL)"
echo ""
echo "Next steps:"
echo "  1. Connect Cloud Build trigger to your GitHub repo:"
echo "     https://console.cloud.google.com/cloud-build/triggers"
echo ""
echo "  2. Or trigger a manual build:"
echo "     gcloud builds submit --config cloudbuild.yaml \\"
echo "       --substitutions=_REGION=${REGION},_REPO=${AR_REPO} ."
echo ""
echo "  3. After deploy, run DB migrations:"
echo "     DATABASE_URL='\$NEON_DATABASE_URL' node apps/server/scripts/run-migrations.ts"
