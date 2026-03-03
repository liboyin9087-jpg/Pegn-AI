#!/usr/bin/env bash
set -euo pipefail

echo "Waiting for Cloud SQL instance (pegn-shared-pg) to become RUNNABLE..."
while true; do
  STATUS=$(gcloud sql instances describe pegn-shared-pg --format="value(state)")
  echo "$(date): Status: $STATUS"
  if [ "$STATUS" == "RUNNABLE" ]; then
    echo "Instance is ready!"
    break
  fi
  sleep 30
done

echo "[INFO] Ensuring app databases exist"
gcloud sql databases create pegn_stg --instance=pegn-shared-pg || true
gcloud sql databases create pegn_prod --instance=pegn-shared-pg || true

echo "[INFO] Ensuring SQL user exists: pegn_app"
gcloud sql users create pegn_app --instance=pegn-shared-pg --password="supersafe_pegn_db_password_2026!" || \
gcloud sql users set-password pegn_app --instance=pegn-shared-pg --password="supersafe_pegn_db_password_2026!"

echo "[DONE] Database setup completed successfully."
