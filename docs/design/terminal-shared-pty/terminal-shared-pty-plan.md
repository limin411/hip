# 终端管理 · 运维助手 共享终端能力整改 执行计划

- 系列：`docs/design/terminal-shared-pty/`
- 配套：`docs/design/terminal-shared-pty/terminal-shared-pty-spec.md`（根因 A–E + 改进 T1–T6 + 验收 11 项）；`terminal-shared-pty-preview.html`（问题对照 + 共享终端协同交互原型，已通过 CDP 全场景验证）
- 状态：待评审
- 日期：2026-08-12
- 前置：共享 PTY 架构已就位（D4：sidecar 不直写 PTY，UI 桥写入共享 xterm）；`terminal-agent-parity` 系列已落地（运维助手视觉对齐）；`terminal-capability-gap` P0 已完成
- 约束：本系列不改写通道架构（沿用 D4）；`wrapEc` 保留向后兼容；TUI 黑名单保留但语义从「拒绝」改为「启动即交还」

---

## 1. 策略

1. **完成判定革命先行**（PR-1）：围栏信号（OSC 633 语义）是 T2/T3 的状态基础——飞行状态机、handed_off、排队都建立在"知道命令何时结束"之上。先做围栏闭环（写入 → 渲染无感 → 解析 → exit chip），再做协作语义。
2. **测试夹具先行**（PR-0）：node-pty 真实 bash/zsh 夹具在围栏实现前验证设计假设（OSC 序列在 shell 输出中的形态、`$?` 捕获、strip 降级路径），避免启发式又一次"白盒自证"。
3. **XtermSurface 改动最小化**：xterm.js 对未注册 OSC 默认忽略（不渲染）——围栏 marker 理论上无需解析器改动即可"用户无感"；PR-1 第一件事实测确认，若回显则用 `parser.registerOscHandler(633, …)` 吞除（XtermSurface 已有 OSC 0/2 title 同机制）。
4. **P0 / P1 分层**：P0 = 围栏 + 接管交还 + 排队 + 规则审批 + 错误码（spec T1–T4 主体、T5 错误码）；P1 = TOCTOU 原子化、排队取消、滚动级上下文注入（cwd/host 元数据）、Full Terminal Use 完整模式。
5. **门禁**：每 PR `yarn tsc` + 指定文件 vitest + 全量回归（注意：`npx vitest run src` 子串会命中 `packages/sidecar/src` 付费 LLM 测试——按 CLAUDE.md 惯例跑前临时移走 `~/.hip/config/auth.json`）+ i18n `translation-keys.test.ts` + e2e 选择器同步 + 与 preview 场景 ②③④ 人工对照。

## 2. 依赖图

```
PR-0 测试夹具（node-pty，验证围栏假设，可随时插队）
        │
PR-1 命令围栏（写入/无感渲染/解析/exit chip）──▶ PR-2 接管交还（四态飞行）
        │                                            │
        ├──────▶ PR-4 规则审批（∥：独立于桥状态机）    └──▶ PR-3 排队（exec FIFO + 消息暂存）
        │
        └──────▶ PR-5（P1）ring 生命周期 + 上下文注入
```

- 串行：PR-1 → PR-2 → PR-3（handed_off 需要围栏的完成信号；排队需要飞行状态机）
- 并行：PR-0 可提前；PR-4 与 PR-2/PR-3 无共享文件（permission-manager/hipConfig vs bridge/store），可插队；PR-5 的 generation 绑定独立于 1–4，可与 PR-3 并行
- PR-1 与 PR-2 同改 `terminalAgentBridge.ts` → 必须串行

## 3. PR 明细

### PR-0 完成判定测试夹具（T6，0.5 天，可与任何 PR 并行）

**目标**：用真实 shell 验证围栏设计与降级路径，为 PR-1 提供判定标准。

文件级任务：
- 新增 devDependency `node-pty`（原生模块；备选 `@homebridge/node-pty-prebuilt-multiarch` 免编译）。**安装前确认**仓库是否已有 pty 依赖（Rust 侧 native-pty 不互通）；CI/本机编译失败时降级方案 B：Rust `cargo test` 集成夹具（spawn bash 跑围栏命令断言输出）
- 新建 `src/domain/ptyFence.fixture.test.ts`（vitest，`describe.skipIf` 无 node-pty 时跳过）：
  - 真实 bash/zsh 下跑 `printf '\x1b]633;A\x1b\\'; <cmd>; printf '\x1b]633;D;%s\x1b\\' "$?"`：断言 marker 原样出现在输出流、`D` marker 携带真实退出码（成功/失败各一）
  - **降级路径**：无 marker 时 `hasPromptTail` 兜底行为——p10k 风格自定义 PS1（`PROMPT='%F{red}❯%f '` 之类图标结尾）下不误判；`echo $?` 输出以 `$` 结尾不误判（现有白盒测试 + 本夹具双保险）
  - 长输出（>2MiB 触发 ring 裁剪语义）下 fence 仍命中
- 结论写入 PR-1 实现注释：marker 形态、strip 场景、xterm.js 对 633 的默认行为（本 PR 先验证渲染层：在 XtermSurface 用真实 xterm 跑一次 633 序列截图/断言不渲染）

验收：spec §5 项 2/10（部分）。

### PR-1 命令围栏（T1，2 天，P0 核心）

**目标**：完成判定从"猜 prompt"升级为"围栏信号"，退出码进工具结果与命令卡。

文件级任务：
- `packages/sidecar/src/session/tools/terminal.ts`：
  - `wrapForFence(command)`：`printf '\x1b]633;A\x1b\\'; <command>; printf '\x1b]633;D;%s\x1b\\' "$?"`——与 `wrapForEc` 同模式，但 marker 为 OSC 序列（渲染无感）。保留 `wrapEc` 旧解析兼容；新增 `fence: boolean`（默认 true）；`fence: false` 时行为 = 现状（供降级）
  - 工具 description 更新：状态枚举增加 `handed_off_resumed` / `ring_reset`（文案 PR-2/PR-5 逐步启用，本 PR 先声明）；注明 `exit`/`exec` 结尾命令的已知语义边界（沿用 wrapEc 既有注释）
- `src/domain/terminalAgentBridge.ts`：
  - `extractFenceExitCode(output)`：匹配最后一个 `\x1b]633;D;<code>\x1b\\`（含旧 `__HIP_EC_EXIT` 兜底）；`hasPromptTail` 降级为"无 marker"时的 fallback
  - 完成判定顺序：fence D marker → （无 marker）prompt-tail + 静默兜底
  - **命令块切分（P0 务实版）**：按 `OSC-A … OSC-D` 建立 `fenceBlocks` 派生索引（起点 cursor → { command, exitCode }）；exec/terminal_read 结果默认按块边界裁剪——**块内用户输入段仍可能混入**（文本流无法可靠剔除），由 `user_interleaved` 标记兜底；完全净化用户输入列为 P1 跟随项（在 spec T1 标注）
  - 飞行 finish 时优先取 fence exitCode 进 `exitCode` 字段（现有字段复用）
- `src/components/artifact/XtermSurface.tsx`：PR-0 实测结论落地——若 xterm.js 默认忽略 633 则零改动（仅测试固化）；若回显则 `parser.registerOscHandler(633, …)` 吞除（与现有 title 序列同机制）
- `src/components/terminals/TerminalAgentPanel.tsx`：ToolCard 解析 `exitCode: N`（`formatExecResult` 已输出该行）→ 状态 chip 旁显示 `exit 0`/`exit 1`（复用 `tc-exit` 视觉，spec 命令卡协议）；i18n 五语言新增 `terminals.agent.exitCode` key
- 单测：`terminalAgentBridge.test.ts` 补 fence 解析用例（marker 命中/无 marker 兜底/旧 wrapEc 兼容/裁剪后命中）；ToolCard exit chip 用例

验收：spec §5 项 1/2/3/11。

### PR-2 接管 / 交还（T2，1.5 天，P0）

**目标**：飞行状态机四态化；用户键入即接管、交还后恢复；TUI 改"启动即交还"。

文件级任务：
- `src/store/terminalAgentStore.ts`：
  - `driverByTerminal: Record<string, 'user' | 'agent'>`
  - 飞行扩展 `phase: 'running' | 'handed_off' | 'resumed'`；`resumeExecFlight(terminalId)` action（UI 交还按钮调用）
  - 悬挂超时常量 `HANDED_OFF_MAX_MS = 10min`
- `src/domain/terminalAgentBridge.ts` `runExec` 轮询循环：
  - 复用现有 `noteUserInput` 触发点：飞行中用户键入 → 置 `phase='handed_off'`、`driver='user'`、**暂停 deadline 计时**；循环改为等待 `phase !== 'handed_off'`（轮询 store）或悬挂超时（→ 以 `handed_off_resumed` 状态收尾，spec §7）
  - 用户交还（`resumeExecFlight`）→ `phase='resumed'` → 重读 ring（含用户输入段）→ 继续等待 fence/兜底完成 → 结果 `status: completed + user_interleaved`（已有标记语义）
  - **TUI 启动即交还**：`isInteractiveTuiCommand` 命中不再拒绝——正常写入围栏命令，**写入后立即置 `phase='handed_off'`**（控制权自动交用户）；sidecar 工具文档同步声明该语义（"交互程序启动后键盘交给用户，用户交还后继续"）
- `src/components/terminals/TerminalAgentPanel.tsx`：
  - 订阅飞行 `phase`：`handed_off` 时渲染接管横幅（「你正在输入 — 完成后点「交还」让助手继续」，preview 场景③同款）+ 交还按钮；`running` 且无输出超阈值（bridge 侧发 UI 事件或复用 banner 触发）→ 信息性横幅「命令可能需要你介入」
  - 交还按钮 → `resumeExecFlight(tmId)`；横幅「撤销接管」按钮（误触恢复，spec §7）
- sidecar `formatExecResult`：`handed_off_resumed` 文案（"用户介入了命令执行，输出可能含用户输入"）
- 单测：bridge 四态用例（键入→handed_off→resume→completed+interleaved；悬挂超时→handed_off_resumed；TUI 命令启动即 handed_off）；TerminalAgentPanel 横幅/按钮用例

验收：spec §5 项 4/5。

### PR-3 排队（T3，1 天，P0）

**目标**：并发从"报错拒绝"变"FIFO 排队"；用户消息飞行期间暂存、结束后自动投递。

文件级任务：
- `src/domain/terminalAgentBridge.ts`：
  - `runExec` 发现 `execFlightByTerminal[tmId]` 存在 → 不再立即回 error，入 `execQueueByTerminal[tmId]`（`terminalAgentStore` 新增，含 callId/sessionId/command/waitMs/wrapEc）；30s 排队超时 → 回 `status: 'error', error: 'queued_timed_out'`
  - 飞行 finish 时从队列 shift 下一个自动执行（复用 runExec 主体，提取 `executeFlight(...)` 供首个与队列复用）
- `src/components/terminals/TerminalAgentPanel.tsx`：
  - composer 提交时若 `execFlightByTerminal[terminalId]` 非空 → 消息**本地暂存**（组件级队列）+ 输入区显示「命令运行中 — 消息将在结束后发送」（preview 场景④同款，i18n key）+ 列表里该消息带 `queued` 标记（发送后立即显示、标记 queued，投递时标记更新）
  - 订阅飞行结束（flight → null）→ 自动 `sessionService.sendMessage` 投递暂存队列（与飞行结束原子判定：订阅回调内检查 store 状态）
  - 队列消息与飞行结束竞态（用户恰在结束时发送）：以 store 快照判定为准，单测覆盖
- 单测：bridge 队列（第二个 exec 排队 → 首个完成后自动执行；超时拒绝）；TerminalAgentPanel 暂存/投递/竞态用例（fake store）

验收：spec §5 项 6/7。

### PR-4 规则化审批（T4，1.5 天，P0 主体）

**目标**：黑名单正则 + window.confirm → allow/deny/ask 规则集 + 应用内确认卡 + 持久化；TOCTOU 留 P1。

文件级任务：
- `packages/sidecar/src/session/permission-manager.ts`：
  - `evaluateCommandRule(command, rules): 'allow' | 'ask' | 'deny'`——glob 模式匹配（`git push*`、`rm -rf /*`），**优先级 deny > ask > allow**（命中 deny 直接拒绝，不进 UI）
  - 预置规则集按 `permissionMode`：chat = 写操作全 ask；edit = 预置规则 + ask 兜底；full = 预置规则 + 高危 ask（映射表见 spec §3 T4 / preview 场景⑤）；高危预置 ask 清单：`git push --force*`、`kill*`、`chmod -R*`、`> /dev/*` 截断、fork bomb 形态（`{...}` 递归）
  - 与现 `requestApproval` 链整合：规则命中 allow → 直跑；ask → 现审批卡；deny → 拒绝文案
- `src/components/terminals/TerminalAgentPanel.tsx`：
  - 危险命令确认从 `window.confirm`（bridge 内两处：exec 危险命令 / sftp 覆盖）迁移到应用内 ConfirmCard（复用 PermissionCard 视觉）：「本次允许 / 总是允许 / 总是拒绝」三按钮（preview 场景⑤同款）
  - 「总是允许/拒绝」→ `hipConfigStore` 新字段 `[terminal] approve_rules / deny_rules`（追加写入 hip.toml，现有 config 持久化通道）；「本次允许」仅飞行级放行
  - bridge 的 `isDangerousCommand` 正则删除，改走 permissionManager 规则评估（错误路径返回规则说明）
- P1 跟随项（本 PR 只记录到 spec）：sftp_write TOCTOU（Rust 侧 `create_new` 原子化）；audit 回显增强
- 单测：规则匹配（优先级/glob/大小写）；三模式预置映射；ConfirmCard 三按钮行为 + 规则写入 store；bridge 危险命令走规则（不再 window.confirm）

验收：spec §5 项 8（部分：P1 项仅记录）。

### PR-5（P1）ring 生命周期 + 错误码（T5 主体，1 天）

**目标**：generation 绑定 ring cursor；错误码细化；上下文注入（P1 冒烟）。

文件级任务：
- `src/store/terminalStore.ts`：`generation`（已有字段）扩展——SSH 重连/ring 重建路径 `generation+1`（`managedTerminalStore` reconnect 处 bump）；`getRingSince` 结果携带 generation
- `src/domain/terminalAgentBridge.ts`：飞行启动记录 generation，轮询校验不匹配 → `finish('error', { error: 'ring_reset: terminal reconnected' })`；断开 → `terminal_closed`（替代笼统 aborted 文案）；sidecar `formatExecResult` 对应文案 + 工具 description（"收到 ring_reset 后应 terminal_read 重读再决定"）
- P1 上下文冒烟：exec 写入前取一次 `pwd`（或 OSC 7）随结果返回 `cwd`；会话上下文注入 host 名/remotePath（spec §2 承诺兑现）；本 PR 可选交付，不做则标注 P2
- 单测：generation 不匹配 → ring_reset；断开 → terminal_closed；cursor 携带 generation 断言

验收：spec §5 项 9（错误码侧）。

## 4. 里程碑

| 里程碑 | 内容 | 估算 |
|---|---|---|
| M0 | PR-0：node-pty 夹具 + xterm.js 633 渲染行为实测（围栏设计假设闭环） | 0.5 天 |
| M1 | PR-1：围栏闭环（默认开启、无感渲染、fence 完成判定、exit chip） | 2 天 |
| M2 | PR-2：接管/交还四态 + TUI 启动即交还 | 1.5 天 |
| M3 | PR-3：exec FIFO + 用户消息排队 | 1 天 |
| M4 | PR-4：规则化审批（规则集 + ConfirmCard + 持久化） | 1.5 天 |
| M5（P1） | PR-5：generation 绑定 + 错误码细化（+ 上下文注入冒烟） | 1 天 |

P0（M0–M4）≈ 6.5 人日；P1（M5 + spec T3 深度取消 / T4 TOCTOU / Full Terminal Use）另行排期。
每 PR 独立提交，提交信息含 `terminal-shared-pty PR-N` 与 spec 条目（如 `feat(terminal): 围栏完成信号（terminal-shared-pty PR-1，spec T1）`）。

## 5. 回归门禁清单

1. `yarn tsc --noEmit` 零错误
2. vitest：`terminalAgentBridge` / `terminalAgentStore` / `TerminalAgentPanel` / `terminal.ts` / `permission-manager` / `XtermSurface` / `translation-keys` 相关全绿 + 全量回归（跑前按 CLAUDE.md 临时移走 `~/.hip/config/auth.json` 防付费 LLM 测试）
3. PR-0 的 node-pty 夹具绿（无 node-pty 环境 skip，本机必跑）
4. `e2e/specs/terminal.spec.ts`（或既有 terminal e2e）：围栏执行 → 命令卡 exit chip 断言；接管横幅 → 交还 → 结果标记断言；选择器随 PR 同步
5. i18n 五语言新 key 一致（`terminals.agent.*` / `terminal.confirm.*`，translation-keys 测试强制）
6. 与 `terminal-shared-pty-preview.html` 场景 ②③④⑤ 人工对照：围栏无感、接管横幅/交还、queued 标记、确认卡三按钮手感一致

## 6. 风险

| 风险 | 等级 | 缓解 |
|---|---|---|
| xterm.js 对 OSC 633 默认行为与假设不符（回显/解析异常） | 中 | PR-0 第一件事实测（真实 xterm 跑 633 序列）；回显则注册 parser handler 吞除（XtermSurface 已有同机制） |
| OSC 序列被远端 shell/中间层 strip（russh 为字节流通道，理论透传） | 中 | fence 无 marker 时自动降级 prompt-tail 兜底（PR-0 夹具覆盖）；`fence: false` 逃生口 |
| node-pty 原生模块安装/编译失败 | 中 | 备选 `@homebridge/node-pty-prebuilt-multiarch`；再备选 Rust cargo test 集成夹具（方案 B） |
| handed_off 悬挂（用户长时间不交还） | 中 | `HANDED_OFF_MAX_MS` 超时收尾为 `handed_off_resumed`；横幅常驻 + 撤销接管按钮 |
| 排队消息与飞行结束竞态（结束瞬间用户发送） | 低 | 排队判定与投递在 store 订阅回调内原子完成；单测覆盖竞态窗口 |
| PR-1/PR-2 同改 `terminalAgentBridge.ts` 冲突 | 低 | 强制串行（PR-2 基于 PR-1 提交） |
| 规则集迁移改变 chat/edit/full 既有行为 | 中 | 三模式映射表先行对齐（preview 场景⑤已固化为对照基准）；回归测试覆盖三模式各一危险命令 |
| `wrapForFence` 与 `exit`/`exec` 结尾命令的语义边界（`$?` 捕获） | 低 | 沿用 wrapEc 既有注释与测试；工具 description 注明 |
| vitest 全量回归误触发付费 LLM 测试 | 低 | 按 CLAUDE.md 惯例跑前移走 auth.json；提交前确认无付费调用记录 |
