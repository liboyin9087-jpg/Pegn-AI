# Pegn-AI — AI-Native Work OS

<p align="center">
  <img src="https://img.shields.io/badge/Phase-3_Complete-22c55e?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Stack-React_19_|_Node.js_|_PostgreSQL_|_Gemini-2383e2?style=for-the-badge" />
  <img src="https://img.shields.io/badge/Deploy-Docker_Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white" />
  <img src="https://img.shields.io/badge/CI-GitHub_Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white" />
  <img src="https://img.shields.io/badge/License-MIT-6366f1?style=for-the-badge" />
</p>

**Pegn-AI** 是一套 AI 原生協作工作平台，將塊狀編輯器、混合語意搜尋、知識圖譜與多 Agent 工作流整合為單一系統。支援即時多人協作、離線優先操作，以及以自然語言驅動的自動化研究與內容生成。

---

## 目錄

- [核心功能](#核心功能)
- [技術架構](#技術架構)
- [快速開始](#快速開始)
- [環境變數](#環境變數)
- [服務一覽](#服務一覽)
- [API 端點](#api-端點)
- [資料庫結構](#資料庫結構)
- [專案結構](#專案結構)
- [功能特性詳解](#功能特性詳解)
- [開發指南](#開發指南)
- [Roadmap](#roadmap)

---

## 核心功能

### 1. 即時協作編輯器
- 基於 **BlockSuite** 的塊狀編輯體驗（文字、標題、程式碼區塊、清單等）
- 透過 **Yjs CRDT** + **Hocuspocus** WebSocket 實現多人即時同步，延遲 < 500ms
- 每 60 秒自動建立快照，支援版本回溯
- JWT 驗證的 WebSocket 連線，確保工作區安全隔離

### 2. 混合知識檢索
- **BM25 全文搜尋**（PostgreSQL `tsvector`）+ **pgvector 語意搜尋**雙引擎並行
- **GraphRAG**：知識圖譜輔助問答，結合實體關係提供引用來源
- 文檔塊即時索引，支援自動重新索引與建議補全
- 進階搜尋支援工作區、類型、時間範圍過濾

### 3. 多 Agent 並行工作流
- **五種 Agent 模板**：Supervisor、Research、Summarize、Brainstorm、Outline
- **真正並行**：Planner 拆解子任務後，各 Worker 以 `Promise.allSettled` 並行執行
- **Server-Sent Events** 即時串流輸出，token 生成過程逐字推送
- 每個 Agent 步驟均有獨立 DB 追蹤，支援伺服器重啟後自動復原

### 4. 知識圖譜視覺化
- Gemini AI 自動抽取文檔中的實體（人物、組織、地點、概念、事件）與關係
- 力導向佈局 + 環形佈局切換；節點位置持久化存儲，重載後保留
- 2-hop 鄰居展開、類型過濾、圖譜搜尋、節點編輯與刪除

### 5. 集合資料庫
- Notion-style 集合，支援**表格視圖**與**看板視圖**
- 多視圖管理，自訂欄位與排版
- 集合匯出功能

### 6. 企業級基礎設施
- **RBAC**：工作區 Admin / Editor / Viewer 三層角色，細粒度到資源操作
- **Billing & Quota**：按方案限制 AI tokens（月）、AI 呼叫（日）、Agent 執行（日）
- **Webhook**：DB 持久化訂閱，伺服器重啟後訂閱不遺失
- **Idempotency Keys**：離線 mutation 安全重播
- **Rate Limiting**：API / Auth / AI 路由分層限速
- **Observability**：Prometheus 指標匯出、結構化日誌、健康儀表板

### 7. Offline-First PWA
- **Service Worker**（Workbox）：靜態資源快取優先，API 請求 Stale-While-Revalidate
- **IndexedDB 操作佇列**：離線時 mutation 入隊，恢復連線後自動重播（含指數退避）
- `navigator.onLine` 事件監聽 + 30 秒輪詢雙重保障
- PWA 可安裝，支援 Standalone 模式

### 8. 身分驗證
- 電子郵件/密碼（bcrypt 雜湊）+ JWT（可設定有效期）
- **OAuth 2.0**：Google 與 GitHub 一鍵登入
- Token 透過 URL hash fragment 傳遞，不記錄於伺服器日誌或瀏覽器歷史
- 生產環境強制驗證 `JWT_SECRET` 非預設值

---

## 技術架構

| 層級 | 技術 |
|------|------|
| **前端框架** | React 19、Vite 5、TypeScript |
| **樣式** | Tailwind CSS 4、Framer Motion（動畫）|
| **編輯器** | BlockSuite 0.10（區塊引擎）、Yjs（CRDT）|
| **即時同步** | Hocuspocus（WebSocket + Yjs 伺服器）|
| **知識圖譜 UI** | ReactFlow 11（力導向圖譜渲染）|
| **PWA** | vite-plugin-pwa + Workbox |
| **後端框架** | Express 4、Node.js、TypeScript（tsx 直接執行）|
| **資料庫** | PostgreSQL 16 + pgvector（向量搜尋）|
| **快取** | Redis 7 |
| **AI 模型** | Google Gemini 2.5 Flash（生成 + 嵌入向量）|
| **認證** | JWT、Passport.js（Google OAuth、GitHub OAuth）|
| **檔案處理** | Multer（上傳）、pdf-parse（PDF 解析）|
| **測試** | Vitest、React Testing Library |
| **容器化** | Docker + Docker Compose（多階段建構）|
| **Web 伺服器** | nginx:alpine（SPA routing + API proxy）|
| **CI/CD** | GitHub Actions（typecheck + test + build + docker-build）|

---

## 快速開始

### 環境需求

- **Docker** & Docker Compose（生產 / 一鍵部署）
- **Node.js** 20.0+（本地開發用）
- **Google Gemini API Key**（AI 功能必須）

### 方式 A：Docker 一鍵部署（推薦）

```bash
# 1. 克隆專案
git clone https://github.com/liboyin9087-jpg/Pegn-AI.git
cd Pegn-AI

# 2. 複製環境變數範本並填入必要值
cp .env.example .env
# 編輯 .env，至少設定：
#   JWT_SECRET=<隨機 32+ 字元字串>
#   GEMINI_API_KEY=<你的 Gemini API Key>

# 3. 一鍵啟動完整 stack
docker-compose up --build
```

啟動後自動健康檢查串接依賴，所有服務 healthy 後可存取：
- **前端**：http://localhost:80
- **API**：http://localhost:4000
- **WebSocket**：ws://localhost:1234

> 資料庫 Schema 在 API 首次啟動時自動初始化，含預設角色（admin / editor / viewer）。

---

### 方式 B：本地開發模式

```bash
# 1. 克隆並安裝依賴
git clone https://github.com/liboyin9087-jpg/Pegn-AI.git
cd Pegn-AI
npm install

# 2. 設定環境變數（本地開發）
cp .env.example .env
# 填入 JWT_SECRET 與 GEMINI_API_KEY

# 3. 僅啟動資料庫基礎設施
docker-compose up -d postgres redis

# 4. 啟動開發伺服器（前後端 hot reload）
npm run dev
```

---

## 服務一覽

### Docker 部署模式（`docker-compose up --build`）

| 服務 | 網址 | 說明 |
|------|------|------|
| 前端 Web | http://localhost:80 | nginx + React SPA |
| API 伺服器 | http://localhost:4000 | Express + Node.js |
| WebSocket 同步 | ws://localhost:1234 | Hocuspocus CRDT |
| Prometheus 指標 | http://localhost:4000/metrics | 監控匯出 |
| 健康詳情 | http://localhost:4000/health/detailed | DB + 記憶體狀態 |
| 管理日誌 | http://localhost:4000/admin/logs | 需認證 |

### 本地開發模式（`npm run dev`）

| 服務 | 網址 |
|------|------|
| 前端（Vite HMR） | http://localhost:5177 |
| API 伺服器 | http://localhost:4000 |
| WebSocket 同步 | ws://localhost:1234 |

---

## 環境變數

複製 `.env.example` 為 `.env` 並填入實際值：

```bash
cp .env.example .env
```

### 必填項目

| 變數 | 說明 |
|------|------|
| `JWT_SECRET` | JWT 簽署密鑰，生產環境必須設為隨機 32+ 字元字串 |
| `GEMINI_API_KEY` | Google Gemini API Key（AI 全功能依賴）|
| `DATABASE_URL` | PostgreSQL 連線字串 |

### Docker 部署 vs 本地開發差異

| 變數 | Docker 模式 | 本地開發模式 |
|------|------------|-------------|
| `DATABASE_URL` | `postgresql://postgres:postgres@postgres:5432/ai_native`（自動注入）| `postgresql://postgres:postgres@localhost:5432/ai_native` |
| `CORS_ORIGIN` | `http://localhost:80` | `http://localhost:5177` |
| `FRONTEND_URL` | `http://localhost:80` | `http://localhost:5177` |

> Docker Compose 會自動覆蓋 `DATABASE_URL` 與 `REDIS_URL` 為容器內部網路地址，其他值從 `.env` 讀取。

完整變數說明請參閱 [`.env.example`](.env.example)。

---

## API 端點

### 認證

| 方法 | 路徑 | 說明 |
|------|------|------|
| `POST` | `/api/v1/auth/register` | 電子郵件/密碼註冊 |
| `POST` | `/api/v1/auth/login` | 登入，回傳 JWT |
| `GET` | `/api/v1/auth/me` | 取得當前用戶資訊 |
| `GET` | `/api/v1/auth/google` | Google OAuth 流程 |
| `GET` | `/api/v1/auth/github` | GitHub OAuth 流程 |
| `GET` | `/api/v1/auth/oauth/status` | 已配置的 OAuth 提供商 |

### 工作區與文檔

| 方法 | 路徑 | 說明 |
|------|------|------|
| `POST` | `/api/v1/workspaces` | 建立工作區 |
| `GET` | `/api/v1/workspaces` | 列出用戶工作區 |
| `GET` | `/api/v1/workspaces/:id` | 取得工作區詳情 |
| `POST` | `/api/v1/documents` | 建立文檔 |
| `GET` | `/api/v1/workspaces/:id/documents` | 列出工作區文檔 |
| `PUT` | `/api/v1/documents/:id` | 更新文檔 |
| `PATCH` | `/api/v1/documents/:id/rename` | 重命名文檔 |
| `DELETE` | `/api/v1/documents/:id` | 刪除文檔 |
| `GET` | `/api/v1/documents/:id/blocks` | 取得文檔區塊 |

### 搜尋

| 方法 | 路徑 | 說明 |
|------|------|------|
| `POST` | `/api/v1/search` | 混合搜尋（BM25 + 向量）|
| `POST` | `/api/v1/search/advanced` | 進階過濾搜尋 |
| `GET` | `/api/v1/search/suggestions` | 搜尋建議補全 |
| `POST` | `/api/v1/indexer/workspace/:id/reindex` | 重建工作區索引 |

### Agent 工作流

| 方法 | 路徑 | 說明 |
|------|------|------|
| `POST` | `/api/v1/agents/supervisor` | 啟動監督器 Agent |
| `POST` | `/api/v1/agents/research` | 研究模式 |
| `POST` | `/api/v1/agents/summarize` | 摘要模式 |
| `POST` | `/api/v1/agents/brainstorm` | 腦力激盪模式 |
| `POST` | `/api/v1/agents/outline` | 大綱生成模式 |
| `GET` | `/api/v1/agents/runs/:run_id` | 取得執行狀態 |
| `GET` | `/api/v1/agents/runs/:run_id/stream` | SSE 即時串流 |

### 知識圖譜

| 方法 | 路徑 | 說明 |
|------|------|------|
| `POST` | `/api/v1/kg/extract` | 從文字抽取實體與關係 |
| `GET` | `/api/v1/kg/entities` | 列出工作區實體（含 metadata）|
| `PATCH` | `/api/v1/kg/entities/:id` | 更新實體 |
| `PATCH` | `/api/v1/kg/entities/:id/position` | 持久化節點位置 |
| `DELETE` | `/api/v1/kg/entities/:id` | 刪除實體 |
| `GET` | `/api/v1/kg/entities/:id/neighbors` | 取得鄰居圖（最深 3 跳）|
| `GET` | `/api/v1/kg/relationships` | 列出工作區關係 |

### GraphRAG & 知識

| 方法 | 路徑 | 說明 |
|------|------|------|
| `POST` | `/api/v1/graphrag/query` | GraphRAG 問答（含來源引用）|
| `POST` | `/api/v1/graphrag/stream` | GraphRAG SSE 串流 |
| `POST` | `/api/v1/knowledge/query` | 智慧知識路由問答 |
| `POST` | `/api/v1/knowledge/stream` | 知識問答串流 |

### 集合資料庫

| 方法 | 路徑 | 說明 |
|------|------|------|
| `POST` | `/api/v1/collections` | 建立集合 |
| `GET` | `/api/v1/collections/workspace/:id` | 列出工作區集合 |
| `POST` | `/api/v1/collection_views` | 建立視圖 |
| `PATCH` | `/api/v1/collection_views/:id` | 更新視圖設定 |

### 協作與通知

| 方法 | 路徑 | 說明 |
|------|------|------|
| `POST` | `/api/v1/documents/:id/comment_threads` | 建立評論執行緒 |
| `POST` | `/api/v1/comment_threads/:id/comments` | 新增評論（支援 @提及）|
| `PATCH` | `/api/v1/comment_threads/:id/resolve` | 解決評論 |
| `GET` | `/api/v1/inbox/notifications` | 取得通知列表 |
| `PATCH` | `/api/v1/inbox/notifications/read_all` | 全部標記已讀 |

### 成員與邀請

| 方法 | 路徑 | 說明 |
|------|------|------|
| `POST` | `/api/v1/workspaces/:id/invites` | 發送邀請（需 admin）|
| `GET` | `/api/v1/workspaces/:id/members` | 列出成員與角色 |
| `POST` | `/api/v1/invites/:token/accept` | 接受邀請 |

### 帳單與配額

| 方法 | 路徑 | 說明 |
|------|------|------|
| `GET` | `/api/v1/billing/usage` | 取得工作區用量報告（需 admin）|
| `GET` | `/api/v1/billing/quota?resource=agent_runs` | 查詢配額狀態 |

### Prompt 管理

| 方法 | 路徑 | 說明 |
|------|------|------|
| `POST` | `/api/v1/prompts` | 建立 Prompt 版本 |
| `GET` | `/api/v1/prompts` | 列出 Prompts |
| `GET` | `/api/v1/prompts/categories` | 動態查詢分類 |
| `POST` | `/api/v1/prompts/:id/test` | 使用真實 LLM 測試 Prompt |

### 系統

| 方法 | 路徑 | 說明 |
|------|------|------|
| `GET` | `/health` | 基礎健康檢查 |
| `GET` | `/health/detailed` | 詳細系統狀態 |
| `GET` | `/metrics` | Prometheus 指標 |
| `GET` | `/admin/logs` | 應用日誌（需認證）|
| `POST` | `/api/v1/webhooks` | 訂閱 Webhook 事件（DB 持久化）|
| `POST` | `/api/v1/upload/file` | 上傳 PDF / 圖片 / 文字 |

---

## 資料庫結構

### 主要表格（30+）

```
用戶與認證
├── users                  用戶帳戶（email、name、avatar_url、password_hash）
├── oauth_providers        Google / GitHub OAuth 連結與 access_token
├── workspace_members      工作區成員資格（user_id、workspace_id、role_id）
└── roles                  系統與工作區自訂角色（JSONB permissions 陣列）

文檔系統
├── workspaces             工作區
├── documents              文檔（parent_id 層級結構、Yjs CRDT 欄位）
├── blocks                 BlockSuite 區塊（JSON content、vector(768) 嵌入）
├── document_snapshots     CRDT 快照（每 60 秒、支援版本回溯）
└── search_index           BM25（tsvector GIN）+ pgvector 混合搜尋索引

集合資料庫
├── collections            資料庫集合（Notion-style）
└── collection_views       多視圖（table / kanban + JSONB schema）

知識圖譜
├── kg_entities            實體（entity_type、vector(768)、JSONB metadata）
└── kg_relationships       實體間關係（relation_type、weight）

Agent 工作流
├── agent_runs             Agent 執行記錄（status、result、token_usage）
└── agent_steps            步驟（planner pos=1, worker_N pos=10+, analyst pos=30, writer pos=40）

協作
├── comment_threads        評論執行緒（open / resolved）
├── comment_anchors        評論錨點（block_id、start/end offset）
├── comments               評論訊息（Markdown 內容）
├── comment_mentions       @提及（user_id、is_read）
└── inbox_notifications    通知（type、read_at）

企業功能
├── workspace_invites      邀請連結（token、expires_at、role_id）
├── quota_limits           工作區配額方案（free / pro / enterprise）
├── usage_records          資源用量記錄（按日/月唯一累計）
├── api_idempotency_keys   冪等鍵（離線 mutation 安全重播）
└── webhook_subscriptions  Webhook 訂閱（events[]、secret、user_id）
```

**向量索引**：`kg_entities.embedding` + `blocks.content_vector` 使用 `IVFFlat (vector_cosine_ops)`
**全文索引**：`search_index` 使用 PostgreSQL `GIN` 索引（tsvector）

---

## 專案結構

```
Pegn-AI/
├── apps/
│   ├── server/                     # Express API + Hocuspocus 同步伺服器
│   │   └── src/
│   │       ├── db/
│   │       │   ├── schema.sql      # 完整資料庫 Schema（含觸發器、索引）
│   │       │   ├── client.ts       # PostgreSQL 連線池
│   │       │   ├── migrations.ts   # Schema 自動初始化 + 預設角色
│   │       │   └── snapshots.ts    # CRDT 快照 CRUD
│   │       ├── middleware/
│   │       │   ├── auth.ts         # JWT 驗證中介層 + signToken
│   │       │   ├── rbac.ts         # checkPermission() 角色權限守衛
│   │       │   └── rateLimit.ts    # generalLimiter / authLimiter / aiLimiter
│   │       ├── routes/             # 22 個路由模組
│   │       │   ├── agent.ts        # Agent 啟動 + SSE 串流（含 quota 守衛）
│   │       │   ├── billing.ts      # 用量查詢與配額狀態
│   │       │   ├── kg.ts           # KG CRUD + position 持久化
│   │       │   ├── prompts.ts      # Prompt 版本控制 + 動態分類
│   │       │   └── webhook.ts      # DB 持久化 Webhook 訂閱管理
│   │       ├── services/
│   │       │   ├── agent.ts        # 並行多 Agent 管道（Promise.allSettled）
│   │       │   ├── search.ts       # 混合搜尋引擎（BM25 + pgvector）
│   │       │   ├── graphrag.ts     # GraphRAG + RRF 排名融合
│   │       │   ├── kg.ts           # Gemini 實體/關係抽取
│   │       │   ├── knowledge.ts    # 智慧知識路由
│   │       │   ├── quota.ts        # 配額追蹤與執行（月/日週期）
│   │       │   ├── webhook.ts      # DB 持久化 Webhook 分派
│   │       │   ├── prompt-ops.ts   # Prompt 版本控制 + LLMProvider 抽象層
│   │       │   ├── snapshot.ts     # CRDT 快照排程服務
│   │       │   ├── observability.ts # 指標、日誌、Prometheus 匯出
│   │       │   └── featureFlags.ts  # Feature Flag 讀取（env var）
│   │       ├── sync/
│   │       │   └── hocuspocus.ts   # WebSocket 同步（JWT 驗證 + DB 成員確認）
│   │       └── index.ts            # 應用入口、路由註冊、優雅關閉
│   │
│   └── web/                        # React 19 前端（PWA）
│       ├── public/
│       │   └── icons/icon.svg      # PWA 安裝圖示
│       ├── src/
│       │   ├── components/
│       │   │   ├── Editor.tsx      # BlockSuite 編輯器整合
│       │   │   ├── Sidebar.tsx     # 導覽側邊欄（文檔樹、集合、成員）
│       │   │   ├── AgentPanel.tsx  # Agent 執行面板（5 種模板）
│       │   │   ├── KGPanel.tsx     # 知識圖譜視覺化（拖曳存位置）
│       │   │   ├── GraphRAGChat.tsx # GraphRAG 問答介面
│       │   │   ├── SearchPanel.tsx  # 混合搜尋 UI
│       │   │   ├── AiPanel.tsx     # AI 助理面板
│       │   │   ├── CommandBar.tsx  # ⌘K 全域命令面板
│       │   │   ├── InboxPanel.tsx  # 通知 Inbox（@提及、評論）
│       │   │   ├── agent-dashboard/ # Agent 儀表板元件群（VerticalStepper 等）
│       │   │   └── database/       # Table / Kanban 視圖元件
│       │   ├── api/client.ts       # 型別化 API 客戶端（含所有端點函數）
│       │   ├── offline/queue.ts    # IndexedDB 離線操作佇列（指數退避重播）
│       │   ├── hooks/              # useCollections 等自訂 Hooks
│       │   └── App.tsx             # 根元件（路由、狀態、在線/離線邏輯）
│       └── vite.config.ts          # Vite + VitePWA（Workbox）+ Vitest
│
├── docker-compose.yml              # 完整 4 服務 stack：postgres + redis + api + web
├── .env.example                    # 環境變數範本（cp .env.example .env）
├── package.json                    # Monorepo 工作區設定（含 typecheck + test scripts）
└── docs/                           # 設計文件與缺口分析
```

---

## 功能特性詳解

### Agent 並行架構

```
用戶請求
    │
    ▼
[Planner]  position=1
Gemini 規劃 2-4 個子任務（JSON 輸出）
    │
    ├──────────────────────────────────┐
    ▼                                  ▼
[Worker 1]  position=10       [Worker N]  position=10+N
retrieveForTask(task1, mode)  retrieveForTask(taskN, mode)
auto / hybrid / graph         Promise.allSettled（並行）
    │                                  │
    └──────────────┬───────────────────┘
                   │  部分失敗不影響整體
                   ▼
             [Analyst]  position=30
             整合成功 Worker 結果，Gemini 抽取洞察
                   │
                   ▼
             [Writer]   position=40
             Gemini generateContentStream()
             → SSE token 即時推送至前端
```

### RBAC 權限矩陣

| 操作 | Admin | Editor | Viewer |
|------|-------|--------|--------|
| `workspace:admin` | ✅ | ❌ | ❌ |
| `collection:create` | ✅ | ✅ | ❌ |
| `collection:edit` | ✅ | ✅ | ❌ |
| `collection:delete` | ✅ | ❌ | ❌ |
| `collection:view` | ✅ | ✅ | ✅ |
| `document:create/edit` | ✅ | ✅ | ❌ |
| `document:delete` | ✅ | ❌ | ❌ |
| `document:view` | ✅ | ✅ | ✅ |
| `comment:create` | ✅ | ✅ | ✅ |
| `comment:resolve` | ✅ | ✅ | ❌ |

### Billing 配額預設值

| 資源 | Free 方案上限 | 計算週期 |
|------|--------------|---------|
| AI Tokens | 100,000 | 月度累計 |
| AI API 呼叫 | 200 次 | 每日重置 |
| Agent 執行 | 20 次 | 每日重置 |

超限回傳 `HTTP 429` 與剩餘配額資訊。

---

## 開發指南

### 執行測試

```bash
# 從根目錄執行全部測試
npm run test

# 個別執行
cd apps/server && npm test        # 後端單元測試
cd apps/web && npm run test -- --run  # 前端測試
cd apps/web && npm run test:coverage  # 覆蓋率報告
```

### Type 檢查

```bash
# 從根目錄同時檢查前後端
npm run typecheck

# 個別執行
cd apps/server && npm run typecheck
cd apps/web && npm run typecheck
```

### 建置生產版本

```bash
# 從根目錄建置所有 package
npm run build

# Docker 建置（確認 image 可正常建構）
docker build -t pegn-api ./apps/server
docker build -t pegn-web ./apps/web
```

### Docker 容器化部署

```bash
# 一鍵啟動完整 stack（含建置）
docker-compose up --build

# 背景執行
docker-compose up --build -d

# 查看各服務狀態與健康
docker-compose ps

# 查看 API 日誌
docker-compose logs -f api

# 停止
docker-compose down
```

### Webhook 事件類型

```
document.created    document.updated    document.deleted
comment.created     comment.resolved
agent.completed     workspace.member_added
```

---

## Roadmap

### 已完成（Phase 1 + Phase 2 + Phase 3）

#### Phase 1 — 核心功能
- [x] BlockSuite 塊狀編輯器 + Yjs 即時協作（< 500ms 延遲）
- [x] 混合搜尋（BM25 + pgvector RRF 融合）
- [x] GraphRAG 知識問答（含引用來源）
- [x] 多 Agent 並行工作流（Promise.allSettled Supervisor Pattern）
- [x] 五種 Agent 模板（Supervisor / Research / Summarize / Brainstorm / Outline）
- [x] Gemini 真實 LLM 串流（SSE token 逐字推送）
- [x] 知識圖譜視覺化（節點拖曳位置持久化）
- [x] 集合資料庫（Table / Kanban 視圖）
- [x] RBAC 細粒度權限（workspace:admin 到 comment:resolve）
- [x] Google / GitHub OAuth（URL hash fragment 安全傳遞）
- [x] WebSocket 認證（JWT + DB 工作區成員驗證）
- [x] Webhook DB 持久化（重啟不遺失）

#### Phase 2 — 強化與基礎設施
- [x] Billing & Quota 基礎架構（月/日週期，HTTP 429 執行）
- [x] PWA + Service Worker（Workbox）+ IndexedDB 離線佇列
- [x] Prompt 版本控制 + LLMProvider 抽象層（Gemini / Mock 切換）
- [x] Prometheus 指標匯出 + 健康監控
- [x] Idempotency Keys（離線 mutation 安全重播）
- [x] PDF / 文字匯入 + 自動索引

#### Phase 3 — 生產部署就緒
- [x] **Docker 容器化**：Express API + React SPA 多階段建構（`node:20-alpine` + `nginx:alpine`）
- [x] **Docker Compose 完整 stack**：4 服務（postgres + redis + api + web）+ healthcheck 依賴鏈
- [x] **nginx 生產配置**：SPA fallback routing + `/api/` proxy_pass，gzip 壓縮
- [x] **CI/CD（GitHub Actions）**：typecheck + unit test + build + docker-build 兩 job 流水線
- [x] **`.env.example` 環境變數範本**：完整文件，一行複製即可啟動

### 規劃中（Phase 4）

- [ ] **PostgreSQL Row-Level Security**：DB 層多租戶資料隔離
- [ ] **Stripe 整合**：訂閱計劃管理、付款 Webhook
- [ ] **OpenTelemetry**：分散式 tracing（Jaeger / Grafana），升級現有 Prometheus 指標
- [ ] **遞迴 Agent 分解**：Worker 輸出可觸發子 Worker（真正多層遞迴）
- [ ] **多模態上傳**：圖片 OCR、音訊轉錄 → 自動索引進 KG
- [ ] **自訂 AI 模型**：OpenAI、本地 Ollama 支援
- [ ] **動態 Feature Flags**：DB 儲存 + 管理 API，無需重啟切換
- [ ] **KG 大圖優化**：能量閾值停止條件（> 50 節點穩定排版）

---

## 授權

本專案採用 [MIT License](LICENSE) 授權。

---

<p align="center">
  <sub>Developed by Pegn AI Team · 2026</sub>
</p>
