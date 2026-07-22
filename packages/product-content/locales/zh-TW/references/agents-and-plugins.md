# hip 智能體、外掛與 MCP（Level 3）

## 內建智能體設定

常見固定設定（在智能體 UI 中啟用/停用）：

| 設定 | 角色 |
|------|------|
| **supervisor** | 預設編排：工具、提交、腳本、委派 |
| **plan** | 偏設計 / 規劃 |
| **explore** | 唯讀程式庫搜尋 |
| **coder** | 偏實作，可帶腳本 |

**內部**智能體：人設 + 綁定模型 + 工具授權。  
**外部 / ACP**：獨立行程；產品記憶預設關閉。

支援的 ACP preset（設定 → 智能體 → 新增 ACP）：**OpenCode**、**Grok Build**（`grok agent stdio`）、**Pi**、**Claude Code**、**Codex**。Grok Build 為原生 ACP（安裝見 `https://x.ai/cli`）；認證用 `grok login` 或可選 `XAI_API_KEY`。

ACP 智能體的認證與模型為**自管**：hip **不會**將自身 provider 的 API key 注入 ACP 子行程。

## 能力矩陣（內建 vs ACP）

| 能力 | 內建主智能體 | ACP 主智能體 | ACP 子智能體（dispatch） |
|------|--------------|--------------|--------------------------|
| hip 內建工具（read / write / run_script …） | 有 | 無（智能體自有工具） | 無 |
| hip Skills / 外掛鉤子 | 有 | 無 | 無 |
| hip MCP | 有 | 無（規劃：opt-in 轉發） | 無 |
| 用戶端 FS bridge | 不適用 | 無（僅 stub） | 無 |
| dispatch / task / task_batch | 有 | 無 | 無 |
| TaskRuntime（後台 shell / monitor / scheduler） | 有 | 無 | 無 |
| 跨工作階段 Memory 注入 | 有 | 無 | 無 |
| Memory 擷取 | 有 | 無 | 無 |
| hip 模型選擇器 | 有 | 無 | 無 |
| HITL 權限 | hip 工具門禁 | ACP `requestPermission` | 同 ACP 主智能體 |
| permissionMode | hip 工具門禁 | chat/edit 安全 kind 自動放行；其餘 HITL | 繼承父工作階段 |

**重點：** 選 ACP 作主智能體時，它是對等程式智能體堆疊，**不是** hip 內建工具／技能／MCP。

## 委派與 TaskRuntime 工具（主智能體）

| 工具 | 用途 |
|------|------|
| `task` | 單個子任務（前台或後台） |
| `dispatch_agent` | 名冊智能體（通常阻塞） |
| `task_batch` | **2+ 獨立子任務首選**（真平行） |
| `run_script`（+ `background:true`） | Shell；長任務回傳 `task_id` |
| `wait_tasks` | 等待一個或多個後台 task id |
| `task_output` | 讀取目前輸出 |
| `task_stop` | 停止後台任務 |
| `monitor` | stdout 串流為 UI 事件（**不**自動注入模型） |
| `scheduler_create` / `scheduler_list` / `scheduler_delete` | 週期喚醒（最短 60s） |

不要在主回合 sleep 輪詢長 shell / CI。

### Runtime 面板（UI）

工作階段右側面板合併 **Agents** 與 **Runtime**。仍在執行的工作顯示 chip。

## 外掛

- 安裝於 `~/.hip/plugins/`；登錄 `~/.hip/config/hip-plugins.json`。
- 外掛可附帶技能、智能體、MCP、掛鉤。

### 外掛市集（設定）

僅整合官方目錄：

| Source id | 目錄 |
|-----------|------|
| `grok-official` | [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace) |
| `claude-official` | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |

UI：**Grok market** · **Claude market** · **Custom plugins**。

- 快取：`~/.hip/cache/marketplaces/<sourceId>/`
- 源開關：`~/.hip/config/marketplace-sources.json`
- 下載預設 `enabled: false`；下載時會審查 `boundModel`。
- 開啟開關後注入貢獻（`plugin:reload`）。

### 外掛目錄結構

每個外掛**必須**有 `.plugin/plugin.json`：

```
~/.hip/plugins/<plugin-id>/
  .plugin/
    plugin.json
  skills/
    <skill-id>/
      SKILL.md
```

### `.plugin/plugin.json`

至少需要 `name`、`version`。可選：`skills`、`mcpServers`、`agents`、`hooks` 等。

### `hip-plugins.json`

建議字串陣列格式：

```json
{
  "plugins": ["/absolute/path/to/plugin"],
  "entries": [],
  "enabled": { "my-plugin": true }
}
```

## MCP

- 設定來自 hip.toml / 外掛合成。
- 用 `mcp_search`，再呼叫 `mcp__<server>__<tool>`。
- 網路原則可能封鎖出站 MCP/web。

## 技能作用域

| 作用域 | 位置 |
|--------|------|
| global | `~/.hip/skills/<id>/` |
| project | `.hip/skills/<id>/`（同 id 覆蓋 global） |
| plugin | 外掛自有技能目錄 |
| 內建產品 | `~/.hip/builtin-skills/hip/`（優先權最低） |
