# Incident Response Runbook — Pegn-AI

> 適用範圍：所有生產環境服務（Cloud Run API、Cloud Run Web、Cloud SQL PostgreSQL）

---

## 1. 嚴重度定義（Severity Matrix）

| 等級 | 名稱 | 定義 | SLO 目標 | 應變時限 |
|------|------|------|----------|---------|
| **P0** | Critical | 主要服務完全中斷；資料遺失或安全事件 | 99.9% | 初始回應 < 15 分鐘；緩解 < 1 小時 |
| **P1** | High | 核心功能嚴重降級（Agent、文件、AI 不可用）；>30% 請求失敗 | 99.5% | 初始回應 < 30 分鐘；緩解 < 4 小時 |
| **P2** | Medium | 部分功能受影響；效能降低但服務可用 | 99.0% | 初始回應 < 2 小時；緩解 < 24 小時 |
| **P3** | Low | 影響少數使用者；非核心功能異常；UI Bug | — | 初始回應 < 24 小時；排入下一個 Sprint |

---

## 2. On-Call 升級矩陣

```
P0 / P1 事件觸發 (PagerDuty / Cloud Monitoring 告警)
    │
    ▼
On-Call Engineer（一線）— 15 分鐘回應
    │  確認後 → 開啟 incident Slack channel (#incident-YYYYMMDD-NNN)
    │  若 30 分鐘無法緩解 ↓
    ▼
Tech Lead / 二線 On-Call
    │  若 1 小時無法緩解（P0）↓
    ▼
VP Engineering + CTO（管理層通知）
    │  若影響客戶資料或安全 ↓
    ▼
Legal / DPO（資料外洩通報啟動 GDPR 72h 窗口）
```

### 聯絡清單（填入實際人員）

| 角色 | 姓名 | PagerDuty | Slack |
|------|------|-----------|-------|
| 一線 On-Call | — | on-call-primary | @oncall |
| Tech Lead | — | — | @tech-lead |
| VP Eng | — | — | @vp-eng |
| DPO | — | — | @dpo |

---

## 3. Incident Response 流程

### 3.1 偵測（Detection）

**自動偵測來源：**
- Cloud Monitoring：HTTP 5xx rate > 1%、P95 latency > 2s
- UptimeRobot：Health endpoint `/health/detailed` 健康度 < 100%
- Sentry：Error spike（5 分鐘內 > 50 events）
- Cost Alert：當日 AI token 用量 > 80% 預算

**手動回報：**
- 使用者透過 In-app 回報（「回報問題」按鈕）
- 客服票單升級

### 3.2 分類（Triage）

1. 確認影響範圍：哪個服務/區域/功能
2. 確認嚴重度（P0-P3）
3. 建立 Incident Slack Channel：`#incident-YYYYMMDD-001`
4. 指派 Incident Commander（IC）
5. 每 30 分鐘發布一次狀態更新至 Slack / Status Page

### 3.3 緩解（Mitigation）

#### Database 問題
```bash
# 查看 Cloud SQL 連線狀態
gcloud sql operations list --instance=pegn-ai-prod

# 手動觸發 DB Failover（Cloud SQL HA 模式）
gcloud sql instances failover pegn-ai-prod

# 緊急重啟 Cloud Run API 服務
gcloud run services update pegn-ai-api --region=asia-east1 \
  --set-env-vars MAINTENANCE=true

# 遷移腳本（緊急回滾）
cd apps/server && npm run migrate:down
```

#### Cloud Run 服務問題
```bash
# 查看最近部署
gcloud run revisions list --service=pegn-ai-api --region=asia-east1

# 流量回滾至上一個穩定版本
gcloud run services update-traffic pegn-ai-api \
  --to-revisions=REVISION=100 --region=asia-east1
```

#### AI Provider 中斷
```bash
# 切換 LLM Provider（AGENT_FALLBACK_CHAIN 已實作自動降級）
# 如需手動強制切換：
gcloud run services update pegn-ai-api --region=asia-east1 \
  --update-env-vars "AGENT_LLM_PROVIDER=openai,AGENT_FALLBACK_CHAIN=openai,claude"
```

#### 配額超限
```bash
# 緊急調高 Quota（適用 P1/P0）
# 在 Cloud SQL 執行：
psql $DATABASE_URL -c "
  UPDATE quota_limits
  SET limit_value = limit_value * 2
  WHERE workspace_id = '<affected_workspace>'
    AND quota_type = 'ai_tokens_per_month';
"
```

### 3.4 溝通（Communication）

| 時機 | 管道 | 訊息格式 |
|------|------|---------|
| 事件確認後 15 分鐘內 | Slack #incidents + Status Page | 「正在調查 [服務] 問題，影響範圍：[描述]」 |
| 每 30 分鐘 | Slack | 進度更新 |
| 緩解後 | Slack + Email（P0/P1） | 「服務已恢復，原因：[摘要]，後續：post-mortem 48h 內完成」 |
| P0 資料外洩 | Legal + 監管機關（GDPR 72h） | 啟動 DPO 流程 |

### 3.5 解決（Resolution）

1. 確認所有受影響使用者服務已恢復
2. 關閉 PagerDuty alert
3. 更新 Status Page 為「Resolved」
4. 在 Slack channel 發布最終結論
5. 排定 Post-Mortem（P0: 24h 內；P1: 48h 內）

---

## 4. Post-Mortem Checklist

> 請於事件解決後指定期限內完成，不要追責，聚焦系統改善。

### 基本資料
- **Incident ID**: INC-YYYY-NNN
- **日期**: YYYY-MM-DD
- **嚴重度**: P0 / P1 / P2
- **持續時間**: X 小時 Y 分鐘
- **影響範圍**: 受影響使用者數 / 請求數
- **IC（Incident Commander）**: 姓名
- **撰寫人**: 姓名

### 事件時間線

| 時間（UTC+8） | 事件 |
|--------------|------|
| HH:MM | 告警觸發 |
| HH:MM | On-call 收到通知 |
| HH:MM | 問題確認 |
| HH:MM | 緩解措施開始 |
| HH:MM | 服務恢復 |

### Root Cause Analysis（RCA）

**問題描述：**
> （詳細描述發生了什麼）

**根本原因：**
> （為何發生）

**觸發因素（Trigger）：**
> （什麼事件觸發 / 使問題浮現）

**貢獻因素（Contributing Factors）：**
> （有哪些系統/流程弱點使問題惡化）

### 哪些做得好（What Went Well）
- 

### 哪些可改善（What Could Be Better）
- 

### 行動項目（Action Items）

| 行動 | 負責人 | 期限 | 優先度 |
|------|--------|------|--------|
| 修正根本原因 | | | P0 |
| 加強監控告警 | | | P1 |
| 更新 runbook | | | P2 |

---

## 5. 常用診斷指令

```bash
# Health Check
curl -s https://api.pegn.ai/health/detailed | jq

# 查看最近錯誤（Cloud Logging）
gcloud logging read \
  "resource.type=cloud_run_revision AND severity>=ERROR" \
  --limit=50 --format=json | jq '.[].textPayload'

# Prometheus metrics
curl -s https://api.pegn.ai/metrics | grep -E '^http_|^agent_'

# 資料庫連線數
psql $DATABASE_URL -c "SELECT count(*) FROM pg_stat_activity WHERE state='active';"

# 最近 Audit Log（P0 安全事件）
psql $DATABASE_URL -c "
  SELECT action, actor_user_id, resource_type, ip_address, created_at
  FROM audit_logs
  WHERE created_at > NOW() - INTERVAL '1 hour'
  ORDER BY created_at DESC LIMIT 50;
"
```

---

## 6. 相關連結

- **Status Page**: https://status.pegn.ai
- **Cloud Console**: https://console.cloud.google.com/home/dashboard?project=pegn-ai
- **Cloud Monitoring Dashboard**: （填入連結）
- **PagerDuty**: （填入連結）
- **Past Incident Archive**: Notion / Confluence 連結
- **Schema.sql**: `apps/server/src/db/schema.sql`
- **Rollback Guide**: `deploy/` 目錄

---

*最後更新：2026-03-05 | 版本：1.0*
