# 运维助手全面改进 执行计划

- 系列：`docs/design/terminal-agent-comprehensive-improvement/`
- 配套：`terminal-agent-comprehensive-improvement-spec.md`（根因 A–F + 改进 T1–T9 + 验收 16 项）
- 状态：待评审
- 日期：2026-08-26
- 前置：
  - `terminal-shared-pty` 系列已落地（共享终端协同整改 P0–P1 已完成）
  - `terminal-agent-parity` 系列已落地（运维助手视觉对齐已完成）
  - `terminal-capability-upgrade` 待实施（终端能力现代化升级）
- 约束：
  - 本系列不改写通道架构（沿用 D4：sidecar 不直写 PTY，UI 桥写入共享 xterm）
  - `wrapEc` 保留向后兼容
  - TUI 黑名单保留但语义从「拒绝」改为「启动即交还」
  - P0 阶段聚焦核心功能，P1/P2 阶段逐步增强

---

## 1. 策略

### 1.1 核心原则

1. **完成判定革命先行**（PR-1）：围栏信号（OSC 633 语义）是 T2/T3 的状态基础——飞行状态机、handed_off、排队都建立在"知道命令何时结束"之上。先做围栏闭环（写入 → 渲染无感 → 解析 → exit chip），再做协作语义。

2. **测试夹具先行**（PR-0）：node-pty 真实 bash/zsh 夹具在围栏实现前验证设计假设（OSC 序列在 shell 输出中的形态、`$?` 捕获、strip 降级路径），避免启发式又一次"白盒自证"。

3. **XtermSurface 改动最小化**：xterm.js 对未注册 OSC 默认忽略（不渲染）——围栏 marker 理论上无需解析器改动即可"用户无感"；PR-1 第一件事实测确认，若回显则用 `parser.registerOscHandler(633, …)` 吞除（XtermSurface 已有 OSC 0/2 title 同机制）。

4. **P0 / P1 / P2 分层**：
   - P0 = 围栏 + 接管交还 + 排队 + 规则审批 + 错误码 + 规划审批 + IME 守卫 + exit code chip
   - P1 = TOCTOU 原子化、排队取消、滚动级上下文注入（cwd/host 元数据）、一个键盘原则
   - P2 = 测试与文档完善

5. **门禁**：每 PR `yarn tsc` + 指定文件 vitest + 全量回归（注意：`npx vitest run src` 子串会命中 `packages/sidecar/src` 付费 LLM 测试——按 CLAUDE.md 惯例跑前临时移走 `~/.hip/config/auth.json`）+ i18n `translation-keys.test.ts` + e2e 选择器同步。

### 1.2 风险缓解策略

| 风险 | 策略 |
|------|------|
| OSC 633 序列被 strip | PR-0 实测 + 降级路径（prompt-tail 兜底） |
| node-pty 编译失败 | 备选 `@homebridge/node-pty-prebuilt-multiarch` 或 Rust cargo test |
| handed_off 悬挂 | 超时自动收尾（10 分钟）+ 横幅常驻 |
| 规则集迁移影响既有行为 | 三模式映射表先行对齐 + 回归测试覆盖 |

---

## 2. 依赖图

```
PR-0 测试夹具（node-pty，验证围栏假设，可随时插队）
        │
PR-1 命令围栏（写入/无感渲染/解析/exit chip）──▶ PR-2 接管交还（四态飞行）
        │                                            │
        ├──────▶ PR-4 规则审批（∥：独立于桥状态机）    └──▶ PR-3 排队（exec FIFO + 消息暂存）
        │
        ├──────▶ PR-5 规划审批（∥：独立于桥状态机）
        │
        ├──────▶ PR-6 IME 守卫（∥：独立于桥状态机）
        │
        └──────▶ PR-7（P1）ring 生命周期 + 上下文注入
```

### 依赖关系说明

- **串行**：PR-1 → PR-2 → PR-3（handed_off 需要围栏的完成信号；排队需要飞行状态机）
- **并行**：
  - PR-0 可提前（验证设计假设）
  - PR-4 与 PR-2/PR-3 无共享文件（permission-manager/hipConfig vs bridge/store），可插队
  - PR-5 与 PR-2/PR-3 无共享文件（TerminalAgentPanel 规划审批部分独立），可插队
  - PR-6 与 PR-2/PR-3 无共享文件（CompactComposer 独立），可插队
  - PR-7 的 generation 绑定独立于 1–6，可与 PR-3 并行
- **文件冲突**：PR-1 与 PR-2 同改 `terminalAgentBridge.ts` → 必须串行

---

## 3. PR 明细

### PR-0 完成判定测试夹具（T9，0.5 天，可与任何 PR 并行）

**目标**：用真实 shell 验证围栏设计与降级路径，为 PR-1 提供判定标准。

#### 文件级任务

1. **新增 devDependency `node-pty`**
   - 原生模块；备选 `@homebridge/node-pty-prebuilt-multiarch` 免编译
   - **安装前确认**仓库是否已有 pty 依赖（Rust 侧 native-pty 不互通）
   - CI/本机编译失败时降级方案 B：Rust `cargo test` 集成夹具（spawn bash 跑围栏命令断言输出）

2. **新建 `src/domain/ptyFence.fixture.test.ts`**（vitest，`describe.skipIf` 无 node-pty 时跳过）
   - 真实 bash/zsh 下跑 `printf '\x1b]633;A\x1b\\'; <cmd>; printf '\x1b]633;D;%s\x1b\\' "$?"`：
     - 断言 marker 原样出现在输出流
     - 断言 `D` marker 携带真实退出码（成功/失败各一）
   - **降级路径**：无 marker 时 `hasPromptTail` 兜底行为
     - p10k 风格自定义 PS1（`PROMPT='%F{red}❯%f '` 之类图标结尾）下不误判
     - `echo $?` 输出以 `$` 结尾不误判（现有白盒测试 + 本夹具双保险）
   - 长输出（>2MiB 触发 ring 裁剪语义）下 fence 仍命中

3. **结论写入 PR-1 实现注释**
   - marker 形态、strip 场景、xterm.js 对 633 的默认行为
   - 本 PR 先验证渲染层：在 XtermSurface 用真实 xterm 跑一次 633 序列截图/断言不渲染

#### 验收

- spec §5 项 2/10（部分）

---

### PR-1 命令围栏（T1，2 天，P0 核心）

**目标**：完成判定从"猜 prompt"升级为"围栏信号"，退出码进工具结果与命令卡。

#### 文件级任务

1. **`packages/sidecar/src/session/tools/terminal.ts`**
   - `wrapForFence(command)`：`printf '\x1b]633;A\x1b\\'; <command>; printf '\x1b]633;D;%s\x1b\\' "$?"`——与 `wrapForEc` 同模式，但 marker 为 OSC 序列（渲染无感）
   - 保留 `wrapEc` 旧解析兼容；新增 `fence: boolean`（默认 true）；`fence: false` 时行为 = 现状（供降级）
   - 工具 description 更新：状态枚举增加 `handed_off_resumed` / `ring_reset`（文案 PR-2/PR-5 逐步启用，本 PR 先声明）；注明 `exit`/`exec` 结尾命令的已知语义边界（沿用 wrapEc 既有注释）

2. **`src/domain/terminalAgentBridge.ts`**
   - `extractFenceExitCode(output)`：匹配最后一个 `\x1b]633;D;<code>\x1b\\`（含旧 `__HIP_EC_EXIT` 兜底）；`hasPromptTail` 降级为"无 marker"时的 fallback
   - 完成判定顺序：fence D marker → （无 marker）prompt-tail + 静默兜底
   - **命令块切分（P0 务实版）**：按 `OSC-A … OSC-D` 建立 `fenceBlocks` 派生索引（起点 cursor → { command, exitCode }）；exec/terminal_read 结果默认按块边界裁剪——**块内用户输入段仍可能混入**（文本流无法可靠剔除），由 `user_interleaved` 标记兜底；完全净化用户输入列为 P1 跟随项（在 spec T1 标注）
   - 飞行 finish 时优先取 fence exitCode 进 `exitCode` 字段（现有字段复用）

3. **`src/components/artifact/XtermSurface.tsx`**
   - PR-0 实测结论落地——若 xterm.js 默认忽略 633 则零改动（仅测试固化）；若回显则 `parser.registerOscHandler(633, …)` 吞除（与现有 title 序列同机制）

4. **`src/components/terminals/TerminalAgentPanel.tsx`**
   - ToolCard 解析 `exitCode: N`（`formatExecResult` 已输出该行）→ 状态 chip 旁显示 `exit 0`/`exit 1`（复用 `tc-exit` 视觉，spec 命令卡协议）
   - i18n 五语言新增 `terminals.agent.exitCode` key

5. **单测**
   - `terminalAgentBridge.test.ts` 补 fence 解析用例（marker 命中/无 marker 兜底/旧 wrapEc 兼容/裁剪后命中）
   - ToolCard exit chip 用例

#### 验收

- spec §5 项 1/2/3/11

---

### PR-2 接管 / 交还（T2，1.5 天，P0）

**目标**：飞行状态机四态化；用户键入即接管、交还后恢复；TUI 改"启动即交还"。

#### 文件级任务

1. **`src/store/terminalAgentStore.ts`**
   - `driverByTerminal: Record<string, 'user' | 'agent'>`
   - 飞行扩展 `phase: 'running' | 'handed_off' | 'resumed'`
   - `resumeExecFlight(terminalId)` action（UI 交还按钮调用）
   - 悬挂超时常量 `HANDED_OFF_MAX_MS = 10min`

2. **`src/domain/terminalAgentBridge.ts` `runExec` 轮询循环**
   - 复用现有 `noteUserInput` 触发点：飞行中用户键入 → 置 `phase='handed_off'`、`driver='user'`、**暂停 deadline 计时**
   - 循环改为等待 `phase !== 'handed_off'`（轮询 store）或悬挂超时（→ 以 `handed_off_resumed` 状态收尾，spec §7）
   - 用户交还（`resumeExecFlight`）→ `phase='resumed'` → 重读 ring（含用户输入段）→ 继续等待 fence/兜底完成 → 结果 `status: completed + user_interleaved`（已有标记语义）
   - **TUI 启动即交还**：`isInteractiveTuiCommand` 命中不再拒绝——正常写入围栏命令，**写入后立即置 `phase='handed_off'`**（控制权自动交用户）；sidecar 工具文档同步声明该语义（"交互程序启动后键盘交给用户，用户交还后继续"）

3. **`src/components/terminals/TerminalAgentPanel.tsx`**
   - 订阅飞行 `phase`：`handed_off` 时渲染接管横幅（「你正在输入 — 完成后点「交还」让助手继续」，preview 场景③同款）+ 交还按钮
   - `running` 且无输出超阈值（bridge 侧发 UI 事件或复用 banner 触发）→ 信息性横幅「命令可能需要你介入」
   - 交还按钮 → `resumeExecFlight(tmId)`
   - 横幅「撤销接管」按钮（误触恢复，spec §7）

4. **sidecar `formatExecResult`**
   - `handed_off_resumed` 文案（"用户介入了命令执行，输出可能含用户输入"）

5. **单测**
   - bridge 四态用例（键入→handed_off→resume→completed+interleaved；悬挂超时→handed_off_resumed；TUI 命令启动即 handed_off）
   - TerminalAgentPanel 横幅/按钮用例

#### 验收

- spec §5 项 4/5

---

### PR-3 排队（T3，1 天，P0）

**目标**：并发从"报错拒绝"变"FIFO 排队"；用户消息飞行期间暂存、结束后自动投递。

#### 文件级任务

1. **`src/domain/terminalAgentBridge.ts`**
   - `runExec` 发现 `execFlightByTerminal[tmId]` 存在 → 不再立即回 error，入 `execQueueByTerminal[tmId]`（`terminalAgentStore` 新增，含 callId/sessionId/command/waitMs/wrapEc）
   - 30s 排队超时 → 回 `status: 'error', error: 'queued_timed_out'`
   - 飞行 finish 时从队列 shift 下一个自动执行（复用 runExec 主体，提取 `executeFlight(...)` 供首个与队列复用）

2. **`src/components/terminals/TerminalAgentPanel.tsx`**
   - composer 提交时若 `execFlightByTerminal[terminalId]` 非空 → 消息**本地暂存**（组件级队列）
   - 输入区显示「命令运行中 — 消息将在结束后发送」（preview 场景④同款，i18n key）
   - 列表里该消息带 `queued` 标记（发送后立即显示、标记 queued，投递时标记更新）
   - 订阅飞行结束（flight → null）→ 自动 `sessionService.sendMessage` 投递暂存队列（与飞行结束原子判定：订阅回调内检查 store 状态）
   - 队列消息与飞行结束竞态（用户恰在结束时发送）：以 store 快照判定为准，单测覆盖

3. **单测**
   - bridge 队列（第二个 exec 排队 → 首个完成后自动执行；超时拒绝）
   - TerminalAgentPanel 暂存/投递/竞态用例（fake store）

#### 验收

- spec §5 项 6/7

---

### PR-4 规则化审批（T4，1.5 天，P0 主体）

**目标**：黑名单正则 + window.confirm → allow/deny/ask 规则集 + 应用内确认卡 + 持久化；TOCTOU 留 P1。

#### 文件级任务

1. **`packages/sidecar/src/session/permission-manager.ts`**
   - `evaluateCommandRule(command, rules): 'allow' | 'ask' | 'deny'`——glob 模式匹配（`git push*`、`rm -rf /*`），**优先级 deny > ask > allow**（命中 deny 直接拒绝，不进 UI）
   - 预置规则集按 `permissionMode`：
     - `chat`：写操作全 ask
     - `edit`：预置规则 + ask 兜底
     - `full`：预置规则 + 高危 ask（映射表见 spec §3 T4 / preview 场景⑤）
   - 高危预置 ask 清单：`git push --force*`、`kill*`、`chmod -R*`、`> /dev/*` 截断、fork bomb 形态（`{...}` 递归）
   - 与现 `requestApproval` 链整合：规则命中 allow → 直跑；ask → 现审批卡；deny → 拒绝文案

2. **`src/components/terminals/TerminalAgentPanel.tsx`**
   - 危险命令确认从 `window.confirm`（bridge 内两处：exec 危险命令 / sftp 覆盖）迁移到应用内 ConfirmCard（复用 PermissionCard 视觉）
   - ConfirmCard 三按钮：「本次允许 / 总是允许 / 总是拒绝」（preview 场景⑤同款）
   - 「总是允许/拒绝」→ `hipConfigStore` 新字段 `[terminal] approve_rules / deny_rules`（追加写入 hip.toml，现有 config 持久化通道）
   - 「本次允许」仅飞行级放行

3. **bridge 的 `isDangerousCommand` 正则删除**
   - 改走 permissionManager 规则评估（错误路径返回规则说明）

4. **单测**
   - 规则匹配（优先级/glob/大小写）
   - 三模式预置映射
   - ConfirmCard 三按钮行为 + 规则写入 store
   - bridge 危险命令走规则（不再 window.confirm）

#### 验收

- spec §5 项 8（部分：P1 项仅记录）

---

### PR-5 规划审批面板（T6，1 天，P0）

**目标**：集成 PlanProgressPanel，解决规划审批功能缺口。

#### 文件级任务

1. **`src/components/terminals/TerminalAgentPanel.tsx`**
   - 用 `selectLivePlan`（`@/lib/todos`）计算当前会话的 `LivePlanView`
   - 非空时在权限卡上方渲染 `<PlanProgressPanel>`（复用 chat 组件，自带 awaiting 审批的 approve / amend / reject 按钮与进度条）
   - `planApprovalPending` 期间禁用 `CompactComposer`（`disabled` 并入该条件），对齐 chat 的 `sessionActionBlocked` 门禁
   - 与 chat 一致：`onApprove → respondPlan('approve')`、`onReject → respondPlan('reject')`、`onAmend → respondPlan('amend', content)`

2. **单测**
   - 会话置 `planApprovalPending` + `activeTurnPlan` → 出现 `plan-progress-panel`
   - 点 approve 调 `respondPlan('approve')`
   - pending 时 textarea `disabled`

#### 验收

- spec §5 项 12

---

### PR-6 IME 守卫修复（T7，0.5 天，P0）

**目标**：修复中文/日文输入法回车确认组词时误发送的问题。

#### 文件级任务

1. **`src/components/terminals/CompactComposer.tsx`**
   - textarea `onKeyDown` 增加 `isComposing` / `Process` 判断：
     ```tsx
     if (e.nativeEvent.isComposing || e.key === 'Process') {
       return;
     }
     ```

2. **单测**
   - `fireEvent.keyDown(input, { key: 'Enter', isComposing: true })` 不发送
   - 普通 Enter 照常发送

#### 验收

- spec §5 项 13

---

### PR-7（P1）ring 生命周期 + 错误码（T5 主体，1 天）

**目标**：generation 绑定 ring cursor；错误码细化；上下文注入（P1 冒烟）。

#### 文件级任务

1. **`src/store/terminalStore.ts`**
   - `generation`（已有字段）扩展——SSH 重连/ring 重建路径 `generation+1`（`managedTerminalStore` reconnect 处 bump）
   - `getRingSince` 结果携带 generation

2. **`src/domain/terminalAgentBridge.ts`**
   - 飞行启动记录 generation，轮询校验不匹配 → `finish('error', { error: 'ring_reset: terminal reconnected' })`
   - 断开 → `terminal_closed`（替代笼统 aborted 文案）
   - sidecar `formatExecResult` 对应文案 + 工具 description（"收到 ring_reset 后应 terminal_read 重读再决定"）

3. **P1 上下文冒烟（可选）**
   - exec 写入前取一次 `pwd`（或 OSC 7）随结果返回 `cwd`
   - 会话上下文注入 host 名/remotePath（spec §2 承诺兑现）
   - 本 PR 可选交付，不做则标注 P2

4. **单测**
   - generation 不匹配 → ring_reset
   - 断开 → terminal_closed
   - cursor 携带 generation 断言

#### 验收

- spec §5 项 9（错误码侧）

---

### PR-8（P1）一个键盘原则（T3.3，0.5 天）

**目标**：`driver` 状态同时门禁 agent 写入，确保同一时刻只有一个键盘。

#### 文件级任务

1. **`src/domain/terminalAgentBridge.ts`**
   - `driver = 'user'` 期间 bridge 拒绝新写入（返回 `handed_off` 语义错误而非执行）
   - 写入前检查 driver 状态，非 agent 时返回错误

2. **单测**
   - driver='user' 时写入被拒绝
   - driver='agent' 时写入正常

#### 验收

- spec §5 项 14（部分）

---

### PR-9（P1）TOCTOU 修复（T4.3，0.5 天）

**目标**：修复 `sftp_write` 的 exists 探测与写入之间的 TOCTOU 窗口。

#### 文件级任务

1. **`src-tauri/src/ssh_session.rs`**
   - `sftp_write` 的 exists 探测与写入改为 Rust 侧原子操作（`create_new` 选项）
   - 或写入前 exists 结果并入审批内容一次呈现

2. **单测**
   - 并发写入场景测试
   - 不存在文件写入成功
   - 已存在文件写入被拦截

#### 验收

- spec §5 项 8（TOCTOU 部分）

---

### PR-10（P2）测试与文档完善（1 天）

**目标**：完善测试覆盖和文档。

#### 文件级任务

1. **集成测试**
   - node-pty 真实 shell 夹具完善
   - bridge 四态用例完善
   - 排队用例完善
   - 规则集映射用例完善
   - IME 守卫测试完善

2. **e2e 测试**
   - `terminal.spec.ts` 围栏执行 → 命令卡 exit chip 断言
   - 接管横幅 → 交还 → 结果标记断言
   - 规划审批面板交互测试
   - 选择器随 PR 同步

3. **i18n**
   - 五语言 keys 完善（接管横幅/排队/确认卡三按钮等）
   - `translation-keys.test.ts` 门禁通过

4. **文档更新**
   - agent 工具文档更新（围栏、排队、错误码、TUI 启动即交还）
   - spec 条目更新（已完成项标记）

#### 验收

- spec §5 项 15/16

---

## 4. 里程碑

| 里程碑 | 内容 | 估算 | 依赖 |
|---|---|---|---|
| M0 | PR-0：node-pty 夹具 + xterm.js 633 渲染行为实测（围栏设计假设闭环） | 0.5 天 | 无 |
| M1 | PR-1：围栏闭环（默认开启、无感渲染、fence 完成判定、exit chip） | 2 天 | PR-0 |
| M2 | PR-2：接管/交还四态 + TUI 启动即交还 | 1.5 天 | PR-1 |
| M3 | PR-3：exec FIFO + 用户消息排队 | 1 天 | PR-2 |
| M4 | PR-4：规则化审批（规则集 + ConfirmCard + 持久化） | 1.5 天 | 无（可与 PR-2/3 并行） |
| M5 | PR-5：规划审批面板集成 | 1 天 | 无（可与 PR-2/3 并行） |
| M6 | PR-6：IME 守卫修复 | 0.5 天 | 无（可与 PR-2/3 并行） |
| M7（P1） | PR-7：generation 绑定 + 错误码细化（+ 上下文注入冒烟） | 1 天 | 无（可与 PR-3 并行） |
| M8（P1） | PR-8：一个键盘原则 | 0.5 天 | PR-2 |
| M9（P1） | PR-9：TOCTOU 修复 | 0.5 天 | 无 |
| M10（P2） | PR-10：测试与文档完善 | 1 天 | 所有 PR |

### 时间线估算

- **P0 阶段**（M0–M6）：6.5 人日
- **P1 阶段**（M7–M9）：2 人日
- **P2 阶段**（M10）：1 人日
- **总计**：9.5 人日

### 并行优化

若资源允许，可按以下并行策略缩短总工期：

```
Week 1:
  - 开发者 A: PR-0 → PR-1 → PR-2 → PR-3
  - 开发者 B: PR-4 → PR-5 → PR-6

Week 2:
  - 开发者 A: PR-7 → PR-8
  - 开发者 B: PR-9 → PR-10
```

**优化后总工期**：约 8 人日（2 人并行）

---

## 5. 回归门禁清单

### 5.1 通用门禁（每 PR 必须）

1. `yarn tsc --noEmit` 零错误
2. vitest：指定文件测试全绿 + 全量回归（跑前按 CLAUDE.md 临时移走 `~/.hip/config/auth.json` 防付费 LLM 测试）
3. i18n 五语言新 key 一致（`terminals.agent.*` / `terminal.confirm.*`，translation-keys 测试强制）

### 5.2 PR 专项门禁

| PR | 专项门禁 |
|---|---|
| PR-0 | node-pty 夹具绿（无 node-pty 环境 skip，本机必跑） |
| PR-1 | `terminalAgentBridge` / `TerminalAgentPanel` 相关测试全绿；与 preview 场景②人工对照 |
| PR-2 | bridge 四态用例全绿；TerminalAgentPanel 横幅/按钮用例全绿；与 preview 场景③人工对照 |
| PR-3 | bridge 队列用例全绿；TerminalAgentPanel 暂存/投递用例全绿；与 preview 场景④人工对照 |
| PR-4 | 规则匹配用例全绿；三模式预置映射用例全绿；ConfirmCard 用例全绿；与 preview 场景⑤人工对照 |
| PR-5 | PlanProgressPanel 集成用例全绿 |
| PR-6 | IME 守卫用例全绿 |
| PR-7 | generation 绑定用例全绿；错误码用例全绿 |
| PR-8 | 一个键盘原则用例全绿 |
| PR-9 | TOCTOU 修复用例全绿 |
| PR-10 | e2e 全绿；i18n 全绿；文档完整性检查 |

### 5.3 最终验收

1. `yarn test` 全量通过
2. `yarn tsc` 零错误
3. `yarn check:store-deps` 通过
4. e2e 全量通过
5. 与 `terminal-agent-comprehensive-improvement-preview.html` 全场景人工对照
6. spec §5 验收清单 16 项全部通过

---

## 6. 风险登记表

| 风险 | 等级 | 影响 | 缓解措施 | 责任人 | 状态 |
|---|---|---|---|---|---|
| OSC 633 序列被远端 shell/中间层 strip 或转义 | 中 | 围栏失效，降级为 prompt-tail 兜底 | PR-0 第一件事实测；回显则注册 parser handler 吞除 | - | 待验证 |
| xterm.js 对 OSC 633 默认行为与假设不符 | 中 | 可能需要额外渲染层改动 | PR-0 实测（真实 xterm 跑 633 序列） | - | 待验证 |
| node-pty 原生模块安装/编译失败 | 中 | 测试夹具无法运行 | 备选 `@homebridge/node-pty-prebuilt-multiarch`；再备选 Rust cargo test | - | 待验证 |
| handed_off 悬挂（用户长时间不交还） | 中 | 飞行状态卡死 | `HANDED_OFF_MAX_MS` 超时收尾为 `handed_off_resumed`；横幅常驻 + 撤销接管按钮 | - | 已缓解 |
| 排队消息与飞行结束竞态 | 低 | 消息可能丢失或重复 | 排队判定与投递在 store 订阅回调内原子完成；单测覆盖竞态窗口 | - | 已缓解 |
| PR-1/PR-2 同改 `terminalAgentBridge.ts` 冲突 | 低 | 代码冲突 | 强制串行（PR-2 基于 PR-1 提交） | - | 已缓解 |
| 规则集迁移改变 chat/edit/full 既有行为 | 中 | 用户体验变化 | 三模式映射表先行对齐（preview 场景⑤已固化为对照基准）；回归测试覆盖三模式各一危险命令 | - | 已缓解 |
| `wrapForFence` 与 `exit`/`exec` 结尾命令的语义边界 | 低 | `$?` 捕获可能不准确 | 沿用 wrapEc 既有注释与测试；工具 description 注明 | - | 已缓解 |
| vitest 全量回归误触发付费 LLM 测试 | 低 | 产生费用 | 按 CLAUDE.md 惯例跑前移走 auth.json；提交前确认无付费调用记录 | - | 已缓解 |
| 用户输入判定误触发 handed_off（粘贴/误触） | 中 | 用户体验不佳 | handed_off 可一键「撤销接管」回到 agent 驾驶；横幅提供恢复按钮 | - | 已缓解 |

---

## 7. 资源需求

### 7.1 人力资源

- **前端开发**：1-2 人（负责 UI 组件、store、bridge）
- **后端开发**：0.5 人（负责 sidecar、permission-manager、Rust 原子操作）
- **测试**：0.5 人（负责测试用例、e2e、i18n）

### 7.2 技术资源

- **开发环境**：Node.js、Rust、Tauri
- **测试环境**：node-pty（或备选方案）
- **文档工具**：Markdown、HTML preview

### 7.3 外部依赖

- **xterm.js**：OSC 633 支持（需验证）
- **node-pty**：测试夹具（需验证编译）
- **Tauri**：Rust 侧原子操作支持

---

## 8. 沟通计划

### 8.1 日常沟通

- **每日站会**：同步进度、阻塞问题
- **PR Review**：每个 PR 至少 1 人 review
- **问题升级**：阻塞超过 1 天的问题升级到项目负责人

### 8.2 里程碑评审

- **M0 评审**：围栏设计假设验证结论
- **M1 评审**：围栏闭环演示
- **M4 评审**：规则化审批演示
- **M10 评审**：全面验收

### 8.3 文档更新

- **spec 更新**：每 PR 完成后更新 spec 条目状态
- **plan 更新**：如有重大变更，更新 plan 文档
- **preview 更新**：如交互有变化，更新 preview.html

---

## 9. 质量保证

### 9.1 代码质量

- **代码审查**：每个 PR 至少 1 人 review
- **静态分析**：`yarn tsc` 零错误
- **测试覆盖**：关键路径 100% 覆盖

### 9.2 测试策略

- **单元测试**：vitest，覆盖所有关键函数
- **集成测试**：node-pty 真实 shell 夹具
- **e2e 测试**：Playwright，覆盖关键用户流程
- **手动测试**：与 preview 场景人工对照

### 9.3 验收标准

- **功能验收**：spec §5 验收清单 16 项全部通过
- **性能验收**：性能影响 < 5% 帧率下降
- **安全验收**：规则集覆盖所有高危命令
- **用户体验验收**：与 preview 场景人工对照一致

---

## 10. 附录

### A. 术语表

| 术语 | 定义 |
|---|---|
| 围栏（fence） | OSC 633 序列包裹的命令，用于标记命令边界和退出码 |
| 驾驶状态（driver） | 当前谁控制终端：`user` 或 `agent` |
| handed_off | 飞行状态：用户已接管，agent 暂停等待 |
| resumed | 飞行状态：用户交还，agent 恢复 |
| queued | 用户消息状态：已暂存，等待飞行结束自动投递 |
| 命令块（command block） | 围栏内的命令+输出+退出码，作为结构化单元 |
| TOCTOU | Time-of-check to time-of-use，检查时间到使用时间的竞争条件 |

### B. 参考文档

1. `terminal-agent-comprehensive-improvement-spec.md`：完整 spec 文档
2. `terminal-shared-pty-spec.md`：共享终端协同整改 spec
3. `terminal-agent-parity-plan.md`：运维助手视觉对齐计划
4. `terminal-capability-upgrade-spec.md`：终端能力现代化升级 spec
5. `terminal-bastion-host-spec.md`：运维跳板机 spec

### C. 变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|---|---|---|---|
| 2026-08-26 | 1.0 | 初始版本 | - |