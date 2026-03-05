#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Pegn-AI  —  GCP Cloud Run 一鍵部署腳本
#
# 預算目標: < 1000 TWD (~$31 USD) / 月
# 架構:
#   - Cloud Run   API  (scale-to-zero, 512 Mi)   ~ $0-5/月
#   - Cloud Run   Web  (scale-to-zero, 256 Mi)   ~ $0-2/月
#   - Neon.tech         PostgreSQL (免費方案)      $0/月
#   - Upstash           Redis     (免費方案)       $0/月
#   - Artifact Registry Docker    (0.5 GB free)   $0/月
#   - Cloud Build       Build     (120 min/day)    $0/月
#   ─────────────────────────────────────────────────────
#   總計: ~$0-10 USD/月  ✅ 遠低於 1000 TWD
#
# 執行方式:
#   1. 開啟 Google Cloud Shell  →  https://shell.cloud.google.com
#   2. 上傳此腳本 或 git clone 後執行
#   3. bash deploy/gcp-one-click.sh
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── 顏色輸出 ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[✅]${NC}   $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
step()    { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }
die()     { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

echo -e "${BOLD}${CYAN}"
cat << 'BANNER'
╔═══════════════════════════════════════════════╗
║          Pegn-AI  GCP 一鍵部署系統             ║
║   預算: < 1000 TWD/月  |  台灣節點 asia-east1  ║
╚═══════════════════════════════════════════════╝
BANNER
echo -e "${NC}"

# ════════════════════════════════════════════════════════════════════════════
# 0. 互動式收集設定
# ════════════════════════════════════════════════════════════════════════════
step "收集部署設定"

# 取得目前 gcloud 登入的 project（Cloud Shell 預設已選）
CURRENT_PROJECT=$(gcloud config get-value project 2>/dev/null || echo "")

if [[ -z "$CURRENT_PROJECT" || "$CURRENT_PROJECT" == "(unset)" ]]; then
  read -rp "請輸入 GCP Project ID: " PROJECT_ID
else
  echo "偵測到目前 Project: ${BOLD}$CURRENT_PROJECT${NC}"
  read -rp "按 Enter 使用此 Project，或輸入其他 Project ID: " INPUT_PROJECT
  PROJECT_ID="${INPUT_PROJECT:-$CURRENT_PROJECT}"
fi

REGION="${REGION:-asia-east1}"
REPO_NAME="pegn-ai"
API_SERVICE="pegn-ai-api"
WEB_SERVICE="pegn-ai-web"
IMAGE_TAG="${IMAGE_TAG:-$(git -C "$REPO_ROOT" rev-parse --short HEAD 2>/dev/null || echo 'latest')}"

echo ""
echo -e "  ${BOLD}Project:${NC}  $PROJECT_ID"
echo -e "  ${BOLD}Region:${NC}   $REGION"
echo -e "  ${BOLD}Tag:${NC}      $IMAGE_TAG"

# ── 必填 Secrets ──────────────────────────────────────────────────────────
echo ""
warn "請準備以下資訊（均可免費取得）:"
echo "  1. Neon PostgreSQL URL:  https://neon.tech  (建立專案 → 複製 connection string)"
echo "  2. Upstash Redis URL:    https://upstash.com (建立 database → 複製 REDIS_URL)"
echo "  3. Gemini API Key:       https://aistudio.google.com/app/apikey"
echo ""

# Gemini Key
if [[ -n "${GEMINI_API_KEY:-}" ]]; then
  info "GEMINI_API_KEY 已從環境變數讀取"
else
  read -rsp "Gemini API Key (輸入不顯示): " GEMINI_API_KEY; echo
  [[ -z "$GEMINI_API_KEY" ]] && die "GEMINI_API_KEY 不能為空"
fi

# Database URL
if [[ -n "${DATABASE_URL:-}" ]]; then
  info "DATABASE_URL 已從環境變數讀取"
else
  echo ""
  echo "Neon.tech 免費 PostgreSQL 建立步驟:"
  echo "  1. 前往 https://neon.tech 登入"
  echo "  2. 建立新 Project (選擇 aws-ap-southeast-1 最近台灣)"
  echo "  3. 複製 'Connection String (pooled)'"
  echo "  範例: postgresql://user:pass@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require"
  read -rsp "DATABASE_URL (輸入不顯示): " DATABASE_URL; echo
  [[ -z "$DATABASE_URL" ]] && die "DATABASE_URL 不能為空"
fi

# Redis URL
if [[ -n "${REDIS_URL:-}" ]]; then
  info "REDIS_URL 已從環境變數讀取"
else
  echo ""
  echo "Upstash 免費 Redis 建立步驟:"
  echo "  1. 前往 https://upstash.com 登入"
  echo "  2. 建立 Database (選擇 ap-northeast-1 Tokyo 最近)"
  echo "  3. 複製 'UPSTASH_REDIS_REST_URL' 或 REDIS_URL"
  echo "  範例: rediss://default:TOKEN@xxx.upstash.io:6379"
  read -rsp "REDIS_URL (輸入不顯示): " REDIS_URL; echo
  [[ -z "$REDIS_URL" ]] && die "REDIS_URL 不能為空"
fi

JWT_SECRET="${JWT_SECRET:-$(openssl rand -hex 32)}"
info "JWT_SECRET: 已自動產生"

echo ""
read -rp "確認開始部署? (y/N): " CONFIRM
[[ "${CONFIRM,,}" != "y" ]] && { info "已取消"; exit 0; }

# ════════════════════════════════════════════════════════════════════════════
# 1. 設定 GCP Project & 啟用 APIs
# ════════════════════════════════════════════════════════════════════════════
step "設定 GCP Project 並啟用 APIs"
gcloud config set project "$PROJECT_ID"

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudbuild.googleapis.com \
  --project="$PROJECT_ID" --quiet

success "GCP APIs 啟用完成"

# ════════════════════════════════════════════════════════════════════════════
# 1.5  GCP 預算告警 (Budget Alert)
# ════════════════════════════════════════════════════════════════════════════
step "設定 GCP 預算告警"

BUDGET_AMOUNT="${BUDGET_AMOUNT:-31}"
echo -e "  預設預算: ${BOLD}\$${BUDGET_AMOUNT} USD/月${NC} (≈ 1000 TWD)"
read -rp "  按 Enter 使用此金額，或輸入其他金額 (USD): " INPUT_BUDGET
BUDGET_AMOUNT="${INPUT_BUDGET:-$BUDGET_AMOUNT}"

gcloud services enable billingbudgets.googleapis.com --project="$PROJECT_ID" --quiet 2>/dev/null || true

BILLING_ACCOUNT=$(gcloud billing projects describe "$PROJECT_ID" \
  --format='value(billingAccountName)' 2>/dev/null | sed 's|billingAccounts/||')

if [[ -n "$BILLING_ACCOUNT" ]]; then
  gcloud billing budgets create \
    --billing-account="$BILLING_ACCOUNT" \
    --display-name="Pegn-AI Monthly Budget" \
    --budget-amount="${BUDGET_AMOUNT}USD" \
    --threshold-rule=percent=0.5 \
    --threshold-rule=percent=0.8 \
    --threshold-rule=percent=1.0 \
    --filter-projects="projects/$PROJECT_ID" \
    2>/dev/null && success "預算告警已建立: \$${BUDGET_AMOUNT}/月 (50%/80%/100% 告警)" \
    || warn "預算可能已存在或權限不足，請至 GCP Console 手動確認"
else
  warn "無法取得 Billing Account，跳過預算設定（請至 GCP Console → Billing → Budgets 手動設定）"
fi

# ════════════════════════════════════════════════════════════════════════════
# 2. Artifact Registry
# ════════════════════════════════════════════════════════════════════════════
step "建立 Artifact Registry Docker 倉庫"
gcloud artifacts repositories create "$REPO_NAME" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Pegn-AI images" \
  --project="$PROJECT_ID" 2>/dev/null || info "倉庫已存在，跳過"

REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/${REPO_NAME}"
API_IMAGE="${REGISTRY}/api:${IMAGE_TAG}"
WEB_IMAGE="${REGISTRY}/web:${IMAGE_TAG}"
success "Artifact Registry: $REGISTRY"

# ════════════════════════════════════════════════════════════════════════════
# 3. Secret Manager
# ════════════════════════════════════════════════════════════════════════════
step "設定 Secret Manager"

create_or_update_secret() {
  local name="$1"; local value="$2"
  if gcloud secrets describe "$name" --project="$PROJECT_ID" &>/dev/null; then
    echo -n "$value" | gcloud secrets versions add "$name" \
      --data-file=- --project="$PROJECT_ID" --quiet
    info "Secret 已更新: $name"
  else
    echo -n "$value" | gcloud secrets create "$name" \
      --data-file=- --project="$PROJECT_ID" --quiet
    success "Secret 已建立: $name"
  fi
}

create_or_update_secret "DATABASE_URL"   "$DATABASE_URL"
create_or_update_secret "JWT_SECRET"     "$JWT_SECRET"
create_or_update_secret "GEMINI_API_KEY" "$GEMINI_API_KEY"
create_or_update_secret "REDIS_URL"      "$REDIS_URL"

# ════════════════════════════════════════════════════════════════════════════
# 4. Service Account (least-privilege)
# ════════════════════════════════════════════════════════════════════════════
step "建立 Service Account"
SA_NAME="pegn-ai-run"
SA_EMAIL="${SA_NAME}@${PROJECT_ID}.iam.gserviceaccount.com"

gcloud iam service-accounts create "$SA_NAME" \
  --display-name="Pegn-AI Cloud Run SA" \
  --project="$PROJECT_ID" 2>/dev/null || info "SA 已存在，跳過"

for ROLE in roles/secretmanager.secretAccessor roles/cloudtrace.agent roles/monitoring.metricWriter; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" \
    --member="serviceAccount:$SA_EMAIL" --role="$ROLE" --quiet 2>/dev/null || true
done
success "Service Account: $SA_EMAIL"

# ════════════════════════════════════════════════════════════════════════════
# 5. Build Docker images via Cloud Build
# ════════════════════════════════════════════════════════════════════════════
step "使用 Cloud Build 建構 Docker 映像"
cd "$REPO_ROOT"

# API image
info "建構 API 映像: $API_IMAGE"
gcloud builds submit apps/server \
  --tag="$API_IMAGE" \
  --project="$PROJECT_ID" \
  --quiet

success "API 映像建構完成"

# Web image — 使用 inline Cloud Build 以傳入 --build-arg VITE_API_URL=''
# 空值讓前端使用相對路徑，由 nginx 反向代理到 API_UPSTREAM
info "建構 Web 映像: $WEB_IMAGE"
gcloud builds submit apps/web \
  --config=/dev/stdin \
  --substitutions="_IMAGE=${WEB_IMAGE},_VITE_API_URL=" \
  --project="$PROJECT_ID" \
  --quiet <<'CLOUDBUILD'
steps:
  - name: gcr.io/cloud-builders/docker
    args:
      - build
      - -t
      - ${_IMAGE}
      - --build-arg
      - VITE_API_URL=${_VITE_API_URL}
      - .
images:
  - ${_IMAGE}
CLOUDBUILD

success "Web 映像建構完成"

# ════════════════════════════════════════════════════════════════════════════
# 6. Deploy API to Cloud Run
# ════════════════════════════════════════════════════════════════════════════
step "部署 API 服務到 Cloud Run"

gcloud run deploy "$API_SERVICE" \
  --image="$API_IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --service-account="$SA_EMAIL" \
  --allow-unauthenticated \
  --port=4000 \
  --min-instances=0 \
  --max-instances=10 \
  --cpu=1 \
  --memory=512Mi \
  --concurrency=80 \
  --timeout=300 \
  --set-env-vars="NODE_ENV=production,PORT=4000,CORS_ALLOW_ALL=true,OTEL_SERVICE_NAME=pegn-ai-api" \
  --set-secrets="DATABASE_URL=DATABASE_URL:latest,JWT_SECRET=JWT_SECRET:latest,GEMINI_API_KEY=GEMINI_API_KEY:latest,REDIS_URL=REDIS_URL:latest" \
  --project="$PROJECT_ID" \
  --quiet

API_URL=$(gcloud run services describe "$API_SERVICE" \
  --region="$REGION" --project="$PROJECT_ID" \
  --format='value(status.url)')

success "API 部署完成: $API_URL"

# ════════════════════════════════════════════════════════════════════════════
# 7. Deploy Web to Cloud Run
# ════════════════════════════════════════════════════════════════════════════
step "部署 Web 服務到 Cloud Run"

# Strip trailing slash from API_URL
API_URL_CLEAN="${API_URL%/}"

gcloud run deploy "$WEB_SERVICE" \
  --image="$WEB_IMAGE" \
  --region="$REGION" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --min-instances=0 \
  --max-instances=5 \
  --cpu=1 \
  --memory=256Mi \
  --concurrency=100 \
  --timeout=60 \
  --set-env-vars="PORT=8080,API_UPSTREAM=${API_URL_CLEAN}" \
  --project="$PROJECT_ID" \
  --quiet

WEB_URL=$(gcloud run services describe "$WEB_SERVICE" \
  --region="$REGION" --project="$PROJECT_ID" \
  --format='value(status.url)')

success "Web 部署完成: $WEB_URL"

# ════════════════════════════════════════════════════════════════════════════
# 8. 更新 API CORS (now we know the web URL)
# ════════════════════════════════════════════════════════════════════════════
step "更新 API CORS 白名單"

gcloud run services update "$API_SERVICE" \
  --region="$REGION" \
  --project="$PROJECT_ID" \
  --set-env-vars="NODE_ENV=production,PORT=4000,CORS_ORIGIN=${WEB_URL},OTEL_SERVICE_NAME=pegn-ai-api" \
  --quiet

success "CORS 已加入: $WEB_URL"

# ════════════════════════════════════════════════════════════════════════════
# 9. 完成報告
# ════════════════════════════════════════════════════════════════════════════
echo ""
echo -e "${BOLD}${GREEN}"
cat << 'DONE'
╔═══════════════════════════════════════════════════════════════╗
║                    🎉  部署成功！                               ║
╚═══════════════════════════════════════════════════════════════╝
DONE
echo -e "${NC}"

echo -e "${BOLD}訪問網址:${NC}"
echo -e "  🌐 前端  →  ${CYAN}${WEB_URL}${NC}"
echo -e "  🔌 API   →  ${CYAN}${API_URL}${NC}"
echo ""
echo -e "${BOLD}費用估算 (低流量):${NC}"
echo -e "  Cloud Run (API + Web):  ~$0-5 USD/月"
echo -e "  Neon PostgreSQL:         $0   (免費方案)"
echo -e "  Upstash Redis:           $0   (免費方案)"
echo -e "  Artifact Registry:       ~$0-1 USD/月"
echo -e "  ─────────────────────────────────────"
echo -e "  ${GREEN}合計: ~$0-6 USD/月 ≈ 0-200 TWD ✅${NC}"
echo ""
echo -e "${BOLD}管理指令:${NC}"
echo -e "  查看 API 日誌:  gcloud run services logs tail $API_SERVICE --region=$REGION --project=$PROJECT_ID"
echo -e "  查看 Web 日誌:  gcloud run services logs tail $WEB_SERVICE --region=$REGION --project=$PROJECT_ID"
echo -e "  更新部署:       bash deploy/gcp-one-click.sh"
echo ""
echo -e "${BOLD}預算控制:${NC}"
echo -e "  App Quota:    ${GREEN}已啟用${NC} (Free: 100K tokens/月, 200 calls/天, 20 runs/天)"
echo -e "  GCP Budget:   ${GREEN}\$${BUDGET_AMOUNT} USD/月${NC} (50%/80%/100% Email 告警)"
echo -e "  Rate Limit:   ${GREEN}已啟用${NC} (300/min general, 60/min AI)"
echo -e "  升級方案:     POST /api/v1/billing/plan { plan: 'pro' | 'team' }"

# 儲存設定到本地
cat > "$SCRIPT_DIR/.deploy-config" << EOF
PROJECT_ID=$PROJECT_ID
REGION=$REGION
API_URL=$API_URL
WEB_URL=$WEB_URL
API_IMAGE=$API_IMAGE
WEB_IMAGE=$WEB_IMAGE
DEPLOYED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF
info "部署設定已儲存至 deploy/.deploy-config"
