# hip 终端能力补齐 SPEC（对照 alacritty 差距分析）

> 状态：SPEC 草案 · 待评审
> 日期：2026-08
> 对比基线：`/Users/lijiamin/data/code-repository/github/alacritty`（alacritty_terminal 0.26.1-dev + alacritty 前端）
> 关联代码：`src/components/artifact/XtermSurface.tsx`（xterm 宿主）、`src/store/terminalStore.ts`（ring）、
> `src/ipc/pty.ts`（PTY/SSH 桥）、`src-tauri/src/pty.rs`、`src-tauri/src/ssh_session.rs`、
> `src/components/terminals/ManagedTerminalSession.tsx`（托管终端）、`packages/sidecar/src/session/tools/terminal.ts`（agent 桥）
> 关联文档：`docs/design/doc-terminal-nerd-fonts/terminal_nerd_font_spec.md`（已落地）、`docs/design/README.md`（目录约定）

## 一、背景与目标（TL;DR）

1. **背景**：hip 的终端是「嵌入式终端面板」——前端 xterm.js 5.5 渲染 + Rust 后端（本地
   `portable-pty` / 远程 `russh` SSH）+ agent 工具桥（terminal_exec/read、sftp_read/write）。
   alacritty 是「独立终端模拟器」——自研 Rust 模拟核心（vte 解析、Grid、damage 追踪）+ GPU 渲染器。
   两者定位不同，但**终端模拟层与交互层的用户体验基线**可比：alacritty 是事实上的「专业终端」
   参照系，其交互能力（搜索、Vi 模式、语义选择、hints、键盘协议、快捷键体系）是 hip 终端
   目前明显欠缺的部分。
2. **问题**：hip 终端当前只有「能跑」的基线能力（输入输出、滚动、主题、Nerd Font、右键复制粘贴），
   缺少终端用户习以为常的进阶交互：**搜索、快捷键、shell 标题联动、bell 提示、OSC 52 剪贴板、
   cwd 跟踪、超链接、Vi 模式、hints**。与 Termius / alacritty 相比观感与效率均落后。
3. **本 SPEC 目标**：以 alacritty 为能力参照系，给出**差距清单 + 分级分期实施计划**（P0–P3），
   每期有明确范围、改动点与验收标准。**不引入 Rust 自研模拟核心**（架构理由见 §6 非目标）；
   差距集中在 xterm 宿主层、store 层与配置层，Rust 后端基本不动。
4. **结论先行**：共识别 **22 项差距**，其中 P0 四项（搜索、快捷键、标题接线、bell 接线）、
   P1 六项（OSC 52、cwd 跟踪、超链接、选择增强、焦点事件、搜索增强）、P2 四项（Vi 模式、hints、
   kitty 键盘协议、渲染性能）、P3 五项（兼容性回归、分屏/多标签、复制模式、性能监控、scrollback 配置化）。
   hip 在 **SSH 会话管理、输出 ring 恢复、agent 工具桥、多终端管理** 上已超越 alacritty（§4 中标注为「领先」），
   不在补齐范围。

## 二、现状盘点：hip 终端能力基线（代码事实）

| # | 能力 | 现状 | 依据 |
|---|---|---|---|
| 1 | 本地 PTY | `portable-pty`（Unix forkpty / Windows ConPTY），1 PTY/session，软上限 8（TerminalBudget） | `src-tauri/src/pty.rs`、`terminal_budget.rs` |
| 2 | Shell 配置 | `[terminal].shell`（hip.toml）；Unix `$SHELL -il`、Windows `cmd.exe`/PowerShell（加载用户 profile） | `pty.rs:122` `resolve_shell` |
| 3 | SSH 终端 | `russh`：password / privateKey（含 passphrase、RSA hash 协商）、TOFU known_hosts pinning、generation 防串台 | `ssh_session.rs` |
| 4 | SFTP | 本地文件树 `term_fs_ls`（jail + symlink 策略）；远程 sftp 读/写/传（agent 工具 + UI） | `term_fs.rs`、`sftp.rs`、`terminalAgentSession.ts` |
| 5 | 渲染前端 | xterm.js 5.5，**仅装了 `@xterm/addon-fit`**（无 search/webgl/unicode 等 addon）；canvas 渲染；scrollback 5000 | `package.json:107-108`、`XtermSurface.tsx` |
| 6 | 输出 ring | 5000 chunks / 2 MB cap、drop-oldest、trimOffset 游标、断线重连恢复（keep-alive） | `terminalStore.ts:4-5` |
| 7 | 事件桥 | `pty:data`/`pty:exit`、`ssh:data`/`ssh:exit`（base64 + 流式 TextDecoder 防 UTF-8 截断）；coalesce 12ms/32KiB | `src/ipc/pty.ts`、`pty.rs` |
| 8 | 生命周期 | ensure/dispose/reset/reconnect 固定调用序（terminalLifecycle），跨 store 单写点 | `src/domain/terminalLifecycle.ts` |
| 9 | 主题 | follow light/dark + 固定主题，16 色 + 光标/选择色；MutationObserver 跟随文档 class 热切换 | `terminalTheme.ts` |
| 10 | 字体 | 内置 JetBrainsMono Nerd Font（子集化 woff2 ≤3MB）、字体加载兜底 1.5s、字号 13/行高 1.25 | `terminal-fonts.css`、`XtermSurface.tsx` |
| 11 | 复制/粘贴 | 仅 canvas 右键菜单（getSelection/paste，paste 尊重 bracketed paste）；**无快捷键** | `terminalCanvasUi.ts` |
| 12 | 终端管理 | 管理页 Tab（local/ssh）、主机目录、recent launches、状态机 connecting/connected/disconnected/error | `TerminalManagementPage.tsx`、`terminalHostStore.ts` |
| 13 | Agent 桥 | terminal_exec（HITL 审批、wait_ms 1–120s、completed/timed_out/user_interleaved/rejected 状态机）、terminal_read（ring 光标增量）、sftp_read/write | `packages/sidecar/src/session/tools/terminal.ts` |
| 14 | 测试 | 单测（store/lifecycle/pty helpers）+ e2e（code-terminal.spec.ts、terminal-agent-ssh.spec.ts） | `vitest`、`wdio` |

**当前明确缺失**（无对应实现）：搜索、快捷键体系、OSC 0/2 标题接线、bell 接线、OSC 52、
OSC 7 cwd 跟踪、超链接、语义/行选择、Vi 模式、hints、kitty 键盘协议、焦点事件（DECSET 1004）、
WebGL 渲染、scrollback 配置化、终端内分屏/多标签。

## 三、对比基线：alacritty 能力全集（按域）

以下为 alacritty（alacritty_terminal crate + 前端）的能力盘点，用作差距矩阵的「参照列」：

### 3.1 模拟核心（`alacritty_terminal/src/term/mod.rs`）
- `TermMode` 全集（bitflags）：SHOW_CURSOR、APP_CURSOR、APP_KEYPAD、MOUSE_REPORT_CLICK、
  BRACKETED_PASTE、SGR_MOUSE、MOUSE_MOTION、LINE_WRAP、LINE_FEED_NEW_LINE、ORIGIN、INSERT、
  **FOCUS_IN_OUT**、ALT_SCREEN、MOUSE_DRAG、UTF8_MOUSE、ALTERNATE_SCROLL、VI、URGENCY_HINTS、
  **KITTY_KEYBOARD_PROTOCOL**（DISAMBIGUATE_ESC_CODES / REPORT_EVENT_TYPES / REPORT_ALTERNATE_KEYS /
  REPORT_ALL_KEYS_AS_ESC / REPORT_ASSOCIATED_TEXT 渐进式 5 个子位）
- 双 Grid（primary/alt）、scrollback 历史（`Config.scrolling_history` 默认 10000，可配置）、
  TabStops、charset 映射、scroll_region
- **Damage 追踪**：`TermDamage` / `LineDamageBounds` 行级增量，渲染层只重绘损坏行
- OSC 面：**Osc52**（Disabled/OnlyCopy/OnlyPaste/CopyPaste 四档策略）、OSC 8 超链接（cell 级
  `Hyperlink`，Arc 去重）、OSC 4/10/11 动态色（`ColorRequest` 事件）、OSC 0/2 标题（`title_stack`）、
  OSC 7 cwd（`TextAreaSizeRequest`）
- 事件代理 `Event`：Title/ResetTitle、ClipboardStore/ClipboardLoad、ColorRequest、PtyWrite、
  TextAreaSizeRequest、CursorBlinkingChange、MouseCursorDirty、Wakeup、**Bell**、Exit、ChildExit
- `Config`：scrolling_history、default_cursor_style、vi_mode_cursor_style、semantic_escape_chars、
  kitty_keyboard、osc52

### 3.2 交互层（selection / search / vi / hints）
- **SelectionType**：Simple / Line / Block / **Semantic**（语义选择，`semantic_escape_chars` 可配置）
- **搜索**：`RegexSearch`（regex-automata），前后向、大小写、正则开关；搜索界面有 match 高亮 +
  focused match 独立配色（`FocusedMatchColors`/`MatchColors`/`SearchColors`）；与 Vi 模式联动
- **Vi 模式**：`ViModeCursor` + `ViMotion`（h/l/j/k/w/b/0/$/g/E…）、scroll 联动、`vi_mode_recompute_selection`、
  选中即复制到剪贴板
- **Hints**：`HintState`（正则 → 匹配项 → 字母标签键盘跳转 → `HintAction`），URL 默认 hint，
  鼠标 hover 高亮 + 悬停超链接提示
- **快捷键体系**：`Action` 全集 ≈ 60 个动作：Paste/Copy/CopySelection/PasteSelection、
  IncreaseFontSize/DecreaseFontSize/ResetFontSize、ScrollPageUp/Down/HalfPage/Line/Top/Bottom、
  ClearHistory、ToggleViMode、SearchForward/SearchBackward、SelectNextTab…SelectLastTab、
  CreateNewWindow/CreateNewTab、ToggleFullscreen/ToggleMaximized、ClearSelection、Bell、
  Hide/Minimize/Quit 等；keybindings + mouse bindings 全 TOML 可配、热重载
- 光标：block/beam/underline + 闪烁 + vi 模式独立样式

### 3.3 渲染与窗口（前端层）
- GPU 渲染器（OpenGL/Vulkan、shader + 纹理图集）、damage 增量绘制、rect 合并
- 窗口：opacity/blur/padding/decorations/动态标题、urgent 提示、resize increments、
  option-as-alt（macOS）
- Bell 配置：视觉动画（`BellAnimation`）+ 音频 + 自定义命令
- `Meter`（FPS 调试）、消息栏（错误/警告）、配置热重载（ConfigMonitor）、daemon + IPC socket
- **连字（ligature）：alacritty 明确不支持**（与 xterm.js 相同，非差距）

### 3.4 alacritty 没有的（hip 领先项）
SSH/SFTP 会话、多终端管理页、输出 ring 断线恢复、agent 工具桥（terminal_exec 等）、
AI 应用内嵌集成。这些不在补齐范围，反而说明差距集中在「模拟层交互体验」。

## 四、能力差距矩阵（核心结论）

等级：**缺** = 完全缺失需新建；**接线** = xterm.js 已有底层能力，缺应用层接线/UI；**部分** = 有基础但缺关键配置或增强；**领先** = hip 已超越参照，不处理。

| 域 | 能力 | alacritty | hip 现状 | 等级 |
|---|---|---|---|---|
| 交互 | 终端内搜索（regex/前后向/大小写） | 完整 RegexSearch | 无（未装 `@xterm/addon-search`） | **缺** P0 |
| 交互 | 快捷键体系（复制/粘贴/字号/滚动/清屏） | 60+ Action 可绑 | 无任何终端快捷键 | **缺** P0 |
| 模拟 | OSC 0/2 标题 → 标签/管理页联动 | Title 事件 + title_stack | xterm 有 `onTitleChange` 未接线 | **接线** P0 |
| 模拟 | Bell → 提示 | 视觉/音频/命令 | xterm 有 `onBell` 未接线 | **接线** P0 |
| 模拟 | OSC 52 剪贴板策略 | 四档策略 | xterm 无内置，可 `registerOscHandler` | **缺** P1 |
| 模拟 | OSC 7 cwd 跟踪（标签/文件树根联动） | TextAreaSizeRequest | 无（启动 cwd 固定，`cd` 后失真） | **缺** P1 |
| 模拟 | 超链接（OSC 8 + URL 高亮/点击） | cell 级 Hyperlink + hint | xterm 5.5 支持 OSC 8 但未配 `linkHandler` | **接线** P1 |
| 交互 | 选择增强（语义/行选择、右击选词、选中即复制） | 4 种 SelectionType | 默认行选 + Alt 矩形；无语义/行选择，无右击选词配置 | **部分** P1 |
| 模拟 | 焦点事件 DECSET 1004 | FOCUS_IN_OUT | xterm.js 不支持（影响 vim/tmux 焦点感知） | **缺** P1 |
| 交互 | 搜索增强（match 高亮配色、focused match、快捷键导航） | 完整 | 随 P0 搜索一并做 | **部分** P1 |
| 交互 | Vi 模式（键盘选择/复制） | 完整 | 无 | **缺** P2 |
| 交互 | Hints（URL 键盘标签跳转） | HintState | 无 | **缺** P2 |
| 输入 | Kitty 键盘协议（渐进式） | 5 子位全支持 | xterm.js 不支持（需跟进上游或自研输入编码层） | **缺** P2 |
| 渲染 | WebGL/GPU 渲染 + 增量绘制 | 自研 GPU 渲染器 + damage | canvas 全量重绘（大输出/大历史滚动掉帧） | **缺** P2 |
| 工程 | 终端模拟兼容性回归（vttest 关键项/tmux 集成） | 自有 parser + 测试 | 无（依赖 xterm.js 上游质量，无自家回归网） | **缺** P3 |
| 交互 | 复制模式 / 选择缓冲（primary selection） | CopySelection/PasteSelection | 无（Web 环境受限，需剪贴板事件方案） | **缺** P3 |
| 会话 | 终端内分屏 / 多标签 | SelectNextTab/CreateNewTab（macOS 原生 tab） | 管理页有 Tab，面板内无分屏 | **缺** P3 |
| 配置 | scrollback 配置化 + ring/xterm 内存统一 | scrolling_history 可配 | 5000 硬编码，ring 与 xterm 双份内存 | **部分** P3 |
| 工程 | 性能监控（吞吐/FPS） | Meter | 无 | **缺** P3 |
| 配置 | 终端偏好集中化（快捷键/搜索/bell/链接开关） | 全量 TOML | 仅 `[terminal].shell/colorTheme` | **部分** P0（随快捷键一并做） |
| 会话 | SSH/ring/agent 桥/多终端管理 | 无 | 已有 | **领先** — |
| 渲染 | 连字（ligatures） | 不支持 | 不支持 | 共同非目标 — |

## 五、分期实施方案

### P0 —— 日常体验基线（1 期，2–3 周）

**目标**：终端「能搜、能快捷键、标题与 bell 不哑火」。全部在前端层完成，Rust 零改动。

1. **终端内搜索**
   - 引入 `@xterm/addon-search`；在终端右栏/浮层提供搜索条（`TerminalRightPanel` 侧或
     `ManagedTerminalSession` 顶栏）：输入框 + 前向/后向 + 大小写开关 + 高亮当前 match。
   - 快捷键：`Cmd/Ctrl+F` 打开（注意与全局 `Cmd+F` 知识库搜索冲突——按当前聚焦上下文分派）。
   - 验收：e2e 输入 `SearchFor` 后 match 高亮、Enter 循环、Esc 关闭；单测覆盖 store 状态。
2. **终端快捷键体系**（新增 `[terminal].keybindings` 配置节 + 默认值）
   - 默认集：复制 `Cmd/Ctrl+Shift+C`、粘贴 `Cmd/Ctrl+Shift+V`、清屏 `Cmd/Ctrl+L`（按
     `fastScrollModifier` 语义处理滚动冲突）、增大/减小/重置字号、滚到顶/底、搜索、重启/关闭。
   - 实现：`XtermSurface` 内 keydown 层（xterm `attachCustomKeyEventHandler` 兼容路径），
     分发到 `terminalCanvasUi`（复制/粘贴复用现有桥）与新动作。
   - 验收：快捷键单测（handler 表驱动）+ e2e 断言复制粘贴动作打到剪贴板与 PTY。
3. **OSC 0/2 标题接线**
   - `term.onTitleChange` → `terminalStore` 的 `title` 字段 → 标签/管理页/窗口标题显示；
     与 alacritty 的 title_stack 语义对齐（shell 退出恢复默认标题）。
   - 验收：e2e 执行 `printf '\e]0;hello\a'` 后标签文本更新。
4. **Bell 接线**
   - `term.onBell` → 应用内视觉提示（窗口闪烁/任务栏 badge/静默 toast，默认仅视觉，配置可关）。
   - 验收：e2e `printf '\a'` 触发提示事件（断言事件计数，不断言 OS 级 UI）。
5. **终端偏好集中化**
   - `hip.toml [terminal]` 扩展：`search.*`、`bell`、`hyperlink`、`keybindings` 默认合并。
   - 验收：`hipConfigStore` 单测覆盖默认值合并与热更新（沿用现有 MutationObserver 模式）。

### P1 —— 协议完整性与链接（2 期，2–3 周）

**目标**：终端协议面补齐——剪贴板策略、cwd 跟踪、超链接、选择增强、焦点事件；搜索增强。

6. **OSC 52 策略**
   - `term.registerOscHandler` 实现 `Osc52` 四档（默认 **OnlyCopy**，与 alacritty 安全默认一致）；
     复制走 `@tauri-apps/plugin-clipboard`（需新增依赖），粘贴编码回 escape 序列。
   - 验收：单测覆盖四档策略矩阵；e2e 用 `printf '\e]52;c;…\a'` 断言剪贴板（策略档位下）。
7. **OSC 7 cwd 跟踪**
   - 终端内解析 `OSC 7`（`file://` URI 或裸路径）→ store `cwd` → 管理页标签 tooltip、
     `TerminalFileTree` 根联动（本地终端跟随 `cd`）；SSH 侧解析远程路径（供 SFTP 树）。
   - 验收：e2e `printf '\e]7;file:///tmp\a'` 后文件树根切换；单测 URI 解析（含中文/空格 percent-decode）。
8. **超链接**
   - 配置 `linkHandler`（OSC 8）：hover 下划线 + 高亮（cursor pointer）、单击/`Cmd+Click` 打开
     （`opener`/Tauri shell plugin）、右键菜单「复制链接地址」。
   - 验收：单测 link 配置与右键动作；e2e 断言 hover 样式类与右键菜单项。
9. **选择增强**
   - 启用 `rightClickSelectsWord` 等 xterm 选项；新增「选中即复制」（配置开关）；
     补语义选择（`semanticEscapeChars` 可配，对齐 alacritty `semantic_escape_chars`）。
   - 验收：单测语义字符表驱动；e2e 双击选词 + 右键复制路径。
10. **焦点事件 DECSET 1004**
    - xterm.js 不支持；方案 A（先做）：`term.onFocus/onBlur` → 手动写 `CSI I/O` 到 PTY
      （仅当 shell 已开启 1004 时响应，用 `CSI ? 1004 h` 检测回包成本高——v1 简化为
      bracketed 式：开启即写，幂等）；方案 B（跟进）：跟踪 xterm.js 上游支持后移除 hack。
    - 验收：e2e 在 tmux 会话中断言状态行随焦点切换（tmux 2.9+ 支持 focus-events）。
11. **搜索增强**
    - match 计数、「所有 match 高亮 + 当前 match 强调」配色（对齐 alacritty
      FocusedMatchColors/MatchColors）、`/` 与 `n/N` 类键盘导航（搜索条聚焦态）。

### P2 —— 专业交互（3 期，3–4 周）

12. **Vi 模式**：`Cmd+Shift+Space`（或配置）进入；实现最小 motion 集（h/j/k/l/w/b/0/$/gg/G）、
    v/y 选择复制、Esc 退出；与搜索联动（进入搜索后回车跳转到 match 并可用 vi 选择）。
    xterm.js 无现成 addon——自研 `viModeLayer`（装饰器 `registerDecoration` 画光标 + keydown
    拦截 + 复用 selection API）。验收：单测 motion 表驱动 + e2e 选择复制。
13. **Hints**：URL hint 起步——`Cmd+Shift+U` 高亮所有 URL，字母标签键盘跳转打开；
    配置 `[terminal].hints`（正则 + 动作 + 字母表）。自研层同 Vi 模式共用装饰器基建。
14. **Kitty 键盘协议**：评估两条路——(a) 跟进 xterm.js 上游（xterm.js 已有多方 PR 讨论）；
    (b) 自研输入编码层：`term.onKey` 拦截 → 按 CSI-u 规范编码 → 直写 PTY，绕过 xterm 默认
    编码；kitty 的渐进式子位（DISAMBIGUATE→REPORT_EVENT_TYPES→…）按 shell 协商逐步点亮。
    验收：在 kitty 协议 shell（如 `kitten` 或 fish 5.x）里验证 Ctrl+I 与 Tab 区分。
15. **渲染性能**：`@xterm/addon-webgl`（xterm 官方 GPU 渲染器）+ 大输出压力 e2e
    （`yes` / `seq 1e6` 滚动帧率）；若不足再评估自研 damage 层。验收：压力场景无 200ms+
    长帧（性能断言按 dev 阈值，不设 CI 硬门禁）。

### P3 —— 深水区（4 期，按需）

16. **兼容性回归网**：vttest 关键用例脚本化（重点：alt screen、光标、颜色、滚动区、鼠标协议）、
    tmux 集成 smoke（focus-events、bracketed paste、copy mode）；产出兼容性基线文档。
17. **终端内分屏**：面板内 split（水平/垂直）→ 一个 session 多 xterm 实例共享 ring
    （ring 已有「多实例只写一次」契约，需扩展 `attachedTerminalId` 为多值或分屏游标方案）。
18. **复制模式/选择缓冲**：Linux primary selection 不可行（WebView），改为「选择缓冲」
    （hip 内独立于系统剪贴板的第二剪贴板）+ `PasteSelection` 语义。
19. **性能监控**：终端吞吐/FPS/ring 水位面板（dev 构建可见，对齐 alacritty Meter）。
20. **scrollback 配置化**：`[terminal].scrollback` 行数 → xterm `scrollback` + ring 上限联动；
    评估 ring 与 xterm 双份内存合并（ring 作为唯一来源，xterm 仅保活窗口内缓冲）。

## 六、非目标（明确不做）

1. **不自研 Rust 模拟核心**：alacritty_terminal 是完整模拟器（vte 解析 + Grid + damage），
   移植/自研成本极高；xterm.js 模拟覆盖面已足够（OSC 8/52 可补、kitty 协议可补输入层），
   差距集中在交互接线而非解析引擎。hip 的差异化在 AI 工作台集成，不在模拟器。
2. **不引入 sixel / kitty graphics**：alacritty 同样不支持，双方一致非差距。
3. **连字（ligature）**：alacritty 与 xterm.js 均不支持；依赖渲染器级改造，另行评估。
4. **独立终端窗口（浮动/脱出）**：hip 是嵌入式面板定位，窗口行为（opacity/blur/padding）
   为独立终端所需，不映射。
5. **daemon / IPC socket / 配置热重载机制**：hip 已有 Tauri 配置体系与主题热切换，不照搬。
6. **全局终端字体/字号可配置化**：v1 沿用 Nerd Font 内置方案（nerd font spec §6 非目标），
   不新增 `terminal.fontFamily` 用户偏好键。
7. **终端历史持久化**（跨进程恢复 scrollback）：ring 为进程内设计，持久化列为独立评估项。

## 七、风险与权衡

| 风险 | 影响 | 缓解 |
|---|---|---|
| 快捷键与全局快捷键冲突（Cmd+F/Cmd+Shift+C 等） | P0 快捷键体验崩坏 | 统一走「聚焦上下文分派」：终端聚焦时终端层优先，未消费键回退全局；默认键表评审后再定稿 |
| xterm.js 不支持 DECSET 1004 / kitty 协议，hack 层与上游行为漂移 | P1/P2 协议面半吊子 | 两个协议都做「探测 + 幂等」设计；kitty 协议先出 RFC 式评估再投入；1004 hack 标记 TODO 追踪上游 |
| ring 与 xterm 双份缓冲（2MB + scrollback 5000） | 长会话内存膨胀 | P3 统一为 ring 单源；P0–P2 期间保持现状（已有 cap 兜底） |
| Vi 模式/hints 自研装饰器层与 xterm 内部 API 耦合 | 升级 xterm 大版本时 break | 隔离为独立模块（`viModeLayer.ts` / `hintLayer.ts`），只依赖公开 API（registerDecoration/onKey/selection），xterm 升级时先跑兼容性回归（P3 的网） |
| addon-search / addon-webgl 体积与 CSP | 包体增长 | 两个 addon 均按需 `import()`（沿用现有懒加载模式）；webgl 加 feature 开关可回退 canvas |
| P1 焦点事件 hack 在 tmux 老版本不生效 | 验收口径漂移 | e2e 限定 tmux 版本断言，文档注明依赖版本 |

## 八、验收总览（checklist）

- [ ] P0.1 搜索可用（打开/高亮/前后向/大小写/Esc），e2e + 单测齐
- [ ] P0.2 默认快捷键表生效且不与全局冲突（冲突用例列入 e2e）
- [ ] P0.3 OSC 0/2 标题联动标签与窗口
- [ ] P0.4 Bell 视觉提示触发（配置可关）
- [ ] P0.5 `[terminal]` 配置节扩展 + 默认合并单测
- [ ] P1.1 OSC 52 四档策略矩阵单测通过，默认 OnlyCopy
- [ ] P1.2 OSC 7 cwd 驱动文件树根切换（本地 + SSH）
- [ ] P1.3 超链接 hover/点击/右键复制链接
- [ ] P1.4 语义选择 + 右击选词 + 选中即复制（开关）
- [ ] P1.5 焦点事件在 tmux 会话生效（e2e）
- [ ] P1.6 搜索 match 计数 + 当前 match 强调配色
- [ ] P2.1 Vi 模式最小 motion 集 + 选择复制（e2e）
- [ ] P2.2 URL hints 键盘标签跳转
- [ ] P2.3 kitty 协议评估结论（实现或明确缓做）
- [ ] P2.4 WebGL 渲染回退开关 + 压力场景无长帧
- [ ] P3 各项按独立任务验收（兼容性网 / 分屏 / 选择缓冲 / 监控 / scrollback 配置）
- [ ] 每期结束 `yarn tsc && yarn test`（paid-free 姿势）+ 相关 wdio e2e 全绿
