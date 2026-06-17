# 智能体工具模型重构 + 对话权限模式

**Date:** 2026-06-17
**Status:** Design approved, ready for implementation plan
**Branch:** `feat/mcp-and-skills-config`(承接同分支上已实现的 MCP/Skill 工作)

## Goal

三项相互关联的改动,围绕"智能体能用哪些工具 / 能动哪些东西":

1. **智能体编辑器:按个配置 Skill** — 内部智能体不再用一个 all-or-nothing 的 `use_skill` 开关,而是从已安装 Skill 列表里**按个勾选**要授予的 skill。
2. **内置工具默认全开** — hip 的全部内置工具(含 `run_script`)对内部智能体**一律默认可用**,移除原来的逐类勾选。每个内部智能体只配置 **Skills + MCP 服务器**两样。
3. **对话权限模式** — 在输入框加一个类似 Claude Desktop 的**每对话权限选择**:`仅对话` / `同意编辑目录内文件` / `完全放开所有目录权限`,运行时据此门控 hip 自有的文件/执行工具与沙箱范围。

本设计**取代 Slice 8**(`feat/mcp-and-skills-config` 上刚实现的"编辑器里 use_skill/run_script/MCP 通配勾选")的工具模型,改用更干净的两字段 + 权限模式。

## Decisions (locked)

1. **仅对话 = 只读** — 允许 `read_file/ls/glob/grep`(+ use_skill 读、MCP),禁用 `write_file/edit_file/run_script`。
2. **编辑模式 = 默认** — `write/edit` 在 cwd 内直接写(无 HITL,= 今天的行为);`run_script` 仍逐次 HITL 弹窗确认。
3. **完全放开** — 文件工具解除 cwd 沙箱(任意绝对路径);`run_script` 自动批准(不弹窗)。
4. **新对话默认 = 编辑模式**(`'edit'`)。`permissionMode` 未设(老会话)按 `'edit'` 处理 → 向后兼容、无感。
5. **权限模式级联到被 dispatch 的子智能体**(沙箱范围/自动批准跟随主对话);子智能体仍只拥有自己的 `allowedSkills`/`allowedMcpServers` + 常开内置工具。
6. **内置工具(含 run_script)对内部智能体默认全开**;不再用 `allowedTools` 给内部智能体做内置工具门控。
7. **每个内部智能体只配置 Skills(按个)+ MCP 服务器(按个)**;默认都为空(显式 opt-in)。
8. **MCP 工具不受权限模式影响** — 三种模式下都按配置可用(MCP 是用户自配的外部能力,且对 hip 不透明)。

---

## A. 智能体工具模型(items 1+2)

### A.1 数据模型(`packages/protocol/src/index.ts`)

`AgentConfig` 新增(内部智能体用):
```ts
/** Skill ids this internal agent may use (use_skill is restricted to these + only these are
 *  advertised in its prompt). undefined/[] ⇒ none. */
allowedSkills?: string[]
/** MCP server ids whose tools this internal agent may use. undefined/[] ⇒ none. */
allowedMcpServers?: string[]
```
`allowedTools` **保留**(协议兼容)但**不再**用于内部智能体的内置工具门控(见 A.4 迁移)。

### A.2 运行时(sidecar)

内部智能体永远拥有:全部内置工具(`read_file/write_file/edit_file/ls/glob/grep/write_todos/git_*`)+ `run_script` + `use_skill`(工具本身)。**唯一的 per-agent 收窄发生在 `buildTools` 的输入上**:

`internal-runner.ts` / `invoker.ts`(内部分支)在调用 `buildTools` 前:
- `skillsForAgent = enabledSkills.filter((s) => (agent.allowedSkills ?? []).includes(s.id))`
- `mcpToolsForAgent = mcpManager.tools().filter((t) => (agent.allowedMcpServers ?? []).some((id) => t.name.startsWith(\`mcp__\${id}__\`)))`

然后 `buildTools(cwd, undefined, cwd, undefined, { mcpTools: mcpToolsForAgent, skills: skillsForAgent, requestApproval, permissionMode })`。**不再调用 `filterTools(allowedTools)`** —— 内置工具全量保留,skills/mcp 已按需收窄。

**退役 Slice 8 的内部工具门控代码**:删除 `filterTools` 的 `mcp__<id>__*` 通配分支(及该函数对内部路径的使用)、`agentTools.ts` 里 `TOOL_GROUPS` 的 `skill`/`script` 组与 `groupsToToolNames/toolNamesToGroups` 的 group-toggle 用法、`mcpServerWildcard`/`grantedMcpServerIds`(除非迁移仍需,见 A.4)。`agentTools.ts` 简化为:导出"内部智能体默认内置工具集"常量(供别处引用,可选)即可。

### A.3 编辑器 UI(`src/components/account/AgentEditor.tsx`)

内部智能体的"工具"区改为:
- 一行说明:**内置工具(读写/规划/git/运行脚本)默认全部可用**。
- **Skills** 区:列出已安装 skill(`useSkillsStore().skills`,挂载时 `load()`),每个一个 `ToolToggle`(label=skill.name,desc=skill.description),勾选写入 `form.allowedSkills`;空列表显示"尚未安装 skill"。
- **MCP 服务器** 区:沿用 Slice 8 的每服务器 `ToolToggle`,勾选写入 `form.allowedMcpServers`。
- **移除**:read/edit/plan/git 四个 `ToolToggle`、`run_script` 开关、`use_skill` 开关。

`src/lib/agentDraft.ts`:`AgentForm` 内部字段去掉 `toolsRead/toolsEdit/toolsPlan/toolsGit/toolsSkill/toolsScript/mcpServerIds`,加 `allowedSkills: string[]` + `allowedMcpServers: string[]`;`buildAgentDraft` 的内部分支输出这两字段(不再产 `allowedTools`)。`isAgentDraftValid` 不变(内部只要 name + prompt)。

### A.4 迁移 / 兼容

读取侧一次性迁移(在 sidecar 读 agent 配置处 + 前端 `toolNamesToGroups` 退役):
- 老内部智能体的 `allowedTools` 含 `mcp__<id>__*` 通配 → 若 `allowedMcpServers` 未设,从通配解析出 server ids 填入(保留旧 MCP 授权)。
- 老 `allowedTools` 含 `use_skill` 但 `allowedSkills` 未设 → `allowedSkills` 留空(none)。旧模型是"所有 skill",新模型要求显式选;用户重新勾选即可(spec 文档说明,UI 不报错)。
- 内置工具:老 `allowedTools` 的内置项忽略(现在一律全开,更宽松,符合 item 2 意图)。

---

## B. 对话权限模式(item 3)

### B.1 数据模型(`packages/protocol/src/index.ts`)

```ts
export type PermissionMode = 'chat' | 'edit' | 'full'   // 仅对话 / 编辑目录内 / 完全放开
```
`SessionConfig` 新增 `permissionMode?: PermissionMode`(语义默认 `'edit'`)。

协议消息(镜像 `session:setThinking` / `session:thinking`):
```ts
// ClientMessage
| { type: 'session:setPermissionMode'; sessionId: string; permissionMode: PermissionMode }
// ServerMessage
| { type: 'session:permissionMode'; sessionId: string; permissionMode: PermissionMode }
```

### B.2 持久化 / 恢复

随 `SessionConfig` JSON 自动持久化(`store.updateConfig`)与恢复(`ensureSession`/`session:load`)。无 schema 迁移;老会话 `permissionMode` 为 `undefined` → 视作 `'edit'`。

### B.3 前端

- `sessionService.setPermissionMode(id, mode)`:optimistic apply `session:permissionMode` + 发送 `session:setPermissionMode`(镜像 `setThinking`/`setSystemPrompt`)。
- `sessionStore.applyServerMessage` 加 `case 'session:permissionMode'` → 写入 `config.permissionMode`。
- `draftStore.Draft` 加 `permissionMode?: PermissionMode`(新对话可预设;未设走服务端默认 `'edit'`)。
- 新组件 `src/components/chat/PermissionModePicker.tsx`(镜像 `ModelPicker.tsx`):读 draft(新对话)/`useActiveSession().config.permissionMode`(已提交会话),`DropdownMenu modal={false}` 三选项 chip;**已提交会话也可改**(与 ModelPicker 锁定不同——permissionMode 调用 `sessionService.setPermissionMode`)。经 `InputBar` 的 `leftSlot` 放在 `<ModelPicker />` 旁。
- i18n:`chat.permission.*`(标签 + 三模式名/描述)三语。

### B.4 运行时门控(sidecar)

`BuildToolsOpts` 新增 `permissionMode?: PermissionMode`(默认 `'edit'`)。

**文件工具(`buildTools`,`tools.ts`)** 按模式:
- 路径解析器 mode-aware:`'full'` → 解析为绝对路径、**不做 cwd jail**(绝对路径原样、相对路径相对 cwd);`'chat'`/`'edit'` → 现有 `real(root,p)` jail(`realInSkill` 旁路保留:skill 文件只读始终可达)。
- `'chat'`:**不注册** `write_file` / `edit_file`(只读)。`'edit'`/`'full'`:注册。
- `read_file/ls/glob/grep`:三模式都注册;`'full'` 用 un-jail 解析器(可读任意目录),`'chat'`/`'edit'` jail。

**run_script(由 `requestApproval` 的形态决定,session 按模式构造并传入)**:
- `'chat'`:session **不传** `requestApproval` → `buildTools` 不注册 `run_script`。
- `'edit'`:传**真实 HITL 闭包**(现有的 `permission:request`/`pendingPermissions` 路径)。
- `'full'`:传**自动批准闭包** `() => Promise.resolve({ kind: 'allow_once' })`(立即解决,不发 `permission:request`、不弹窗)。

**系统提示(`system-prompt.ts`)**:`buildSystemPrompt`/`buildManagedAgentPrompt` 接收 `permissionMode`;`cwdBlock` 出 mode-aware 文案——`'full'` 说明"文件工具未沙箱化,可读写任意目录";`'chat'` 说明"只读,不可写/执行";`'edit'` = 现有文案。

**MCP 工具**:三模式都按配置注入(不门控)。

### B.5 session 装配(`session.ts runTurn`)+ 级联

- 主智能体:`const mode = this._config.permissionMode ?? 'edit'`;按 mode 构造 `requestApproval`(chat→undefined / edit→HITL / full→auto);`buildTools(..., { mcpTools, skills, requestApproval, permissionMode: mode })`。
- `Session.setPermissionMode(mode)`:写 `_config`(与 `setThinking` 同形;不需要 `buildAgent`,下一轮 `runTurn` 自然生效)。`session-manager.ts` 加 `case 'session:setPermissionMode'`(镜像 `setThinking`,持久化 + 回显真实值)。
- **级联**:`AgentInvoker.invoke` 的 `extras`(`InvokerExtras`)新增 `permissionMode`;内部分支把它连同(按主对话 mode 构造的)`requestApproval` 透传给 `runManagedAgent` → `buildTools`。即子智能体的文件沙箱/自动批准跟随主对话模式。`RunManagedAgentArgs` 加 `permissionMode`。

---

## C. 受影响 / 新增文件

**protocol** `packages/protocol/src/index.ts` — `PermissionMode`、`SessionConfig.permissionMode`、`AgentConfig.allowedSkills`/`allowedMcpServers`、`session:setPermissionMode`/`session:permissionMode` 消息。

**前端**
- 新增 `src/components/chat/PermissionModePicker.tsx`。
- 改 `src/components/chat/InputBar.tsx`(leftSlot 加 picker)、`src/domain/sessionService.ts`(setPermissionMode)、`src/domain/sessionStore.ts`(reducer case)、`src/store/draftStore.ts`(字段)、`src/components/account/AgentEditor.tsx`(工具区重构:Skills 列表 + MCP 列表,移除旧 toggles)、`src/lib/agentDraft.ts`(AgentForm/buildAgentDraft)、`src/lib/agentTools.ts`(退役 group/wildcard,精简)。
- i18n `src/i18n/{en,zh-CN,zh-TW}.ts` — `chat.permission.*`;移除/复用 `settings.agents.tool*` 中废弃键。

**sidecar**
- 改 `packages/sidecar/src/session/tools.ts`(`BuildToolsOpts.permissionMode`、mode-aware 解析器、chat 省略 write/edit、full un-jail)、`session/system-prompt.ts`(cwdBlock mode 文案 + 签名)、`session/session.ts`(mode→requestApproval 构造 + buildTools + `setPermissionMode` + 级联 extras)、`session/session-manager.ts`(handler)、`session/internal-runner.ts`(`RunManagedAgentArgs.permissionMode` + 输入预过滤 skills/mcp + 去掉 filterTools)、`session/agents/invoker.ts`(`InvokerExtras.permissionMode` 透传 + 内部分支按 allowedSkills/allowedMcpServers 预过滤)。
- 退役 `filterTools` 的通配分支(及内部路径用法)。

## D. 错误处理 / 边界

- 未知 `permissionMode` 值(脏数据)→ 视作 `'edit'`(安全默认,不报错)。
- `'full'` un-jail:`write_file`/`edit_file` 可写任意目录——这是显式用户授权(完全放开);仍捕获 IO 错误返回给模型,不抛断 turn。
- `'chat'` 下模型调用 `write_file`/`edit_file`:工具不存在 → LLM 收到"无此工具",或在描述里说明只读;`run_script` 同理不存在。
- 级联:子智能体在 `'chat'` 下也无 write/edit/run_script;在 `'full'` 下也 un-jail + 自动批准——与主对话一致。
- 迁移:老内部智能体 MCP 通配 → allowedMcpServers;use_skill→allowedSkills 留空(用户重选)。
- `permissionMode` 可在对话进行中切换:下一轮 `runTurn` 生效(`setPermissionMode` 不需要 running 时立即重建)。若 turn 正在跑,沿用本轮已构建的工具(与 setThinking 一致:running 时设置在下一轮生效)。

## E. 测试策略(避免付费真实 LLM)

- **纯函数 / store**:`agentDraft` 内部分支输出 allowedSkills/allowedMcpServers;MCP 通配→allowedMcpServers 迁移解析;`PermissionModePicker` 渲染(mock invoke + draft/session 两态);`sessionService.setPermissionMode` optimistic + send;reducer case。
- **sidecar(buildTools,mode-aware)**:`'chat'` 不含 write_file/edit_file/run_script、含 read_file;`'edit'` = 现状(write 在 cwd、run_script 经 requestApproval);`'full'` write/read 命中 cwd 外的临时绝对路径成功 + run_script 自动批准(fake auto-approve,跑 `echo`,不弹 permission:request);`realInSkill` 旁路仍工作。
- **级联**:`runManagedAgent`/invoker 在给定 `permissionMode` + allowedSkills/allowedMcpServers 时,工具集正确(含/不含 write、skills/mcp 已收窄)。
- **session**:`setPermissionMode` 持久化 + 回显;`session:permissionMode` 广播。
- 全量 `yarn test` 前把 `~/.hip/config/auth.json` 挪开保证 paid-free;tsc(root + sidecar)+ build 干净。

## F. 范围外 / 后续

- 对 ACP/CLI 外部智能体的权限模式(它们是外部进程,不受 hip 工具/沙箱约束——本设计只管 hip 自有循环:核心 + 内部智能体)。
- 更细粒度的 per-tool 权限(本设计是三档模式 + per-agent skill/mcp)。
- `'full'` 模式的二次确认/审计日志(本期靠用户显式选择该模式)。
- 把 MCP "写类"工具纳入权限模式门控(本期 MCP 始终可用)。
