# Pegn-AI — AI-Native Work OS

<p align="center">
  <img src="https://img.shields.io/badge/Phase-P2_In_Progress-2383e2?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Stack-React_19_|_Node.js_|_PostgreSQL-2383e2?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Enterprise-SAML_|_SCIM_|_Audit-7c3aed?style=for-the-badge" />
  <img src="https://img.shields.io/badge/License-MIT-6366f1?style=for-the-badge" />
</p>

**Pegn-AI** 是 AI 原生協作工作平台，整合塊狀編輯器、混合語意搜尋、知識圖譜與多 Agent 工作流，支援即時多人協作與離線優先操作。

---

## 快速開始

```bash
git clone https://github.com/liboyin9087-jpg/Pegn-AI.git && cd Pegn-AI
cp .env.example .env          # 填入 JWT_SECRET、GEMINI_API_KEY
docker-compose up --build     # 啟動完整 stack
```

| 服務 | URL |
|------|-----|
| 前端 | http://localhost:80 |
| API | http://localhost:4000 |
| API Docs | http://localhost:4000/api-docs |
| WebSocket | ws://localhost:1234 |

本地開發：`npm install && docker-compose up -d postgres redis && npm run dev`

---

## 技術架構

| 層 | 技術 |
|----|------|
| 前端 | React 19 + Vite 5 + TypeScript + Tailwind CSS |
| 編輯器 | BlockSuite（塊引擎）+ Yjs CRDT + Hocuspocus |
| 後端 | Express 4 + Node.js 20 + TypeScript |
| 資料庫 | PostgreSQL 16 + pgvector + Redis 7 |
| AI | Google Gemini 2.5 Flash（生成 + 嵌入）+ Claude + OpenAI |
| 認證 | JWT + SAML 2.0 + SCIM 2.0 + Google/GitHub OAuth |
| 觀測 | OpenTelemetry（OTLP tracing + metrics）+ Prometheus |
| 部署 | Docker Compose / Cloud Run + Cloud SQL |

---

## 主要功能

- **即時協作**：Yjs CRDT 多人同步（< 500ms）、Presence 顯示、版本快照
- **混合搜尋**：BM25 + pgvector RRF 融合搜尋、GraphRAG 知識問答
- **多 Agent 工作流**：Supervisor + 並行 Worker（Promise.allSettled）、Gemini/OpenAI/Claude 可切換、自動降級策略
- **知識圖譜**：節點拖曳持久化、ReactFlow 力導向圖、KG 關係管理
- **Prompt 管理**：版本控制、LLMProvider 抽象層、多模型測試
- **企業功能**：SAML SSO、SCIM 佈建、Audit Export (CSV/JSON)、RBAC 細粒度權限
- **計費計量**：Quota 系統（月/日）、Usage Add-on、多維度成本儀表板（依模型分類）
- **PWA + 離線**：Service Worker + IndexedDB 佇列、Idempotency Keys 安全重播

---

## 環境變數

```bash
# 必填
JWT_SECRET=<32+ 字元隨機字串>
GEMINI_API_KEY=<Google AI Studio Key>
DATABASE_URL=postgresql://user:pass@localhost:5432/pegn

# 選填 — AI
AGENT_LLM_PROVIDER=auto        # auto / gemini / openai / claude
AGENT_FALLBACK_CHAIN=gemini,openai,claude
OPENAI_API_KEY=
ANTHROPIC_API_KEY=

# 選填 — 企業
SAML_ENTRY_POINT=
SAML_CERT=
SCIM_TOKEN=

# 選填 — 計費
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

---

## API 端點（核心）

| 前綴 | 說明 |
|------|------|
| `POST /api/v1/auth/login` | 登入取得 JWT |
| `POST /api/v1/agent/run` | 執行 Agent 任務 |
| `GET /api/v1/billing/usage` | 用量查詢 |
| `GET /api/v1/webhooks/templates` | Webhook 模板 catalog |
| `GET /api/v1/prompts/categories` | 動態分類清單 |
| `GET /api-docs` | Swagger UI |

---

## Roadmap

### 已完成
- ✅ Phase 1–3：核心編輯器、搜尋、Agent、OAuth、Webhooks、Docker CI/CD
- ✅ Phase 4 (P1)：SAML / SCIM / Audit Export / FeedbackModal / Onboarding 追蹤 / 模型降級 / Add-on 計費 / 多維度成本
- ✅ B1 OpenAPI：`swagger-jsdoc` + `/api-docs` Swagger UI（本次新增）

### 進行中（P2）
- 🔄 B2 Webhook 模板商店（`webhook_templates` catalog）
- 🔄 B4 i18n 框架（`react-i18next` zh-TW / en）
- 🔄 B5 資料駐留架構（EU / US / APAC Cloud Run region）

---

## 授權

[MIT License](LICENSE) · Pegn AI Team · 2026

