#!/usr/bin/env bash
# ============================================================
# Pegn-AI — GCP 首次部署初始化腳本
# 執行前請先填入下方變數
# 費用估算: ~$10-20 USD/月 (低流量)
# ============================================================
set -euo pipefail

# ── 請填入您的 GCP 設定 ────────────────────────────────────
PROJECT_ID="YOUR_GCP_PROJECT_ID"       # e.g. pegn-ai-prod
REGION="asia-east1"                    # 台灣最近節點
GITHUB_ORG="YOUR_GITHUB_ORG"          # e.g. liboyin9087-jpg
GITHUB_REPO="Pegn-AI"
# ────────────────────────────────────────────────────────────

# ── 待設定的 Secret 值（執行前填入）────────────────────────
DATABASE_URL="postgresql://USER:PASS@HOST:5432/ai_native"
JWT_SECRET="$(openssl rand -hex 32)"
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
REDIS_URL="rediss://default:PASS@HOST:PORT"  # Upstash Redis URL
# ────────────────────────────────────────────────────────────

echo "🚀 Pegn-AI GCP 初始化開始 (Project: $PROJECT_ID, Region: $REGION)"

# ── 1. 設定 gcloud 專案 ──────────────────────────────────────
gcloud config set project "$PROJECT_ID"

# ── 2. 啟用必要 APIs ─────────────────────────────────────────
echo "📦 啟用 GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  sqladmin.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  --project="$PROJECT_ID"

# ── 3. 建立 Artifact Registry 倉庫 ──────────────────────────
echo "🐳 建立 Artifact Registry 倉庫..."
gcloud artifacts repositories create pegn-ai \
  --repository-format=docker \
  --location="$REGION" \
  --description="Pegn-AI Docker images" \
  --project="$PROJECT_ID" || echo "  倉庫已存在，跳過"

# ── 4. 建立 Cloud SQL (PostgreSQL 16, db-f1-micro ~$7/月) ────
echo "🗄️  建立 Cloud SQL 實例 (db-f1-micro)..."
gcloud sql instances create pegn-ai-db \
  --database-version=POSTGRES_16 \
  --tier=db-f1-micro \
  --region="$REGION" \
  --storage-auto-increase \
  --storage-size=10GB \
  --no-backup \
  --project="$PROJECT_ID" || echo "  實例已存在，跳過"

gcloud sql databases create ai_native \
  --instance=pegn-ai-db \
  --project="$PROJECT_ID" || echo "  資料庫已存在，跳過"

gcloud sql users set-password postgres \
  --instance=pegn-ai-db \
  --password="$(openssl rand -hex 16)" \
  --project="$PROJECT_ID" || echo "  使用者設定跳過"

# 取得 Cloud SQL proxy 連線字串
SQL_CONN=$(gcloud sql instances describe pegn-ai-db \
  --project="$PROJECT_ID" \
  --format='value(connectionName)')
echo "  Cloud SQL connectionName: $SQL_CONN"
echo "  ⚠️  請用 Cloud SQL Auth Proxy 取得實際 DATABASE_URL"
echo "     或在 Cloud Run 中加入 --add-cloudsql-instances=$SQL_CONN"

# ── 5. 建立 Secret Manager Secrets ──────────────────────────
echo "🔐 建立 Secrets..."
create_secret() {
  local name="$1"
  local value="$2"
  echo -n "$value" | gcloud secrets create "$name" \
    --data-file=- \
    --project="$PROJECT_ID" 2>/dev/null || \
  echo -n "$value" | gcloud secrets versions add "$name" \
    --data-file=- \
    --project="$PROJECT_ID"
  echo "  ✅ Secret: $name"
}
create_secret "DATABASE_URL"  "$DATABASE_URL"
create_secret "JWT_SECRET"    "$JWT_SECRET"
create_secret "GEMINI_API_KEY" "$GEMINI_API_KEY"
create_secret "REDIS_URL"     "$REDIS_URL"

# ── 6. 建立 Service Account ──────────────────────────────────
echo "👤 建立 Service Account..."
SA_NAME="pegn-ai-deploy"
SA_EMAIL="$SA_NAME@$PROJECT_ID.iam.gserviceaccount.com"

gcloud iam service-accounts create "$SA_NAME" \
  --display-name="Pegn-AI Deploy SA" \
  --project="$PROJECT_ID" || echo "  SA 已存在，跳過"

# 授予必要角色
for ROLE in \
  roles/run.admin \
  roles/artifactregistry.writer \
  roles/secretmanager.secretAccessor \
  roles/cloudsql.client; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" \
    --role="$ROLE" --quiet
done
echo "  ✅ IAM 角色授予完成"

# ── 7. Workload Identity Federation (GitHub Actions → GCP) ──
echo "🔗 設定 Workload Identity Federation..."
POOL_NAME="github-pool"
PROVIDER_NAME="github-provider"

# 建立 Workload Identity Pool
gcloud iam workload-identity-pools create "$POOL_NAME" \
  --location=global \
  --display-name="GitHub Actions Pool" \
  --project="$PROJECT_ID" || echo "  Pool 已存在，跳過"

POOL_ID=$(gcloud iam workload-identity-pools describe "$POOL_NAME" \
  --location=global \
  --project="$PROJECT_ID" \
  --format='value(name)')

# 建立 GitHub OIDC Provider
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_NAME" \
  --workload-identity-pool="$POOL_NAME" \
  --location=global \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='$GITHUB_ORG/$GITHUB_REPO'" \
  --project="$PROJECT_ID" || echo "  Provider 已存在，跳過"

PROVIDER_ID=$(gcloud iam workload-identity-pools providers describe "$PROVIDER_NAME" \
  --workload-identity-pool="$POOL_NAME" \
  --location=global \
  --project="$PROJECT_ID" \
  --format='value(name)')

# 允許 GitHub Repo 使用 SA
gcloud iam service-accounts add-iam-policy-binding "$SA_EMAIL" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/$POOL_ID/attribute.repository/$GITHUB_ORG/$GITHUB_REPO" \
  --project="$PROJECT_ID"

echo ""
echo "══════════════════════════════════════════════════════════"
echo "✅ GCP 初始化完成！請在 GitHub 設定以下 Secrets / Variables："
echo "══════════════════════════════════════════════════════════"
echo ""
echo "GitHub Repository Secrets:"
echo "  GCP_WORKLOAD_IDENTITY_PROVIDER = $PROVIDER_ID"
echo "  GCP_SERVICE_ACCOUNT            = $SA_EMAIL"
echo ""
echo "GitHub Repository Variables:"
echo "  GCP_PROJECT_ID = $PROJECT_ID"
echo "  GCP_REGION     = $REGION"
echo ""
echo "⚠️  Redis 建議使用 Upstash (免費方案): https://upstash.com"
echo "   建立後將 REDIS_URL 更新到 Secret Manager:"
echo "   echo -n 'rediss://...' | gcloud secrets versions add REDIS_URL --data-file=- --project=$PROJECT_ID"
echo ""
echo "🚀 完成後，推送到 main 分支即自動觸發 CD 部署！"
