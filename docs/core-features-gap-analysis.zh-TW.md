# Pegn-AI 四大核心功能完整度檢核（現況 + 補齊清單）

> 本文件針對目前 `Pegn-AI` 程式碼庫中的「四大核心支柱」進行**可實作性**與**完整度**盤點，並整理成可直接排入 sprint 的補齊項目。
>
> ⚠️ 重要：本專案名稱為 Pegn-AI（AI Work OS）。若要導入「PGN 對抗攻擊 / Pointer-Generator / Part Grouping」等研究路線，需另立模組，不是現有主流程內建能力。

---

## 市場化結論（2026-03-02）

- **核心功能完整實做，可市場化**（MVP / 商業試營運）
- 建議發佈策略：先以 Public Beta 上線，並以受控流量逐步擴大
- 本文件後續清單聚焦於「市場化後 hardening」與「企業級治理補齊」，非阻擋 MVP 上市

---

## 0.1) 已落地修補（本次提交）

- ✅ PromptOps 已完成 **多供應商 Provider 架構**（Gemini + OpenAI + Mock fallback）。
- ✅ `PROMPT_OPS_LLM_PROVIDER=auto` 可依序 fallback（Gemini → OpenAI → Mock），並有對應測試覆蓋。
- ✅ Agent SSE `schema_version: "v1"`、run artifacts replay API、GraphRAG profiling 已落地。

---

## 0) 快速結論（你現在最該補齊的）

### P0（2 週內）
1. **RLS 全面化**：從 KG table 擴展至所有 workspace-sensitive tables。
2. **導入 OpenTelemetry**：完成 web → api → agent/search 全鏈路 trace/span。
3. **CI 擴充為 CD**：補齊 image push / release / deploy pipeline（含環境閘門）。
4. **建立一致的進度收斂門檻**：定義 Phase 3 DoD（Definition of Done）與驗收清單。

### P1（1 個月內）
1. **協作可靠性壓測**：多人同編輯（10~30 clients）與收斂延遲基準化。
2. **搜尋品質回歸框架**：固定測試集 + Recall@K / nDCG@K 自動比較。
3. **Agent SSE 整合測試補齊**：含中斷/重連/完成態的長流測試。
4. **離線佇列 SLA 指標化**：replay 成功率、平均滯留時間、失敗重試分布。

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
- **缺「多人衝突壓測」標準流程**：目前功能可用，但缺 SLO 證據。
- **回放演練已有 drill 能力**，但仍缺 nightly 自動化與失敗告警串接。

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
- **UI C 主流程測試覆蓋不足**：`AgentPanel + Editor` 串接流程可用，但關鍵互動（長流、完成態、錯誤態、儲存回寫）測試仍不足。
- **權限/計費尚未納入本波**：本波先完成資料串接，權限、配額與計費治理需在後續切片補齊。

### 建議補齊
- **第 9 波定位採 B（含資料串接）**：維持 `/api/v1/agents/*`、SSE envelope、artifacts replay 契約一致。
- **UI C 範圍採 C（主軸）**：以 `AgentPanel + Editor` 串接為主，`AiPanel` 列為次要整理項目。
- **驗收採雙軌並進**：以「先可用流程」作 release gate，並在同一 sprint 完成關鍵互動測試擴充。

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

- Epic 1：RLS 全面化（workspace-sensitive tables policy rollout）。
- Epic 2：OpenTelemetry 全鏈路導入（Trace + Span + Exporter）。
- Epic 3：CI → CD 自動化（release/image push/deploy）。
- Epic 4：可靠性與品質基準（collab-chaos + retrieval eval + Agent SSE integration）。

> 建議先做 Epic 1 + 2，因為它們會直接影響資料隔離風險與可觀測性可驗證性。
