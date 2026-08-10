# hip 终端能力补齐 PLAN（对照 alacritty 差距分析）

> 状态：PLAN 定稿 · **P0 已执行完毕（2026-08-10）** · P1–P3 待排期
> 关联：`docs/design/doc-terminal-capability-gap/terminal-capability-gap-spec.md`（差距矩阵与验收标准）、
> `terminal-capability-gap-preview.html`（高保真原型）
> 执行轮次：**P0 全量已完成**；P1–P3 为后续轮次，本 plan 仅记录范围与依赖，不展开任务。

## 〇、P0 执行记录（2026-08-10）

| 任务 | 落地 | 验证 |
|---|---|---|
| T1 搜索 | `@xterm/addon-search@0.16.0`；`TerminalSearchBar.tsx`（受控组件）；XtermSurface 集成（lazy import、incremental + decorations、计数/前后向/大小写） | `TerminalSearchBar.test.tsx` 6 用例；TerminalView 集成 2 用例；e2e 2 用例 |
| T2 快捷键 | `src/lib/terminalKeymap.ts` 纯函数键表（copy/paste/clear/search/font±reset/scroll/restart），attachCustomKeyEventHandler 消费；复制走既有 clipboard 桥，粘贴走 `term.paste`（bracketed） | `terminalKeymap.test.ts` 7 用例 |
| T3 标题 | `terminalStore.title` + `setTitle`（空串=重置）；`onTitleChange` 接线；`ManagedTerminalSession` chrome + 窗口标题联动（卸载恢复）；`TerminalView` chrome badge | `terminalStore.test.ts` 4 用例；TerminalView 1 用例 |
| T4 Bell | `onBell` → 顶部闪烁条 700ms；`[terminal].bell=off` 静默 | TerminalView 2 用例 |
| T5 配置 | protocol `TerminalConfig.bell`；Rust `TerminalConfig/TomlTerminalConfig.bell`（round-trip）；`GeneralSettings` bell 下拉；i18n 五语言全量补 key | Rust `cargo test` 281 全绿；`GeneralSettings.test.tsx` 2 用例；translation-keys 11 用例 |
| T6 验收 | `yarn tsc` 全绿；全量 vitest 7850 passed；e2e `terminal-features.spec.ts` @smoke 2/2 | — |

**e2e 备注**：真实 PTY 键盘注入在 WKWebView 下不可靠（WebDriver keys 双发字符、合成 InputEvent 不被信任），OSC 0/2 标题链路由单测覆盖（`TerminalView.test.tsx`），e2e 保留搜索两项稳定用例。

## 一、范围与轮次

| 轮次 | 范围 | 状态 |
|---|---|---|
| 本轮 | **P0 全量**：搜索 / 快捷键 / OSC 0·2 标题 / Bell / [terminal] 配置集中化 | ✅ 已完成（2026-08-10） |
| 后续 | P1：OSC 52、OSC 7 cwd、超链接、选择增强、DECSET 1004、搜索增强 | 待排期 |
| 后续 | P2：Vi 模式、Hints、Kitty 协议（先评估）、WebGL | 待排期 |
| 后续 | P3：兼容性回归网、分屏、选择缓冲、监控、scrollback 配置化 | 待排期 |

**执行原则**（AGENTS.md §1–§3）：
- 全部改动在 xterm 宿主层 / store 层 / 配置层，**Rust 后端零改动**（仅 hip_config 配置字段同步）。
- 新增逻辑必须可单测：键表 = 纯函数；搜索条 = 受控组件；标题 = store 字段。
- 不引入新 UI 框架；沿用现有上下文菜单桥 / lazy import / hipConfigStore 模式。

## 二、P0 任务分解

### T1 终端内搜索（P0.1）
- 依赖：新增 `@xterm/addon-search`（0.16.0）。
- 改动：
  - `src/components/artifact/TerminalSearchBar.tsx`（新）：受控搜索条（输入 / 计数 / Aa / ↑ ↓ / 关闭），
    props 驱动，无 xterm 依赖 → 独立单测。
  - `XtermSurface.tsx`：lazy import SearchAddon（与 FitAddon 同 Promise.all）；搜索条浮层渲染于
    terminal 容器顶部（对齐 preview）；状态 searchOpen/searchQuery/caseSensitive/currentIndex。
  - 快捷键 ⌘/Ctrl+F 打开（见 T2 键表）。
- 验收：`TerminalSearchBar.test.tsx` 渲染与回调全绿；e2e 打开搜索条断言可见。

### T2 终端快捷键体系（P0.2）
- 新增 `src/lib/terminalKeymap.ts`：纯函数 `matchTerminalKey(e) → TerminalKeyAction | null`，
  表驱动（复制 / 粘贴 / 清屏 / 搜索 / 字号±reset / 滚动顶底 / 重启 / 关闭）。
- `XtermSurface.tsx`：`attachCustomKeyEventHandler` 消费键表（返回 false 阻止 xterm 转发），
  动作实现：
  - copy：`term.getSelection()` → `copyText()`（复用 `src/ipc/clipboard.ts`）
  - paste：`readText()` → `term.paste()`（尊重 bracketed paste）
  - clear：`term.clear()`；search：开关搜索条；font：`term.options.fontSize`（clamp 10–18）；
  - scroll-top/bottom：`term.scrollToTop()/scrollToBottom()`
- 冲突处理：终端聚焦时终端优先；⌘K 全局调色板保留（键表不含 K）；⌘F 与全局搜索的冲突
  以「终端聚焦上下文分派」处理（现有全局 Cmd+F 不存在，安全）。
- 验收：`terminalKeymap.test.ts` 表驱动全绿（mac meta / win ctrl / 修饰键组合 / 冲突键返回 null）。

### T3 OSC 0/2 标题接线（P0.3）
- `src/store/terminalStore.ts`：`SessionPtyUi.title?: string` + `setTitle(sessionId, title)`
  （空串忽略；clearSession 时清理）。
- `XtermSurface.tsx`：`term.onTitleChange` → `setTitle(terminalId, title)`（仅 attached 终端写）。
- `ManagedTerminalSession.tsx`：chrome `managed-terminal-title` 显示
  `store.title ?? term.title`（OSC2 优先）；`TerminalView.tsx`（代码面板）同理在 chrome 显示。
- 窗口标题：`ManagedTerminalSession` 挂载/标题变化时 `getCurrentWindow().setTitle(...)`，
  卸载恢复默认（守卫：仅终端管理页聚焦时生效，不做全局覆盖）。
- 验收：`terminalStore.test.ts` 补 setTitle 用例；e2e 执行 `printf '\e]0;hello\a'` 断言 chrome 文本。

### T4 Bell 接线（P0.4）
- `XtermSurface.tsx`：`term.onBell` → 视觉提示（容器顶部 flash 条 + status 区短暂 bell 图标），
  data-testid 暴露供测试；`[terminal].bell = 'off'` 时禁用（见 T5）。
- 验收：`TerminalView.test.tsx`/新 XtermSurface 测试断言 onBell 后 flash 元素出现。

### T5 [terminal] 配置集中化（P0.5）
- `packages/protocol/src/hip-config.ts`：`TerminalConfig.bell?: 'visual' | 'off'`（默认 visual）。
- `src-tauri/src/hip_config.rs`：`TerminalConfig` + `TomlTerminalConfig` 加 `bell` 字段（String），
  round-trip 测试补 bell。
- `src/components/account/GeneralSettings.tsx`：bell 模式选择（沿用 colorTheme 下拉模式）；
  `src/i18n/zh-CN.ts` / `en.ts` 补文案。
- 验收：Rust `cargo test` 配置 round-trip；`GeneralSettings.test.tsx` 补 bell 设置用例；
  设置保存后 `hipConfigStore` 生效。

### T6 测试与验收（横切）
- 单测：T1–T5 全部补测；`yarn tsc` 全绿。
- e2e：新增 `e2e/specs/terminal-features.spec.ts`（搜索条打开 / 标题 OSC2 更新 / bell 计数 /
  快捷键复制粘贴冒烟），随现有 wdio 基建运行。
- 运行姿势：`yarn test` 前按 CLAUDE.md 将 `~/.hip/config/auth.json` 移走（paid-free）。

## 三、文件清单

| 文件 | 动作 |
|---|---|
| `package.json` | +`@xterm/addon-search` |
| `src/lib/terminalKeymap.ts` · `terminalKeymap.test.ts` | 新建 |
| `src/components/artifact/TerminalSearchBar.tsx` · `.test.tsx` | 新建 |
| `src/components/artifact/XtermSurface.tsx` | 集成 T1–T4 |
| `src/store/terminalStore.ts` · `.test.ts` | title 字段 + setTitle |
| `src/components/terminals/ManagedTerminalSession.tsx` | 标题联动 + 窗口标题 |
| `src/components/artifact/TerminalView.tsx` | 标题联动（代码面板 chrome） |
| `packages/protocol/src/hip-config.ts` | TerminalConfig.bell |
| `src-tauri/src/hip_config.rs` | bell 字段 + round-trip 测试 |
| `src/components/account/GeneralSettings.tsx` · `.test.tsx` | bell 设置项 |
| `src/i18n/zh-CN.ts` · `en.ts` | 文案 |
| `e2e/specs/terminal-features.spec.ts` | 新建（冒烟） |

## 四、风险与缓解（P0 内）

| 风险 | 缓解 |
|---|---|
| ⌘/Ctrl+Shift+C/V 与系统/WebView 粘贴冲突 | 键表先于 xterm 默认处理；mac 上 Cmd+Shift+C 无系统占用；e2e 覆盖 |
| addon-search 体积 | 与 FitAddon 同一 lazy import 路径，按需加载 |
| onTitleChange 高频触发 | setTitle 幂等（同值不写），无订阅放大 |
| 窗口标题覆盖应用标题 | 仅管理页聚焦 + 卸载恢复 "hip"；不碰全局标题逻辑 |
