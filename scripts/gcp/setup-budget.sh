#!/usr/bin/env bash
# ════════════════════════════════════════════════════════════════════════════
# Pegn-AI  —  GCP Billing Budget 設定腳本
#
# 用法:
#   PROJECT_ID=my-project BUDGET_AMOUNT=31 bash scripts/gcp/setup-budget.sh
#
# 預設: $31 USD/月 (≈ 1000 TWD)，50%/80%/100% Email 告警
# ════════════════════════════════════════════════════════════════════════════
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
success() { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()     { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── 取得 Project ID ─────────────────────────────────────────────────
if [[ -z "${PROJECT_ID:-}" ]]; then
  PROJECT_ID=$(gcloud config get-value project 2>/dev/null || echo "")
  [[ -z "$PROJECT_ID" || "$PROJECT_ID" == "(unset)" ]] && die "PROJECT_ID 未設定。請用 PROJECT_ID=xxx 執行此腳本"
  info "使用目前 Project: $PROJECT_ID"
fi

BUDGET_AMOUNT="${BUDGET_AMOUNT:-31}"
BUDGET_NAME="${BUDGET_NAME:-Pegn-AI Monthly Budget}"

echo -e "  ${BOLD}Project:${NC}  $PROJECT_ID"
echo -e "  ${BOLD}Budget:${NC}   \$${BUDGET_AMOUNT} USD/月"
echo ""

# ── 啟用 API ────────────────────────────────────────────────────────
info "啟用 Cloud Billing Budget API..."
gcloud services enable billingbudgets.googleapis.com --project="$PROJECT_ID" --quiet 2>/dev/null || true

# ── 取得 Billing Account ────────────────────────────────────────────
BILLING_ACCOUNT=$(gcloud billing projects describe "$PROJECT_ID" \
  --format='value(billingAccountName)' 2>/dev/null | sed 's|billingAccounts/||')

if [[ -z "$BILLING_ACCOUNT" ]]; then
  die "無法取得 Billing Account。請確認：
  1. 此 Project 已連結 Billing Account
  2. 你的帳號有 billing.projects.get 權限
  手動設定: GCP Console → Billing → Budgets & alerts"
fi

info "Billing Account: $BILLING_ACCOUNT"

# ── 建立預算 ────────────────────────────────────────────────────────
info "建立預算告警: \$${BUDGET_AMOUNT} USD/月..."
gcloud billing budgets create \
  --billing-account="$BILLING_ACCOUNT" \
  --display-name="$BUDGET_NAME" \
  --budget-amount="${BUDGET_AMOUNT}USD" \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.8 \
  --threshold-rule=percent=1.0 \
  --filter-projects="projects/$PROJECT_ID" \
  2>/dev/null \
  && success "預算告警已建立！" \
  || warn "建立失敗（可能已存在同名預算）。請至 GCP Console 確認。"

echo ""
echo -e "${BOLD}告警門檻:${NC}"
echo "  50%  → \$$(echo "$BUDGET_AMOUNT * 0.5" | bc) USD  → Email 通知"
echo "  80%  → \$$(echo "$BUDGET_AMOUNT * 0.8" | bc) USD  → Email 通知"
echo "  100% → \$${BUDGET_AMOUNT} USD         → Email 通知"
echo ""
echo -e "管理預算: ${BLUE}https://console.cloud.google.com/billing/budgets?project=${PROJECT_ID}${NC}"
