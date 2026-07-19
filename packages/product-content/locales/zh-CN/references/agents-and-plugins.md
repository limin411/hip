# hip 智能体、插件与 MCP（Level 3）

## 内置智能体配置

常见固定配置（在智能体 UI 中启用/禁用）：

| 配置 | 角色 |
|------|------|
| **supervisor** | 默认编排：工具、提交、脚本、委派 |
| **plan** | 偏设计 / 规划（写权限视配置收窄） |
| **explore** | 只读代码库搜索 |
| **coder** | 偏实现，可带脚本 |

自定义 **internal** 智能体：人设提示 + 绑定模型 + 工具授权。  
**外部 / ACP** 智能体：独立进程；产品记忆默认关闭（除非配置开启）。

支持的 ACP preset（设置 → 智能体 → 新增 ACP）：**OpenCode**、**Grok Build**（`grok agent stdio`）、**Pi**、**Claude Code**、**Codex**。Grok Build 为原生 ACP（安装见 `https://x.ai/cli`）；认证用 `grok login` 或可选 `XAI_API_KEY`。

## 委派工具（主智能体）

| 工具 | 用途 |
|------|------|
| `task` | 单个子任务（前台或后台） |
| `dispatch_agent` | 命名花名册智能体；阻塞，除非同批多个调用 |
| `task_batch` | **2+ 独立子任务的首选**（真并行） |

若只用顺序 dispatch，不要声称「并行」完成。

## 插件

- 安装于 `~/.hip/plugins/`；注册表在 `~/.hip/config/hip-plugins.json`。
- 插件可附带技能、智能体、MCP 配置与钩子。
- 禁用插件会从会话中移除其贡献。

## MCP

- 服务器配置来自 hip.toml / 插件合成。
- Code 面可能注入短目录；用 `mcp_search` 发现。
- 调用形式：`mcp__<server>__<tool>`。
- 若配置了网络策略，可能拦截出站 MCP/web 工具。

## 技能作用域

| 作用域 | 位置 |
|--------|------|
| global | `~/.hip/skills/<id>/` |
| project | `.hip/skills/<id>/`（同 id 覆盖 global） |
| plugin | 插件自有技能目录 |
| 内置产品 | `~/.hip/builtin-skills/hip/`（优先级最低；可被同 id 覆盖） |
