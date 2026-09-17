# hip

hip 是一款**桌面 AI 工作台**（Tauri 殼 + React UI + Node sidecar），產品版本 **{{HIP_PRODUCT_VERSION}}**。每個 UI 分頁是獨立工作階段。預設產品迴路是 **Supervisor ReAct** 智能體：用工具完成工作，並可透過 `task` / `dispatch_agent` / `task_batch` 委派——一般回合**不會**強制 Planner → Coder → Reviewer 流水線。

本技能是 *hip 產品本身* 的權威指南。使用者專案中的一般編碼任務**不要**載入本技能。

用**使用者的語言**回答產品問題，但設定路徑與識別符請保持原文準確。

## 漸進式揭露

- **Level 1**（系統提示 Skills 列表）：僅名稱 + 描述
- **Level 2**（本檔）：下方概覽，透過 `use_skill({ name: "hip" })` 載入
- **Level 3**：`references/` 中的深入主題——需要時用 `read_file` 讀絕對路徑

若某產品細節未寫在此處，請如實說明，不要編造 UI 文案或設定鍵。

## 介面（Surfaces）

| 介面 | 用途 |
|------|------|
| **Code** | 專案工作台（側欄「專案」）：檔案工具、git 指導、MCP 目錄、完整智能體工具、非同步 TaskRuntime |
| **Chat** | 較輕的對話面（側欄「對話」）：更短提示、無 git 提交指導；可預覽交付物請 `write_file` 到工作區以便工件面板展示 |
| **Terminals** | 託管終端 / SSH 主機介面（側欄「終端」）：在本地或遠端主機上開互動式 shell；終端右欄有 **檔案** 與 **智能體** 兩個標籤 |

沒有筆記 / 文件介面。介面在 UI 中選擇；系統提示會反映目前介面。

## 權限模式

| 模式 | 效果 |
|------|------|
| **edit**（預設） | 檔案系統工具限制在專案根沙箱內 |
| **chat** | 唯讀：不能寫/改檔案，不能跑腳本 |
| **full** | 未沙箱的檔案系統（使用者明確授權）；優先絕對路徑 |

edit/chat 下的路徑約定：以 `/` 開頭的專案根相對形式。不要發明 shell 工具名——有則用 `run_script`。

## 設定（桌面 UI）

常見入口（具體文案可能隨 UI 微調）：

- **模型設定** / **金鑰管理** — 供應商清單、模型選擇與 API 金鑰；金鑰以明文保存在 `~/.hip/config/auth.json`（依設計為 0600）
- **記憶** — 跨工作階段記憶**預設關閉**；在 設定 → 記憶 開啟（見 `references/memory.md`）
- **技能** — 啟用/停用已安裝技能
- **外掛市集** — 安裝/啟用外掛（技能、智能體、MCP、掛鉤）並瀏覽官方市集
- **智能體管理** — 固定設定（supervisor / plan / explore / coder）與自訂內部或外部智能體
- **MCP**、**掛鉤**、**一般**、**視窗** — 其餘頁面
- **網路原則** — 僅設定檔（`~/.hip/config/network.json`）；**沒有**對應的設定頁

## 工作階段右欄

在 **Code** 上，右欄標籤是 **檔案 / 大綱 / 變更 / 終端**（變更需要 git 儲存庫；終端需要活躍工作階段）。子智能體與後台執行中的工作**不在**獨立面板裡：

- 子智能體與工具過程內聯顯示在訊息軌跡中。
- 後台 shell 任務、monitor 與排程顯示在輸入框上方的執行時條裡；開啟它可檢視輸出或停止任務。

長時間 shell、日誌監視與週期檢查應使用 TaskRuntime 工具。不要在主回合 sleep 輪詢。

## 排程任務

週期提示**依工作階段歸屬**：在輸入框的時鐘按鈕建立（Chat 與 Code 皆可）。到點在**它所屬的那個工作階段內**執行——hip 不會為每次觸發新開工作階段；刪除該工作階段即刪除它的排程任務。智能體側工具為 `scheduler_create` / `scheduler_list` / `scheduler_delete`（最短間隔 60s）。

## 技能、外掛、MCP

- **技能**：Claude 格式 `SKILL.md` 資料夾。全域：`~/.hip/skills/<id>/`。專案：`.hip/skills/<id>/`。
- **外掛**：位於 `~/.hip/plugins/`；可貢獻技能、智能體、MCP 與掛鉤。見 `references/agents-and-plugins.md`。
- **MCP**：用 `mcp_search` 後呼叫 `mcp__<server>__<tool>`。

## 智能體與委派

- 預設工作階段智能體決定何時用工具或委派。
- 有專用名冊時優先：**explore**、**plan**、**coder**。
- 多個獨立子任務 → 一次 `task_batch`。
- 長時間 shell / CI / 週期工作 → TaskRuntime（`run_script` background、`monitor`、`scheduler_*`）。
- 深入：`references/agents-and-plugins.md`。

## CLI（`@hip/cli`）

僅附著到**已執行**的 hip 應用（共享 sidecar 與 `~/.hip` 資料）。不會啟動產品 sidecar。

```bash
yarn cli:dev doctor
yarn cli:dev config auth-status
yarn cli:dev session list
yarn cli:dev run --stream none --json "Reply with exactly: pong"
yarn cli:dev repl --cwd .
```

應用未執行時 CLI 失敗並回傳 `APP_NOT_RUNNING`。

## 專案指導檔

專案中若存在 `AGENTS.md` / `Claude.md` / `.hip` 等，hip 可能注入。**專案**約定優先；本技能描述**產品**行為。

## Level 3 參考

- 記憶 → `references/memory.md`
- 本機資料與設定 → `references/config-and-data.md`
- 疑難排解 → `references/troubleshooting.md`
- 智能體、外掛、MCP、TaskRuntime → `references/agents-and-plugins.md`
