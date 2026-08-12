# 终端管理 · 运维助手 共享终端能力整改 Spec

- 系列：`docs/design/terminal-shared-pty/`
- 配套：`docs/design/terminal-shared-pty/terminal-shared-pty-preview.html`（问题对照 + 共享终端协同交互原型，浏览器直接打开）
- 状态：待评审
- 日期：2026-08-12
- 前置基线：`.temp/design-archive-2026-08-02/terminal-agent-panel-spec.md`（共享 PTY 决策 D1–D7，本版沿用 D4 共享当前 PTY、不改写通道架构）；`docs/design/terminal-agent-parity/terminal-agent-parity-plan.md`（运维助手视觉对齐，已完成）；`docs/design/doc-terminal-capability-gap/terminal-capability-gap-spec.md`（终端能力补齐，P0 已完成）
- 涉及模块：`src/domain/terminalAgentBridge.ts`（exec 状态机/完成判定）、`packages/sidecar/src/session/tools/terminal.ts`（terminal_exec/terminal_read/sftp 工具）、`src/store/terminalStore.ts`（ring/trimOffset/userInterleaved）、`src/store/terminalAgentStore.ts`（单飞行锁）、`src/components/terminals/TerminalAgentPanel.tsx`（运维助手）、`src/components/artifact/XtermSurface.tsx`（onData/OSC 解析/用户输入标记）、`src/ipc/ssh.ts` + `src-tauri`（ssh_write 通道）、`packages/sidecar/src/session/permission-manager.ts`（审批）

---

## 1. 根因：共享终端协同的四个结构性缺口

现状架构（D4 决策）：sidecar 从不直写 PTY——agent 工具发 bridge 请求，UI 进程 `terminalAgentBridge` 把命令写入**用户可见的共享 xterm**，轮询 ring 回收输出回传。方向与行业一致（Warp Full Terminal Use / tmux 共享会话同构），但三个关键机制落后：**完成判定靠正则猜 prompt、无接管/交还驾驶协议、无输入仲裁与排队**，外加安全模型粗糙。

### 1.1 根因 A：完成判定是正则启发式，不是命令边界信号

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| A1 | 命令是否结束靠"最后一行像 prompt"猜测：`[$#%>]\s*$`。自定义 PS1（p10k/starship 图标结尾）、输出恰好以 `$` 结尾（`echo $?`）、输出被 ring 裁剪后看不到 prompt → 漏判/误判 | `terminalAgentBridge.ts` `hasPromptTail()` | 无 shell 集成层。行业标准（VS Code OSC 633、Warp CommandFinished hook）都是 **hook 驱动的命令边界标记**，退出码随标记携带 |
| A2 | 退出码默认拿不到：`wrapEc` 是 **opt-in**，且会往用户可见命令后追加 `printf` 围栏文本，污染共享终端观感 → 多数命令 agent 不知道成败 | `wrapForEc()` + `terminal.ts` `wrapEc?: boolean` | 围栏未默认开启、未做"用户无感"处理 |
| A3 | 500ms 静默 + deadline 双启发式：网络慢/命令等锁时误判完成；`watch` 类长驻命令永不提示 → 只能 `timed_out + mayStillRun` | `EXEC_SILENCE_MS=500`、`EXEC_POLL_MS=150` | 没有"该命令还在前台"的权威信号，只能猜 |
| A4 | exec 回传输出**含命令回显与用户自己的输入**，无命令块切分，token 浪费且结果易混淆 | `getRingSince(startCursor)` 整段截取 | ring 是文本流，没有命令边界索引 |

### 1.2 根因 B：无"接管/交还"驾驶协议——用户被锁死在 timed_out

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| B1 | agent 触发 `sudo` 密码、交互确认（`git rebase`、包管理器询问）时无协作路径：只能等到 deadline 判 `timed_out + mayStillRun`，用户干完活 agent 也不知道何时恢复 | `runExec()` deadline 分支 | 飞行状态机只有 `running → finished`，没有 `handed_off → resumed`。Claudette / Warp / Codex 社区（#13444）均为显式"接管→交还"协议 |
| B2 | 交互式 TUI 直接**拒绝**（vim/nvim/top/htop/passwd/ssh 黑名单），agent 无法在交互程序内协作 | `TUI_PATTERNS` + `isInteractiveTuiCommand()` | 与 Warp Full Terminal Use（agent 进入 psql/vim/gdb 操作）相反。至少应支持"启动即交还" |
| B3 | 用户键入只有**事后标记** `user_interleaved`，飞行照常 deadline 推进——用户介入被当作噪声而非协作事件 | `XtermSurface.tsx` L463 `noteUserInput` → `consumeUserInterleaved` | 无"一个键盘"原则：Warp 是 Takeover 暂停 agent、SkyDeck 是 one-driver-at-a-time、Claudette 是三态驾驶机 |

### 1.3 根因 C：并发语义是"报错"而不是"排队"

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| C1 | 第二个 exec（同终端其他会话）直接失败："another command is already running" | `execFlightByTerminal` 判重 | 单飞行锁无队列。Warp 的做法是用户 prompt 排队，命令结束后自动投递 |
| C2 | agent 跑长命令期间用户发新消息 → 与飞行并行，agent 读到过期状态 | 无任何门禁 | 同 C1：缺"运行中入队"语义 |

### 1.4 根因 D：安全模型是正则黑名单 + 原生弹窗

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| D1 | 危险命令靠正则黑名单：漏 `git push --force`、`kill -9`、`chmod -R 777`、fork bomb、`> file` 重定向 | `DANGER_PATTERNS` | 黑名单天然不完整。Claude Code 是 allow/deny/ask **模式规则**（`Bash(git status:*)`） |
| D2 | 二次确认用 `window.confirm`：原生阻塞弹窗、与应用 UI 割裂、不可测试、**无"记住选择"** | `runExec()` / `runWrite()` | 未接入应用内确认组件 + 规则持久化 |
| D3 | `sftp_write` 覆盖检测是"先 read 探测再写"，存在 TOCTOU 窗口 | `runWrite()` `sftpReadFile(path, 1)` 探测 | exists 检查与写入非原子 |
| D4 | 只有审批层、无能力层 | sidecar `requestApproval` 单一通道 | Codex 是 sandbox（OS 级能力限制）+ approval policy（策略）分离；远程无法 OS 沙箱，至少应统一为规则集 |

### 1.5 根因 E：ring 生命周期与上下文

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| E1 | SSH 重连后 ring 重建、cursor 失效，飞行中直接 `aborted`，agent 无感知自愈路径 | `terminalStore` trimOffset/reset、`runExec` 无 generation 校验 | cursor 未绑定会话 generation（pty 侧已有 `generation` 字段，未用于 ring cursor） |
| E2 | agent 上下文只有"最近终端输出"，无 cwd、无 host 元数据、无结构化命令记录 | spec §2 承诺 host 元数据未落地 | 上下文注入未按承诺实现 |

---

## 2. 基线：行业最佳实践（调研结论）

| 方案 | 关键机制 | 对照 hip 的启示 |
|---|---|---|
| **Warp Full Terminal Use**（[docs.warp.dev](https://docs.warp.dev/agents/capabilities/full-terminal-use/)） | agent 附加活动 PTY；**Takeover 控制**（一键停 agent、用户同会话打字、再点恢复）；长命令期间用户 prompt **排队**；完成靠 shell hook `CommandFinished`/`Precmd` 双信号冗余（[warp#12853](https://github.com/warpdotdev/warp/pull/12853)） | B1/B3/C2 的直接答案：驾驶状态机 + 排队 + hook 完成信号 |
| **VS Code Shell Integration / OSC 633**（[code.visualstudio.com](https://code.visualstudio.com/docs/terminal/shell-integration)） | `OSC 633 ; A/B/C/D/E` 标记 prompt 开始/结束、pre-exec、**execution finished + exit code**；xterm 渲染层吞 marker 用户无感 | A1/A2 的事实标准：命令边界 + 退出码不可见标记 |
| **Claudette shell handoff**（[Olorin-ai-git/claudette](https://github.com/Olorin-ai-git/claudette/blob/main/docs/claudette-shell-handoff-ux.md)） | 三态驾驶机 `agent driving / human driving / handing back`；agent 卡住时横幅 "take the wheel?"；交还时重读 shell 状态 + 用户附注 | B1 的完整状态机模板 |
| **SkyDeck Pods**（[docs.skydeck.ai](https://docs.skydeck.ai/use-cases/operate-an-agent-together/)） | **one driver at a time**：同一时刻一个键盘，request-control 交接，read-only 观察者 | B3 的并发纪律 |
| **tmuxb / tmux control mode**（[Ramblurr/tmux-buddy](https://github.com/Ramblurr/tmux-buddy)、[tmux wiki](https://github.com/tmux/tmux/wiki/Control-Mode)） | `send-keys`/`capture-pane`/`%output`；铁律"**send 前必 capture**"、验证状态迁移、长序列拆检查点 | 命令写入前的状态确认纪律（E 组） |
| **Claude Code 权限模型** | Bash 工具 allow/deny/ask 模式规则（`Bash(git status:*)`），规则持久化 | D1/D2 的规则化审批模板 |
| **OpenAI Codex**（[developers.openai.com](https://developers.openai.com/codex/agent-approvals-security)、[issue #13444](https://github.com/openai/codex/issues/13444)） | sandbox（能力层：Landlock/Seatbelt）+ approval policy（策略层）分离；社区高赞诉求"take over 输密码后回到 agent 流程" | D4 的分层思想 + B1 的社区验证 |
| **Microsoft Agent Host Protocol**（[terminal channel spec](https://microsoft.github.io/agent-host-protocol/specification/terminal-channel.html)） | 终端为一等资源：catalogue + 订阅 + **claim 所有权**（client vs session） | "谁拥有键盘"是协议级概念（对应 T2 的 driver 状态） |

反模式对照：**OpenHands** 把 agent 放进独立 Docker 沙箱（EventStream Action→Observation），与用户终端彻底隔离——安全但不可见。hip D4 选择共享可见性，方向正确；借鉴其"隔离能力层"思想即可。

---

## 3. 改进项

### T1 命令围栏（command fence）——完成判定革命（P0 核心）

把"猜 prompt"换成"命令边界信号"，渐进实现（SSH 远端无法预装 shell hook，用**写入时包裹**替代）：

1. **默认开启围栏**（替代 opt-in `wrapEc`，保留旧解析兼容）：

   ```
   printf '\x1b]633;A\x1b\\'          # 命令开始（OSC 633 语义，VS Code 同款）
   <command>
   printf '\x1b]633;D;%s\x1b\\' "$?"  # 执行结束 + 退出码
   ```

   - 与 `wrapEc` 的差异：marker 是 **OSC 序列**而非可见文本。`XtermSurface` 增加 OSC 633 解析（xterm.js custom escape sequence handler），**渲染层吞掉 marker 不显示**——用户看到的终端只是命令 + 输出（VS Code 同款体验）；ring 保留 OSC 原文供 bridge 解析。
   - 失败降级：远端 shell 不兼容/被 strip → 无 marker 时回退 `hasPromptTail` + 静默兜底（现状逻辑保留为 fallback）。
2. **完成判定两级信号**：`extractFenceExitCode(output)` 命中即 `completed + exitCode`（不再等 prompt）；未命中才走 prompt-tail 兜底。
3. **命令块切分**：ring 侧按 fence marker 建立命令块索引（`fenceByCursor`：起点 cursor → { command, exitCode, endCursor }）；`terminal_read` / exec 结果按块返回，**不再混入用户自己的输入输出**（用户输入在块外仍可见，但不再进 agent 上下文）。
4. 退出码进入工具结果与消息卡片（`TerminalAgentPanel` 命令卡显示 `exit 0` chip，对齐 ToolStatusChip）。

### T2 接管/交还驾驶协议（take the wheel）（P0 核心）

飞行状态机从 `running → finished` 扩展为四态：`running → handed_off ⇄ resumed → finished`（Claudette 三态 + Warp Takeover）：

1. **driver 状态**（`terminalAgentStore` 新增 `driverByTerminal: 'user' | 'agent'`）：
   - 飞行中用户键入（现有 `noteUserInput` 触发点复用）→ `driver = 'user'`，飞行置 `handed_off`：**暂停 deadline 计时**（不再 timed_out）、暂停 agent 等待循环；
   - 运维助手面板出现**接管横幅**：「你正在输入 — 完成后点「交还」让助手继续」；
   - 用户点「交还」→ agent 重读 ring（含用户输入段，标记 `user_interleaved`）→ `resumed`，继续等待完成/后续动作。
2. **agent 卡住检测**：命令已写入但超 `INTERACTIVE_DETECT_MS`（如 3s）无输出 → 面板提示「命令可能需要你介入 — 接管」（sudo 密码、交互确认场景；不阻止用户直接键入，提示仅信息性）。
3. **TUI 从"拒绝"改"启动即交还"**：`vim/htop/passwd/ssh` 等不再拒绝——agent 可启动，但启动后**立即 handed_off**（控制权自动交用户）；agent 侧工具文档同步声明"交互程序启动后控制权交给用户，等待用户交还"。Full Terminal Use（agent 主动操作交互程序内部）列为 P1 增强。
4. 交还语义的底层信号：飞行结果新增状态 `handed_off_resumed`（sidecar `formatExecResult` 明确提示 agent"用户介入了命令执行"）。

### T3 输入仲裁与排队（P0 UI / P1 深度）

1. **exec 排队**（P0）：单飞行锁保留，第二个 exec 请求不再立即报错——进入 per-terminal FIFO（带 30s 排队超时），前序结束后自动写入；sidecar 工具文档更新为"可能排队"。
2. **用户消息排队**（P0 UI 层）：exec flight 期间用户在运维助手输入框提交消息 → 不直接发，本地暂存并提示「命令运行中 — 消息将在结束后发送」（Warp queued prompts 同款，带 `queued` 标记）；飞行结束自动投递。P1 深度版：排队期支持取消。
3. **一个键盘原则**（P1）：`driver` 状态同时门禁 agent 写入——`driver = 'user'` 期间 bridge 拒绝新写入（返回 `handed_off` 语义错误而非执行）。

### T4 安全与审批升级（P0 规则化 / P1 原子性）

1. **规则集替代黑名单**：`DANGER_PATTERNS` 正则 → 模式规则三元组（allow / deny / ask），按 `permissionMode` 预置：
   - `chat`：写操作全部 ask；`edit`：ask + 规则集；`full`：ask 仅高危 + 用户自定义规则；
   - 规则形如 `Bash(rm -rf:*)`（Claude Code 式），持久化于 `hip.toml`（`[terminal] approve_rules` / `deny_rules`）；高危清单（`git push --force`、`kill -9`、`chmod -R`、重定向截断 `> file`、fork bomb 形态）进 deny/ask 预置。
2. **应用内确认卡**：`window.confirm` → 复用 PermissionCard 视觉的 ConfirmCard（含「本次允许 / 总是允许 / 总是拒绝」三按钮；「总是」写入规则集）。`sftp_write` 覆盖确认同卡。
3. **TOCTOU 修复**（P1）：`sftp_write` 的 exists 探测与写入改为 Rust 侧原子操作（`create_new` 选项），或写入前 exists 结果并入审批内容一次呈现。
4. **审计回显**：围栏内高危命令执行时，命令卡展示完整命令 + exit code + 时间（T1 已提供数据，此处仅展示层）。

### T5 ring 生命周期与上下文（P0 错误码 / P1 上下文）

1. **generation 绑定 cursor**：`SessionPtyUi.generation`（已有字段）扩展到 ring reset 语义——SSH 重连/清屏时 generation+1，飞行 cursor 校验失败 → 新错误码 `ring_reset`（agent 工具文档：收到后应重新 `terminal_read` 再决定）；错误码体系细化：`terminal_closed` / `ring_reset` / `handed_off_resumed` 替代笼统 `aborted`。
2. **上下文注入**（P1）：exec 结果附带 cwd（写入时 `pwd` 一次或 OSC 7）；会话上下文注入 host 名 / remotePath（兑现 spec §2 承诺）；长任务场景 agent 可主动 `terminal_read` 取命令块。

### T6 完成判定集成测试（P0）

- `hasPromptTail` / `extractFenceExitCode` 现有白盒测试保留；
- 新增 **node-pty + 真实 bash/zsh** 集成夹具（vitest，非 paid LLM）：真实 prompt（含 p10k 风格自定义 PS1）下验证：围栏命中 → completed+exitCode；无围栏 → prompt 兜底；长输出裁剪 → 不误判；`echo $?` 类输出结尾 `$` → 不误判。

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

---

## 5. 验收清单

| # | 验收点 | 关联 |
|---|---|---|
| 1 | 围栏默认开启：agent 命令执行后用户终端**看不到** marker 文本；结果含 exitCode（`df -h` → exit 0） | T1 |
| 2 | 无围栏兼容：老 wrapEc 结果仍可解析；marker 被 strip 时 prompt-tail 兜底仍能完成（真实 bash 夹具覆盖） | T1/T6 |
| 3 | 命令块切分：exec 结果不含用户输入段；terminal_read 按块返回 | T1 |
| 4 | 用户键入 → handed_off：deadline 不再触发 timed_out；横幅出现；交还后 agent 恢复并标记 user_interleaved | T2 |
| 5 | `vim` 等 TUI 不再拒绝：agent 可启动，启动后自动 handed_off 交还用户 | T2 |
| 6 | 第二个 exec 请求进入队列（30s 超时），前序完成后自动执行，不再报错拒绝 | T3 |
| 7 | 飞行中用户消息显示 queued 标记，结束后自动投递 | T3 |
| 8 | 危险命令确认卡：三按钮（本次/总是允许/总是拒绝）；「总是」写入 hip.toml 规则，重启后生效 | T4 |
| 9 | 重连 → 飞行返回 `ring_reset` 错误码（非笼统 aborted） | T5 |
| 10 | 新增 node-pty 真实 shell 夹具测试绿；既有 terminal 测试全绿 | T6 |
| 11 | 运维助手命令卡显示 exit code chip（对齐 ToolStatusChip 视觉） | T1/T4 |

## 6. 非目标

- 不引入 sidecar 直连 PTY 的第二通道（沿用 D4：执行权始终在桌面壳 + 用户可见通道）；
- 不做 OpenHands 式独立沙箱容器（远程不可行，D4 已否决）；
- 不做 agent 主动操作交互程序内部（Full Terminal Use 完整模式）——P1 评估，本版仅"启动即交还"；
- 不改主 Chat/Code 的 `run_script` 本机执行语义；
- 不做跨多终端并行飞行（仍 per-terminal 单飞行 + 队列）；
- 不改 ring 存储结构（块索引为派生数据，不迁移历史数据）。

## 7. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| OSC 633 序列被远端 shell/中间层 strip 或转义 | 中 | 无 marker 时自动回退 prompt-tail 兜底（T1 降级路径）；真实 bash 夹具覆盖 |
| marker 解析引入 xterm 渲染性能开销 | 低 | 解析仅针对 633 序列，与现 title 序列同机制；无正则回溯 |
| handed_off 期间用户长时间不交还，飞行悬挂 | 中 | 悬挂超时（如 10 分钟）自动转 `handed_off_resumed` 结束；横幅常驻直到交还 |
| 排队消息与 agent 结束时序竞态（飞行结束瞬间用户发送） | 低 | 排队判定与投递在同一 store action 内原子完成 |
| 规则集迁移影响既有权限模式行为（chat/edit/full） | 中 | 预置规则与现 permissionMode 行为映射表先行对齐（full 模式仍保留 ask 高危）；回归测试覆盖三模式 |
| 用户输入判定误触发 handed_off（粘贴/误触） | 中 | handed_off 可一键「撤销接管」回到 agent 驾驶；横幅提供恢复按钮 |

## 8. 交付物

- [ ] `terminalAgentBridge.ts`：围栏写入 + `extractFenceExitCode` + 命令块索引 + 四态飞行（handed_off/resumed）+ 新错误码
- [ ] `XtermSurface.tsx`：OSC 633 渲染层吞除（含 marker 不显示的 xterm.js 序列 handler）
- [ ] `terminal.ts`（sidecar）：围栏默认开启、队列语义、`handed_off_resumed`/`ring_reset` 结果文案、TUI 文档更新（启动即交还）
- [ ] `terminalAgentStore.ts`：`driverByTerminal` + 排队队列 + 悬挂超时
- [ ] `TerminalAgentPanel.tsx`：接管横幅、交还按钮、queued 消息标记、exit code chip、ConfirmCard（允许/总是允许/总是拒绝）
- [ ] `permission-manager.ts` + `hipConfigStore`：allow/deny/ask 规则集 + hip.toml 持久化
- [ ] `terminalStore.ts`：generation 绑定 ring reset；`sftp` TOCTOU 原子化（Rust）
- [ ] i18n 五语言 keys（接管横幅/排队/确认卡三按钮等，`translation-keys.test.ts` 门禁）
- [ ] 测试：node-pty 真实 shell 夹具（T6）；bridge 四态用例；排队用例；规则集映射用例
- [ ] e2e：`terminal.spec.ts` 围栏执行 → 命令卡 exit chip 断言；接管横幅 → 交还 → 结果标记断言
