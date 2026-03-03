#!/usr/bin/env bash
set -euo pipefail
DB_URL="postgresql://pegn_app:supersafe_pegn_db_password_2026!@localhost/pegn_prod?host=/cloudsql/gen-lang-client-0881356669:asia-east1:pegn-shared-pg"
JWT_SEC="prod_jwt_secret_$(date +%s|md5sum|head -c16)"
SESS_SEC="prod_session_secret_$(date +%s|md5sum|head -c16)"
GEMINI_KEY="dummy_gemini_key_for_now"

push_secret() {
  local name="$1"
  local val="$2"
  if ! gcloud secrets describe "$name" >/dev/null 2>&1; then
    gcloud secrets create "$name" --replication-policy=automatic
  fi
  printf '%s' "$val" | gcloud secrets versions add "$name" --data-file=-
  echo "Secret $name updated."
}

push_secret "DATABASE_URL_PROD" "$DB_URL"
push_secret "JWT_SECRET_PROD" "$JWT_SEC"
push_secret "SESSION_SECRET_PROD" "$SESS_SEC"
push_secret "GEMINI_API_KEY_PROD" "$GEMINI_KEY"
