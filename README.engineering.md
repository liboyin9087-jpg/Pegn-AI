# Pegn-AI — AI Native Work OS

Pegn-AI 是一套 AI 原生協作工作平台，整合文件編輯、知識圖譜、混合搜尋、PromptOps、多 Agent 工作流與離線優先機制。

---

## 專案現況（2026-03-02）

- Monorepo：`apps/web`（React + Vite + TypeScript）與 `apps/server`（Express + TypeScript）
- 協作底層：Yjs + Hocuspocus（文件同步）與 WebSocket Presence（在線狀態）
- 搜尋：BM25 + 向量混合檢索，含 GraphRAG 查詢流程
- 已完成 C 級協作 UX 強化 Wave 1–9（含遠端游標、活動清單、可達性與過場，以及 Agent telemetry 對齊）
- 目前核心功能可本地開發與 Docker 部署

### 市場化判定（2026-03-02）

- 判定結論：核心功能已完整實做，可市場化（MVP / 商業試營運）
- 建議發佈層級：Public Beta（建議先導入真實客戶與受控流量）
- 主要風險與後續 hardening：RLS 全面化、OpenTelemetry trace、CD 自動部署

### Phase 3 進度矩陣（對齊 2026-03-02 盤點）

| 主題 | 狀態 | 補充 |
| --- | --- | --- |
| 多租戶資料隔離（RLS） | 部分完成 | `kg_entities`、`kg_relationships` 已啟用；其餘 workspace-sensitive tables 待擴展。 |
| 即時協作（WebSocket / CRDT） | 已完成 | Hocuspocus sync + 前端 provider + `/ws` presence/cursor 已落地。 |
| 向量搜尋（pgvector） | 已完成 | `vector` extension、`vector(768)`、ivfflat index 與 hybrid/GraphRAG 查詢已落地。 |
| 完整可觀測性（OpenTelemetry） | 待完成 | 目前有 request tracker / metrics / logs / health；OTel trace/span export 尚未導入。 |
| CI/CD Pipeline | 部分完成 | 已有 GitHub Actions CI（typecheck/test/build/docker build）；CD（deploy/release/push）待補。 |
| 容器化部署（Docker Compose） | 已完成 | `docker-compose.yml`、API/Web Dockerfile、healthcheck 已配置。 |

---

## 核心功能

### 1) 即時協作編輯
- 文件內容以 Yjs CRDT 同步
- WebSocket presence 顯示協作者在線/活動狀態
- 評論串、錨點留言、@mention
- 離線 queue 支援 mutation 重播

### 2) 知識與搜尋
- 文件/區塊索引
- 混合搜尋（關鍵字 + 語意）
- GraphRAG 查詢與串流
- Knowledge Graph 實體/關係可視化與操作

### 3) Agent 與 PromptOps
- 多種 Agent 入口（含 supervisor 流程）
- Prompt 版本化與測試
- LLM Provider 抽象（Gemini/OpenAI/Mock）

### 4) 平台能力
- JWT + OAuth（Google/GitHub）
- RBAC 權限控制
- Billing / Quota
- Observability（metrics / logs / health）

### 5) PWA / Offline-First
- VitePWA + Workbox
- API runtime cache
- 離線事件觀測與重播

---

## C 級協作體驗（Wave 1–9）

### 已完成
- 協作者狀態列（在線、活躍、連線狀態）
- 遠端游標標記（名稱 + 行號）
- 活動清單（最近活動、行號、輸入中狀態）
- 跳行追焦（點活動清單/標記跳至對應行）
- 追焦後 1.2 秒行高亮
- 活躍高亮 8 秒淡出
- Tooltip 完整資訊（名稱/行號/最近活動）
- Tooltip 智慧避邊 + 微彈簧過場
- 鍵盤可達性（Esc 關閉、Tab 可聚焦標記觸發 tooltip）
- Agent run 介面 telemetry 對齊：SSE `schema_version` / `request_id` 呈現、artifacts replay 指標（tokens / latency / estimated cost）

---

## 技術棧

### Frontend
- React 19
- Vite 5
- TypeScript
- Tailwind CSS 4
- Motion
- ReactFlow
- Yjs / @hocuspocus/provider

### Backend
- Node.js + Express 4
- TypeScript（tsx）
- PostgreSQL 16 + pgvector
- Redis 7
- WebSocket (`ws`)

### AI / Auth / Infra
- Google Gemini
- OpenAI（PromptOps provider）
- JWT / Passport OAuth
- Docker Compose

---

## 專案結構

```text
Pegn-AI/
├─ apps/
│  ├─ server/   # Express API + DB + Agent + WebSocket Presence
│  └─ web/      # React SPA + Editor + KG + 協作 UI
├─ docs/        # 補充文件（含功能缺口分析）
├─ docker-compose.yml
└─ package.json
```

---

## 本地開發

### 1. 安裝依賴

```bash
npm install
```

### 2. 啟動資料服務

```bash
docker-compose up -d postgres redis
```

### 3. 環境變數

```bash
cp .env.example .env
```

至少確認：
- `DATABASE_URL`
- `JWT_SECRET`
- `GEMINI_API_KEY`（或你使用的 provider 設定）

### 4. 啟動前後端

```bash
npm run dev
```

預設開發位址：
- Web: `http://localhost:5177`
- API: `http://localhost:4000`
- Sync: `ws://localhost:1234`

---

## Docker 部署（整包）

```bash
cp .env.example .env
docker-compose up --build
```

預設位址：
- Web: `http://localhost:80`
- API: `http://localhost:4000`
- Postgres: `localhost:5432`
- Redis: `localhost:6379`

---

## 常用指令

### Root

```bash
npm run dev
npm run build
npm run typecheck
npm run test
```

### Server (`apps/server`)

```bash
npm run dev -w apps/server
npm run build -w apps/server
npm run typecheck -w apps/server
npm run test -w apps/server
npm run snapshot:drill -w apps/server -- --document <doc_id>
```

### Web (`apps/web`)

```bash
npm run dev -w apps/web
npm run build -w apps/web
npm run typecheck -w apps/web
npm run test -- --run -w apps/web
```

---

## 主要 API 分類

- Auth: `/api/v1/auth/*`
- Workspaces/Documents: `/api/v1/workspaces/*`, `/api/v1/documents/*`
- Search/Indexer: `/api/v1/search/*`, `/api/v1/indexer/*`
- GraphRAG/Knowledge/KG: `/api/v1/graphrag/*`, `/api/v1/knowledge/*`, `/api/v1/kg/*`
- Agents: `/api/v1/agents/*`
- Prompts: `/api/v1/prompts/*`
- Billing: `/api/v1/billing/*`
- Comments/Inbox: `/api/v1/comments/*`, `/api/v1/inbox/*`

附加端點：
- Metrics: `/metrics`
- Detailed health: `/health/detailed`

---

## 環境變數（精簡）

```dotenv
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_native
REDIS_URL=redis://localhost:6379

JWT_SECRET=change_me_to_a_random_32char_string_in_production
JWT_EXPIRES_IN=7d
SESSION_SECRET=change_me_too_at_least_32_chars

GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
OPENAI_BASE_URL=
PROMPT_OPS_LLM_PROVIDER=auto

API_PORT=4000
SYNC_PORT=1234
CORS_ORIGIN=http://localhost:5177
FRONTEND_URL=http://localhost:5177
```

完整欄位請看 [`.env.example`](.env.example)。

---

## 開發注意事項

- 生產環境不可使用預設 `JWT_SECRET`
- 需要 Docker 與 DB 時，先確認 `postgres/redis` healthy
- 若遇到協作狀態異常，先檢查：
  - API `4000`
  - Sync `1234`
  - WebSocket `/ws` 連線

---

## 文件

- 核心功能缺口分析：[docs/core-features-gap-analysis.zh-TW.md](docs/core-features-gap-analysis.zh-TW.md)
- 實作摘要（歷史）：[README-IMPLEMENTATION.md](README-IMPLEMENTATION.md)

---

## License

MIT
