# 运维助手全面改进 Spec

- 系列：`docs/design/terminal-agent-comprehensive-improvement/`
- 配套：`terminal-agent-comprehensive-improvement-preview.html`（交互原型，浏览器直接打开）
- 状态：待评审
- 日期：2026-08-26
- 前置基线：
  - `docs/design/terminal-shared-pty/terminal-shared-pty-spec.md`（共享终端协同整改，P0–P1 已完成）
  - `docs/design/terminal-agent-parity/terminal-agent-parity-plan.md`（运维助手视觉对齐，已完成）
  - `docs/design/terminal-capability-upgrade/terminal-capability-upgrade-spec.md`（终端能力现代化升级，待实施）
  - `docs/design/terminal-bastion-host/terminal-bastion-host-spec.md`（运维跳板机，待实施）
- 涉及模块：
  - `src/components/terminals/TerminalAgentPanel.tsx`（运维助手 UI 面板）
  - `src/domain/terminalAgentBridge.ts`（exec 状态机/完成判定）
  - `packages/sidecar/src/session/tools/terminal.ts`（terminal_exec/terminal_read/sftp 工具）
  - `src/store/terminalStore.ts`（ring/trimOffset/userInterleaved）
  - `src/store/terminalAgentStore.ts`（单飞行锁/驾驶状态）
  - `src/components/artifact/XtermSurface.tsx`（终端渲染层）
  - `src/ipc/ssh.ts` + `src-tauri`（ssh_write 通道）
  - `packages/sidecar/src/session/permission-manager.ts`（审批）
  - `src/store/hipConfigStore.ts`（规则持久化）
  - `src-tauri/src/pty.rs`（PTY 后端）
  - `src-tauri/src/ssh_session.rs`（SSH 会话）

---

## 1. 根因：运维助手的系统性缺陷

基于对现有代码和设计文档的全面分析，运维助手存在以下**五类结构性缺陷**：

### 1.1 缺陷 A：完成判定靠"猜"而不是信号

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| A1 | 命令是否结束靠正则启发式 `[$#%>]\s*$` 猜测 prompt。自定义 PS1（p10k/starship 图标结尾）、输出恰好以 `$` 结尾（`echo $?`）、输出被 ring 裁剪后看不到 prompt → 漏判/误判 | `terminalAgentBridge.ts` `hasPromptTail()` | 无 shell 集成层，缺乏命令边界信号 |
| A2 | 退出码默认拿不到：`wrapEc` 是 opt-in，且会往用户可见命令后追加 `printf` 围栏文本，污染共享终端观感 → 多数命令 agent 不知道成败 | `wrapForEc()` + `terminal.ts` `wrapEc?: boolean` | 围栏未默认开启、未做"用户无感"处理 |
| A3 | 500ms 静默 + deadline 双启发式：网络慢/命令等锁时误判完成；`watch` 类长驻命令永不提示 → 只能 `timed_out + mayStillRun` | `EXEC_SILENCE_MS=500`、`EXEC_POLL_MS=150` | 没有"该命令还在前台"的权威信号，只能猜 |
| A4 | exec 回传输出含命令回显与用户自己的输入，无命令块切分，token 浪费且结果易混淆 | `getRingSince(startCursor)` 整段截取 | ring 是文本流，没有命令边界索引 |

### 1.2 缺陷 B：无接管/交还协议——用户被锁死在 timed_out

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| B1 | agent 触发 `sudo` 密码、交互确认（`git rebase`、包管理器询问）时无协作路径：只能等到 deadline 判 `timed_out + mayStillRun`，用户干完活 agent 也不知道何时恢复 | `runExec()` deadline 分支 | 飞行状态机只有 `running → finished`，没有 `handed_off → resumed` |
| B2 | 交互式 TUI 直接拒绝（vim/nvim/top/htop/passwd/ssh 黑名单），agent 无法在交互程序内协作 | `TUI_PATTERNS` + `isInteractiveTuiCommand()` | 与 Warp Full Terminal Use（agent 进入 psql/vim/gdb 操作）相反 |
| B3 | 用户键入只有事后标记 `user_interleaved`，飞行照常 deadline 推进——用户介入被当作噪声而非协作事件 | `XtermSurface.tsx` L463 `noteUserInput` → `consumeUserInterleaved` | 无"一个键盘"原则：Warp 是 Takeover 暂停 agent、SkyDeck 是 one-driver-at-a-time |

### 1.3 缺陷 C：并发语义是"报错"而不是"排队"

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| C1 | 第二个 exec（同终端其他会话）直接失败："another command is already running" | `execFlightByTerminal` 判重 | 单飞行锁无队列 |
| C2 | agent 跑长命令期间用户发新消息 → 与飞行并行，agent 读到过期状态 | 无任何门禁 | 缺"运行中入队"语义 |

### 1.4 缺陷 D：安全模型是正则黑名单 + 原生弹窗

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| D1 | 危险命令靠正则黑名单：漏 `git push --force`、`kill -9`、`chmod -R 777`、fork bomb、`> file` 重定向 | `DANGER_PATTERNS` | 黑名单天然不完整 |
| D2 | 二次确认用 `window.confirm`：原生阻塞弹窗、与应用 UI 割裂、不可测试、无"记住选择" | `runExec()` / `runWrite()` | 未接入应用内确认组件 + 规则持久化 |
| D3 | `sftp_write` 覆盖检测是"先 read 探测再写"，存在 TOCTOU 窗口 | `runWrite()` `sftpReadFile(path, 1)` 探测 | exists 检查与写入非原子 |
| D4 | 只有审批层、无能力层 | sidecar `requestApproval` 单一通道 | 应采用 sandbox（能力层）+ approval policy（策略层）分离 |

### 1.5 缺陷 E：ring 生命周期与上下文

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| E1 | SSH 重连后 ring 重建、cursor 失效，飞行中直接 `aborted`，agent 无感知自愈路径 | `terminalStore` trimOffset/reset、`runExec` 无 generation 校验 | cursor 未绑定会话 generation |
| E2 | agent 上下文只有"最近终端输出"，无 cwd、无 host 元数据、无结构化命令记录 | spec §2 承诺 host 元数据未落地 | 上下文注入未按承诺实现 |

### 1.6 缺陷 F：视觉与交互体验不一致

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| F1 | 规划审批面板缺失：`planApprovalPending` 触发时用户看不到、无法响应 | `TerminalAgentPanel.tsx` 无规划审批 UI | 功能性缺口，不是视觉问题 |
| F2 | 输入框 IME 守卫缺失：中文/日文输入法回车确认组词时会误发送 | `CompactComposer` 的 textarea 无 `isComposing` 判断 | 未与主 Composer 对齐 |
| F3 | 命令卡无 exit code 显示：agent 不知道命令成败，用户也不知道 | `TerminalAgentPanel.tsx` 命令卡无 exit code chip | 未与 ToolStatusChip 视觉对齐 |

---

## 2. 行业最佳实践调研

| 方案 | 关键机制 | 对照 hip 的启示 |
|---|---|---|
| **Warp Full Terminal Use** | agent 附加活动 PTY；Takeover 控制（一键停 agent、用户同会话打字、再点恢复）；长命令期间用户 prompt 排队；完成靠 shell hook `CommandFinished`/`Precmd` 双信号冗余 | B1/B3/C2 的直接答案：驾驶状态机 + 排队 + hook 完成信号 |
| **VS Code Shell Integration / OSC 633** | `OSC 633 ; A/B/C/D/E` 标记 prompt 开始/结束、pre-exec、execution finished + exit code；xterm 渲染层吞 marker 用户无感 | A1/A2 的事实标准：命令边界 + 退出码不可见标记 |
| **Claudette shell handoff** | 三态驾驶机 `agent driving / human driving / handing back`；agent 卡住时横幅 "take the wheel?"；交还时重读 shell 状态 + 用户附注 | B1 的完整状态机模板 |
| **SkyDeck Pods** | one driver at a time：同一时刻一个键盘，request-control 交接，read-only 观察者 | B3 的并发纪律 |
| **tmuxb / tmux control mode** | `send-keys`/`capture-pane`/`%output`；铁律"send 前必 capture"、验证状态迁移、长序列拆检查点 | 命令写入前的状态确认纪律 |
| **Claude Code 权限模型** | Bash 工具 allow/deny/ask 模式规则（`Bash(git status:*)`），规则持久化 | D1/D2 的规则化审批模板 |
| **OpenAI Codex** | sandbox（能力层：Landlock/Seatbelt）+ approval policy（策略层）分离；社区高赞诉求"take over 输密码后回到 agent 流程" | D4 的分层思想 + B1 的社区验证 |
| **Microsoft Agent Host Protocol** | 终端为一等资源：catalogue + 订阅 + claim 所有权（client vs session） | "谁拥有键盘"是协议级概念（对应 T2 的 driver 状态） |

---

## 3. 改进项

### T1 命令围栏（command fence）——完成判定革命（P0 核心）

把"猜 prompt"换成"命令边界信号"，渐进实现（SSH 远端无法预装 shell hook，用写入时包裹替代）：

#### T1.1 默认开启围栏

替代 opt-in `wrapEc`，保留旧解析兼容：

```bash
printf '\x1b]633;A\x1b\\'          # 命令开始（OSC 633 语义，VS Code 同款）
<command>
printf '\x1b]633;D;%s\x1b\\' "$?"  # 执行结束 + 退出码
```

- 与 `wrapEc` 的差异：marker 是 OSC 序列而非可见文本
- `XtermSurface` 增加 OSC 633 解析（xterm.js custom escape sequence handler）
- 渲染层吞掉 marker 不显示——用户看到的终端只是命令 + 输出（VS Code 同款体验）
- ring 保留 OSC 原文供 bridge 解析
- 失败降级：远端 shell 不兼容/被 strip → 无 marker 时回退 `hasPromptTail` + 静默兜底（现状逻辑保留为 fallback）

#### T1.2 完成判定两级信号

```typescript
function extractFenceExitCode(output: string): { completed: boolean; exitCode?: number } {
  // 第一级：围栏信号（权威）
  const fenceMatch = output.match(/\x1b\]633;D;(\d+)\x1b\\/);
  if (fenceMatch) {
    return { completed: true, exitCode: parseInt(fenceMatch[1], 10) };
  }
  
  // 第二级：prompt 尾巴（兜底）
  if (hasPromptTail(output)) {
    return { completed: true, exitCode: undefined };
  }
  
  return { completed: false };
}
```

#### T1.3 命令块切分

ring 侧按 fence marker 建立命令块索引（`fenceByCursor`：起点 cursor → { command, exitCode, endCursor }）；`terminal_read` / exec 结果按块返回，不再混入用户自己的输入输出。

#### T1.4 退出码进入工具结果与消息卡片

`TerminalAgentPanel` 命令卡显示 `exit 0` chip（对齐 ToolStatusChip 视觉）。

### T2 接管/交还驾驶协议（take the wheel）（P0 核心）

飞行状态机从 `running → finished` 扩展为四态：`running → handed_off ⇄ resumed → finished`（Claudette 三态 + Warp Takeover）：

#### T2.1 driver 状态

```typescript
interface TerminalAgentState {
  // ...existing fields...
  driverByTerminal: Map<string, 'user' | 'agent'>;  // 新增
  handedOffAt: Map<string, number>;                   // 新增：接管时间戳
}
```

- 飞行中用户键入（现有 `noteUserInput` 触发点复用）→ `driver = 'user'`
- 飞行置 `handed_off`：暂停 deadline 计时（不再 timed_out）、暂停 agent 等待循环
- 运维助手面板出现接管横幅：「你正在输入 — 完成后点「交还」让助手继续」
- 用户点「交还」→ agent 重读 ring（含用户输入段，标记 `user_interleaved`）→ `resumed`，继续等待完成/后续动作

#### T2.2 agent 卡住检测

命令已写入但超 `INTERACTIVE_DETECT_MS`（如 3s）无输出 → 面板提示「命令可能需要你介入 — 接管」（sudo 密码、交互确认场景；不阻止用户直接键入，提示仅信息性）。

#### T2.3 TUI 从"拒绝"改"启动即交还"

`vim/htop/passwd/ssh` 等不再拒绝——agent 可启动，但启动后立即 handed_off（控制权自动交用户）；agent 侧工具文档同步声明"交互程序启动后控制权交给用户，等待用户交还"。

#### T2.4 交还语义的底层信号

飞行结果新增状态 `handed_off_resumed`（sidecar `formatExecResult` 明确提示 agent"用户介入了命令执行"）。

### T3 输入仲裁与排队（P0 UI / P1 深度）

#### T3.1 exec 排队（P0）

单飞行锁保留，第二个 exec 请求不再立即报错——进入 per-terminal FIFO（带 30s 排队超时），前序结束后自动写入；sidecar 工具文档更新为"可能排队"。

```typescript
interface ExecQueue {
  pending: Array<{
    command: string;
    resolve: (result: ExecResult) => void;
    reject: (error: Error) => void;
    enqueuedAt: number;
  }>;
  timeout: 30_000; // 30s
}
```

#### T3.2 用户消息排队（P0 UI 层）

exec flight 期间用户在运维助手输入框提交消息 → 不直接发，本地暂存并提示「命令运行中 — 消息将在结束后发送」（Warp queued prompts 同款，带 `queued` 标记）；飞行结束自动投递。

#### T3.3 一个键盘原则（P1）

`driver` 状态同时门禁 agent 写入——`driver = 'user'` 期间 bridge 拒绝新写入（返回 `handed_off` 语义错误而非执行）。

### T4 安全与审批升级（P0 规则化 / P1 原子性）

#### T4.1 规则集替代黑名单

`DANGER_PATTERNS` 正则 → 模式规则三元组（allow / deny / ask），按 `permissionMode` 预置：

```toml
# hip.toml
[terminal]
permission_mode = "edit"  # chat | edit | full

[[terminal.approve_rules]]
pattern = "Bash(git status:*)"
action = "allow"

[[terminal.approve_rules]]
pattern = "Bash(rm -rf:*)"
action = "deny"

[[terminal.approve_rules]]
pattern = "Bash(git push --force:*)"
action = "ask"
```

- `chat`：写操作全部 ask
- `edit`：ask + 规则集
- `full`：ask 仅高危 + 用户自定义规则
- 高危清单（`git push --force`、`kill -9`、`chmod -R`、重定向截断 `> file`、fork bomb 形态）进 deny/ask 预置

#### T4.2 应用内确认卡

`window.confirm` → 复用 PermissionCard 视觉的 ConfirmCard：

```tsx
interface ConfirmCardProps {
  title: string;
  description: string;
  command: string;
  options: [
    { label: '本次允许'; action: 'allow_once'; variant: 'primary' },
    { label: '总是允许'; action: 'allow_always'; variant: 'outline' },
    { label: '总是拒绝'; action: 'deny_always'; variant: 'destructive' },
  ];
  onAction: (action: 'allow_once' | 'allow_always' | 'deny_always') => void;
}
```

#### T4.3 TOCTOU 修复（P1）

`sftp_write` 的 exists 探测与写入改为 Rust 侧原子操作（`create_new` 选项），或写入前 exists 结果并入审批内容一次呈现。

#### T4.4 审计回显

围栏内高危命令执行时，命令卡展示完整命令 + exit code + 时间（T1 已提供数据，此处仅展示层）。

### T5 ring 生命周期与上下文（P0 错误码 / P1 上下文）

#### T5.1 generation 绑定 cursor

`SessionPtyUi.generation`（已有字段）扩展到 ring reset 语义——SSH 重连/清屏时 generation+1，飞行 cursor 校验失败 → 新错误码 `ring_reset`。

```typescript
// 错误码体系细化
type ExecError = 
  | 'terminal_closed'      // 终端关闭
  | 'ring_reset'           // SSH 重连/清屏，ring 重建
  | 'handed_off_resumed'   // 用户介入，飞行恢复
  | 'aborted';             // 兼容旧代码

interface ExecResult {
  status: 'completed' | 'timed_out' | 'error';
  exitCode?: number;
  output: string;
  error?: ExecError;
  userInterleaved?: boolean;  // 新增：是否有用户输入
  commandBlocks?: CommandBlock[];  // 新增：命令块索引
}
```

#### T5.2 上下文注入（P1）

exec 结果附带 cwd（写入时 `pwd` 一次或 OSC 7）；会话上下文注入 host 名 / remotePath（兑现 spec §2 承诺）；长任务场景 agent 可主动 `terminal_read` 取命令块。

```typescript
interface TerminalContext {
  cwd: string;           // 当前工作目录
  host: string;          // 主机名
  remotePath?: string;   // SSH 远程路径
  user: string;          // 当前用户
  shell: string;         // shell 类型
  lastCommands: CommandBlock[];  // 最近命令历史
}
```

### T6 规划审批面板集成（P0 功能缺口）

#### T6.1 规划审批 UI

`TerminalAgentPanel` 用 `selectLivePlan`（`@/lib/todos`）计算当前会话的 `LivePlanView`，非空时在权限卡上方渲染 `<PlanProgressPanel>`（复用 chat 组件，自带 awaiting 审批的 approve / amend / reject 按钮与进度条）。

#### T6.2 规划审批期间禁用输入

`planApprovalPending` 期间禁用 `CompactComposer`（`disabled` 并入该条件），对齐 chat 的 `sessionActionBlocked` 门禁。

#### T6.3 规划审批回调

与 chat 一致：`onApprove → respondPlan('approve')`、`onReject → respondPlan('reject')`、`onAmend → respondPlan('amend', content)`。

### T7 输入框 IME 守卫修复（P0 功能 bug）

#### T7.1 IME 守卫

`CompactComposer` 的 textarea `onKeyDown` 增加 `isComposing` / `Process` 判断：

```tsx
const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
  // IME 守卫：中文/日文输入法回车确认组词时误发送
  if (e.nativeEvent.isComposing || e.key === 'Process') {
    return;
  }
  
  // ...existing logic...
};
```

### T8 命令卡 exit code 显示（P0 视觉对齐）

#### T8.1 exit code chip

`TerminalAgentPanel` 命令卡显示 exit code chip（对齐 ToolStatusChip 视觉）：

```tsx
interface CommandCardProps {
  command: string;
  exitCode?: number;
  status: 'completed' | 'timed_out' | 'error';
  userInterleaved?: boolean;
}

const CommandCard: React.FC<CommandCardProps> = ({ command, exitCode, status, userInterleaved }) => (
  <div className="command-card">
    <code>{command}</code>
    {exitCode !== undefined && (
      <span className={`exit-code-chip ${exitCode === 0 ? 'success' : 'error'}`}>
        exit {exitCode}
      </span>
    )}
    {userInterleaved && (
      <span className="user-interleaved-badge">用户介入</span>
    )}
  </div>
);
```

### T9 完成判定集成测试（P0）

#### T9.1 真实 shell 夹具

新增 node-pty + 真实 bash/zsh 集成夹具（vitest，非 paid LLM）：

- 真实 prompt（含 p10k 风格自定义 PS1）下验证：
  - 围栏命中 → completed+exitCode
  - 无围栏 → prompt 兜底
  - 长输出裁剪 → 不误判
  - `echo $?` 类输出结尾 `$` → 不误判

#### T9.2 四态飞行测试

- running → handed_off（用户键入触发）
- handed_off → resumed（用户点交还）
- resumed → finished（命令完成）
- 异常路径：handed_off 超时自动转 handed_off_resumed

#### T9.3 排队测试

- exec 排队：前序完成 → 后续自动执行
- 用户消息排队：飞行结束 → 暂存消息自动投递
- 排队超时：30s 无响应 → 自动取消

---

## 4. 交互序列

### 4.1 agent 执行命令（围栏路径，P0 主路径）

```
agent: terminal_exec("df -h", reason)
→ sidecar 审批：规则集命中 ask → PermissionCard（含 reason）
→ 用户批准 → bridge 写入围栏命令（OSC 633 marker 不渲染，用户仅见 df -h 及输出）
→ xterm 输出 → fence exitCode 命中（或 prompt 兜底）
→ exec 结果 { status: completed, exitCode: 0, output: [df -h 块] }
→ 运维助手命令卡：`df -h` + exit 0 chip（折叠态一行）
```

### 4.2 用户中途接管（P0 主路径）

```
agent 命令运行中（如 sudo apt install 等待密码）
→ 用户直接在共享终端键入密码
→ driver='user'，飞行置 handed_off（deadline 暂停）
→ 面板横幅「你正在输入 — 完成后点「交还」」
→ 用户点「交还」→ agent 重读 ring → resumed → 命令完成 → 结果标记 user_interleaved
```

### 4.3 长命令 + 用户消息排队（P0）

```
agent: terminal_exec("npm run build", wait_ms=120000)
→ 飞行中用户提交「顺便把 CHANGELOG 更新了」
→ 消息暂存（queued 标记，输入框提示「命令运行中 — 消息将在结束后发送」）
→ build 完成（exit 0）→ 暂存消息自动投递 → agent 继续
```

### 4.4 重连（P0 错误码）

```
SSH 断线 → 重连成功 → ring generation+1
→ 飞行 cursor 失效 → 结果 { status: 'error', error: 'ring_reset: terminal reconnected' }
→ agent 收到后 terminal_read 重读 → 继续
```

### 4.5 规划审批（P0 功能缺口）

```
agent: terminal_exec("complex-task", reason)
→ agent 生成执行计划（多个步骤）
→ 规划审批面板出现（PlanProgressPanel）
→ 用户审批（approve / amend / reject）
→ approve → agent 按计划执行
→ amend → agent 修改计划后重新提交
→ reject → agent 取消计划
```

### 4.6 TUI 启动即交还（P0）

```
agent: terminal_exec("vim file.txt", reason)
→ sidecar 检测到 TUI 命令
→ 立即 handed_off（控制权交用户）
→ 面板横幅「vim 已启动 — 完成后点「交还」让助手继续」
→ 用户操作 vim
→ 用户点「交还」→ agent 继续
```

---

## 5. 验收清单

| # | 验收点 | 关联 |
|---|---|---|
| 1 | 围栏默认开启：agent 命令执行后用户终端看不到 marker 文本；结果含 exitCode（`df -h` → exit 0） | T1 |
| 2 | 无围栏兼容：老 wrapEc 结果仍可解析；marker 被 strip 时 prompt-tail 兜底仍能完成（真实 bash 夹具覆盖） | T1/T9 |
| 3 | 命令块切分：exec 结果不含用户输入段；terminal_read 按块返回 | T1 |
| 4 | 用户键入 → handed_off：deadline 不再触发 timed_out；横幅出现；交还后 agent 恢复并标记 user_interleaved | T2 |
| 5 | `vim` 等 TUI 不再拒绝：agent 可启动，启动后自动 handed_off 交还用户 | T2 |
| 6 | 第二个 exec 请求进入队列（30s 超时），前序完成后自动执行，不再报错拒绝 | T3 |
| 7 | 飞行中用户消息显示 queued 标记，结束后自动投递 | T3 |
| 8 | 危险命令确认卡：三按钮（本次/总是允许/总是拒绝）；「总是」写入 hip.toml 规则，重启后生效 | T4 |
| 9 | 重连 → 飞行返回 `ring_reset` 错误码（非笼统 aborted） | T5 |
| 10 | 新增 node-pty 真实 shell 夹具测试绿；既有 terminal 测试全绿 | T9 |
| 11 | 运维助手命令卡显示 exit code chip（对齐 ToolStatusChip 视觉） | T8 |
| 12 | 规划审批面板：planApprovalPending 时出现 PlanProgressPanel；approve/amend/reject 功能正常 | T6 |
| 13 | IME 守卫：中文/日文输入法回车确认组词时不误发送 | T7 |
| 14 | 用户消息排队：飞行中提交的消息显示 queued 标记，结束后自动投递 | T3 |
| 15 | 接管横幅：用户键入时出现横幅，点交还后 agent 恢复 | T2 |
| 16 | 规则持久化：hip.toml 中的规则重启后仍生效 | T4 |

---

## 6. 非目标

- 不引入 sidecar 直连 PTY 的第二通道（沿用 D4：执行权始终在桌面壳 + 用户可见通道）；
- 不做 OpenHands 式独立沙箱容器（远程不可行，D4 已否决）；
- 不做 agent 主动操作交互程序内部（Full Terminal Use 完整模式）——P1 评估，本版仅"启动即交还"；
- 不改主 Chat/Code 的 `run_script` 本机执行语义；
- 不做跨多终端并行飞行（仍 per-terminal 单飞行 + 队列）；
- 不改 ring 存储结构（块索引为派生数据，不迁移历史数据）；
- 不做 GPU 加速渲染（属于终端能力现代化升级范畴，见 `terminal-capability-upgrade-spec.md`）；
- 不做多媒体能力（图片预览等，属于终端能力现代化升级范畴）。

---

## 7. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| OSC 633 序列被远端 shell/中间层 strip 或转义 | 中 | 无 marker 时自动回退 prompt-tail 兜底（T1 降级路径）；真实 bash 夹具覆盖 |
| marker 解析引入 xterm 渲染性能开销 | 低 | 解析仅针对 633 序列，与现 title 序列同机制；无正则回溯 |
| handed_off 期间用户长时间不交还，飞行悬挂 | 中 | 悬挂超时（如 10 分钟）自动转 `handed_off_resumed` 结束；横幅常驻直到交还 |
| 排队消息与 agent 结束时序竞态（飞行结束瞬间用户发送） | 低 | 排队判定与投递在同一 store action 内原子完成 |
| 规则集迁移影响既有权限模式行为（chat/edit/full） | 中 | 预置规则与现 permissionMode 行为映射表先行对齐（full 模式仍保留 ask 高危）；回归测试覆盖三模式 |
| 用户输入判定误触发 handed_off（粘贴/误触） | 中 | handed_off 可一键「撤销接管」回到 agent 驾驶；横幅提供恢复按钮 |
| 规划审批面板与主会话状态同步延迟 | 低 | 复用 chat 的 `selectLivePlan`，保证状态一致性 |
| IME 守卫影响非 CJK 输入法（如某些特殊输入法） | 低 | 仅拦截 `isComposing` 和 `key === 'Process'`，不影响正常输入 |

---

## 8. 交付物

### 核心模块

- [ ] `terminalAgentBridge.ts`：围栏写入 + `extractFenceExitCode` + 命令块索引 + 四态飞行（handed_off/resumed）+ 新错误码
- [ ] `XtermSurface.tsx`：OSC 633 渲染层吞除（含 marker 不显示的 xterm.js 序列 handler）
- [ ] `terminal.ts`（sidecar）：围栏默认开启、队列语义、`handed_off_resumed`/`ring_reset` 结果文案、TUI 文档更新（启动即交还）
- [ ] `terminalAgentStore.ts`：`driverByTerminal` + 排队队列 + 悬挂超时

### UI 组件

- [ ] `TerminalAgentPanel.tsx`：接管横幅、交还按钮、queued 消息标记、exit code chip、规划审批面板集成
- [ ] `CompactComposer.tsx`：IME 守卫修复
- [ ] `CommandCard.tsx`：命令卡组件（exit code chip + 用户介入标记）
- [ ] `ConfirmCard.tsx`：应用内确认卡（三按钮：本次允许/总是允许/总是拒绝）

### 配置与持久化

- [ ] `permission-manager.ts`：allow/deny/ask 规则集
- [ ] `hipConfigStore.ts`：hip.toml 规则持久化
- [ ] `terminalStore.ts`：generation 绑定 ring reset；`sftp` TOCTOU 原子化（Rust）

### 测试

- [ ] node-pty 真实 shell 夹具（T9）
- [ ] bridge 四态用例
- [ ] 排队用例
- [ ] 规则集映射用例
- [ ] IME 守卫测试

### 文档

- [ ] i18n 五语言 keys（接管横幅/排队/确认卡三按钮等，`translation-keys.test.ts` 门禁）
- [ ] e2e：`terminal.spec.ts` 围栏执行 → 命令卡 exit chip 断言；接管横幅 → 交还 → 结果标记断言
- [ ] agent 工具文档更新（围栏、排队、错误码、TUI 启动即交还）

---

## 9. 实施路线图

### P0 阶段（核心功能，2 周）

1. **T1 命令围栏**：默认开启围栏 + 完成判定两级信号 + 命令块切分
2. **T2 接管/交还协议**：driver 状态 + 横幅 + 交还按钮
3. **T3 排队机制**：exec 排队 + 用户消息排队
4. **T4 安全升级**：规则集替代黑名单 + 应用内确认卡
5. **T5 错误码**：generation 绑定 cursor + 错误码细化
6. **T6 规划审批**：PlanProgressPanel 集成
7. **T7 IME 守卫**：输入框修复
8. **T8 exit code chip**：命令卡视觉对齐

### P1 阶段（增强功能，1 周）

1. **T3.3 一个键盘原则**：driver 状态门禁 agent 写入
2. **T4.3 TOCTOU 修复**：sftp_write 原子操作
3. **T5.2 上下文注入**：cwd、host、命令历史

### P2 阶段（测试与文档，1 周）

1. **T9 集成测试**：node-pty 夹具 + 四态测试 + 排队测试
2. **文档更新**：i18n + e2e + agent 工具文档

---

## 10. 成功指标

| 指标 | 目标 | 测量方式 |
|---|---|---|
| 命令完成判定准确率 | > 99%（围栏路径） | 测试覆盖 + 真实使用监控 |
| 用户接管成功率 | > 95%（用户能成功交还） | e2e 测试 + 用户反馈 |
| 排队消息丢失率 | 0% | 测试覆盖 |
| 规则持久化成功率 | 100% | 测试覆盖 |
| IME 误发送率 | 0% | 测试覆盖 |
| 性能影响 | < 5% 帧率下降 | 性能测试 |

---

## 11. 附录

### A. 术语表

| 术语 | 定义 |
|---|---|
| 围栏（fence） | OSC 633 序列包裹的命令，用于标记命令边界和退出码 |
| 驾驶状态（driver） | 当前谁控制终端：`user` 或 `agent` |
| handed_off | 飞行状态：用户已接管，agent 暂停等待 |
| resumed | 飞行状态：用户交还，agent 恢复 |
| queued | 用户消息状态：已暂存，等待飞行结束自动投递 |
| 命令块（command block） | 围栏内的命令+输出+退出码，作为结构化单元 |

### B. 参考资料

1. VS Code Shell Integration: https://code.visualstudio.com/docs/terminal/shell-integration
2. Warp Full Terminal Use: https://docs.warp.dev/agents/capabilities/full-terminal-use/
3. Claudette Shell Handoff: https://github.com/Olorin-ai-git/claudette/blob/main/docs/claudette-shell-handoff-ux.md
4. SkyDeck Pods: https://docs.skydeck.ai/use-cases/operate-an-agent-together/
5. Claude Code 权限模型: https://docs.anthropic.com/claude-code/permissions
6. OpenAI Codex Agent Approvals: https://developers.openai.com/codex/agent-approvals-security
7. Microsoft Agent Host Protocol: https://microsoft.github.io/agent-host-protocol/specification/terminal-channel.html