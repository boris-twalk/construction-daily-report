# DCR V2.0 智慧工程工作日誌

手機優先的繁體中文工程工作日誌。原始敘述、分類、草稿與版本儲存在目前瀏覽器的 IndexedDB。首次使用可在「歷史日誌」開啟 2026-11-20 示範日誌。

## 本機啟動

需要 Node.js 24 以上與 npm。從儲存庫根目錄執行：

```bash
npm ci
npm run dev
```

在瀏覽器開啟 http://localhost:5173。開發伺服器同時提供 Vite 網頁及同來源的 API。正式版可用 `npm run build` 後執行 `npm start`。預設埠為 5173，可透過 `PORT` 變更。

## 使用流程

- 選擇日期，增刪或編輯工作敘述。編輯會自動寫入本機，也可按「儲存草稿」立即儲存。
- 按「AI 整理日誌」，核對八類項目。點選來源編號可返回對應敘述。報表提供欄位與類別編輯，以及事項合併、拆分和刪除。
- 「需要人工確認」可採用建議或保留現有內容。已關閉的提醒仍留在日誌，亦可重新開啟。對工作主項執行「確認修改」後，可從其他日期使用「沿用已確認主項」帶入最近可用的主項與累計資料。
- 「儲存日誌」可立即保存編修。「版本紀錄」可展開舊內容及還原。還原會保留當前版本，方便再復原。
- 「歷史日誌」可按日期篩選、匯出完整 JSON 或匯入備份。相同日期匯入會先把原來的內容保存在版本紀錄。瀏覽器資料按來源隔離，清除網站資料前可先匯出。
- 在預覽按「列印／PDF」，從瀏覽器列印對話框選擇「另存為 PDF」。版面使用 A4。

## 選擇性啟用 OpenAI

將 `.env.example` 複製為 `.env`，只在伺服器填入 `OPENAI_API_KEY`。需要時設定支援 Structured Outputs 的 `OPENAI_MODEL`，預設為 `gpt-4.1-mini`。重新啟動伺服器。部署時可在伺服器的 Secret 設定注入同名變數。請勿使用 `VITE_` 前綴、把金鑰放進瀏覽器，或提交 `.env`。

啟用後，按整理才會透過後端把當日已新增或修改的敘述送給 OpenAI。後端要求固定 JSON Schema、驗證各類欄位與來源 ID，並停用 Responses API 的回應儲存選項。配置 API 金鑰時，請將本階段的單人服務放在可信任的網路或由部署平台限制入口，避免他人使用同一付費 API。

未配置金鑰、API 回傳無效格式、連線失敗或應用程式開啟後中斷網路時，會採用本機示範規則。正式版在 HTTPS 或本機環境首次成功載入後，可在離線時重新開啟。示範模式只辨識有限的工程關鍵字和數字格式，遇到未能辨識的內容會列入提醒，沒有 AI 語意理解能力。

## 驗證

```bash
npm run build
npm test
npm run test:print
```

先完成建置再執行列印測試。最後一項需 Chromium 與 Poppler 的 `pdftotext`。預設瀏覽器路徑為 `/usr/bin/chromium`，可設定 `CHROMIUM_PATH`。測試自行啟動伺服器、操作手機尺寸網頁、重新載入草稿並產生實際 A4 PDF。備份、差異更新及進度公式由 Vitest 驗證。

## 模組

- `src/schema.ts` 定義分類欄位、資料模型及備份格式。
- `src/storage.ts` 管理日期索引、交易及匯入。
- `src/classifier.ts` 提供分類介面及示範回退，`server/index.mjs` 管理 AI 金鑰及模型呼叫。
- `src/delta.ts` 依來源內容比對差異，記錄建議變更與提醒。相似工作項目保留各自的數量，讓使用者核對。

## Render 公開測試站

使用 **Web Service** 執行 Node.js 與 Express。Express 同時提供 `dist/` 的 React 靜態檔、離線 Service Worker，以及同來源的 `/api/*` 路由。一個 Render HTTPS 網址即可從 Windows 和手機開啟，前端 API 使用相對路徑。

| 設定 | 值 |
| --- | --- |
| 儲存庫 / 分支 | `boris-twalk/construction-daily-report` / `main` |
| Root Directory | 留空（儲存庫根目錄） |
| Runtime / Plan | Node / Free（依帳戶可用方案選擇） |
| Node 版本 | `NODE_VERSION=24.22.1` |
| Build Command | `npm ci --include=dev && npm run build` |
| Start Command | `npm start` |
| Health Check Path | `/api/status` |
| 環境變數 | `NODE_ENV=production`、`HOST=0.0.0.0`、`DCR_DEMO_ONLY=true` |
| PORT | 留給 Render 注入，由 Express 讀取 `process.env.PORT` |
| Auto-Deploy | 關閉，驗證後手動部署 |

1. 在 Render Dashboard 選擇 **New → Blueprint**，連接上述 GitHub 儲存庫與 `main`，選用根目錄的 `render.yaml`。審閱方案和環境變數後再部署。也可以選 **New → Web Service** 並手動填入表格設定。
2. 保持 `DCR_DEMO_ONLY=true`，並讓 `OPENAI_API_KEY` 空缺。公開展示期間請使用合成測試文字。此模式會在伺服器端停用 OpenAI，即使環境誤帶金鑰也不會建立 OpenAI 用戶端。
3. 部署成功後，複製 Render 頁面提供的實際 `https://…onrender.com` 網址，再用 Windows 和手機瀏覽器開啟。Free 服務閒置後，首次請求可能需要等候啟動。
4. 開啟 `/api/status`，確認得到 `{"mode":"demo"}`。以虛構文字新增或編輯敘述，按「AI 整理日誌」確認進入示範分類，重新整理確認資料仍在，再測試列印與 JSON 備份。
5. 在手機以同一網址重複測試。IndexedDB 按網站來源及瀏覽器設定檔隔離，Windows 的草稿不會出現在手機。要在另一台裝置使用同一份測試日誌，請手動匯出及匯入 JSON。

公開示範站未啟用付費 AI 分類。未來如果要開放真正 AI 給外部測試者，須另外加入身分驗證、使用配額及伺服器端請求限制，再以 Render 的秘密環境變數設定金鑰。
