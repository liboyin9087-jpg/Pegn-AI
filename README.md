# AI‑Native Work OS — Phase 1 POC

此專案為 Phase 1 可跑 POC：包含 Block Editor（BlockSuite + Yjs）、Hocuspocus 同步伺服器、AI Router + SSE 串流範例與基礎 API Skeleton。

## 先決條件
- Node.js 18+
- Docker（用於 Postgres/Redis）

## 快速開始
1. 啟動基礎服務
```bash
docker compose up -d
```
（若你的環境仍是舊版 Docker，可改用 `docker-compose`）

2. 安裝依賴
```bash
npm install
```

3. 啟動開發環境（前後端同時）
```bash
npm run dev
```

## Indexer / 搜尋測試
1. 進入 Web UI 後點選「寫入示範資料」即可寫入索引。
2. 在搜尋欄輸入關鍵字並按下搜尋，後端會使用 BM25（若提供 embedding 則合併 pgvector）。

## 服務位置
- Web UI：`http://localhost:5177`
- API：`http://localhost:4000`
- Hocuspocus Sync：`ws://localhost:1234`

## 環境變數
請複製並調整：
```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

## 注意事項
- 本 POC 的 AI Router 與 SSE 目前為示範串流（非真實 LLM）
- BlockSuite API 若與目前版本不一致，可在 `apps/web/src/components/Editor.tsx` 依實際套件文件調整

## 專案結構 (初步)
- `apps/server/`: 包含 Hocuspocus WebSocket 伺服器、API 服務和後端邏輯。
- `apps/web/`: 包含 Block Editor 前端應用。
- `docker-compose.yml`: 本地開發環境的 Docker 配置。
