#!/usr/bin/env bash
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-}"
REGION="${REGION:-asia-east1}"
AR_REPO="${AR_REPO:-pegn-artifacts}"
SQL_INSTANCE="${SQL_INSTANCE:-pegn-shared-pg}"
SQL_TIER="${SQL_TIER:-db-custom-1-3840}"
SQL_DISK_GB="${SQL_DISK_GB:-20}"
SQL_DB_VERSION="${SQL_DB_VERSION:-POSTGRES_16}"
DB_USER="${DB_USER:-pegn_app}"
DB_PASSWORD="${DB_PASSWORD:-}"
BILLING_ACCOUNT="${BILLING_ACCOUNT:-}"
CREATE_PROJECT="${CREATE_PROJECT:-true}"
CREATE_SQL="${CREATE_SQL:-true}"

if [[ -z "$PROJECT_ID" ]]; then
  echo "[ERROR] PROJECT_ID is required"
  echo "Example: PROJECT_ID=my-gcp-project REGION=asia-east1 scripts/gcp/bootstrap.sh"
  exit 1
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "[ERROR] gcloud is not installed"
  exit 1
fi

echo "[INFO] Using project: $PROJECT_ID"
echo "[INFO] Region: $REGION"

if [[ "$CREATE_PROJECT" == "true" ]]; then
  if ! gcloud projects describe "$PROJECT_ID" >/dev/null 2>&1; then
    echo "[INFO] Creating project: $PROJECT_ID"
    gcloud projects create "$PROJECT_ID"
  else
    echo "[INFO] Project already exists: $PROJECT_ID"
  fi
fi

gcloud config set project "$PROJECT_ID" >/dev/null

if [[ -n "$BILLING_ACCOUNT" ]]; then
  echo "[INFO] Linking billing account"
  gcloud beta billing projects link "$PROJECT_ID" --billing-account="$BILLING_ACCOUNT"
else
  echo "[WARN] BILLING_ACCOUNT not set; ensure billing is linked manually"
fi

echo "[INFO] Enabling required services"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  sqladmin.googleapis.com \
  secretmanager.googleapis.com \
  iam.googleapis.com \
  servicenetworking.googleapis.com

if ! gcloud artifacts repositories describe "$AR_REPO" --location="$REGION" >/dev/null 2>&1; then
  echo "[INFO] Creating Artifact Registry repo: $AR_REPO"
  gcloud artifacts repositories create "$AR_REPO" \
    --repository-format=docker \
    --location="$REGION" \
    --description="Pegn-AI images"
else
  echo "[INFO] Artifact Registry repo already exists: $AR_REPO"
fi

if [[ "$CREATE_SQL" == "true" ]]; then
  if ! gcloud sql instances describe "$SQL_INSTANCE" >/dev/null 2>&1; then
    echo "[INFO] Creating Cloud SQL instance: $SQL_INSTANCE"
    gcloud sql instances create "$SQL_INSTANCE" \
      --database-version="$SQL_DB_VERSION" \
      --edition=ENTERPRISE \
      --tier="$SQL_TIER" \
      --region="$REGION" \
      --storage-size="$SQL_DISK_GB" \
      --storage-type=SSD \
      --availability-type=zonal \
      --backup-start-time=03:00
  else
    echo "[INFO] Cloud SQL instance already exists: $SQL_INSTANCE"
  fi

  echo "[INFO] Ensuring app databases exist"
  gcloud sql databases create pegn_stg --instance="$SQL_INSTANCE" || true
  gcloud sql databases create pegn_prod --instance="$SQL_INSTANCE" || true

  if [[ -z "$DB_PASSWORD" ]]; then
    echo "[WARN] DB_PASSWORD not set; skip SQL user create/update"
  else
    echo "[INFO] Ensuring SQL user exists: $DB_USER"
    gcloud sql users create "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD" || \
      gcloud sql users set-password "$DB_USER" --instance="$SQL_INSTANCE" --password="$DB_PASSWORD"
  fi
fi

echo "[DONE] Bootstrap completed"
echo "[NEXT] Run scripts/gcp/seed-secrets.sh then scripts/gcp/deploy-env.sh stg and prod"
