# 设置页 — MCP 服务器配置 + Skill 配置(+ ACP/CLI 模型变量回退)

**Date:** 2026-06-16
**Status:** Design approved, ready for implementation plan
**Branch:** `feat/mcp-and-skills-config`

## Goal

在设置页新增两个端到端可用的配置模块,并对现有外部智能体集成做一处行为回退:

1. **MCP 服务器配置** — 在设置页增删改 MCP 服务器(stdio / SSE / HTTP),持久化到 `~/.hip/config`,运行时由 sidecar 连接并把其工具合并进 hip 的工具集。
2. **Skill 配置** — 采用 Claude 的 skill 格式(`SKILL.md` + 多目录多文件)。**不在应用内编辑正文**;通过上传 `.zip` 或把文件夹放进数据目录指定位置来安装。运行时以"渐进式披露"接入 hip 的循环,并新增 HITL 门控的 `run_script` 工具使 skill 自带脚本**能够执行**。
3. **ACP/CLI 模型变量回退** — **不再向 ACP 与 CLI 智能体下推 hip 的模型/密钥**(删除 ACP 的 `hip-managed` 路径与 CLI 的 `buildModelEnv` 路径,两类外部智能体一律自管模型/认证)。

与现有"智能体管理 / 模型配置"一样,新模块完整复用:`Zustand store → src/ipc/* → Tauri 命令 → ~/.hip/... → sidecar 读 env 路径`。

## Decisions (locked)

1. **使用范围(核心共识)** — 只有 **hip 核心智能体** 和 **内部(内置)智能体**(`kind:'internal'`,跑在 hip 自有 ReAct 循环上)能使用新增的 MCP 工具与 Skill。**ACP(`kind:'acp'/'opencode'`)与 CLI(`kind:'custom'`)智能体不可用**——它们是外部进程,本就不碰 hip 的工具集。
2. **Skill 格式** — Claude 式文件夹:`SKILL.md`(YAML frontmatter `name`/`description` + Markdown 正文)+ 可选子目录/文件。无应用内正文编辑。
3. **Skill 安装** — ① 上传 `.zip`(解压进数据目录);② 用户自行把文件夹放进 `~/.hip/skills/`。设置页只做:扫描列表 / 启停 / 查看 / 删除 / 上传。
4. **Skill 自带脚本要能跑(方案 A)** — 新增 `run_script` 工具到 hip 自有循环,**HITL 门控**(复用现有 `permission:request/respond` 通道与通用 `PermissionModal`),每次执行需用户在弹窗确认。
5. **MCP 传输** — `stdio` + `sse` + `http`(streamable)。配置存 `~/.hip/config/hip-mcp-servers.json`。
6. **MCP 消费方** — hip 主循环始终合并所有 enabled 服务器的工具;内部智能体经其**已有工具白名单**(`allowedTools`)选择性获得。**不修改 [acp-connection.ts](../../../packages/sidecar/src/session/agents/acp-connection.ts) 的 `mcpServers: []`**。
7. **MCP 连接生命周期** — sidecar 维护一个**常驻 MCP 客户端池**,每轮开始时按配置文件做**增量协调**(connect 新增 / disconnect 移除或停用 / 复用已有),无需重启 sidecar;失败优雅降级(跳过该服务器工具 + 记日志)。与现有"agents 配置每轮重读"哲学一致。
8. **模型回退范围** — ACP **与** CLI 都不再接收 hip 的模型配置。删除 ACP 的 `hip-managed` 分支、CLI 的 `buildModelEnv` 注入,以及编辑器里两者的认证/模型 UI。`acceptsModelConfig` / `authMode` 退化为纯历史字段(运行时忽略,兼容旧配置)。`boundModel` **保留**(内部智能体仍用,未绑定时回退全局)。仅**内部智能体**保留模型选择器。

---

## A. MCP 服务器配置

### A.1 数据模型(`packages/protocol/src/index.ts`)

```ts
export type McpTransport = 'stdio' | 'sse' | 'http'

export interface McpServerConfig {
  id: string
  name: string
  transport: McpTransport
  // stdio:
  command?: string
  args?: string[]
  env?: Record<string, string>
  // sse / http:
  url?: string
  headers?: Record<string, string>
  enabled: boolean
}

export interface McpServersConfig { servers: McpServerConfig[] }
```

### A.2 持久化链路(镜像 agents 配置)

| 层 | 改动 |
|---|---|
| Rust `src-tauri/src/paths.rs` | 新增 `mcp_servers_config_path()` → `~/.hip/config/hip-mcp-servers.json` |
| Rust `src-tauri/src/lib.rs` | 新增 `get_mcp_servers_config` / `set_mcp_servers_config` 命令并注册进 `generate_handler!` |
| Rust `src-tauri/src/sidecar.rs` | spawn 时设 `HIP_MCP_SERVERS_PATH` env |
| 前端 `src/ipc/mcpServersConfig.ts` | `getMcpServersConfig()` / `setMcpServersConfig()`(`invoke`,JSON 序列化,空文件 → `{ servers: [] }`) |
| 前端 `src/store/mcpServersStore.ts` | Zustand:`servers`、`loaded`、`load()/addServer()/updateServer()/removeServer()`(`nanoid` 生成 id,镜像 `agentsStore`) |
| sidecar `packages/sidecar/src/config/mcp-servers.ts` | `readMcpServersConfig()`:读 `HIP_MCP_SERVERS_PATH`,`JSON.parse`,失败返回 `[]`(镜像 `agents/registry.ts`) |

### A.3 设置页 UI(`src/components/account/McpConfig.tsx`)

仿 `AgentManagement` 的"列表 + 编辑弹窗"(MCP 比"两栏 provider"更接近"agents 列表"):

- 列表:每个服务器一张卡片(名称、传输方式徽章 `stdio/SSE/HTTP`、启停 `Switch`、kebab 菜单 → 编辑/删除)。空状态引导。
- "添加服务器"按钮 → `McpServerEditor` 弹窗:`name`、`transport`(`ChoiceCard` 单选)、按传输条件渲染(stdio:`command`/`args`/`env` 键值对;sse/http:`url`/`headers` 键值对)。
- 删除确认 `Modal`(复用 `DeleteAgentDialog` 模式)。
- ⚠️ kebab `DropdownMenu` 打开 Modal → 必须 `modal={false}`(既有踩坑)。
- 注册:`SettingsPanel.tsx` 的 `PAGES` 增加 `{ id: 'mcp', icon: Plug, labelKey: 'settings.mcpLabel', Component: McpConfig }`。

### A.4 运行时:MCP 客户端池 + 工具适配

新增 `packages/sidecar/src/session/mcp/manager.ts`:

- 依赖 `@modelcontextprotocol/sdk`(新增):`Client` + `StdioClientTransport` + `StreamableHTTPClientTransport` / `SSEClientTransport`。
- `McpManager`(模块级单例,跨 turn 常驻):
  - `reconcile(servers: McpServerConfig[]): Promise<void>` — 对比当前连接与目标 enabled 集合,connect 新增、disconnect 移除/停用、复用未变(按 `JSON.stringify(server)` 指纹判等)。connect 失败:记录该服务器为 `error` 状态、不抛、不阻塞其它。
  - `tools(): StructuredToolInterface[]` — 把每个已连接服务器 `listTools()` 的结果适配成 LangChain `StructuredTool`,工具名**命名空间化**为 `mcp__<serverId>__<toolName>`(防冲突;adapter 内反查真实 server+tool 调 `client.callTool`)。zod schema 由 MCP 工具的 `inputSchema`(JSON Schema)转换。
- 集成点 `session.ts runTurn`(就在 `buildTools` 之前):`await mcpManager.reconcile(readMcpServersConfig())`,再把 `mcpManager.tools()` 合并进 hip 主循环工具集(与 `buildTools` 的产物拼接)。
- **内部智能体**:`runManagedAgent` 同样接收 MCP 工具候选,经 `filterTools(allTools, allowedTools)` 按白名单收窄 → 内部智能体只拿到它显式允许的 `mcp__*` 工具(见 §C.4 的编辑器改动)。

> ACP/CLI 路径完全不引用 `mcpManager` —— 范围共识落地于此。

---

## B. Skill 配置

### B.1 格式与存放

```
~/.hip/skills/<skill-id>/
  SKILL.md          # YAML frontmatter: name, description (+ 任意其它字段忽略) + Markdown 正文
  scripts/...       # 可选:脚本(靠 run_script 执行)
  references/...     # 可选:参考文件(靠 read_file 读取)
```

- `<skill-id>` = 安装时由 frontmatter `name` 派生的 slug(kebab-case,去重时加后缀)。
- `SKILL.md` 为用户资产,**只读不改写**。

### B.2 启停状态

因 `SKILL.md` 不可改写,启停存独立文件 `~/.hip/config/hip-skills.json`:

```ts
export interface SkillMeta { id: string; name: string; description: string; dir: string; hasScripts: boolean }
export interface SkillsConfig { enabled: Record<string, boolean> }  // 缺省视为启用
```

### B.3 安装 / 管理(Rust + 前端)

| 层 | 改动 |
|---|---|
| Rust `paths.rs` | 新增 `skills_dir()` → `hip_subdir(app, "skills")`;`skills_config_path()` → `~/.hip/config/hip-skills.json` |
| Rust `Cargo.toml` | 新增 `zip`(解压)+ `serde_yaml`(解析 frontmatter) |
| Rust `lib.rs` | `list_skills()` → 扫描 `skills_dir/*/SKILL.md`,解析 frontmatter,返回 `Vec<SkillMeta>`(JSON);`install_skill_zip(zip_path)` → 解压进 `skills_dir/<slug>/`,校验存在 `SKILL.md`,否则报错回滚;`delete_skill(id)` → 删该目录;`get_skills_config`/`set_skills_config`(启停表)。全部注册进 `generate_handler!` |
| Rust 安全 | **zip-slip 防护**:解压前规范化每个 entry 路径,拒绝/剥离 `..` 与绝对路径,确保落在目标目录内 |
| Rust `sidecar.rs` | spawn 时设 `HIP_SKILLS_DIR` + `HIP_SKILLS_PATH`(启停表) env |
| 前端 `src/ipc/skills.ts` | `listSkills()`、`installSkillZip(path)`、`deleteSkill(id)`、`getSkillsConfig()`/`setSkillsConfig()`;上传用 `@tauri-apps/plugin-dialog` 的 `open({ filters:[{name:'ZIP',extensions:['zip']}] })`(`dialog:allow-open` 已授权) |
| 前端 `src/store/skillsStore.ts` | Zustand:`skills`(来自 `listSkills`)、`enabled`(来自 `getSkillsConfig`)、`load()/toggle()/install()/remove()` |

### B.4 设置页 UI(`src/components/account/SkillConfig.tsx`)

- 列表:每个 skill 一张卡片(`name`、`description`、启停 `Switch`、kebab → 查看/删除;若 `hasScripts` 显示一个"含脚本"徽章作安全提示)。
- "上传 skill 压缩包"按钮 → 选 `.zip` → `installSkillZip` → 刷新列表(失败 toast)。
- 空状态:说明两种安装方式(上传 / 放入 `~/.hip/skills/`)。
- 查看:只读 `Modal` 渲染 `SKILL.md` 正文(经一个新的只读 IPC `readSkillFile(id,'SKILL.md')`,或复用 `list_skills` 时带回正文——MVP 选按需读)。**无编辑**。
- 注册:`PAGES` 增加 `{ id: 'skill', icon: Sparkles, labelKey: 'settings.skillLabel', Component: SkillConfig }`。

### B.5 运行时:渐进式披露 + use_skill

新增 `packages/sidecar/src/session/skills/registry.ts`:

- `readEnabledSkills(): SkillMeta[]` — 扫描 `HIP_SKILLS_DIR` 解析 frontmatter,交叉 `HIP_SKILLS_PATH` 启停表(缺省=启用),返回 enabled skills(每轮调用)。
- 注入系统提示:扩展 `buildSystemPrompt`(`system-prompt.ts`)签名,新增 `skills?: SkillMeta[]`;若非空追加一段:
  ```
  ## 可用 Skills
  以下技能可按需加载。当任务匹配某技能时,调用 use_skill 工具(参数 name)把其完整说明读入上下文,再据此操作。
  - <name>: <description>
  ...
  ```
- `use_skill` 工具(加入 `buildTools`):入参 `{ name }`,读 `<dir>/SKILL.md` 正文返回,并附目录内文件清单(相对路径,供模型用 `read_file` 取参考文件)。**单轮内即生效**(无需中途解锁工具;`read_file` 恒在)。

### B.6 运行时:run_script(方案 A,HITL 门控)

**这是让 skill "自带脚本能跑"的关键工具。**

- 工具 `run_script`(加入 `buildTools`):入参 `{ command: string, reason?: string }`。
- 执行:`spawn(shell, ['-c', command])`(Windows `cmd /c`),`cwd` = 会话项目目录,`env` = `process.env`,**超时**(默认 120s)+ **输出截断**(默认 64KB),返回 `exitCode + 合并的 stdout/stderr`。
- **HITL 门控(复用现有通道,无新协议消息)**:
  - `buildTools` 新增可选参数 `requestApproval?: (req: PermissionRequest) => Promise<Decision>`。
  - `run_script` 执行前 `await requestApproval({ title: 'Run script', kind: 'execute', content: command })`,选项复用既有 `PermissionOption`(`allow_once` / `reject_once`,可选 `allow_always` = 本会话内自动批准 `run_script`)。
  - `session.ts` 构造该闭包:登记到既有 `pendingPermissions` 表 + `send({ type:'permission:request', ... })`;前端既有 [PermissionModal.tsx](../../../src/components/chat/PermissionModal.tsx) 渲染(`PermissionRequestPayload` 通用);用户决定经既有 `permission:respond` → `session.respondPermission` 解析 Promise。取消 turn 时既有 drain 逻辑覆盖。
  - 拒绝 → 工具返回 "用户拒绝执行" 文本(不运行);批准 → 执行并返回输出。
- **内部智能体**:`run_script` 仅在其 `allowedTools` 含 `run_script` 时可用;HITL 闭包由父 session 透传给 `runManagedAgent`(审批弹窗可带 `agentFrame` 标明是哪个内部智能体),与既有嵌套 HITL 一致。

> 安全:`run_script` 可执行任意命令,**唯一控制是 HITL**——默认每次调用都弹窗、完整展示命令、不默认自动批准。这是 Claude skill 平价能力的必要代价,已用现有审批基建兜底。

---

## C. 工具装配的统一改动(hip 自有循环)

`run_script` / `use_skill` / `mcp__*` 都只挂在 hip 自有循环上,装配点集中:

### C.1 `buildTools(...)` 签名扩展

新增可选项(全部可选,旧调用方不破):
```ts
buildTools(root, spawnSubagent?, cwd?, dispatch?, opts?: {
  mcpTools?: StructuredToolInterface[]      // 来自 McpManager
  skills?: SkillMeta[]                       // 有 enabled skills 时加 use_skill
  requestApproval?: (req) => Promise<Decision> // 有则加 run_script(HITL)
})
```

### C.2 主循环装配(`session.ts runTurn`)

`reconcile MCP → 读 enabled skills → buildSystemPrompt({..., skills}) → buildTools(..., { mcpTools, skills, requestApproval })`。`requestApproval` 闭包同 §B.6。

### C.3 内部智能体装配(`internal-runner.ts runManagedAgent`)

`RunManagedAgentArgs` 增 `mcpTools?` / `skills?` / `requestApproval?`(由 invoker 从父 session 透传)。`buildTools(..., { mcpTools, skills, requestApproval })` 后照旧 `filterTools(tools, allowedTools)` —— 即内部智能体只拿到白名单内的 `use_skill` / `run_script` / `mcp__*`。`buildManagedAgentPrompt` 同样在白名单含 `use_skill` 时注入 skill 列表。

### C.4 内部智能体编辑器(`AgentEditor.tsx`)工具选择

内部智能体的工具白名单选择需新增可勾选项:`use_skill`、`run_script`、以及各已配置 MCP 工具(`mcp__*`,按服务器分组展示)。`agentDraft.ts` 的工具集合相应扩展。

---

## D. 外部智能体模型变量回退(ACP + CLI)

**目标:ACP 与 CLI 智能体一律自管模型/认证,hip 不再下推任何模型配置/密钥。**

| 层 | 改动 |
|---|---|
| sidecar `agents/acp-config.ts` | **删除 `authMode==='hip-managed'` 分支**(行 20–38):不再写 `OPENCODE_CONFIG` 临时文件、不再设 `{PROVIDER}_API_KEY`。仅保留 `agent.env` 等非模型 env。等价于一律 `opencode-self`。 |
| sidecar `agents/adapters.ts` | **删除 `buildModelEnv`**——不再产出 `HIP_PROVIDER/HIP_MODEL/HIP_BASE_URL/HIP_API_KEY`。 |
| sidecar `agents/loop-provider.ts:61–63` | 删除 `if (acceptsModelConfig && model) Object.assign(env, buildModelEnv(model))`;CLI 子进程 env 仅 `process.env` + `agent.env`。 |
| sidecar `session.ts:196` | 外部智能体(acp + custom)不再 `resolveAgentModel`——一律 `model=null`,连接/spawn 不带 model;连接池 key(`acp-connection.ts:143`)的 model 分量恒为 null。`resolveAgentModel` 此后仅服务内部智能体路径。 |
| protocol `index.ts` | `acceptsModelConfig`、`AgentAuthMode`/`AgentConfig.authMode` 标 **deprecated**:类型保留以兼容旧配置,运行时对 ACP/CLI **不再读取**(旧值忽略,按自管处理)。`boundModel` **保留**——内部智能体仍用(未绑定时回退全局)。 |
| 前端 `AgentEditor.tsx` | **移除 ACP 的认证模式单选(authSelf/authManaged)+ 条件模型下拉**(行 187–247)**和 CLI 的 `acceptsModel` 开关 + 条件模型下拉**(行 283–315)。ACP/CLI 编辑均不再涉及模型/认证。**仅内部智能体保留模型选择器。** |
| 前端 `agentDraft.ts` | `isValid`:acp 与 custom 永不 `needsModel`;仅内部智能体可绑定模型(未绑定回退全局,故也非必填)。 |
| 前端 `AgentCard.tsx` | acp/custom 卡片不再显示 `boundModel` 徽章;仅 internal 显示(绑定模型或"全局模型")。 |
| i18n | 移除/停用 ACP 的 `authSelf/authSelfDesc/authManaged/authManagedDesc/sectionAuth` 与 CLI 的 `acceptsModel/acceptsModelDesc`,以及仅外部用的 `sectionModel/selectModel`(内部智能体若复用模型选择器则保留其所需键)。 |
| 内置 OpenCode 默认 | 已是 `authMode:'opencode-self'`,无行为变化。 |

> 结果:`acceptsModelConfig` / `authMode` 成为纯历史字段;ACP 与 CLI 两类外部智能体完全自管模型/认证。

---

## E. 开放确认项(留待 spec review)

1. **MCP 是否需要"按服务器选工具子集"?** MVP 为"整服务器 enabled → 其全部工具进池";如需 per-tool 勾选,后续在编辑器加。
2. **Skill 查看正文**:MVP 提供只读查看弹窗;确认是否需要。

---

## F. 受影响 / 新增文件清单

**protocol**
- `packages/protocol/src/index.ts` — `McpTransport/McpServerConfig/McpServersConfig`、`SkillMeta/SkillsConfig`;`acceptsModelConfig`/`AgentAuthMode`/`authMode` 标 deprecated(`boundModel` 保留给内部智能体)。

**Rust(src-tauri)**
- `src/paths.rs` — `mcp_servers_config_path`、`skills_dir`、`skills_config_path`。
- `src/lib.rs` — `get/set_mcp_servers_config`、`list_skills`、`install_skill_zip`、`delete_skill`、`get/set_skills_config`(+注册)。
- `src/sidecar.rs` — `HIP_MCP_SERVERS_PATH`、`HIP_SKILLS_DIR`、`HIP_SKILLS_PATH` env。
- `Cargo.toml` — `zip`、`serde_yaml`。

**前端(src)**
- 新增 `ipc/mcpServersConfig.ts`、`ipc/skills.ts`。
- 新增 `store/mcpServersStore.ts`、`store/skillsStore.ts`。
- 新增 `components/account/McpConfig.tsx`(+ `McpServerEditor`)、`components/account/SkillConfig.tsx`。
- 改 `components/account/SettingsPanel.tsx`(`PAGES` +2)、`AgentEditor.tsx`(删 ACP 认证 UI + CLI 模型 UI;内部智能体工具勾选加项)、`AgentCard.tsx`(ACP/CLI 不再显示模型徽章)、`lib/agentDraft.ts`(acp/custom 不再 needsModel)。
- i18n `i18n/{en,zh-CN,zh-TW}.ts` — `settings.mcp.*` / `settings.skill.* /` `settings.mcpLabel` / `settings.skillLabel`;移除 ACP authMode + CLI acceptsModel 文案。

**sidecar(packages/sidecar)**
- 新增 `config/mcp-servers.ts`、`session/mcp/manager.ts`、`session/skills/registry.ts`。
- 改 `session/tools.ts`(`buildTools` 扩展 + `use_skill` + `run_script`)、`session/system-prompt.ts`(skill 注入)、`session/session.ts`(reconcile/装配/HITL 闭包;外部一律 `model=null`)、`session/internal-runner.ts`(透传)、`session/agents/invoker.ts`(透传)、`session/agents/acp-config.ts`(删 hip-managed)、`session/agents/adapters.ts`(删 `buildModelEnv`)、`session/agents/loop-provider.ts`(删 CLI 模型 env)。
- `package.json` — `@modelcontextprotocol/sdk`。

---

## G. 错误处理与边界

- **MCP 连接失败 / 超时**:跳过该服务器工具,记日志;UI 卡片可显示 `错误` 状态(MVP 可省,先日志)。
- **MCP 工具调用失败**:adapter 捕获,返回错误文本给模型(同既有工具 catch 风格)。
- **远程 MCP(sse/http)**:工具调用会把上下文发往远端——用户自配,接受;文档提示。
- **Skill zip 非法**(无 `SKILL.md` / frontmatter 缺 name):`install_skill_zip` 报错并清理半成品目录。
- **Skill 目录被手工删除**:`readEnabledSkills` 跳过;`use_skill` 找不到时返回"技能不存在"。
- **run_script 拒绝 / 超时 / 非零退出**:均返回结构化文本给模型,不抛断 turn。
- **旧配置兼容**:旧 ACP agent 带 `authMode:'hip-managed'` 或旧 CLI agent 带 `acceptsModelConfig:true`/`boundModel` → 运行时**忽略**,按自管处理(不报错;旧的 `boundModel` 在外部智能体上变为惰性数据)。

## H. 测试策略(避免付费真实 LLM,见记忆约定)

- **纯函数 TDD**:MCP 工具名命名空间化与反查、MCP JSON-Schema→zod 转换、skill frontmatter 解析(若 TS 侧也解析)、enabled-skills 协调、MCP reconcile 增量 diff、zip-slip 路径规范化(Rust 单测)。
- **sidecar**:`McpManager.reconcile` 用 Fake transport;`use_skill` 读临时 skill 目录;`run_script` 用自动批准的 fake `requestApproval` 跑 `echo` 验证执行与截断;HITL 拒绝路径。
- **前端**:两个 store 的 CRUD;两个页面用 mock `__TAURI_INTERNALS__.invoke` 渲染验证;`agentDraft.isValid` 对 acp/custom 不再要求模型;ACP/CLI 编辑器移除认证/模型 UI 的快照。
- **Rust**:`install_skill_zip` 正常/非法 zip;`list_skills` 解析。
- 全量 `yarn test` 前按记忆把 `~/.hip/config/auth.json` 挪开以保证 paid-free。

## I. 范围外 / 后续

- ACP/CLI 使用 MCP/Skill(已明确排除)。
- MCP OAuth 授权流、MCP resources/prompts(本期仅 tools)。
- Skill 应用内编辑、skill 市场/远程安装。
- `run_script` 的细粒度沙箱/白名单命令(本期靠 HITL)。
- MCP per-tool 勾选、MCP 服务器健康面板。
