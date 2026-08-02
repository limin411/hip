# 终端管理 · SSH 智能体接入 Spec v2.6（修订稿）

> 状态：**主路径 · 草案 v2.6** · 2026-08-02  
> 范围：侧栏「终端」→ 已连接 **SSH** managed terminal 的右侧 rail + 左侧会话树  
> 本文为终端智能体接入的**现行唯一 spec**（取代 v1.3；旧稿已清理，备份见 `.temp/design-archive-2026-08-02/`）。  
> 评审结论已并入本文（原评审材料 `ssh-agent-path-review.md` 已清理，git 历史可查）。  
> 对齐参考：`right-panel-titlebar-slot-spec.md`（**待补**，见 §17.2）
> **v2.1 修订（用户评审）**：关闭终端改为「状态标识 + 记录保留」，废弃「关闭即删除 / 级联软删」策略（D12 修订，全文档同步）。
> **v2.2 修订（用户评审）**：删除连接记录时级联软删其下对话（进回收站）；新增 D14「Host 配置删除关联」及 Q8。
> **v2.3 修订（用户评审）**：删除 Host 配置默认**级联清理**记录与对话（进回收站）；「仅删配置」降为可选项（D14 / Q8 翻转）。
> **v2.4 修订（用户评审）**：砍掉「仅删配置」可选项；删 Host = 连记录带对话一起进回收站；移除 `hostMissing` / `hostLabel` 相关逻辑（D14 / Q8 简化）。
> **v2.5（文档清理）**：删除旧稿 `terminal-agent-panel-spec.md`（v1.3）与 `remote-project-workspace-spec.md`（搁置稿）；引用更新；旧稿备份于 `.temp/design-archive-2026-08-02/`。
> **v2.6（文档清理）**：删除评审材料 `ssh-agent-path-review.md`（评审结论已并入本文决策与修订记录）。

---

## 0. 已确认决策

| # | 决策 | 选择 |
|---|------|------|
| D1 | 形态 | **对话面板** + **可执行运维 Agent**（可读终端上下文、可向当前会话写命令） |
| D2 | 覆盖范围 | **仅 SSH** managed terminal（`kind === 'ssh'`） |
| D3 | 与文件面板 | **Tab 切换**：`files` \| `agent`（对齐 Code `PanelTabBar`） |
| D4 | 命令通道 | **共享当前 PTY**（与用户同一 SSH channel / 同一 xterm） |
| D5 | Agent 选型 | **复用现有 Agents**（builtin / custom internal / ACP） |
| D6 | 会话绑定 | **每个 SSH `tm_*` 下 0..N 条** terminal 对话会话；**不**进主 Chat/Code 列表 |
| D7 | 侧栏入口 | 会话挂在对应 SSH 终端行 **下方**，可 **展开/折叠**；支持 **右键删除**（及打开/重命名） |
| D8 | 持久归属 | 会话同时记录 `hostId`（持久归属）与 `managedTerminalId`（记录归属）；`tm_*` 记录跨 close 保留（进程内），App 重启后不恢复（P2 持久化） |
| D9 | 文件读取 | **SFTP 只读工具进入 P0**（与 Files tab 同源通道）；写文件 P1 起 |
| D10 | 完成检测 | **不确定性为一等状态**：`terminal_exec` 结果默认带 `mayStillRun`；不虚构完成；可轮询、可问用户 |
| D11 | 多会话语境 | 同 `tm_*` 多会话共享 ring；切换会话必须注入「状态可能已变化」注记 |
| D12 | 关终端策略 | **关闭 ≠ 删除**：侧边栏记录保留并标记 `disconnected`，子会话全部保留（只读）；重连复用同一 `tm_*`；仅显式删除记录才清理：确认后**级联软删**其下全部对话（进回收站，可恢复） |
| D13 | 长期方向 | 远程工作区**保留为 P3 方向**（非否决）；P2 结束时复盘再立项 |
| D14 | Host 删除关联 | 删除 Host 配置 = **级联清理**相关连接记录与对话（进回收站，可恢复）；确认框提示关联数量；**无保留选项** |

本地 managed terminal（`kind === 'local'`）本版 **不出现** Agent tab / 子会话树，右栏保持现状（仅文件树）。

---

## 1. 问题摘要

| # | 问题 | 影响 |
|---|------|------|
| P1 | SSH 连上后右栏只有 SFTP 文件树 | 运维场景缺「对着这台机子问 / 让 AI 帮敲命令」的入口 |
| P2 | 主 Chat/Code 的 `run_script` 跑在 **本机 cwd** | 无法直接操作远程机；用户需手工复制命令 |
| P3 | 若另开隐蔽 shell | 与用户可见状态不一致，排障困难；且与 D4 冲突 |
| P4 | 共享 PTY 存在竞态与交互式程序风险 | 无协议会踩乱用户输入、卡在 vim/passwd |
| P5 | 终端生命周期与 AI session 未绑定 | 易出现孤儿会话或关终端后 Agent 仍写已死 channel |
| P6 | 无文件能力时「改配置重启」类任务无法收尾 | Agent 只能诊断不能治疗；需从 P0 起提供只读，P1 提供修改闭环 |

---

## 2. 产品定位

**SSH 会话侧运维副驾（Terminal Ops Copilot）**。

主栏仍是用户的交互式终端；右栏 Agent 是「看得到同一屏幕、经批准后往同一键盘打字」的助手。它**不是**第二台机器上的独立 CI runner，也**不是**完整远程开发环境（后者见 §17.3 的 P3 方向）。

| 做（本版） | 不做（本版） |
|------------|--------------|
| SSH 右栏 `files` / `agent` 双 tab | 本地 managed terminal 的 Agent |
| 每 SSH `tm_*` 多会话 + 会话记录 `hostId` | 与主 Chat/Code 会话合并 |
| 侧栏 SSH 行下会话树（展开/折叠/右键删） | 跨 `tm_*` 的每 Host 永久会话（P1 起仅只读查询入口） |
| 共享 PTY 执行命令（HITL 默认） | 隐蔽第二 channel / 旁路 `run_script` 本机执行冒充远程 |
| 注入近期终端输出 + Host 元数据为上下文 | 完整 Code 面（Changes / git / 项目树） |
| 窄栏可用的紧凑对话 UI | 右栏内嵌完整 xterm 第二实例 |
| 命令执行可视化（终端内可见回显） | 交互式 TUI（vim/htop/passwd）的 Agent 自动操作 |
| **SFTP 只读工具（P0）** | 无确认的任意上传覆盖系统路径 |
| **「命令可能仍在运行」的不确定状态（P0）** | 把启发式当可靠完成信号 |
| **多会话切换语境注记（P0）** | 会话间共享输出但不告知模型 |
| **「提议修改」文件闭环（P1）** | P0 就做远程写文件 |
| **关闭后保留记录 + 状态标识 + 会话历史（P0，D12）** | 关闭即删除侧边栏记录（现网行为，本版废弃） |
| **重连复用同一记录，对话可继续（P0）** | 关闭即静默级联删除会话 |
| **删除 Host 配置 = 级联清理记录与对话（进回收站，可恢复，D14）** | 删除 Host 即静默不可恢复地删除记录与对话 |

变更写入路径：**Agent 提案 → 用户批准（默认）→ UI 写入当前 SSH PTY → 从 ring 回收输出 → 回传 sidecar**。  
Sidecar **不**直连 russh；执行权始终在桌面壳 + 用户可见通道上。

---

## 3. 信息架构

### 3.1 布局（SSH + 右栏打开）

```
┌─ AppSidebar ──────────────────┬─ Main: xterm ──────────┬─ Right rail ────────────┐
│ 终端                          │  ManagedTerminalSession │ [Context][Tab▾][×]      │
│ ▼ prod-box          SSH  ●    │  (shared PTY)           │ files | agent           │
│     ● 查磁盘 · 刚才           │                         │ agent → 当前选中会话    │
│       部署回滚（昨晚）         │                         │                        │
│ ○ staging             SSH 已断开│                        │                        │
│     · 磁盘排查（历史只读）     │                         │                        │
│   local-dev           本地    │                         │ （local 无子树/无 agent）│
└───────────────────────────────┴─────────────────────────┴────────────────────────┘
```

侧栏层次（仅 SSH 可有子节点）：

```
Managed terminal row (tm_*)          ← 点击：focus 终端 + 主栏 xterm
├── chevron 展开/折叠（有会话时显示；0 会话隐藏）
└── Terminal agent session rows      ← 点击：focus 父终端 + 打开右栏 agent tab + 载入该 session
    └── context menu: 打开 / 重命名 / 删除
```

SSH 行带状态标识：`connected`（●）/ `disconnected`（○）/ `error`；**断开行保留记录与子会话树**（D12），主栏显示重连空态。

### 3.2 Tab 集合

| Tab id | 可见条件 | Body | 备注 |
|--------|----------|------|------|
| `files` | SSH 或 local | 现有 `TerminalFilesPanel` 内容（SFTP / local FS） | local 时为唯一 tab，可无 Tab▾ |
| `agent` | **仅 SSH** 且存在连接记录（`connected` 可执行；`disconnected` / `error` 只读历史） | 新建 `TerminalAgentPanel` | 从未连接过则无此 tab |

```ts
// uiStore
export type TerminalPanelTab = 'files' | 'agent'
// activeTerminalPanelTab: TerminalPanelTab  // 按 tm_* 记忆
```

### 3.3 Titlebar

骨架：`[ Context Slot | Tab▾ | Collapse ]`

| Tab | Context Slot Identity | Actions（≤2） |
|-----|----------------------|---------------|
| `files` | 当前 SFTP 路径 basename 或 host 短名 | Refresh tree |
| `agent` | 当前 Agent 显示名；可选 `· 运行中` | Stop turn（若 streaming） |

- 引入 `PanelTabBar surface="terminals"`（或扩展现有 surface 联合类型）。
- `PanelToggle` 折叠菜单增加 Terminals 下的 Files / Agent 项。
- local：无 Agent tab → 保持「标题 + Collapse」，不强制 Tab▾。

### 3.4 Agent 面板 IA

```
TerminalAgentPanel
├── (optional) thin status strip: user@host · pty status · agent name
├── MessageList（复用 Chat 消息渲染子集）
│     ├── user / assistant / tool cards
│     └── terminal_exec 工具卡：命令摘要 + 批准状态 + 结果状态（completed | timed_out | user_interleaved | rejected | error）
├── RuntimeTaskStrip？→ 本版默认不挂（共享 PTY 前台执行；background shell 禁用）
└── Composer
      ├── Agent picker（现有 agents 列表）
      ├── PermissionMode 精简控件（见 §6）
      ├── 输入框 + 发送
      └── 附件：可选纯文本粘贴；不强制图片/文件
```

主栏 xterm **始终**是用户焦点区；Agent 对话不抢占主栏布局。

### 3.5 左侧边栏 · SSH 下会话树（D7）

#### 3.5.1 可见性

| 父行 kind | 子会话树 |
|-----------|----------|
| `ssh` | **有**：列出 `surface==='terminal' && managedTerminalId===tm_*` 的会话（**含断开记录**，历史只读） |
| `local` | **无**（本版） |

- 主「会话 / 项目」列表：**过滤掉** `surface==='terminal'`。
- 断开记录**不删除**：保留在侧栏，子会话树仍可展开浏览（D12）。
- 排序：子会话默认最近活动优先（`updatedAt` / last message）；同秒稳定按 id。

#### 3.5.2 展开 / 折叠

| 状态 | 行为 |
|------|------|
| 默认 | 有 ≥1 会话的 SSH 行：**展开**；0 会话：无 chevron |
| 记忆 | `uiStore.terminalAgentSidebarExpanded: Record<tmId, boolean>`（进程内即可） |
| Chevron | 点 chevron **只**切换展开，不改变 focus |
| 整行点击 | focus 该 `tm_*` + 确保 `activeView==='terminals'`；**不**自动改 agent session；断开记录 → 主栏重连空态 + 右栏只读历史 |
| 无会话 | 不显示空子行 |

#### 3.5.3 子行 UI

```
[indent] [running•?] [title truncate] [可选 meta]
```

active 规则：`focusedManagedId===tm_*` **且** `activeTerminalAgentSessionId===sessionId` **且** 右栏在 agent tab → `SIDEBAR_ACTIVE_RAIL`。

- 仅 focus 终端、未选具体会话、或右栏在 files：**父行**高亮。
- 选中某子会话且 agent tab 打开：**子行**高亮；父行可选弱高亮。

#### 3.5.4 点击子会话

1. `focus(tm_*)`
2. `activeView = terminals`（若尚未）
3. `terminalPanelOpen = true`，`terminalPanelTab[tm_*] = 'agent'`
4. `activeTerminalAgentSessionId = sessionId`（load/switch sidecar session）
5. **注入多会话语境注记**（D11，见 §5.5）
6. 右栏渲染该会话消息

记录为 `disconnected` 时同样加载历史（只读），exec 保持禁用。

#### 3.5.5 新建会话

| 入口 | 行为 |
|------|------|
| 右栏 Agent 空态 / composer「新对话」 | 在当前 `tm_*` 下 `session:create`（带 `hostId`），设为 active，侧栏插入并展开 |
| 父行右键「新建智能体对话」 | 同上 |
| 侧栏 SSH 行 hover「+」（可选） | 同上 |

同一 `tm_*` 允许多会话；同时只有一条为该终端的 active agent session。  
**exec 锁仍按 `tm_*` 全局单 flight**（多会话不能并行往同一 PTY 写）。
断开状态下允许新建/浏览对话（只读），`terminal_exec` 保持禁用。

#### 3.5.6 右键菜单

**子会话**：

```ts
// context-menu kinds
'terminalAgentSession': {
  sessionId: string
  terminalId: string  // tm_*
  hostId: string
  title: string
}
```

| 项 | 行为 |
|----|------|
| 打开 | 同 §3.5.4 |
| 重命名 | 对齐 `sessionHistory.rename` |
| 删除 | 确认后软删/进回收站；若删 active → 切到同 tm 最近一条，否则空态 |
| 复制标题 | 可选 |

**父 SSH 行**增量：

| 项 | 行为 |
|----|------|
| 新建智能体对话 | §3.5.5 |
| 关闭终端（断开） | `sshClose` + 取消 SFTP；**记录保留**，状态 → `disconnected`；子会话保留（D12） |
| 重新连接 | 同记录重新 `ssh_open`（同 `tm_*`，新 generation）；ring 重建；会话可继续 exec |
| 删除记录… | 确认后**级联软删**其下全部智能体对话（进回收站，可恢复）；若在线先 `sshClose` |
| （已有）重命名 / 复制标题 | 不变 |

#### 3.5.7 无障碍

- 父行：`aria-expanded`；子列表：`role="group"` + `aria-label`。
- 删除：danger 项 + 确认对话框，不静默删。

---

## 4. 会话模型

### 4.1 绑定关系（D8）

| 实体 | ID | 关系 |
|------|-----|------|
| Managed terminal | `tm_<nanoid>` | **记录跨 close 保留**（P0 进程内）；`status` 标记连接状态；执行目标（PTY 写、ring） |
| SSH Host | `hostId`（现有 Host 库） | **持久归属**；Host 删除时按 `hostId` 级联软删相关记录与对话（D14） |
| AI session | 现有 session id | 1:N 挂在同一 `tm_*`；`hostId` 随会话持久化 |
| Active agent session | per `tm_*` 一个 current id | 右栏展示谁；exec 上下文跟 active |

```ts
// managedTerminalStore
export type ManagedTerminalStatus = 'connecting' | 'connected' | 'disconnected' | 'error'

export interface ManagedTerminal {
  id: string                       // tm_*；close 后保留（D12）
  kind: ManagedTerminalKind
  title: string
  hostId?: string
  remotePath?: string
  status: ManagedTerminalStatus    // 新增状态标识
  createdAt: number
}

// terminalAgentStore（逻辑模型）
interface TerminalAgentState {
  sessionIdsByTerminal: Record<string, string[]>       // 可派生，避免双写漂移
  activeSessionByTerminal: Record<string, string | null>
  sidebarExpanded: Record<string, boolean>
}

// 权威归属：SessionConfig.managedTerminalId + surface==='terminal' + hostId
```

持久化：

- 会话消息 + config：走现有 sidecar / event-source；config 含 `surface`、`managedTerminalId`、`hostId`、`remotePathHint?`。
- 侧栏展开 / active 指针：进程内即可。
- 连接记录与状态：进程内；P2 持久化后 App 重启可恢复断开记录并按 `hostId` 重绑。
- 不维护独立 binding 文件。

**close 不再产生孤儿**：记录与子会话随记录保留。仅 App 重启后 `tm_*` 不恢复，旧 terminal 会话若仍在 DB 会变成无父终端孤儿——见 §4.3。

### 4.2 SessionConfig 扩展

```ts
// protocol SessionConfig（增量）
surface?: 'chat' | 'code' | 'terminal'   // 新增 'terminal'
/** 绑定的 managed SSH terminal id；surface==='terminal' 时必填 */
managedTerminalId?: string
/** 持久归属的 SSH host id；surface==='terminal' 时必填（D8） */
hostId?: string
/** 展示/语境用远程路径提示；非本机 cwd */
remotePathHint?: string
```

创建参数（逻辑）：

| 字段 | 值 |
|------|-----|
| `surface` | `'terminal'` |
| `managedTerminalId` | 当前 `tm_*` |
| `hostId` | 当前终端的 Host id |
| `remotePathHint` | 连接时的远程目录（若有） |
| `agentId` | 用户选择或上次该终端使用的 agent；默认 builtin supervisor |
| `permissionMode` | 默认 `'edit'`（见 §6） |
| `workspaceMode` | 不设或 `'sandbox'` 语义；**无**项目 git 树 |
| `tools` | 终端专用工具集（§5），非完整 code 工具集 |
| `systemPrompt` | 追加 Terminal Ops 段（§5.5） |

`cwd` 字段：**不指向远程路径**；禁用本地 file tools，避免路径幻觉。

主侧栏会话列表（Chats / Projects）：

- **必须过滤** `surface === 'terminal'`。
- 唯一导航入口：终端 section 下 SSH 子树 + 右栏 Agent。

### 4.3 生命周期

| 事件 | 行为 |
|------|------|
| 首次进入 Agent tab 且无 active / 首次发送 | 无 session → `session:create`（带 `hostId`）；有 → active 或最近一条 |
| 切换 focused `tm_*` | 右栏显示该 tm 的 `activeSessionByTerminal`；无则空状态 CTA |
| 切换子会话 | 换 active + 消息视图 + **注入语境注记（D11）**；不重连 SSH |
| SSH `exited` / `error` | 该 tm 会话**禁止**新 `terminal_exec`；status → `disconnected` / `error`；历史只读；UI 提示重连 |
| 用户 Restart SSH（同 `tm_*`） | 保留全部子会话；状态 `connecting → connected`；向 active（或全部）注入系统注记「PTY 已重启」；清空 exec flight |
| 用户删除子会话 | 确认 → 删/进 trash；更新 active；**不**关 SSH |
| 用户 Close 终端 tab | `sshClose` + 取消 SFTP；abort 进行中 turn；**记录保留、status → `disconnected`、子会话保留只读（D12）**；ring/fs 运行时状态清空 |
| 用户重连（同记录） | 同一 `tm_*` 重新 `ssh_open`（Rust 支持同 id 重建，generation 变化）；status → `connected`；会话可继续 exec |
| 用户删除记录 | 确认后：若在线先 `sshClose`；**级联软删**该记录下全部 terminal 会话（进回收站，可恢复）；移除记录 |
| 用户删除 Host 配置（HostLibrary） | 确认框提示「该主机下有 N 条连接记录、M 条智能体对话」；**级联清理**：相关记录及其全部对话软删进回收站（若在线先 `sshClose`）、清理 recents 中该 hostId 引用；无保留选项 |
| Host 重命名 / 编辑 | 记录实时跟随新 label（经 `hostId` 关联） |
| 离开终端 view（切到 Chat） | keep-alive：PTY 与 sessions 均保留 |
| App 退出 | 现有 quit/tray；`tm_*` 不恢复 |

**孤儿**（仅 App 重启 / 异常）：启动时 `surface==='terminal'` 且 `managedTerminalId` 不在当前 managed list → 不进终端树；P0 直接隐藏；P2 提供持久化、历史只读浏览/清理。`hostId` 存在使未来「按 host 找回 / 重绑」成为可能。

---

## 5. 工具与执行协议（共享 PTY）

### 5.1 工具集（terminal surface）

| 工具 | 本版 | 说明 |
|------|------|------|
| `terminal_exec` | **必须（P0）** | 经批准后向共享 PTY 发送命令并回收输出；结果带不确定状态（D10） |
| `terminal_read` | **必须（P0）** | 读取 ring 近期输出 / 自游标起的增量；不写 PTY |
| `sftp_read` | **必须（P0，D9）** | 只读远程文件（文本/小文件）；复用 Files tab SFTP 通道 |
| `terminal_send_keys` | 可选 Phase 1.1 | 原始键序（Ctrl-C 等）；高风险，默认需批准 |
| `run_script` | **禁用** | 避免本机执行被误认为远程 |
| 本地 `read_file` / `write_file` / `grep` / … | **禁用** | 防止路径幻觉 |
| SFTP list/write | list P0（Files tab 已有）；**write P1 起** | 写文件走「提议修改」闭环 |
| `task` / subagent / background shell | **默认关** | 共享 PTY 不适合并行多 shell |
| MCP / skills | 按 agent 授权；默认保守 | 与现 agent grants 一致 |
| ACP primary | 允许选 | ACP 自带 shell **不**写远程 PTY；见 §5.6 |

### 5.2 `terminal_exec` 语义（修订：不确定性一等状态）

```ts
// 逻辑 schema
{
  command: string
  reason?: string
  wait_ms?: number          // 默认 e.g. 15000；上限 e.g. 120000
  poll?: boolean            // 是否在返回前轮询 ring（默认 true）
}

// 结果
{
  status: 'completed' | 'timed_out' | 'user_interleaved' | 'rejected' | 'error' | 'aborted'
  output: string            // cap e.g. 64KB，可能为 partial
  mayStillRun: boolean      // completed=false 时通常为 true
  exitCode?: number | null  // 仅可靠时提供（P1 包装后）
}
```

**执行流水线（UI-mediated bridge）**：

```
Sidecar tool call terminal_exec
    → WS: tool_called (pending approval)
    → UI PermissionModal（permissionMode 允许时自动批）
    → 若拒绝: 返回 rejected，不写 PTY
    → 若批准:
         1. 断言 terminalId 匹配、记录 status==='connected'、无并发 exec 锁
         2. 不自动 Ctrl-C；若 ring 尾部显示 REPL 不完整行，可提示用户
         3. sshWrite(terminalId, command + "\n")
         4. 标记 ring 游标 start
         5. 轮询/监听 pty 输出直至完成启发式或 wait_ms 超时
         6. 截取 [start, end) 输出（cap 64KB）返回 sidecar
```

**完成启发式（仅用于给结果分级，不用于断言成功）**：

1. **空闲静默**：连续 N ms（400–800ms）无新输出 **且**
2. **提示符像**：尾部匹配常见 prompt（`$ ` `# ` `% ` `> ` 或用户可配）→ `completed`（弱信号，仍允许模型继续观察）
3. **硬超时**：`wait_ms` 到 → `timed_out` + 已收集输出 + `mayStillRun: true`；**不**自动 Ctrl-C

**模型侧规则（写入 system prompt）**：

- `timed_out` 时**禁止**断言命令已成功；可调用 `terminal_read` 轮询，或直接问用户「命令是否已完成」。
- `user_interleaved` 时结果置信度降低，优先向用户确认。
- 一次 `terminal_exec` 只发一条命令；需要长任务指导用 `nohup`/`tmux` 等（见 §5.5）。

交互式命令检测（拒绝或强警告）：`vim` `nvim` `less` `top` `htop` `passwd` `ssh`（嵌套）等 → 批准框红字警告或 tool error 建议用户手操。

### 5.3 并发与人机抢写

| 规则 | 说明 |
|------|------|
| **单 flight** | 同一 `tm_*` 同时只允许一个 `terminal_exec` |
| **用户输入优先** | exec 进行中用户键入：不阻断；结果标记 `user_interleaved` |
| **视觉** | 工具卡显示「已写入终端」+ 结果状态 |
| **锁 UI** | Agent 面板 flight 中禁用连发；可「取消等待」（只停回收）；「发送 Ctrl-C」按钮 P1 |

### 5.4 与 `run_script` / TaskRuntime

- terminal surface **不注册** `run_script` background。
- 长任务：指导 agent 用 `nohup`/`tmux` 经 `terminal_exec` 启动，再 `terminal_read` 查看。
- 不把 RuntimeTaskStrip 接到远程 PTY。

### 5.5 System 上下文注入

每次 turn 组装（session 创建时 + 增量刷新）：

```
You are assisting on an SSH managed terminal inside hip.
Host: {username}@{hostname}:{port}
Label: {host.label}
Terminal id: {tm_*}   Host id: {hostId}
Remote path hint: {remotePathHint or unknown}
PTY status: {connected|disconnected|error}
Recent terminal output (last ~N lines, may be truncated):
```
{ring tail}
```
Rules:
- Execute only via terminal_exec (shared PTY the user sees).
- When the terminal is disconnected, terminal_exec is unavailable; read history only.
- A timed_out result means the command MAY STILL BE RUNNING. Never claim success.
  Poll terminal_read or ask the user if uncertain.
- User input may appear between your command and its output; treat results cautiously.
- Remote file reading: use sftp_read with an absolute remote path; never assume local paths.
- Prefer non-interactive flags (-y, --noconfirm, DEBIAN_FRONTEND=noninteractive).
- If a command may be destructive, explain risk in reason and wait for approval.
```

**多会话语境注记（D11）**：切换子会话时追加：

```
Note: terminal state may have changed since your last turn; recent output may belong
to another conversation on this terminal. Check current ring tail before acting.
```

`TerminalContextInjector`（对齐 OpenFile injector）在每 turn 前注入 ring tail，P1 落地。

### 5.6 ACP / 外部 Agent

| Agent kind | 行为 |
|------------|------|
| builtin / internal | 完整 `terminal_*` + `sftp_read` 工具 |
| ACP / opencode 等自带 shell | **P1**：选中时 toast/文案「该 Agent 的内置 shell 不会写入本 SSH 会话」；仅开放只读对话 |
|  | **P2**：ACP 桥接映射到 `terminal_exec`（若协议允许） |

---

## 6. 权限模型

复用 `PermissionMode`，语义映射到终端：

| Mode | `terminal_read` / `sftp_read` | `terminal_exec` | `terminal_send_keys` |
|------|------------------------------|-----------------|----------------------|
| `chat` | 允许 | **拒绝** | 拒绝 |
| `edit`（默认） | 允许 | **每次 HITL** | 每次 HITL |
| `full` | 允许 | 自动批准 | 建议仍 HITL 或 sticky |

- Sticky approval（「始终允许」）按 command hash / binary 前缀，复用现有 permission UX。
- Autopilot：本版**不推荐**在 terminal surface 开启；若 `executionMode=autopilot` 且非 full，沿用现有 coerce 规则。
- 危险命令（`rm -rf` `mkfs` `dd` `shutdown`）在 UI 层二次确认（即使 full）。
- `sftp_write`（P1）默认每次 HITL；任意路径覆盖需二次确认。

---

## 7. 状态与存储

### 7.1 UI store

| 状态 | 位置 | 默认 |
|------|------|------|
| `terminalPanelOpen` | `uiStore`（已有） | `true` |
| `terminalPanelTab` | per-`tm_*` map | `'files'`；首次连接不强制跳 agent |
| 连接记录状态 | `managedTerminalStore`（`ManagedTerminal.status`） | `connecting → connected / disconnected / error`；close 保留记录 |
| binding map | `terminalAgentStore` | 空 |
| exec lock / flight | `terminalAgentStore` 或 per-terminal | null |

记忆：`terminalPanelTab` 按 terminalId 记忆，切换 tab 不串台。

### 7.2 复用组件

| 能力 | 复用 | 注意 |
|------|------|------|
| 消息列表 / markdown / tool card | `MessageBubble` 等原子组件 | **不要**直接挂 `ChatPane`（active-only） |
| Composer / agent picker | 抽 `CompactComposer(sessionId)` | 显式 sessionId；窄栏 ≥350px |
| Permission UI | 复用 `permission:request` 协议与弹层样式 | **必须** sessionId 显式挂载在 Agent 面板内 |
| Session WS | `createSession(..., { activate: false })` + `sendMessageToSession` | 自动化已证明后台 turn |
| Ring / status | `terminalStore.getSession` / `ringIndexForCursor` | 新增 `readSince(cursor)`；flight/interleave 标记 |
| SSH write | `sshWrite` | 仅 bridge 路径；预留 `source` 字段（P2 遥测） |
| SFTP | 现有 sftp IPC（Files tab 同源） | `sftp_read` 需 size cap 与错误映射 |

避免：右栏再挂一个 `XtermSurface`（单 attach 契约）。

### 7.3 焦点模型（双轨）

| 指针 | 职责 |
|------|------|
| `domain.activeSessionId` | 用户当前 Chat/Code 会话；terminal turn **默认不抢**（`activate: false`） |
| `terminalAgentStore.activeSessionByTerminal[tm_*]` | 右栏 Agent 展示 / 发送 / HITL |
| `managedTerminalStore.focusedId` | 主栏 xterm + SSH 写目标 |

规则：

1. `activeView==='terminals'` 时，**禁止**裸 `selectSession` 切走 view；新增 `focusTerminalAgentSession(tmId, sessionId)`。
2. HITL 订阅 **该 sessionId** 的 `pendingPermission`（`useSessionPendingPermission(id)`）。
3. 若实现成本迫使「必须 activate」：`selectSession` 对 `surface==='terminal'` special-case 保持 `activeView='terminals'`，离开终端时恢复先前 chat/code active。
4. 推荐优先路径：**不 activate + session 作用域 UI**。

---

## 8. 交互流程

### 8.1 主路径

1. 用户从 HostLibrary 连接 SSH → 主栏 xterm running。
2. 右栏默认 Files（SFTP）。
3. 用户 Tab▾ → Agent。
4. 空状态：简短说明 + Agent 下拉 + 「开始」；首次发送创建 session（带 `hostId`）。
5. 用户：「看看磁盘还剩多少」。
6. Agent 调 `terminal_read` 或直接 `terminal_exec` `df -h`。
7. HITL 卡展示命令 → 批准 → 主栏 xterm 出现命令与输出 → 右栏回复解读。
8. 若 `timed_out`：工具卡显示「可能仍在运行」→ Agent 轮询或询问用户，**不**断言成功。

### 8.2 失败路径

| 情况 | UX |
|------|-----|
| SSH 未连接 / 已断开 | Agent body 空状态「先连接服务器」；历史只读；禁用 exec |
| Exec 超时 | 工具卡 `timed_out` + 部分输出 + 操作：「发送 Ctrl-C」「继续观察」「问用户」 |
| 用户拒绝 | 助手继续对话，不重试死循环 |
| soft-cap / write 失败 | toast + tool error |
| 切换 terminal 时 flight 未完成 | abort 回收等待；已写入远程的命令不回滚 |
| 多会话切换 | 注入语境注记；历史输出可见但标注可能属于其他对话 |
| 断线 | 禁 exec；历史只读；提示重连 |
| 点击断开记录 | 主栏重连空态；右栏显示历史会话（只读） |

### 8.3 快捷入口（可选 Phase 1.1）

- 主栏终端 chrome：「问 AI」→ 打开右栏并切到 `agent`。
- 选中 xterm 文本右键「解释」→ 打开 agent 并预填引用（需 selection API）。

---

## 9. 协议 / IPC 变更

### 9.1 Protocol

```ts
// SessionConfig
surface?: 'chat' | 'code' | 'terminal'
managedTerminalId?: string
hostId?: string                    // 新增（D8）
remotePathHint?: string            // 新增
```

**选定模式 A′（HITL 扩展，最小新协议）**：

```
sidecar terminal_exec.invoke
  → requestApproval / 专用 pendingUiTool map（同 promise 门闩）
  → WS: permission:request
       { toolName:'terminal_exec', kind:'execute', content: command,
         meta: { managedTerminalId, wait_ms, poll, callId } }
  → UI(Agent 面板) 展示批准
  → 用户批准后：UI 本地 sshWrite + ring readSince + 启发式
  → UI → WS: session:uiToolResult
       { callId, ok, status, output, mayStillRun, userInterleaved }
  → sidecar resolve tool promise → 模型继续
```

`terminal_read`：ring 在 UI/Tauri，走 UI 查询短路径（`session:uiToolRead` 或复用 injector）；只读不经 HITL。

### 9.2 无需新的 Rust SSH API（MVP）

现有 `ssh_write` / ring 事件足够。可选后续：`ssh_write` 带 `source: 'user' | 'agent'`（仅遥测，不改变字节流）。

### 9.3 Protocol surface 扩展（落地清单，遗漏任一则 terminal 会话会伪装成 code）

| 位置 | 现状 | 改动 |
|------|------|------|
| `packages/protocol` `SessionConfig.surface` | `'chat'\|'code'` | + `'terminal'`；+ `hostId` |
| `SessionSummary.surface` | 同上 | + `'terminal'` |
| `src/lib/sessions.ts` `surfaceOf` | 未知 → `'code'` | 识别 `'terminal'`；未知勿默默当 code |
| `packages/sidecar/.../surface.ts` `surfaceOf` | 同上 | 同上 |
| `resolveAgentRuntimeProfile` | 未知走 code 工具集 | terminal：`allowRunScript:false` + 仅 terminal 工具 |
| `system-prompt` bodies | chat/knowledge/code | + terminal ops body（含不确定性与多会话规则） |
| `sessionService.selectSession` | `setActiveView(surfaceOf)` | terminal → 保持/设为 `terminals` |
| `AppSidebar` chats/projects filter | `surfaceOf === chat\|code` | 显式排除 `config.surface==='terminal'` |
| History / command palette / counts | 全量或 code 桶 | 排除或独立桶 |
| `uiStore.Surface` | chat\|code | 拆分，避免 terminals view 与 session surface 混淆 |

---

## 10. UI 文案与 i18n（键名草案）

| Key | en（示意） |
|-----|------------|
| `terminals.panel.tab.files` | Files |
| `terminals.panel.tab.agent` | Agent |
| `terminals.agent.emptyTitle` | Ops assistant |
| `terminals.agent.emptyBody` | Ask about this server. Approved commands run in the terminal you see. |
| `terminals.agent.needSsh` | Connect SSH to use the agent. |
| `terminals.agent.execTitle` | Run in SSH terminal |
| `terminals.agent.execHint` | This will be typed into the shared session. |
| `terminals.agent.execTimedOut` | Command may still be running |
| `terminals.agent.execPartial` | Partial output captured; verify before continuing |
| `terminals.agent.ptyDead` | Terminal disconnected. Reconnect to run commands. |
| `terminals.agent.acpLimited` | This agent’s built-in shell does not drive the SSH session. |
| `terminals.agent.newChat` | New agent chat |
| `terminals.agent.sessionsGroup` | Agent chats for {{title}} |
| `terminals.agent.deleteTitle` | Delete agent chat? |
| `terminals.agent.deleteBody` | Removes this conversation. The SSH terminal stays open. |
| `terminals.agent.contextChanged` | Terminal state may have changed since the last message |
| `contextMenu.managedTerminal.newAgentChat` | New agent chat |
| `contextMenu.terminalAgentSession.open` | Open |
| `contextMenu.terminalAgentSession.rename` | Rename |
| `contextMenu.terminalAgentSession.delete` | Delete |

中文产品用语：**智能体**（tab / 设置一致）。

---

## 11. 非目标与后续

### 11.1 明确非目标（v2.0）

- 本地 terminal Agent
- 每 Host 跨 `tm_*` 的完整永久会话（P1 起仅只读查询入口）
- 共享 PTY 上的多 agent 并行 exec
- 把 Terminal 做成完整 Code 工作面（P3 另议，见 §17.3）
- Agent 自动处理 vim/密码提示
- 无用户感知的隐蔽 shell
- 本版远程写文件（P1「提议修改」闭环起）
- App 重启后自动恢复断开记录与连接（P2 持久化）

### 11.2 Phase 2+

- SFTP 写工具（走批准）、选区「解释 / 修复」
- `tm_*` 持久化与会话重绑（按 `hostId`）
- ACP → `terminal_exec` 桥
- 命令结果结构化（`__HIP_EC` 包装，opt-in）提升启发式
- 可选「独立 exec channel」高级模式（打破 D4 的进阶，需产品确认）

---

## 12. 实现分期

### P0 — 可演示闭环（风险优先顺序）

1. **协议 + `surfaceOf` + 全列表硬过滤 + `hostId`**（§9.3）— 必须先于任何 create
2. Sidecar `terminal` runtime profile：禁 `run_script`/本地 file 写；注册 `terminal_exec` / `terminal_read` / `sftp_read` 占位
3. 双轨焦点：`terminalAgentStore` + `sendMessageToSession` + session 作用域消息/composer/HITL
4. UI tool 桥：批准 → `sshWrite` → `readSince` → `uiToolResult`（含 `status` / `mayStillRun` / `userInterleaved`）
5. **SFTP 只读**：`sftp_read` + Files tab 同源通道 + size cap
6. SSH 右栏 tabs：`files` \| `agent` + `TerminalAgentPanel` 壳
7. 侧栏 SSH 会话树 + 状态标识；`close(tm)` → **保留记录（`disconnected`）+ 会话只读**；重连复用同 `tm_*`
8. per-tm exec 单 flight；断线禁 exec；**多会话切换语境注记**
9. 删除记录确认对话框：确认后**级联软删其下对话进回收站**（若在线先 `sshClose`）
10. Host 删除关联：确认框关联数量提示；删除 = **级联清理进回收站**（无保留选项）

### P1 — 体验与闭环

1. 完成检测增强：turn 内轮询、opt-in `__HIP_EC` 包装、超时后「问用户」路径
2. **「提议修改」文件闭环**：`sftp_read` → agent 提 diff → 用户确认 → UI 写入或用户执行
3. hostId 级「最近对话」只读查询入口
4. 危险命令二次确认、TUI 黑名单
5. Context Slot / PanelTabBar / PanelToggle 对齐
6. 父行右键「新建智能体对话」；子行重命名；i18n 全量
7. ACP 限权文案；`TerminalContextInjector`（ring tail 每 turn）
8. flight 取消 + 「发送 Ctrl-C」按钮；Restart PTY 系统注记

### P2 — 增强

1. `tm_*` 持久化与会话重绑（按 `hostId`）；孤儿会话历史浏览
2. SFTP 写工具（HITL）、选区解释、更强 prompt 检测
3. 删除记录时可选「连同删除对话」（默认保留）
4. `ssh_write` source 遥测；可选独立 exec channel 原型
5. ACP 桥接

### P3 — 远程工作区方向（D13，非承诺）

P2 结束时复盘决定是否立项：

- 数据：SSH 用户请求分布、终端使用时长、文件编辑/代码任务占比
- 若远程代码任务占比高，优先「最小 SshBackend」：SFTP 树 + 读写 + `ssh_exec` 挂到 Code surface，而非完整 WorkspaceBackend
- 复用：Host 库、SFTP 通道、HITL、ring、`hostId` 绑定

---

## 13. 测试计划

| 层 | 用例 |
|----|------|
| Unit | `surfaceOf('terminal')`；列表/history/palette 不含 terminal；1:N filter；exec 单 flight；`readSince` 在 trim 后行为；`hostId` 持久化；**close 保留记录与会话；status 状态机（connecting→connected→disconnected→重连）；Host 删除 → 按 hostId 级联软删记录与对话** |
| Unit | `terminal_exec` 结果分级：completed / timed_out（`mayStillRun:true`）/ user_interleaved |
| Component | 侧栏展开/折叠；子行 active；右键删除后 active 回退；Agent 面板内 HITL（非全局 active）；pty dead |
| Component | 工具卡超时态 + 「发送 Ctrl-C / 继续观察 / 问用户」操作 |
| Component | 多会话切换后注记注入 |
| Integration | mock sshWrite + ring → uiToolResult；`sftp_read` 越界/cap/错误映射；删 session 不关 SSH；**close tm 保留记录与会话；删除记录级联软删对话（进回收站）；删除 Host 级联软删记录与对话（进回收站）** |
| Permission | chat 禁 exec；edit HITL；full auto（危险命令仍二次确认）；terminals view 下 HITL 可见可点 |
| Regression | 单 XtermSurface；local 无子树；create terminal 不进 Projects；select 不踢出 terminals view |
| Manual / e2e | 真 SSH：双会话切换；批准执行可见；拒绝不写；断线禁 exec；`tail -f` 超时后 agent 不虚构完成；**关闭后记录保留、重连继续对话；删除 Host 后记录与对话级联进回收站** |

---

## 14. 成功标准

1. SSH 连接后右栏可在 **文件** 与 **智能体** 间切换。
2. 智能体会话出现在左侧对应 SSH 终端下，可展开/折叠；可右键删除。
3. 同一 SSH 下可有多条对话；点击切换右栏内容；主 Chat/项目列表无这些会话。
4. 用户用现有 Agent 完成至少一轮「提问 → 批准 → 共享终端执行 → 解读输出」。
5. 命令只出现在用户正在看的 SSH 会话中，不在本机 shell 偷跑。
6. 关闭终端后无继续写入；**侧边栏记录保留并显示断开状态，子会话与对话历史保留可查看**。
7. 本地 managed terminal 行为与现网一致（无 Agent tab / 无子树）。
8. **超时/长命令返回部分输出，agent 不虚构完成、不自动 Ctrl-C。**
9. **用户中途输入不造成状态错乱，结果标记 `user_interleaved`。**
10. **同 `tm_*` 多会话切换后上下文不串台（注记生效）。**
11. **Agent 能用 `sftp_read` 读取远程文件并正确引用内容。**
12. **会话持久化包含 `hostId`；按 host 过滤查询可用（P1 验证）。**
13. **重连同一记录后对话可继续执行（同 `tm_*` 复用，generation 变化）。**
14. **删除连接记录后其下对话进入回收站（可恢复）；删除 Host 配置级联清理记录与对话（进回收站）。**

---

## 15. 开放问题（需产品拍板）

| # | 问题 | 建议默认 |
|---|------|----------|
| Q1 | P0 是否含 SFTP 只读？ | **含**（D9，已决） |
| Q2 | 「提议修改」文件闭环是否 P1？ | **是** |
| Q3 | `hostId` 冗余字段是否现在加？ | **现在加**（D8，已决） |
| Q4 | 完成检测 P1 是否 opt-in `__HIP_EC` 包装？ | **是**（默认启发式 + 轮询） |
| Q5 | P3 workspace 评估门槛是否认可？ | **认可**，P2 结束时复盘 |
| Q6 | 独立 exec channel 是否 P2 原型？ | **原型可做**，默认不开 |
| Q7 | 删除连接记录时是否连同删除对话？ | **是，级联软删进回收站**（用户评审已决）；软删可恢复 |
| Q8 | 删除 Host 配置时如何处理关联记录与对话？ | **级联清理进回收站**（用户评审已决）；无保留选项 |

---

## 16. 关键文件（落地时预期触达）

| 区域 | 文件 |
|------|------|
| UI 壳 | `AppLayout.tsx`、`PanelToggle.tsx`、`PanelTabBar.tsx`、`visibleArtifactTabs.ts`、`PanelContextSlot.tsx` |
| 侧栏 | `AppSidebar.tsx`（SSH 树 + 子行）；`sidebarActions.ts` |
| 终端 | `TerminalFilesPanel.tsx` → 拆 `TerminalRightPanel.tsx` + files body；新建 `TerminalAgentPanel.tsx` |
| Store | `uiStore.ts`、`managedTerminalStore.ts`（`ManagedTerminal.status` + close 保留）、新建 `terminalAgentStore.ts`；session 列表 filter |
| Context menu | `types.ts` / `catalog.ts` / 新 `terminalAgentSession` provider；`managedTerminal` 增「新建对话 / 重新连接 / 删除记录」 |
| Host 删除钩子 | `terminalHostStore` / `HostFormDialog`：删除前关联检查（记录数、会话数）；按 `hostId` 级联软删记录与对话（进回收站）；清理 recents |
| Session | `sessionService` / domain session create；`packages/protocol` `SessionConfig.surface` + `managedTerminalId` + `hostId` + `remotePathHint` |
| Sidecar | tools 注册按 surface 过滤；`terminal_exec` / `terminal_read` / `sftp_read`；system-prompt 分支；不确定性与多会话规则 |
| i18n | `en.ts` / zh 等 |
| 测试 | §13 |

---

## 17. 与旧文档的关系

### 17.1 取代关系

- `terminal-agent-panel-spec.md`（v1.3）与 `remote-project-workspace-spec.md`（v0.1 搁置稿）：**已清理**（备份于 `.temp/design-archive-2026-08-02/`）；本文为现行唯一实现依据。
- `ssh-agent-path-review.md`（v0.6）：评审材料，**已清理**（git 历史可查）；评审结论已并入本文决策与修订记录。

### 17.2 待补文档

- `right-panel-titlebar-slot-spec.md`：当前**不存在**；落地 Context Slot 前需补齐或从本 spec 删除引用。

### 17.3 与远程工作区方案

- P3 方向要点已并入本 spec §12 P3（原 `remote-project-workspace-spec.md` 已清理）：P2 结束时按数据复盘，优先「最小 SshBackend」挂 Code surface，而非完整 WorkspaceBackend。
- 本版 `hostId`（D8）与 SFTP 通道（D9）即为向 P3 迁移预留的接口。

---

## 18. 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v2.0 | 2026-08-02 | 修订稿：在 v1.3 基础上新增 D8 `hostId`、D9 SFTP 只读、D10 不确定性一等状态、D11 多会话语境注记、D12 关终端策略、D13 P3 工作区方向；补充成功标准 8–12、测试用例与 P3 评估门槛 |
| v2.1 | 2026-08-02 | 用户评审修订：关闭终端改为状态标识 + 记录保留（D12），废弃级联软删；侧栏/生命周期/工具/存储/测试/成功标准同步更新；新增删除记录确认语义（Q7） |
| v2.2 | 2026-08-02 | 用户评审修订：删除连接记录 → 级联软删其下对话（进回收站）；新增 D14 Host 配置删除关联（hostMissing 标记、确认框关联数量提示、快照回退）与 Q8 |
| v2.3 | 2026-08-02 | 用户评审修订：删除 Host 配置默认级联清理记录与对话（进回收站）；「仅删配置」降为可选项（D14 / Q8 翻转，全文档同步） |
| v2.4 | 2026-08-02 | 用户评审修订：砍掉「仅删配置」可选项；删 Host = 连记录带对话一起进回收站；移除 `hostMissing` / `hostLabel` 相关逻辑（D14 / Q8 简化，全文档同步） |
| v2.5 | 2026-08-02 | 文档清理：删除旧稿 v1.3 与 workspace 搁置稿（备份 `.temp/design-archive-2026-08-02/`），更新 §17 引用；本文为现行唯一 spec |
| v2.6 | 2026-08-02 | 文档清理：删除评审材料 `ssh-agent-path-review.md`（评审结论已并入本文，git 历史可查） |
