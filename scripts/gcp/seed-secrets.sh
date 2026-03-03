#!/usr/bin/env bash
set -euo pipefail

ENV_NAME="${1:-}"
if [[ -z "$ENV_NAME" ]]; then
  echo "Usage: scripts/gcp/seed-secrets.sh <stg|prod>"
  exit 1
fi

PROJECT_ID="${PROJECT_ID:-}"
if [[ -z "$PROJECT_ID" ]]; then
  echo "[ERROR] PROJECT_ID is required"
  exit 1
fi

gcloud config set project "$PROJECT_ID" >/dev/null

UPPER_ENV="$(echo "$ENV_NAME" | tr '[:lower:]' '[:upper:]')"

declare -a REQUIRED=(
  "DATABASE_URL_${UPPER_ENV}"
  "JWT_SECRET_${UPPER_ENV}"
  "SESSION_SECRET_${UPPER_ENV}"
  "GEMINI_API_KEY_${UPPER_ENV}"
)

declare -a OPTIONAL=(
  "OPENAI_API_KEY_${UPPER_ENV}"
)

create_or_update_secret() {
  local secret_name="$1"
  local secret_value="$2"
  if gcloud secrets describe "$secret_name" >/dev/null 2>&1; then
    printf '%s' "$secret_value" | gcloud secrets versions add "$secret_name" --data-file=- >/dev/null
    echo "[INFO] Updated secret version: $secret_name"
  else
    gcloud secrets create "$secret_name" --replication-policy=automatic >/dev/null
    printf '%s' "$secret_value" | gcloud secrets versions add "$secret_name" --data-file=- >/dev/null
    echo "[INFO] Created secret: $secret_name"
  fi
}

echo "[INFO] Input required secrets for $ENV_NAME"
for key in "${REQUIRED[@]}"; do
  read -r -s -p "$key: " value
  echo
  if [[ -z "$value" ]]; then
    echo "[ERROR] $key cannot be empty"
    exit 1
  fi
  create_or_update_secret "$key" "$value"
done

for key in "${OPTIONAL[@]}"; do
  read -r -s -p "$key (optional, Enter to skip): " value
  echo
  if [[ -n "$value" ]]; then
    create_or_update_secret "$key" "$value"
  fi
done

echo "[DONE] Secrets seeded for $ENV_NAME"
