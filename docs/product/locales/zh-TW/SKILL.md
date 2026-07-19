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
| **Code** | 專案工作台：檔案工具、git 指導、MCP 目錄、完整智能體工具 |
| **Chat** | 較輕的對話面：更短提示、無 git 提交指導；可預覽交付物請 `write_file` 到工作區以便工件面板展示 |

介面在 UI 中選擇；系統提示會反映目前介面。

## 權限模式

| 模式 | 效果 |
|------|------|
| **edit**（預設） | 檔案系統工具限制在專案根沙箱內 |
| **chat** | 唯讀：不能寫/改檔案，不能跑腳本 |
| **full** | 未沙箱的檔案系統（使用者明確授權）；優先絕對路徑 |

edit/chat 下的路徑約定：以 `/` 開頭的專案根相對形式。不要發明 shell 工具名——有則用 `run_script`。

## 設定（桌面 UI）

常見入口（具體文案可能隨 UI 微調）：

- **提供者 / API 金鑰** — 明文保存在 `~/.hip/config/auth.json`（依設計為 0600）
- **記憶** — 跨工作階段記憶**預設關閉**；在 設定 → 記憶 開啟（見 `references/memory.md`）
- **技能** — 啟用/停用已安裝技能
- **外掛** — 安裝/啟用外掛（技能、智能體、MCP、掛鉤）
- **智能體** — 固定設定（supervisor / plan / explore / coder）與自訂內部或外部智能體
- **網路原則** — 可選的出站工具允許/拒絕

## 技能、外掛、MCP

- **技能**：Claude 格式 `SKILL.md`。全域：`~/.hip/skills/<id>/`。專案：`.hip/skills/<id>/`。
- **外掛**：位於 `~/.hip/plugins/`。見 `references/agents-and-plugins.md`。
- **MCP**：用 `mcp_search` 尋找，再呼叫 `mcp__<server>__<tool>`。

## 智能體與委派

- 預設工作階段智能體決定何時用工具或委派。
- 有專用名冊時優先：**explore**、**plan**、**coder**。
- 多個獨立子任務 → 一次 `task_batch`。
- 深入：`references/agents-and-plugins.md`。

## CLI（`@hip/cli`）

僅附著到**已執行**的 hip 應用。應用未執行時 CLI 失敗並回傳 `APP_NOT_RUNNING`。

```bash
yarn cli:dev doctor
yarn cli:dev config auth-status
yarn cli:dev session list
yarn cli:dev run --stream none --json "Reply with exactly: pong"
yarn cli:dev repl --cwd .
```

## 專案指導檔

專案中的 `AGENTS.md` / `Claude.md` / `.hip` 等描述**專案**約定；本技能描述**產品**行為。

## Level 3 參考

- 記憶 → `references/memory.md`
- 本機資料與設定 → `references/config-and-data.md`
- 故障排除 → `references/troubleshooting.md`
- 智能體與外掛 → `references/agents-and-plugins.md`
