# Pegn-AI 四大核心功能完整度檢核（現況 + 補齊清單）

> 本文件針對目前 `Pegn-AI` 程式碼庫中的「四大核心支柱」進行**可實作性**與**完整度**盤點，並整理成可直接排入 sprint 的補齊項目。
>
> ⚠️ 重要：本專案名稱為 Pegn-AI（AI Work OS）。若要導入「PGN 對抗攻擊 / Pointer-Generator / Part Grouping」等研究路線，需另立模組，不是現有主流程內建能力。

---

## 0.1) 已落地修補（本次提交）

- ✅ PromptOps 已從純 mock 改為 **Provider 架構**（Gemini + Mock fallback）。
- ✅ 可透過 `PROMPT_OPS_LLM_PROVIDER` 切換（`auto`/`gemini`），且缺少 API key 時安全降級為 mock。
- ✅ 新增 `prompt-ops` 單元測試，驗證 provider 選擇與輸出行為。

---

## 0) 快速結論（你現在最該補齊的）

### P0（2 週內）
1. **把 PromptOps 的 mock LLM 改為真實 provider adapter**（Gemini / OpenAI 可切換）。
2. **補齊 Agent SSE 流程的整合測試**（run start → stream step → done）。
3. **搜尋品質評測基準**（MRR / Recall@K + regression baseline）與固定測試集。
4. **前後端 observability 串接**（Trace-ID 貫穿 API、Agent run、Search pipeline）。

### P1（1 個月內）
1. **Sync snapshot 回放驗證流程**（故障復原 drill）。
2. **GraphRAG 查詢效能 profile**（索引更新與查詢拆分 profiling）。
3. **Agent 模板 DSL 與策略配置化**（避免硬編碼模板分岔）。
4. **離線佇列 SLA 指標**（replay 成功率、平均滯留時間）。

### P2（2~3 個月）
1. **多代理 Supervisor-Worker 真正遞迴拆解**（目前偏單 run 編排）。
2. **容量治理**（token quota / rate / 成本上限與告警）。
3. **平台化回歸測試矩陣**（API contract + Web E2E + load test）。

---

## 1) 核心功能 A：協作式 Block Intelligence

### 現況判定
- 有 Web 編輯器與 Block 元件（Editor/Sidebar/Comment/Inbox 等 UI）。
- 有 Hocuspocus + Yjs 同步入口，且 server 啟動時一併啟 sync service。
- 有 snapshot service 與 DB schema 支援持久化。

### 目前缺口
- **缺「多人衝突壓測」與「回放驗證」標準流程**：可用，但缺 SLO 證據。
- **缺崩潰復原演練腳本**：難以證明 60 秒快照在實際故障場景可恢復。

### 建議補齊
- 建立 `collab-chaos` 測試：模擬 10~30 客戶端同編輯，驗證收斂延遲。
- 增加 snapshot 恢復 smoke test（CI nightly）。

---

## 2) 核心功能 B：Hybrid Retrieval（BM25 + Vector + Graph）

### 現況判定
- 已有 search / indexer / graphrag / knowledge / kg routes 與對應 service。
- 架構方向正確，具備混合檢索骨架。

### 目前缺口
- **缺統一檢索評估集與評分儀表板**：目前主要是功能可用，非品質可驗證。
- **缺 query plan 可觀測性明細**：BM25 命中、向量命中、重排權重貢獻未完整外顯。

### 建議補齊
- 建立 `retrieval_eval`：每次部署自動比較 Recall@10、nDCG@10。
- Search API 回傳 debug fields（可由 feature flag 控制）供排障。

---

## 3) 核心功能 C：Agentic Workflows

### 現況判定
- 已有 `/api/v1/agents/*` 啟動與 `/runs/:id/stream` SSE。
- 有 supervisor/research/summarize 兼容模板，支援 run 狀態查詢。

### 目前缺口
- **前端部分 metrics 為 mock 驅動**，與實際 run telemetry 尚未完全對齊。
- **PromptOps 已完成 Gemini/Mock provider 化**，下一步是補 OpenAI provider 與線上 A/B 評測。

### 建議補齊
- 導入 `LLMProvider` 介面（GeminiProvider、MockProvider）。
- Agent run event schema 版本化（v1/v2），避免前後端演進時破壞相容。
- 增加 agent stream integration tests（含中斷/重連/完成態）。

---

## 4) 核心功能 D：Enterprise Observability

### 現況判定
- 已有 request tracker、`/metrics`、`/health/detailed`、log 查詢端點。
- 已有 offline observability 路由與部分測試。

### 目前缺口
- **缺跨服務 trace 串接（web → api → agent/search）**。
- **缺成本監控與容量治理圖表**（token、延遲、錯誤率可再細分）。

### 建議補齊
- 導入 OpenTelemetry（trace + span attributes）。
- 設定 SLO：P95 latency、agent success rate、queue replay success rate。

---

## 5) 與「PGN 研究路線」的對齊建議（未來性）

若你要走你前面提到的 3 種 PGN 研究方向（對抗式/NLP Pointer/CV Part Grouping），建議採用「外掛式研究模組」：

- `research/pgn-adversarial/`
- `research/pgn-pointer-generator/`
- `research/pgn-part-grouping/`

每個模組都共用平台層能力（資料治理、評測、觀測），但不要和主產品核心服務耦合，這樣能兼顧商業穩定性與研究迭代速度。

---

## 6) 交付建議（可直接變 Jira Epic）

- Epic 1：PromptOps 真實 provider 化 + 回歸測試。
- Epic 2：Hybrid retrieval 離線評測框架。
- Epic 3：Agent SSE 穩定性與斷線重連測試。
- Epic 4：全鏈路 observability（Trace + Cost + SLA dashboard）。

> 建議先做 Epic 1 + 2，因為它們會直接決定你「AI 回答品質可驗證」是否成立。

---

## 7) 以 Notion PM 視角檢核（完整度 / 實作度 / 差異化）

### 7.1 完整度對標（上市產品標準）

| 能力面向 | Notion 常見標準 | Pegn-AI 現況 | 完整度 |
|---|---|---|---|
| 多人協作 | 穩定即時同步、權限分層、歷史回復、多人游標可視化 | 已有 Yjs + Hocuspocus + RBAC + snapshot，缺壓測報告與回復演練證據 | **75%** |
| 自動化 | 資料庫自動化規則、Agent/流程編排、Webhook 事件驅動 | 已有多 Agent、Webhook、PromptOps；缺「可視化規則編輯」與端到端回歸 | **65%** |
| 搜尋引擎 | 全文 + 語意 + 關聯查詢、排序可解釋、查詢效能可觀測 | 已有 BM25 + 向量 + GraphRAG；缺評測基準、debug ranking 欄位、SLA 儀表板 | **70%** |
| UI/UX 品質 | 一致設計語言、空狀態/錯誤態完善、快捷操作流暢 | 整體結構與互動完整，缺大規模可用性驗證（新手引導/快捷鍵覆蓋） | **72%** |

### 7.2 與 Notion 的差異化核心（應主打）

1. **AI-First 而非 AI 附加功能**：PromptOps、Supervisor-Worker、SSE 串流是核心工作流，不是外掛。
2. **GraphRAG + 知識圖譜操作閉環**：不只搜尋結果，還能視覺化、編輯、持久化知識關係。
3. **Quota/成本治理內建**：具備工作區級 token/call/run 配額，較適合企業導入與 FinOps 管理。
4. **離線 mutation replay**：對行動/弱網情境友善，可做「可靠編輯不中斷」產品敘事。

---

## 8) 上市級補齊清單（強調多人協作 + 自動化 + 搜尋）

### P0（必做，上市前）

- [ ] **協作可靠性報告**：10/30/50 併發編輯壓測、衝突收斂時間、資料一致性驗證。
- [ ] **自動化端到端驗證**：Webhook → Agent run → Artifact 產出完整 happy-path / retry-path 測試。
- [ ] **搜尋品質門檻**：固定測試集 + Recall@10 / MRR / nDCG@10 baseline，納入 CI gate。
- [ ] **UI/UX 上市檢核**：空狀態、錯誤態、離線態、無權限態、載入骨架、快捷鍵清單全覆蓋。

### P1（上市後 1 個版本內）

- [ ] 視覺化 automation rule builder（條件、觸發器、動作鏈）。
- [ ] 搜尋 explainability（BM25/向量/圖譜分數拆解）與 ranking debug panel。
- [ ] 協作審計追蹤（誰在何時修改何 block / 關鍵欄位）。
- [ ] 多租戶資料隔離（RLS）與企業合規報告模板。

---

## 9) 建議「完整實作檔案」清單（可直接開工）

> 下列是以現有專案結構為基礎、可直接補齊的檔案級任務（最小侵入）。

1. **協作壓測與回復驗證**
   - `apps/server/src/services/sync.ts`（補強觀測欄位）
   - `apps/server/src/routes/sync.ts`（新增診斷資訊端點）
   - `apps/server/src/services/snapshots.ts`（恢復流程 smoke test hook）

2. **自動化與 Agent 端到端**
   - `apps/server/src/routes/webhooks.ts`（delivery retry/trace metadata）
   - `apps/server/src/routes/agent.ts`（event schema version + telemetry 欄位）
   - `apps/server/src/services/agent.ts`（worker 失敗分類與可重試策略）

3. **搜尋引擎強化**
   - `apps/server/src/routes/search.ts`（feature flag 控制 debug fields）
   - `apps/server/src/services/search.ts`（分數拆解輸出）
   - `apps/server/src/services/graphrag.ts`（查詢耗時與命中來源標記）

4. **高品質 UI/UX**
   - `apps/web/src/components/Editor.tsx`（空/錯誤/離線態一致化）
   - `apps/web/src/components/AgentPanel.tsx`（automation 可見性、步驟狀態）
   - `apps/web/src/components/KGPanel.tsx`（搜尋解釋與可操作回饋）

---
