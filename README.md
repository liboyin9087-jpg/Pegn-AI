# Pegn-AI — AI Native Work OS

Pegn-AI 是一個面向知識工作者與團隊的 AI 原生工作平台：
文件協作、知識圖譜、混合搜尋、PromptOps 與多 Agent 工作流在同一個產品裡完成。

![Pegn-AI Hero Placeholder](docs/assets/hero-placeholder.png)

> 提示：上圖為展示佔位圖，請替換成你實際產品首頁截圖。

---

## 產品狀態（2026-03-02）

- 核心功能：已完整落地，可市場化（MVP / 商業試營運）
- 建議對外定位：Public Beta / Early Access
- 目前已具備：協作 CRDT、混合/向量搜尋、Agent + PromptOps、Docker 化部署、CI 品質門檻
- 上市後優先補強：RLS 全面化、OpenTelemetry 全鏈路追蹤、CI 擴充為 CD 自動部署

---

## 為什麼是 Pegn-AI

- 寫作與協作不是分開工具：編輯、討論、AI 協作在同頁完成
- 從文字到知識：文件內容可直接形成可查詢、可視化的知識圖譜
- 從搜尋到行動：搜尋結果可接到 Agent 流程與生成任務
- 從線上到離線：離線可操作，回線自動重播 mutation

---

## 產品亮點

### 1) 即時協作編輯
- Yjs CRDT + Hocuspocus 同步
- 評論串、錨點留言、@mention
- 協作者 presence 與遠端游標提示

![Editor Placeholder](docs/assets/editor-collab-placeholder.png)

### 2) C 級協作體驗（Wave 1–9）
- 活動清單、遠端標記、行號跳轉
- 追焦後 1.2 秒行高亮、活躍 8 秒淡出
- Tooltip 智慧避邊、微彈簧位移過場
- 鍵盤可達（Tab 焦點 / Esc 關閉）
- Agent Run UI telemetry 對齊（SSE schema/request id + artifacts replay 指標）

![Presence Placeholder](docs/assets/presence-placeholder.png)

### 3) 知識圖譜 + GraphRAG
- 實體與關係視覺化
- 混合檢索（BM25 + 向量）
- GraphRAG 問答路徑

![KG Placeholder](docs/assets/kg-placeholder.png)

### 4) Agent + PromptOps
- Supervisor/Research 等流程入口
- Prompt 版本化、測試與 provider abstraction

![Agent Placeholder](docs/assets/agent-placeholder.png)

---

## 快速體驗

### 本地開發

1. 安裝依賴

```bash
npm install
```

2. 啟動資料服務

```bash
docker-compose up -d postgres redis
```

3. 設定環境

```bash
cp .env.example .env
```

4. 啟動前後端

```bash
npm run dev
```

預設位址：
- Web: http://localhost:5177
- API: http://localhost:4000
- Sync: ws://localhost:1234

### Docker 整包啟動

```bash
cp .env.example .env
docker-compose up --build
```

預設位址：
- Web: http://localhost:80
- API: http://localhost:4000

---

## 技術棧

- Frontend: React 19, Vite 5, TypeScript, Tailwind CSS 4, Motion
- Collaboration: Yjs, Hocuspocus, WebSocket Presence
- Backend: Node.js, Express, TypeScript
- Data: PostgreSQL 16 + pgvector, Redis 7
- AI: Gemini / OpenAI（PromptOps provider abstraction）

---

## 專案文件

- 工程版 README（完整開發/部署/API）：[README.engineering.md](README.engineering.md)
- 歷史實作摘要：[README-IMPLEMENTATION.md](README-IMPLEMENTATION.md)
- 功能缺口分析：[docs/core-features-gap-analysis.zh-TW.md](docs/core-features-gap-analysis.zh-TW.md)

---

## 專案結構

```text
Pegn-AI/
├─ apps/
│  ├─ server/
│  └─ web/
├─ docs/
├─ README.md                # 對外展示版
├─ README.engineering.md    # 工程版
└─ README-IMPLEMENTATION.md
```

---

## License

MIT
