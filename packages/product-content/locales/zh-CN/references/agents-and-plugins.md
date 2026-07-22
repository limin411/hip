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

ACP 智能体的认证与模型为**自管**：hip **不会**把自身 provider 的 API key 注入 ACP 子进程。请使用智能体自身登录 / 环境变量 / 预设可选的 `authEnvVar`。

## 能力矩阵（内置 vs ACP）

hip 可运行 **内置** LangGraph 智能体、将 **ACP 作为会话主智能体**，或 **派发 ACP 作为子智能体**。能力不同（当前产品；规划中的 host 能力另行标注）：

| 能力 | 内置主智能体 | ACP 主智能体 | ACP 子智能体（dispatch） |
|------|--------------|--------------|--------------------------|
| hip 内置工具（read / write / run_script …） | 有 | 无（智能体自有工具） | 无（智能体自有工具） |
| hip Skills / 插件钩子 | 有 | 无 | 无 |
| hip MCP（会话内合并） | 有 | 无（规划：opt-in 转发） | 无（规划：opt-in 转发） |
| 客户端 FS bridge | 不适用 | 无（仅 stub；真实 bridge 规划中） | 无（仅 stub；真实 bridge 规划中） |
| dispatch / task / task_batch | 有 | 无 | 无 |
| TaskRuntime（后台 shell / monitor / scheduler） | 有 | 无 | 无 |
| 跨会话 Memory 注入 | 有 | 无（配置项预留；前缀规划中） | 无 |
| Memory 抽取 | 有 | 无 | 无 |
| hip 模型选择器 | 有 | 无（用 agent configOptions / 智能体侧模型 UI） | 无 |
| HITL 权限 | hip 工具门禁 | ACP `requestPermission` | 同 ACP 主智能体 |
| permissionMode | hip 工具门禁 | chat/edit 下安全 kind（read/fetch/other）自动放行；其余 HITL（ACP 路径上 `full` 亦为 HITL） | 继承父会话 mode |

**要点：** 选 ACP 作主智能体时，它是对等的编程智能体栈，**不是** hip 内置工具/技能/MCP。子智能体派发使用同一工具栈；主智能体与子智能体目前均无 hip memory 注入或 hip MCP。

## 委派与 TaskRuntime 工具（主智能体）

| 工具 | 用途 |
|------|------|
| `task` | 单个子任务（前台或后台） |
| `dispatch_agent` | 命名花名册智能体；阻塞，除非同批多个调用 |
| `task_batch` | **2+ 独立子任务的首选**（真并行） |
| `run_script`（+ `background:true`） | Shell；长任务返回 `task_id` |
| `wait_tasks` | 等待一个或多个后台 task id |
| `task_output` | 读取目前输出（shell / agent / monitor） |
| `task_stop` | 停止运行中的后台任务 |
| `monitor` | 将 stdout 流式到 UI 事件（**不会**自动注入模型上下文） |
| `scheduler_create` / `scheduler_list` / `scheduler_delete` | 周期唤醒（最短间隔 60s） |

若只用顺序 dispatch，不要声称「并行」完成。  
长 shell / CI 不要在主回合 sleep 轮询——使用上表 TaskRuntime 工具。

### Runtime 面板（UI）

会话右侧面板合并 **Agents**（花名册 / 子智能体）与 **Runtime**（后台 shell、monitor、定时任务）。仍在运行的工作显示 chip；打开 Runtime 可查看或停止任务。

## 插件

- 安装于 `~/.hip/plugins/`；注册表在 `~/.hip/config/hip-plugins.json`。
- 插件可附带技能、智能体、MCP 配置与钩子。
- 禁用插件会从会话中移除其贡献。

### 插件市场（设置）

hip 的插件市场页**仅**集成官方目录：

| Source id | 目录 |
|-----------|------|
| `grok-official` | [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace) |
| `claude-official` | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |

UI 标签：**Grok market** · **Claude market** · **Custom plugins**（无官方来源的本地安装）。

- 目录缓存：`~/.hip/cache/marketplaces/<sourceId>/`
- 源开关：`~/.hip/config/marketplace-sources.json`
- 市场**下载**默认 `enabled: false`（已下载未启用）。
- 下载时 sidecar **审查** agent `boundModel`；不可用模型会改写为产品默认（hip.toml 的 `activeModel`）。
- 打开插件开关后注入技能/MCP/智能体（`plugin:reload`）。

### 插件目录结构

每个插件**必须**包含 `.plugin/plugin.json` 清单文件。缺少此文件 hip 无法发现插件：

```
~/.hip/plugins/<plugin-id>/
  .plugin/
    plugin.json          ← 必需：清单文件（名称、版本、技能等）
  skills/                ← 可选，由清单中 "skills" 字段引用
    <skill-id>/
      SKILL.md
```

### `.plugin/plugin.json` 清单

**必填字段：**

```json
{
  "name": "my-plugin",
  "version": "1.0.0"
}
```

**完整示例**（含所有可选字段）：

```json
{
  "name": "my-plugin",
  "version": "1.0.0",
  "id": "my-plugin",
  "description": "一个 hip 插件示例",
  "author": { "name": "作者名" },
  "license": "MIT",
  "keywords": ["ai", "tools"],
  "skills": ["./skills/tdd", "./skills/debug"],
  "mcpServers": "./mcp-config.json",
  "agents": "./agents.json",
  "hooks": "./hooks.json"
}
```

- `skills` — 指向包含 `SKILL.md` 文件的目录的路径（或路径数组）。路径相对于插件根目录，不可使用 `..`。
- `mcpServers`、`agents`、`hooks` — 可内联指定为 JSON 数组/对象，或指定为插件根目录下外部 JSON 文件的路径。

### `hip-plugins.json` 注册表格式

注册表将插件 ID 映射到绝对路径。支持两种格式：

**字符串数组格式**（新插件推荐使用）：
```json
{
  "plugins": ["/absolute/path/to/plugin"],
  "entries": [],
  "enabled": { "my-plugin": true }
}
```

**旧版对象格式**（使用 `"dir"` 键）：
```json
{
  "plugins": [
    { "dir": "/absolute/path/to/plugin", "enabled": true }
  ]
}
```

安装插件的步骤：

1. 将插件克隆/下载到 `~/.hip/plugins/<plugin-id>/`。
2. 确保 `.plugin/plugin.json` 存在，至少包含 `name` 和 `version`。
3. 将绝对路径添加到 `hip-plugins.json` → `plugins` 数组（字符串格式）。
4. 插件将在下次会话启动或执行 `plugin:reload` 后被加载。

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
