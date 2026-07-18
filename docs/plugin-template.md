# hip 插件包模版（Plugin Package Spec）

> 目标：在 `~/.hip/plugins/<plugin-id>/` 中用**可解析的约定格式**描述插件能力；  
> 插件市场与 sidecar 通过同一套结构决定「这个插件提供什么」。

本文档既是 **设计说明**，也是作者可复制的 **脚手架模版**。  
与当前实现一致：运行时真源是 `.plugin/plugin.json`；市场展示可叠加人类可读的 `PLUGIN.md`。

---

## 1. 设计结论（先读这段）

### 1.1 能不能用「文档」决定插件能力？

**可以，但不要用纯散文 Markdown 当真源。**

| 层级 | 文件 | 角色 | 消费者 |
|------|------|------|--------|
| **能力真源（机器）** | `.plugin/plugin.json` | 声明 id / 版本 / 组件入口 | sidecar 安装、加载、信任推导 |
| **市场卡片（人机可读）** | `PLUGIN.md`（推荐） | 展示文案、来源、信任说明、截图链接 | 插件市场 UI、作者 README |
| **组件本体** | `skills/`、`.mcp.json`、`agents.json`、`hooks/*.cjs` | 真实能力实现 | 会话合成、工具注册 |

原因：

1. hip **已有** `PluginManifest`（见 `@hip/protocol`）与 `parsePluginManifest` / `synthesizePlugin`；能力字段已是 JSON 路径/内联配置，而不是段落标题。
2. 纯 Markdown 章节标题（`### skill 01`）难做稳定解析，且无法表达 MCP transport、hooks 函数等结构。
3. 与 skill 体系一致：`SKILL.md` 用 **YAML frontmatter + Markdown body**；插件市场层沿用同一习惯。

**推荐读取顺序（市场 / 扫描器）：**

```
1. 读 .plugin/plugin.json      → 能力、版本、组件清单（必选）
2. 若存在 PLUGIN.md            → 覆盖/补充展示字段（名称、长描述、来源、标签）
3. 扫描组件目录 / 被引用路径    → 填充 skill 名描述、MCP 细节、hook 事件名
4. 若无 plugin.json             → 按现有 auto-gen 规则从 skills/、.mcp.json 等生成
```

### 1.2 目录约定（安装后）

```
~/.hip/plugins/<plugin-id>/
├── .plugin/
│   └── plugin.json          # 必选（运行时）；能力声明真源
├── PLUGIN.md                # 推荐；市场展示 + 作者说明
├── README.md                # 可选；仓库说明（安装时可作 name 回退）
├── skills/                  # 可选；Claude 格式 skill 包
│   └── <skill-id>/
│       ├── SKILL.md
│       ├── references/      # 可选
│       ├── assets/          # 可选
│       └── scripts/         # 可选（执行需用户批准）
├── .mcp.json                # 可选；MCP 服务器列表（或写在 plugin.json 内联）
├── agents.json              # 可选；Agent 配置数组或 { "agents": [...] }
└── hooks/
    └── hooks.cjs            # 可选；导出 Hook[] 的 CJS 模块
```

- **plugin-id**：目录名 slug，通常来自 manifest `id` 或 `name` 的 slugify；注册在 `~/.hip/config/hip-plugins.json`。
- 路径一律相对**插件根目录**，禁止 `..`（parser 会拒绝路径穿越）。
- 清单也可放在插件根 `plugin.json`（兼容）；**规范位置**是 `.plugin/plugin.json`。

---

## 2. 能力清单：`.plugin/plugin.json`

### 2.1 Schema（与 `PluginManifest` 对齐）

```jsonc
{
  // —— 身份 ——
  "id": "my-plugin",                 // 可选；缺省 = name。稳定 ID，卸载/更新按此关联
  "name": "My Plugin",               // 必选；展示名
  "version": "1.0.0",                // 必选；semver 字符串
  "description": "一句话说明插件做什么", // 推荐；市场卡片摘要
  "author": {
    "name": "Author",
    "email": "optional@example.com",
    "url": "https://example.com"
  },
  "license": "MIT",
  "keywords": ["git", "review", "mcp"],

  // —— 组件入口（均可省略；省略 = 不提供该能力）——
  // skills: 相对路径，指向含 SKILL.md 的目录；string 或 string[]
  "skills": [
    "./skills/code-review",
    "./skills/pr-summary"
  ],

  // mcpServers: 内联 McpServerConfig[]，或指向 JSON 文件的相对路径
  "mcpServers": "./.mcp.json",
  // 或内联：
  // "mcpServers": [
  //   {
  //     "id": "my_mcp",
  //     "name": "My MCP",
  //     "transport": "stdio",
  //     "command": "node",
  //     "args": ["./mcp/server.js"],
  //     "env": {},
  //     "enabled": true
  //   }
  // ],

  // agents: 内联 AgentConfig[]，或指向 JSON 文件
  "agents": "./agents.json",

  // hooks: 必须是指向 CJS 模块的相对路径（内联数组无法承载 handler 函数）
  "hooks": "./hooks/hooks.cjs"
}
```

### 2.2 字段与能力映射

| 字段 | 能力类型 | 运行时效果 | 信任暗示（安装摘要用） |
|------|----------|------------|------------------------|
| `skills` | Skill | 注册 plugin-scoped skills，可 `use_skill` / `$` 调用 | 可读项目上下文（`read_files`） |
| `mcpServers` | MCP | 注册外部工具服务（stdio / sse / http） | 网络与外部进程（`network_access`） |
| `agents` | Agent | 注册可调度 agent（internal / acp / custom 等） | 可跑子进程/代理（`run_scripts`） |
| `hooks` | Hook | 会话生命周期拦截（PreToolUse 等） | 可改工具行为（`write_files` 级暗示） |

市场 UI 展示计数时，与现有 `PluginMeta` 一致：

- `skills[]` → skill id 列表  
- `mcpServers` → 解析后的配置列表  
- `agents` → agent id 列表  
- `hooks` → hook 条数 + 静态扫描到的 `HookEvent` 名  

### 2.3 最小合法清单（仅技能）

```json
{
  "name": "sample-plugin",
  "version": "0.0.1",
  "skills": [
    "./skills/sample-greet",
    "./skills/sample-format"
  ]
}
```

（与 `e2e/fixtures/sample-plugin` 一致。）

### 2.4 无清单时的自动生成（兼容）

若克隆/安装的仓库**没有** `.plugin/plugin.json`，安装流程会扫描并生成：

| 扫描 | 生成字段 |
|------|----------|
| `skills/*/SKILL.md` | `skills: ["./skills/<dir>", ...]` |
| 根目录 `.mcp.json` | `mcpServers: "./.mcp.json"` |
| `hooks/` 非空 | `hooks: "./hooks/hooks.cjs"` |
| `agents/` 非空 | `agents: "./agents.json"` |

**作者仍应手写完整 manifest**：auto-gen 不含 `id`/`description`/`author`/`keywords`，不利于市场展示与稳定更新。

---

## 3. 市场卡片：`PLUGIN.md`（推荐规范）

机器能力以 `plugin.json` 为准；`PLUGIN.md` 负责**可读性与市场信息**。  
解析规则与 `SKILL.md` 同构：**YAML frontmatter + Markdown body**。

### 3.1 完整模版（复制即用）

````markdown
---
# 与 plugin.json 对齐的稳定字段（市场优先读这些展示）
id: my-plugin
name: My Plugin
version: 1.0.0
description: >
  一句话摘要：这个插件给 hip 增加了什么能力。
  （卡片列表用；请保持简短。）

# 来源与分发
source:
  type: github                 # github | local | url | builtin
  url: https://github.com/org/my-plugin
  homepage: https://example.com/docs/my-plugin
  # 可选：锁定安装引用
  # ref: main                  # branch / tag / commit

author:
  name: Author Name
  url: https://github.com/author

license: MIT
keywords: [git, review, mcp]

# 可选：市场筛选 / 徽章（前端可忽略未知键）
category: productivity         # productivity | devops | data | writing | other
min_hip_version: "0.1.0"       # 可选；semver 下限
icon: ./assets/icon.png        # 可选；相对插件根

# 可选：信任与权限的人类说明（与 deriveTrust 互补，不替代安全策略）
permissions:
  - read_files                 # skills 会读工作区上下文
  - network_access             # MCP 外连
  # - run_scripts
  # - write_files              # hooks 可能改写工具输入/策略

# 可选：组件索引（展示用；真源仍以 plugin.json 路径为准）
# 若省略，市场应从 plugin.json + 扫描结果填充
components:
  skills:
    - id: code-review
      path: ./skills/code-review
      summary: 按仓库规范做代码审查
    - id: pr-summary
      path: ./skills/pr-summary
      summary: 生成 PR 说明草稿
  mcp:
    - id: my_mcp
      path: ./.mcp.json        # 或 inline 时写 name + transport
      summary: 提供 xxx 工具集
  agents: []
  hooks:
    - path: ./hooks/hooks.cjs
      events: [PreToolUse, PostToolUse]
      summary: 在危险命令前二次确认
---

# My Plugin

## 这个插件做什么

用 2–5 段说明适用场景、不解决什么问题、与内置能力的差异。

## 安装后你会得到

- **Skills**：`code-review`、`pr-summary` — 可在会话中 `$` 调用或授予 agent
- **MCP**：`my_mcp` — 外部工具服务（见下方配置要求）
- **Hooks**（若有）：在哪些生命周期事件介入

## 来源与维护

- 仓库：https://github.com/org/my-plugin
- 问题反馈：https://github.com/org/my-plugin/issues
- 许可证：MIT

## 配置与前置条件

列出 API Key、本地二进制、环境变量等（**不要**把密钥写进仓库）。

| 依赖 | 说明 |
|------|------|
| Node ≥ 18 | MCP stdio 子进程 |
| `MY_API_TOKEN` | 可选 env，通过 MCP `env` 注入 |

## 组件说明

### Skills

#### `code-review`

- **路径**：`./skills/code-review`
- **何时用**：用户要求 review PR / diff
- **是否含 scripts**：是/否（含 scripts 时每次执行需批准）

#### `pr-summary`

- **路径**：`./skills/pr-summary`
- **何时用**：需要生成变更说明

### MCP

#### `my_mcp`

- **传输**：stdio / sse / http
- **命令或 URL**：`node ./mcp/server.js` 或 `https://…`
- **暴露的工具（摘要）**：`search`, `create_issue`, …
- **工具白名单**（若使用）：`enabledTools` / `disabledTools`

### Agents（可选）

#### `my-agent`

- **kind**：internal | acp | custom | opencode
- **用途**：……

### Hooks（可选）

| 事件 | matcher | 行为摘要 |
|------|---------|----------|
| PreToolUse | run_script | 拦截高危命令并 ask |

## 卸载影响

卸载后上述 skill / MCP / agent / hook 不再注入新会话；已有会话是否热卸载以实现为准。

## 变更记录（可选）

### 1.0.0

- 首发：2 skills + 1 MCP
````

### 3.2 Frontmatter 字段约定

| 键 | 必填 | 说明 |
|----|------|------|
| `id` | 推荐 | 与目录名 / `plugin.json` id 一致 |
| `name` | 推荐 | 展示名；缺省回退 `plugin.json` |
| `version` | 推荐 | 与 `plugin.json` 同步 |
| `description` | 推荐 | 列表摘要 |
| `source.type` / `source.url` | 市场强烈推荐 | 安装来源；GitHub 安装走现有 `plugin:install:url` |
| `author` / `license` / `keywords` | 可选 | 市场筛选与信任展示 |
| `permissions` | 可选 | 人类可读权限说明 |
| `components.*` | 可选 | 仅展示索引；**不得**与 `plugin.json` 冲突时覆盖真源路径 |

**冲突规则：**  
`plugin.json` 与 `PLUGIN.md` frontmatter 同名字段不一致时，**能力路径以 `plugin.json` 为准**；展示文案优先 `PLUGIN.md`，其次 `plugin.json`，再次 body 第一段。

### 3.3 为何不建议「只写 Markdown 清单」

草稿形态如：

```markdown
## 插件关联的 skill 清单
### skill 01
* path
```

问题：

1. 无稳定 `id` / `version`，无法升级与去重  
2. skill 只有 path 不够：市场需要 name/description（在 `SKILL.md` frontmatter）  
3. MCP 需要 `transport`/`command`/`url` 等结构字段  
4. hooks 是代码模块，不是段落  

因此：**Markdown 写给人看；JSON 写给加载器看；两者通过 path 关联。**

---

## 4. 组件子模版

### 4.1 Skill（`skills/<id>/SKILL.md`）

```markdown
---
name: code-review
description: 按项目规范审查 diff，并给出可执行修改建议
# 可选扩展字段（与 SkillMeta 对齐）
# autoInvoke: true
# userInvocable: true
# allowedTools: []
# context: inline
# arguments:
#   - name: scope
#     description: 审查范围（pr | unstaged | path）
#     required: false
---

（Skill 正文：给模型的指令……）
```

插件市场展示 skill 时：优先读该 frontmatter 的 `name` / `description`，并标注 `scope=plugin`、`pluginId=<id>`。

### 4.2 MCP（`.mcp.json` 或内联）

支持两种文件形状（与 synthesizer 一致）：

```json
[
  {
    "id": "my_mcp",
    "name": "My MCP",
    "transport": "stdio",
    "command": "node",
    "args": ["./mcp/server.js"],
    "env": {},
    "enabled": true
  }
]
```

或：

```json
{
  "servers": [
    {
      "id": "remote_mcp",
      "name": "Remote MCP",
      "transport": "http",
      "url": "https://example.com/mcp",
      "headers": {},
      "enabled": true
    }
  ]
}
```

字段语义同 `McpServerConfig`：`stdio` 用 `command`/`args`/`env`；`sse`/`http` 用 `url`/`headers`；可选 `enabledTools` / `disabledTools`。

### 4.3 Agents（`agents.json`）

```json
{
  "agents": [
    {
      "id": "review-bot",
      "name": "Review Bot",
      "description": "专注代码审查的内部 agent",
      "kind": "internal",
      "command": "",
      "args": [],
      "prompt": "You are a careful code reviewer…",
      "allowedSkills": ["code-review"],
      "allowedMcpServers": ["my_mcp"],
      "enabled": true
    }
  ]
}
```

也可顶层直接是数组。字段对齐 `AgentConfig`。

### 4.4 Hooks（`hooks/hooks.cjs`）

```js
/** @typedef {import('@hip/protocol').Hook} Hook */

/** @type {Hook[]} */
module.exports = [
  {
    event: 'PreToolUse',
    matcher: 'run_script',
    handler: async (ctx) => {
      // 返回 { kind: 'allow' | 'deny' | 'ask' | 'modify' | 'continue', ... }
      return { kind: 'allow' }
    },
  },
]
```

合法 `event` 见 `HookEvent`：`SessionStart`、`TurnStart`、`UserPromptSubmit`、`PreToolUse`、`PostToolUse`、`PostToolUseFailure`、`TurnComplete`、`Stop`、`PermissionRequest`、`ActivityStart`、`ActivityEnd`、`ActivityBudgetRequest`。

`plugin.json` 中：

```json
{ "hooks": "./hooks/hooks.cjs" }
```

---

## 5. 插件市场如何读这份格式

### 5.1 列表项（`PluginMeta` 级）

对每个 `~/.hip/plugins/<id>/`（且在 `hip-plugins.json` 注册，或未来内置目录）：

```
PluginMeta {
  id, name, version, description, dir,
  skills: string[],          // 来自 manifest skills 路径 basename
  mcpServers: McpServerConfig[],
  agents: string[],
  hookCount, hookEvents[]
}
```

数据源：

1. `parsePluginManifest(dir)`  
2. 可选 merge `PLUGIN.md` frontmatter 的 `description` / `source` / `keywords`  
3. 对每个 skill path 读 `SKILL.md` frontmatter 丰富详情页  
4. hooks：静态扫描事件名（与现有 Hook 设置页一致，非实时 session probe）

### 5.2 详情页区块建议

1. **标题区**：name · version · author · license · source 链接  
2. **能力矩阵**：skills / MCP / agents / hooks 计数与标签  
3. **组件列表**：可展开 path、摘要、是否含 scripts  
4. **信任与权限**：`permissions` + deriveTrust 结果  
5. **正文**：`PLUGIN.md` body（Markdown 渲染）  
6. **操作**：安装 / 卸载 / 启用禁用（按阶段实现）

### 5.3 内置目录 vs 用户安装

| 来源 | 路径 | 说明 |
|------|------|------|
| 用户安装 | `~/.hip/plugins/<id>/` | GitHub URL 安装、本地路径注册 |
| 注册表 | `~/.hip/config/hip-plugins.json` | `{ plugins: string[], entries?: [...] }` |
| 内置市场（未来） | 应用包内 catalog 或远程 index | 可只下发 `PLUGIN.md`+`plugin.json` 元数据，安装时再拉完整包 |

**本地开发**：把仓库链到 `~/.hip/plugins/my-plugin` 或在 `hip-plugins.json` 写入绝对路径即可被扫描（e2e 已用 fixture 路径注入）。

---

## 6. 作者检查清单

- [ ] `.plugin/plugin.json` 含非空 `name`、`version`  
- [ ] `id` 稳定（升级不改 id）  
- [ ] 所有 path 相对插件根且不含 `..`  
- [ ] 每个 skill 目录有 `SKILL.md`，且 frontmatter 有 `name`/`description`  
- [ ] MCP `id` 全局唯一、可复现  
- [ ] hooks 使用 **CJS 路径**，模块导出数组，handler 为函数  
- [ ] 推荐提供 `PLUGIN.md`（source.url + description + 组件说明）  
- [ ] 不在仓库中提交密钥；用 env 名文档化  
- [ ] 在干净环境验证：`skills` 可加载、MCP 可启动、hooks 事件名出现在设置页扫描结果  

---

## 7. 空脚手架（最短可安装）

```
my-plugin/
├── .plugin/plugin.json
├── PLUGIN.md
└── skills/
    └── hello/
        └── SKILL.md
```

**`.plugin/plugin.json`**

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "0.1.0",
  "description": "Minimal hip plugin with one skill",
  "skills": ["./skills/hello"]
}
```

**`skills/hello/SKILL.md`**

```markdown
---
name: hello
description: Greet the user in the hip style
---

Greet the user briefly and offer one next step.
```

**`PLUGIN.md`（frontmatter 可极简）**

```markdown
---
id: my-plugin
name: My Plugin
version: 0.1.0
description: Minimal hip plugin with one skill
source:
  type: local
  url: ""
---

# My Plugin

Provides a single `hello` skill.
```

---

## 8. 与早期草稿的对应关系

| 草稿章节 | 规范落点 |
|----------|----------|
| 插件名称 / 描述 | `plugin.json` + `PLUGIN.md` frontmatter |
| 插件来源 / 来源链接 | `PLUGIN.md` → `source.type` / `source.url` |
| 关联 skill 清单 | `plugin.json` → `skills[]` + 各 `SKILL.md`；`PLUGIN.md` → `components.skills` 仅展示 |
| 关联 MCP 清单 | `plugin.json` → `mcpServers` + `.mcp.json`；`PLUGIN.md` → `components.mcp` |
| （草稿未覆盖）agents / hooks | `plugin.json` → `agents` / `hooks` + 对应文件 |

---

## 9. 非目标（本阶段不做）

- 用自由 Markdown 标题替代 `plugin.json` 作为加载真源  
- 在模版里规定远程「插件商店索引协议」的完整 API（可后续单独设计 `catalog.json`）  
- 在 `PLUGIN.md` 中嵌入可执行 hook 代码（hooks 必须独立 CJS）  

---

## 10. 参考实现位置

| 概念 | 代码 |
|------|------|
| `PluginManifest` / `PluginMeta` | `packages/protocol/src/plugins.ts` |
| 清单解析 | `packages/sidecar/src/session/plugins/parser.ts` |
| 能力合成 | `packages/sidecar/src/session/plugins/synthesizer.ts` |
| 安装与 auto-gen | `packages/sidecar/src/session/plugin-install.ts` |
| 样例插件 | `e2e/fixtures/sample-plugin/` |
| Skill 元数据 | `packages/protocol/src/skills.ts` |
| MCP 配置 | `packages/protocol/src/mcp-config.ts` |

---

## 相关文档

- 插件市场产品与实施规格：[`docs/plugin-market-spec.md`](./plugin-market-spec.md)
- 示范插件（obra/superpowers）：`bash scripts/install-demo-plugin-superpowers.sh`  
  安装到 `~/.hip/plugins/superpowers` 并写入 `hip-plugins.json`；重启或新开会话后技能可 `use_skill`。

*文档版本：与 hip 当前 plugin 加载路径对齐；若 `PluginManifest` 增字段，先改 protocol，再同步本节 schema。*
