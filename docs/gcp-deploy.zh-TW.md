# Pegn-AI GCP 手動部署（Cloud Run + Cloud SQL）

此文件對應目前專案狀態：
- 服務拆分為 3 個 Cloud Run 服務：`web`、`api`、`sync`
- `api` 與 `sync` 使用同一份 `apps/server` 映像，透過 `APP_ROLE` 切換
- 前端使用 build-time 注入：`VITE_API_URL`、`VITE_SYNC_URL`

## 1) 前置條件

- 已安裝 `gcloud` 並完成 `gcloud auth login`
- GCP 已啟用 Billing（可由腳本協助綁定）
- 你有 Gemini API Key（若要 OpenAI 再提供 OpenAI Key）

## 2) 建立基礎資源（一次）

```bash
export PROJECT_ID=<your-project-id>
export REGION=asia-east1
export AR_REPO=pegn-artifacts
export SQL_INSTANCE=pegn-shared-pg

# 若要由腳本自動綁 Billing，補上：
# export BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX

# 若要腳本建立 Cloud SQL user，補上：
# export DB_USER=pegn_app
# export DB_PASSWORD=<strong-password>

npm run gcp:bootstrap
```

腳本會：
- 建立/設定 Project
- 啟用 Cloud Run、Artifact Registry、Cloud Build、Cloud SQL、Secret Manager 等 API
- 建立 Artifact Registry
- 建立 1 個共用 Cloud SQL instance（含 `pegn_stg`、`pegn_prod` 兩個資料庫）

## 3) 設定 secrets（每個環境各一次）

先準備好以下值：
- `DATABASE_URL_<ENV>`（建議使用 Cloud SQL socket 形式）
- `JWT_SECRET_<ENV>`
- `SESSION_SECRET_<ENV>`
- `GEMINI_API_KEY_<ENV>`
- `OPENAI_API_KEY_<ENV>`（可選）

### 建議 DATABASE_URL 格式

```text
postgresql://<db_user>:<db_password>@/pegn_stg?host=/cloudsql/<PROJECT_ID>:<REGION>:<SQL_INSTANCE>
postgresql://<db_user>:<db_password>@/pegn_prod?host=/cloudsql/<PROJECT_ID>:<REGION>:<SQL_INSTANCE>
```

### 寫入 Secret Manager

```bash
export PROJECT_ID=<your-project-id>
npm run gcp:secrets:stg
npm run gcp:secrets:prod
```

## 4) 部署 staging / production

```bash
export PROJECT_ID=<your-project-id>
export REGION=asia-east1
export AR_REPO=pegn-artifacts
export APP_NAME=pegn
export SQL_INSTANCE=pegn-shared-pg

npm run gcp:deploy:stg
npm run gcp:deploy:prod
```

部署腳本流程：
1. build server image
2. 先部署暫時 web（拿到 web URL）
3. 部署 api（`APP_ROLE=api`）
4. 部署 sync（`APP_ROLE=sync`）
5. 重新 build/deploy web，注入正確 `VITE_API_URL` / `VITE_SYNC_URL`

## 5) 驗證

- Web 首頁可打開（Cloud Run URL）
- API 健康檢查：`<api-url>/health`
- Agent 串流（SSE）正常
- 文件協作（Hocuspocus WebSocket）正常

## 6) 成本控制（1000 TWD 目標）

- staging 與 production 共用同一個 Cloud SQL instance（不同 database）
- Cloud Run `min-instances` 先維持 0
- Cloud SQL 磁碟先用 20GB，定期觀察
- 在 Cloud Billing 建立 70% / 90% / 100% 預算告警

## 7) 重要環境變數說明

- `APP_ROLE=all`：本地/compose 一體啟動（預設）
- `APP_ROLE=api`：僅啟動 API + `/ws` presence
- `APP_ROLE=sync`：僅啟動 Hocuspocus sync

> 若要把部署流程改為 GitHub Actions CD，可直接重用 `scripts/gcp/*.sh`。