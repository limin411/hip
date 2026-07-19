# hip 智能體、外掛與 MCP（Level 3）

## 內建智能體設定

| 設定 | 角色 |
|------|------|
| **supervisor** | 預設編排：工具、提交、腳本、委派 |
| **plan** | 偏設計 / 規劃 |
| **explore** | 唯讀程式庫搜尋 |
| **coder** | 偏實作，可帶腳本 |

**內部**智能體：人設 + 綁定模型 + 工具授權。  
**外部 / ACP**：獨立行程；產品記憶預設關閉。

支援的 ACP preset（設定 → 智能體 → 新增 ACP）：**OpenCode**、**Grok Build**（`grok agent stdio`）、**Pi**、**Claude Code**、**Codex**。Grok Build 為原生 ACP（安裝見 `https://x.ai/cli`）；認證用 `grok login` 或可選 `XAI_API_KEY`。

ACP 智能體的認證與模型為**自管**：hip **不會**將自身 provider 的 API key 注入 ACP 子行程。請使用智能體自身登入 / 環境變數 / 預設可選的 `authEnvVar`。

## 能力矩陣（內建 vs ACP）

hip 可執行 **內建** LangGraph 智能體、將 **ACP 作為工作階段主智能體**，或 **派發 ACP 作為子智能體**。能力不同（目前產品；規劃中的 host 能力另行標註）：

| 能力 | 內建主智能體 | ACP 主智能體 | ACP 子智能體（dispatch） |
|------|--------------|--------------|--------------------------|
| hip 內建工具（read / write / run_script …） | 有 | 無（智能體自有工具） | 無（智能體自有工具） |
| hip Skills / 外掛鉤子 | 有 | 無 | 無 |
| hip MCP（工作階段內合併） | 有 | 無（規劃：opt-in 轉發） | 無（規劃：opt-in 轉發） |
| 用戶端 FS bridge | 不適用 | 無（僅 stub；真實 bridge 規劃中） | 無（僅 stub；真實 bridge 規劃中） |
| dispatch / task / task_batch | 有 | 無 | 無 |
| 跨工作階段 Memory 注入 | 有 | 無（設定項預留；前綴規劃中） | 無 |
| Memory 擷取 | 有 | 無 | 無 |
| hip 模型選擇器 | 有 | 無（用 agent configOptions / 智能體側模型 UI） | 無 |
| HITL 權限 | hip 工具門禁 | ACP `requestPermission` | 同 ACP 主智能體 |
| permissionMode | hip 工具門禁 | chat/edit 下安全 kind（read/fetch/other）自動放行；其餘 HITL（ACP 路徑上 `full` 亦為 HITL） | 繼承父工作階段 mode |

**重點：** 選 ACP 作主智能體時，它是對等的程式智能體堆疊，**不是** hip 內建工具／技能／MCP。子智能體派發使用同一工具堆疊；主智能體與子智能體目前均無 hip memory 注入或 hip MCP。

## 委派工具

| 工具 | 用途 |
|------|------|
| `task` | 單個子任務 |
| `dispatch_agent` | 名冊智能體（通常阻塞） |
| `task_batch` | **2+ 獨立子任務首選**（真平行） |

## 外掛與 MCP

- 外掛：`~/.hip/plugins/`；登錄 `~/.hip/config/hip-plugins.json`。
- MCP：`mcp_search` 後呼叫 `mcp__<server>__<tool>`。

## 技能作用域

全域 `~/.hip/skills/`、專案 `.hip/skills/`、外掛目錄、內建 `~/.hip/builtin-skills/hip/`（優先權最低）。
