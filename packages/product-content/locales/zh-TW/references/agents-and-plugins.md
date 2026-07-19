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
