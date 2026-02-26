# 本地啟動指南 (Local Run Guide)

由於當前終端環境的權限限制（沙箱環境），無法直接在此處啟動伺服器或連接資料庫。請在您的 **電腦原始終端機 (Mac Terminal / iTerm2)** 中執行以下步驟：

## 1. 準備資料庫
請確保您的 PostgreSQL 正在執行，並建立 `ai_native` 資料庫：
```bash
# 如果有安裝 psql
psql -U lego -c "CREATE DATABASE ai_native;"
```

## 2. 安裝依賴項與啟動後端
進入後端目錄並執行：
```bash
cd "/Users/lego/Desktop/pegn Ai/apps/server"
npm install
# 執行資料庫遷移 (套用 RBAC 與 搜尋索引 Schema)
node scripts/run-migrations-safe.js
# 啟動後端服務
npm run dev
```

## 3. 啟動前端
開啟另一個終端機視口並執行：
```bash
cd "/Users/lego/Desktop/pegn Ai/apps/web"
npm install
npm run dev
```

## 4. 存取應用程式
- 前端網址：`http://localhost:5177`
- API 網址：`http://localhost:4000`

---
## 🧹 完全重設開發環境 (Reset Data)
如果您發現介面顯示舊資料，或者想要清空所有內容重新開始，請執行：

```bash
# 1. 停止目前的伺服器 (Ctrl+C)
# 2. 執行重設腳本 (會刪除並重建 ai_native 資料庫)
cd "/Users/lego/Desktop/pegn Ai/apps/server" && node scripts/reset-db.js

# 3. 重新執行遷移與啟動
node scripts/run-migrations-safe.js && npm run dev
```

**⚠️ 重要建議：**
執行完資料庫重設後，請在瀏覽器中 **清除 `localhost:5177` 的本地儲存 (LocalStorage)**，以確保舊的登入資訊或暫存狀態不會干擾新環境。
*(在瀏覽器按 F12 -> Application -> Local Storage -> 右鍵清除)*
