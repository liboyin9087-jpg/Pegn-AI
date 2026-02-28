# CLAUDE.md — Pegn-AI Project Context Cache

> 此檔案供 Claude Code 使用，讓每次新 session 快速掌握專案狀態，無需重新讀取所有檔案。

## 當前狀態

- **Branch**: `claude/review-core-features-M27dd`
- **Phase**: Phase 2 完成（已合併最新 origin/main）
- **最後 commit**: `4ac048d` merge: 解決 prompt-ops.ts 衝突，整合 LLMProvider 抽象層

## 專案架構

```
Pegn-AI/
├── apps/
│   ├── web/          # React + Vite + TypeScript 前端 (port 5173)
│   └── server/       # Express + TypeScript 後端 (port 3000)
├── packages/         # 共用套件 (未使用)
├── README.md         # 完整 Phase 2 文件
└── CLAUDE.md         # 本檔案
```

### 後端關鍵目錄

```
apps/server/src/
├── index.ts          # 主入口，所有 route 在此 register
├── middleware/
│   ├── auth.ts       # authMiddleware (JWT → req.user, req.workspaceId)
│   └── rbac.ts       # checkPermission(action, resourceType)
├── db/
│   ├── schema.sql    # 所有 DDL (30+ tables)
│   └── migrations.ts # checkSchema() 確認 table 存在 (目前檢查 10 tables)
├── services/
│   ├── agent.ts      # Supervisor Agent + 並行 Worker 架構
│   ├── prompt-ops.ts # PromptOps class (LLMProvider 抽象、getCategories)
│   ├── quota.ts      # Billing/Quota: recordUsage, checkQuota, getWorkspaceUsage
│   └── observability.ts # 日誌/追蹤 wrapper
└── routes/
    ├── agent.ts      # /api/v1/agent/*  + quota enforcement
    ├── billing.ts    # /api/v1/billing/* (usage, quota)
    ├── kg.ts         # /api/v1/kg/* + PATCH position endpoint
    ├── prompts.ts    # /api/v1/prompts/* (categories 動態查詢)
    ├── auth.ts       # /api/v1/auth/*
    ├── webhooks.ts   # /api/v1/webhooks/* (持久化)
    └── ... (其他 route 檔案)
```

### 前端關鍵目錄

```
apps/web/src/
├── App.tsx           # 主 App，含 navigator.onLine 離線偵測 (30s interval)
├── api/
│   └── client.ts    # 所有 API 呼叫函數 (含 saveKgEntityPosition)
└── components/
    ├── KGPanel.tsx   # Knowledge Graph (ReactFlow + position 持久化)
    ├── AgentPanel.tsx
    ├── PromptPanel.tsx
    └── ...
apps/web/public/
└── icons/
    └── icon.svg     # PWA 圖示 (藍色圓角矩形 + 白色 P)
apps/web/vite.config.ts  # VitePWA 已完整配置 (Workbox + icons)
```

## 已實作功能 (Phase 1 + Phase 2)

### Phase 1 Bug Fixes (commit cacf73c, f478d88)
- [x] JWT 安全性修正
- [x] RBAC 權限控管
- [x] Agent 模式修正
- [x] Webhook 持久化 (DB 儲存，非 in-memory)
- [x] 離線偵測 (App.tsx navigator.onLine)

### Phase 2 P1 — PWA (commit 6949265)
- [x] P1-1: VitePWA + icon.svg（`apps/web/public/icons/icon.svg`）
- [x] P1-2: 離線重播（App.tsx 已有完整實作，跳過重複）

### Phase 2 P2 — 功能強化 (commit 6949265)
- [x] P2-1: Prompt 分類動態查詢 (`getCategories()` → `SELECT DISTINCT category`)
- [x] P2-2: Prompt 測試用真實 LLM (Gemini via `GeminiLLMProvider`)
- [x] P2-3: KG 節點位置持久化 (`PATCH /kg/entities/:id/position` + jsonb_set)

### Phase 2 P3 — 進階架構 (commit 9089c03)
- [x] P3-1: 真正並行多 Agent Worker (`Promise.allSettled`)
- [x] P3-2: Billing & Quota 系統 (`quota_limits`, `usage_records` tables)

## 重要技術決策

### 1. LLMProvider 抽象層 (origin/main 引入)
```typescript
// apps/server/src/services/prompt-ops.ts
interface LLMProvider {
  name: string;
  generate(prompt: string, input: string): Promise<string>;
}
class MockLLMProvider implements LLMProvider { ... }
class GeminiLLMProvider implements LLMProvider { ... }
// PromptOps 使用 this.llmProvider，不使用 module-level genAI
```

### 2. Agent STEP_TEMPLATES (3 固定 + N 動態 worker)
```typescript
// apps/server/src/services/agent.ts
const STEP_TEMPLATES = [
  { step_key: 'planner', position: 1 },   // 固定
  { step_key: 'analyst', position: 30 },  // 固定
  { step_key: 'writer',  position: 40 },  // 固定
];
// worker_1...worker_N 在 planning 後動態插入 (position: 10, 11, 12...)
// Promise.allSettled 並行執行所有 worker
```

### 3. KG 位置儲存用 metadata jsonb
```sql
-- 不新增欄位，利用既有 metadata jsonb
UPDATE kg_entities
SET metadata = jsonb_set(COALESCE(metadata, '{}'), '{position}', $2::jsonb)
WHERE id = $1
```

### 4. Billing Quota Period 計算
```typescript
// apps/server/src/services/quota.ts
// ai_tokens_per_month → period = '2025-01' (月)
// ai_calls_per_day / agent_runs_per_day → period = '2025-01-15' (日)
```

### 5. Middleware 順序 (固定順序，不可調換)
```typescript
// 所有需要認證的 route 必須按此順序：
authMiddleware,                          // 1. 解析 JWT → req.user
checkPermission('action', 'resource'),  // 2. 檢查 RBAC
```

## 資料庫 Tables (schema.sql)

核心 tables（按功能分組）：
- **Auth**: `users`, `workspaces`, `workspace_members`, `sessions`
- **RBAC**: `roles`, `permissions`, `role_permissions`, `user_roles`
- **Agent**: `agent_runs`, `agent_steps`, `agent_artifacts`
- **Prompts**: `prompts`, `prompt_versions`, `prompt_test_results`
- **KG**: `kg_entities`, `kg_relationships`
- **Webhooks**: `webhooks`, `webhook_deliveries`
- **Collections**: `collections`, `collection_items`
- **Billing**: `quota_limits`, `usage_records` ← Phase 2 新增
- **Observability**: `audit_logs`, `system_metrics`

`migrations.ts` 的 `checkSchema()` 目前檢查 10 tables 存在：
```typescript
const REQUIRED_TABLES = ['users','workspaces','workspace_members',
  'agent_runs','agent_steps','prompts','kg_entities',
  'webhooks','quota_limits','usage_records'];
```

## API Endpoints 快速索引

| 前綴 | Route 檔案 | 說明 |
|------|-----------|------|
| `/api/v1/auth` | `routes/auth.ts` | 登入/登出/刷新 |
| `/api/v1/agent` | `routes/agent.ts` | Agent 執行 + quota |
| `/api/v1/prompts` | `routes/prompts.ts` | Prompt CRUD + 測試 |
| `/api/v1/prompts/categories` | `routes/prompts.ts` | 動態分類 |
| `/api/v1/kg` | `routes/kg.ts` | KG CRUD + position |
| `/api/v1/kg/entities/:id/position` | `routes/kg.ts` | PATCH 位置 |
| `/api/v1/webhooks` | `routes/webhooks.ts` | Webhook 管理 |
| `/api/v1/billing/usage` | `routes/billing.ts` | 用量查詢 (admin) |
| `/api/v1/billing/quota` | `routes/billing.ts` | Quota 查詢 |

## 環境變數

```bash
# apps/server/.env
DATABASE_URL=postgresql://...
JWT_SECRET=...
GEMINI_API_KEY=...      # Phase 2 P2-2 需要
GOOGLE_AI_API_KEY=...   # 同上，二選一

# apps/web/.env
VITE_API_URL=http://localhost:3000
```

## 常用開發指令

```bash
# 根目錄
npm run dev         # 同時啟動前後端
npm run build       # 建構所有 package
npm run test        # 執行測試

# 前端
cd apps/web
npm run dev         # Vite dev server (port 5173)

# 後端
cd apps/server
npm run dev         # ts-node-dev (port 3000)
```

## Git 工作流程

```bash
# 當前功能分支
git checkout claude/review-core-features-M27dd

# 同步最新 main（已完成，勿重複 merge）
git fetch origin main
git merge origin/main  # 已在 4ac048d 完成

# 推送
git push -u origin claude/review-core-features-M27dd
```

## 已知注意事項

1. **pool null guard**: 所有 DB 操作前必須 `if (!pool) return ...`
2. **runStep wrapper**: agent.ts 中所有步驟用 `runStep(runId, stepKey, async () => {...})` 包裝
3. **Quota 429**: agent route 在 `runSupervisorPipeline` 前呼叫 `checkQuota`，超限回傳 `{ error: 'Quota exceeded', ... }`
4. **KGPanel debounce**: `onNodeDragStop` 有 800ms debounce 避免頻繁 API 呼叫
5. **PWA**: VitePWA 已完整配置，`icon.svg` 在 `apps/web/public/icons/`
6. **merge conflict 已解決**: `prompt-ops.ts` 衝突已於 `4ac048d` 解決

## Phase 3 待辦 (尚未實作)

- [ ] 多租戶資料隔離（Row-Level Security）
- [ ] 即時協作（WebSocket / CRDT）
- [ ] 向量搜尋（pgvector）
- [ ] 完整可觀測性（OpenTelemetry）
- [ ] CI/CD Pipeline
- [ ] 容器化部署（Docker Compose）
