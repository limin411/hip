# hip

[English](./README.md) | [简体中文](./README.zh-CN.md) | **繁體中文**

**hip** 是一款桌面 AI 工作台（定位類似 Claude Code Desktop / Codex Desktop）：Tauri 殼 + React UI + Node.js sidecar，在本機專案中執行 [LangGraph](https://langchain-ai.github.io/langgraphjs/) 智能體。

每個 UI 分頁是獨立工作階段。產品預設是 **Supervisor ReAct** 迴路——智能體使用工具，並在需要時透過 `task` / `dispatch_agent` / `task_batch` 委派。一般回合**不會**強制 Planner → Coder → Reviewer 流水線。

## 核心能力

| 領域 | 說明 |
|------|------|
| **介面（Surfaces）** | **Code** — 完整專案工作台（檔案、git 指導、MCP、工具）。**Chat** — 較輕的對話面；可預覽交付物寫入工作區供工件面板展示。 |
| **權限模式** | **edit**（預設，專案根沙箱）、**chat**（唯讀）、**full**（使用者明確授權的全檔案系統）。 |
| **智能體** | Supervisor 與專用名冊（**explore** / **plan** / **coder**）；透過 `task_batch` 做真正的並行子任務。 |
| **擴充** | 技能（`SKILL.md`）、外掛、MCP、掛鉤——全域在 `~/.hip/`，專案在 `.hip/`。 |
| **記憶** | 跨工作階段記憶**預設關閉**；在 **設定 → 記憶** 中開啟。 |
| **CLI** | 僅附著到**已執行**桌面應用的 `@hip/cli`（`doctor`、`session`、`run`、`repl`）。 |
| **本機優先** | 設定、SQLite、技能、外掛與日誌均在 `~/.hip/`。 |

## 架構

執行時有三個行程協作：

| 行程 | 執行環境 | 職責 |
|------|----------|------|
| **Tauri Shell** | Rust（`src-tauri/`） | 視窗管理、sidecar 生命週期、`get_sidecar_port` 命令 |
| **Frontend** | React + Vite（`src/`） | 分頁、聊天、智能體執行樹 |
| **Sidecar** | Node.js（`packages/sidecar/`） | LangGraph 智能體執行環境、WebSocket 服務 |

Tauri 殼在啟動時透過 `tauri-plugin-shell` 的 sidecar 機制拉起 sidecar。sidecar 在空閒連接埠綁定 WebSocket，並向 stdout 印出 `{"port":NNNN}`；Rust 擷取後透過 `get_sidecar_port` 暴露給前端，前端連線 `ws://localhost:NNNN`。

### 委派入口（智能體執行環境）

產品回合走以下三條路徑之一。只有**明確**工作流程定義會離開預設 ReAct 迴路；工作階段 `orchMode` 不參與路由（UI 開關已移除；API 仍保留但已棄用）。

| 入口 | 時機 | 行為 |
|------|------|------|
| **預設 ReAct + task/dispatch** | 普通 `message:send`（無待執行工作流程） | Supervisor ReAct 圖（`buildGraph`）。透過 `task` / `dispatch_agent` 做智能體驅動隔離；一次 `task_batch` 做**真正並行**的多段研究（可選 per-task `agent`，預設並行 4）。優先 `task_batch`，避免順序多次 `dispatch_agent`。 |
| **明確 DAG** | 設定了 `pendingWorkflowDef`，或 `workflow:run` | 編排器 / workflow-runner DAG。不被模式旗標強制。內建 cluster 範本（如 planner→coder）僅作內部/測試輔助。 |
| **多智能體 handoff** | 可選 / 非預設呼叫方 | `multi-agent-graph` 的 `handoff_to_*` 組合。實驗面；不是產品預設工作階段路徑。 |

本倉庫為 **yarn workspaces** monorepo：

```
packages/protocol/   @hip/protocol — 共用 WebSocket 訊息類型
packages/sidecar/    @hip/sidecar  — LangGraph WS 服務
packages/cli/        @hip/cli      — 僅附著的產品 CLI
packages/product-content/  智能體嵌入內容 + 設定 Help 在地化
src/                 React 前端
src-tauri/           Rust 殼
```

## 開發環境

> API 金鑰（如 DeepSeek）在應用 **設定** 面板中填寫，保存在
> `~/.hip/config/auth.json`（檔案模式 `0600`）——唯一權威來源。桌面應用、
> 獨立 sidecar（`scripts/dev.sh start sidecar`）與測試套件都從該處讀取。
> **`~/.hip/config/` 存有明文金鑰；請勿同步到雲端硬碟或 dotfile 倉庫。**

### 前置條件

- Node.js + [Yarn](https://yarnpkg.com/)（workspaces）
- Rust 工具鏈（Tauri）
- [Tauri v2](https://v2.tauri.app/start/prerequisites/) 平台依賴

### 快速開始

```bash
# 1. 安裝 workspace 依賴
yarn install

# 2. 產生 dev 模式 sidecar 包裝（首次，以及工具鏈變更後）。
#    src-tauri/binaries/ 為 gitignore 的建置產物目錄，
#    Rust 建置解析 sidecar 前必須執行本步。
yarn sidecar:dev-bin

# 3. 執行應用（啟動 Vite、sidecar 與 Tauri 視窗）
yarn tauri dev
```

然後開啟 **設定**，新增提供者 API 金鑰，在 **Code** 或 **Chat** 介面開始工作階段。

### LangSmith 追蹤（可選）

sidecar 中的 LangGraph / LangChain 執行可匯出追蹤到
[LangSmith](https://smith.langchain.com/)。追蹤**預設關閉**。

**建議：** 寫入 `~/.hip/config/hip.toml`（sidecar 啟動時經 `HIP_CONFIG_PATH` 載入）：

```toml
[langsmith]
enabled = true
api_key = "lsv2_…"                                    # 來自 LangSmith 設定
project = "hip"
endpoint = "https://eu.api.smith.langchain.com"       # 僅歐盟；美國雲可省略
```

專案級 `.hip/hip.toml` 可整段覆寫全域同名節（與 `[agentLoop]` 合併規則相同）。

**覆寫：** 若行程環境變數已設定則優先（`LANGSMITH_TRACING`、
`LANGSMITH_API_KEY`、`LANGSMITH_PROJECT`、`LANGSMITH_ENDPOINT`，以及舊版
`LANGCHAIN_*` 別名）。Tauri 也會把這些轉發進 sidecar。

每個使用者回合是一條根 trace；同一 hip 工作階段的多輪執行透過
`metadata.thread_id` / `metadata.session_id`（= session id）歸入同一
LangSmith **Thread**。根 run 的 **name** 也是 session id。LLM span 名為
`hip.model`。請勿將 `api_key` 提交進 git；hip.toml 位於 `~/.hip/config/`
（請勿把該目錄同步到公開雲端硬碟/dotfile 倉庫）。

### 本機資料配置（`~/.hip/`）

| 路徑 | 用途 |
|------|------|
| `~/.hip/config/` | `auth.json`、`hip.toml`、網路原則（適用處模式 `0600`） |
| `~/.hip/db/hip.db` | SQLite：工作階段、訊息、智能體執行、工具、事件 |
| `~/.hip/data/tool-output/` | 大型工具輸出（不進 DB） |
| `~/.hip/logs/` | Sidecar / Tauri 日誌 |
| `~/.hip/skills/`、`plugins/`、`scratch/` | 技能、外掛、安裝暫存區 |
| `~/.hip/memories/` | 開啟記憶後的 Markdown 匯出鏡像 |

刪除工作階段會移除該工作階段的 DB 列（含事件日誌）。

```bash
# 可選：大量刪除後回收閒置頁（須先關閉應用）
sqlite3 ~/.hip/db/hip.db 'VACUUM;'
```

### 常用指令碼

| 命令 | 說明 |
|------|------|
| `yarn tauri dev` | 開發模式執行完整桌面應用 |
| `yarn sidecar:dev` | 獨立執行 sidecar WS 服務（印出連接埠） |
| `yarn sidecar:dev-bin` | （重新）產生 `src-tauri/binaries/` 中的 dev sidecar 包裝 |
| `yarn cli:dev` | 產品 CLI（`hip doctor` / `session` / `run` / `repl`）——**需 hip 應用已執行** |
| `yarn cli:test` | CLI 單元測試（無付費 LLM） |
| `yarn type-check` | 前端型別檢查 |
| `yarn workspace @hip/sidecar type-check` | sidecar 型別檢查 |
| `yarn test` | 前端與單元測試（Vitest） |
| `yarn product:content` | 重新產生智能體/UI 產品內容嵌入 |

### 產品 CLI（`@hip/cli`）

僅附著到**已執行**的 hip 桌面應用（共用 sidecar 與 `~/.hip` 資料）。

**沒有**單獨的 SDK 套件——指令碼應呼叫 `hip … --json`。
CLI **不會**啟動產品 sidecar；須先啟動應用，否則失敗並回傳
`APP_NOT_RUNNING`（結束代碼 3）。

```bash
# 先啟動桌面應用，然後：

# 健康檢查：discovery 檔案 + 附著 + hasApiKey
yarn cli:dev doctor

# 是否已有驗證金鑰？（永不印出金鑰本身）
yarn cli:dev config auth-status

# 對線上應用做一次執行（HipRunResult JSON）
yarn cli:dev run --stream none \
  --json --output /tmp/hip-out/result.json \
  "Reply with exactly: pong"

# 人類可讀串流模式：text | tools | all | none
yarn cli:dev run --stream all "summarize README.md"

# 工作階段（與 GUI 共用）
yarn cli:dev session list
yarn cli:dev session show <id-prefix> --limit 20
yarn cli:dev session delete <id> --yes

# 互動式多輪 REPL（TTY；有 GUI 時 HITL 優先走 GUI）
yarn cli:dev repl --cwd .
```

| 旗標 / 命令 | 含義 |
|-------------|------|
| `doctor` | 附著健康檢查（需應用已執行） |
| `--json` / `--output` | `HipRunResult` schemaVersion 1 |
| `--out-dir` | `result.json`、`trace.jsonl`、`patch.diff`、`usage.json` |
| `--stream` | 人類可讀 transcript（text \| tools \| all \| none） |
| `--hitl auto` | 自動批准工具權限（**繞過 GUI**） |
| `--hitl prompt` | 無 GUI 客戶端時等待 GUI 或 TTY |
| `session *` | 在共用工作階段上 list/show/delete/send |
| `repl` | 多輪互動聊天 |
| `HIP_CLI_DEV_SPAWN=1` | 僅開發：隔離 spawn（絕不使用產品 DB） |

## 記憶

跨工作階段記憶**預設關閉**。在 **設定 → 記憶** 中開啟。
SQLite 為權威資料來源；`~/.hip/memories/` 存放 Markdown 匯出鏡像。
供智能體使用的產品文案（維護者亦可閱讀）：[packages/product-content/references/memory.md](./packages/product-content/references/memory.md)（英文）；繁體中文見 [packages/product-content/locales/zh-TW/references/memory.md](./packages/product-content/locales/zh-TW/references/memory.md)。

## 建議 IDE 設定

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 產品內容（智能體嵌入）

內建產品 / 編碼技能會嵌入給智能體使用（倉庫意義上的使用者 Help 頁不在此；設定中的 Help 使用在地化正文）。

權威來源（不在 `docs/` 下）：

- 產品：[packages/product-content/](./packages/product-content/)
- 編碼 / 委派 ops 技能：[packages/product-content/ops/](./packages/product-content/ops/)
- UI 在地化：`packages/product-content/locales/zh-CN/`、`zh-TW/`

編輯上述目錄後重新產生嵌入：`yarn product:content`。

倉庫根目錄的 `docs/`（若存在）僅為可選開發者筆記，應用**不會**讀取。

## 文件語言

| 語言 | 檔案 |
|------|------|
| English | [README.md](./README.md) |
| 简体中文 | [README.zh-CN.md](./README.zh-CN.md) |
| 繁體中文 | [README.zh-TW.md](./README.zh-TW.md) |

英文為 GitHub 與智能體側產品嵌入的預設語言。技術識別符（路徑、CLI 旗標、工具名）在各語言版本中保持一致。
