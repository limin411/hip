# 终端内核替换：集成 libghostty-vt Spec

- 系列：`docs/design/terminal-ghostty-kernel/`
- 配套：`terminal-ghostty-kernel-plan.md`（执行计划）
- 状态：草案待评审
- 日期：2026-08-27
- 前置基线：
  - `docs/design/terminal-capability-upgrade/terminal-capability-upgrade-spec.md`（终端能力现代化升级，待实施）
  - `docs/design/terminal-shared-pty/terminal-shared-pty-spec.md`（共享终端协同整改，P0–P1 已完成）
  - `docs/design/terminal-agent-comprehensive-improvement/`（运维助手全面改进，待实施）
- 涉及模块：
  - `src-tauri/src/pty.rs`（PTY 后端 — 保留）
  - `src-tauri/src/ssh_session.rs`（SSH 会话 — 保留）
  - `src/components/artifact/XtermSurface.tsx`（终端渲染层 — 改造）
  - `src/store/terminalStore.ts`（ring buffer — 替换）
  - `src/components/artifact/terminalEnhancements.ts`（渲染增强 — 适配）
  - `src/components/artifact/terminalProtocols.ts`（OSC 协议 — 迁移到 Rust 侧）
  - `src/components/artifact/terminalTheme.ts`（主题 — 适配）
  - `src-tauri/src/ghostty_backend.rs`（**新增**：libghostty-vt 集成层）
  - `src-tauri/src/ghostty_render_bridge.rs`（**新增**：Grid diff → JS 传输）

---

## 1. 根因：xterm.js 内核的结构性局限

### 1.1 现状架构

```
PTY/SSH → base64 events → JS terminalStore.ring → xterm.js VT Parser → Canvas/WebGL
```

xterm.js 同时承担 **VT 解析** 和 **渲染** 两个职责。这是一个浏览器时代的终端模拟器，存在以下结构性瓶颈：

| # | 局限 | 影响 | 量化 |
|---|------|------|------|
| K1 | VT 解析器运行在 JS JIT 上，无 SIMD | 高吞吐场景（`cat` 大文件、编译输出）帧率不足 | Ghostty SIMD 路径 5–10x 吞吐差距 |
| K2 | Grid 存储为 JS 对象数组，GC 压力大 | 大 scrollback 时内存暴涨 + 偶发 GC 卡顿 | 10K 行 scrollback: xterm ~10MB vs Ghostty LZ4 ~2MB |
| K3 | 无 Kitty Graphics / Sixel / iTerm2 图片协议 | AI 生成图表无法在终端内联显示 | 协议完整度 ~60% vs Ghostty 100% |
| K4 | 无 Kitty Keyboard Protocol | vim/neovim 用户键入歧义 | 现代终端标配 |
| K5 | scrollback 是纯文本数组，无压缩 | 内存线性增长 | Ghostty LZ4 压缩节省 60–80% |
| K6 | 样式未引用计数去重 | 相同样式重复存储 | Ghostty Style ref_counted_set |
| K7 | 无终端状态快照/序列化 | 断电/崩溃后无法恢复 | Ghostty Snapshot 格式 |
| K8 | 无命令边界感知 | 运维助手靠猜 prompt 判定完成 | 需要 OSC 133 + Grid 语义 |
| K9 | termios 不感知 | 无法检测密码输入模式 | 需要 PTY 层配合 |

### 1.2 为什么选择 libghostty-vt 而非增强 xterm.js

| 维度 | 增强 xterm.js | 集成 libghostty-vt |
|------|---------------|-------------------|
| VT 解析性能 | 受 JS 运行时硬上限约束 | 原生 Zig + SIMD，理论最优 |
| 协议支持 | 需逐个开发 addon | 开箱即用（Kitty Graphics/Keyboard/Sixel/DCS） |
| 内存效率 | JS 对象模型无法优化 | Page-based + LZ4 压缩 |
| 维护成本 | 依赖 xterm.js 上游发布节奏 | libghostty-vt 活跃开发中，API 在收敛 |
| 渲染层 | 保留 xterm.js Canvas/WebGL | 可保留 xterm.js 做渲染，或渐进替换 |
| 风险 | 低（增量改进） | 中（架构变更） |

**结论**：xterm.js 的 VT 解析器和 Grid 存储是性能和协议的双重瓶颈。libghostty-vt 提供了完整的 Rust crate（`libghostty-vt` on crates.io），可以直接集成到 Tauri Rust 后端，获得原生性能和全部现代终端协议。

---

## 2. 目标架构

### 2.1 数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│  React UI                                                           │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ XtermSurface (改造后)                                       │    │
│  │  - xterm.js 仅做渲染 (write VT 序列 / 接收 grid diff)      │    │
│  │  - 不再订阅 PTY 数据流                                      │    │
│  │  - 输入事件 → Tauri IPC → Rust                             │    │
│  └─────────────────────────────────────────────────────────────┘    │
├─────────────────────────────────────────────────────────────────────┤
│  Tauri IPC                                                          │
│  - pty:write       JS → Rust (键盘输入)                             │
│  - ghostty:diff    Rust → JS (grid cell 增量更新)                   │
│  - ghostty:effect  Rust → JS (bell/title/clipboard/cwd 事件)       │
│  - ghostty:resize  JS → Rust (窗口尺寸变化)                         │
├─────────────────────────────────────────────────────────────────────┤
│  Rust (src-tauri)                                                   │
│  ┌──────────────────────────────────────────────┐                  │
│  │ ghostty_backend.rs                            │                  │
│  │  libghostty_vt::Terminal<'alloc, 'cb>         │                  │
│  │   .vt_write(pty_bytes)    ← PTY/SSH reader   │                  │
│  │   .on_bell(...)           ← effect callbacks  │                  │
│  │   .on_title_changed()                          │                  │
│  │   .on_pty_write()         ← shell responses   │                  │
│  │   .on_clipboard_write()   ← OSC 52            │                  │
│  │   .resize(cols, rows)                          │                  │
│  │   .compress_scrollback()  ← idle LZ4          │                  │
│  ├──────────────────────────────────────────────┤                  │
│  │ ghostty_render_bridge.rs                      │                  │
│  │  RenderState → cell diff → Tauri emit         │                  │
│  └──────────────────────────────────────────────┘                  │
│  pty.rs (保留) — portable-pty ConPTY/POSIX                         │
│  ssh_session.rs (保留) — russh SSH 客户端                           │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 模块职责划分

| 模块 | 职责 | 语言 |
|------|------|------|
| `libghostty-vt::Terminal` | VT 解析、Grid 状态、模式管理、scrollback | Rust (Zig 编译) |
| `ghostty_backend.rs` | Terminal 生命周期、PTY/SSH 数据管道、effect 桥接 | Rust |
| `ghostty_render_bridge.rs` | RenderState → cell diff 编码、Tauri emit | Rust |
| `XtermSurface.tsx` (改造) | 接收 diff → xterm.write() 渲染、输入转发 | TypeScript |
| `terminalStore.ts` (改造) | effect 事件存储（bell/title/cwd）、不再持有 ring | TypeScript |
| `pty.rs` (保留) | PTY 创建/读写/进程管理 | Rust |
| `ssh_session.rs` (保留) | SSH 连接/读写/SFTP | Rust |

---

## 3. 核心设计

### 3.1 Rust 侧：Terminal 生命周期管理

**新增 `ghostty_backend.rs`**

每个终端会话对应一个 `Terminal<'static, 'static>` 实例，运行在专用线程上。

```
GhosttySession {
    terminal: Terminal<'static, 'static>,
    render_state: RenderState,
    pty_sender: mpsc::Sender<Vec<u8>>,    // → PTY write
    event_sender: mpsc::Sender<Effect>,   // → JS effect 通道
    diff_sender: mpsc::Sender<GridDiff>,  // → JS render 通道
}
```

**生命周期**：
1. `ghostty_open(session_id, cols, rows)` → 创建 Terminal + 专用线程
2. PTY reader 线程产出数据 → `terminal.vt_write(bytes)`
3. `vt_write` 触发 effect callbacks → 通过 channel 发送到 JS
4. 渲染桥读取 `RenderState` → 编码 diff → Tauri emit 到 JS
5. JS 输入事件 → `ghostty_write(session_id, data)` → `pty_write`
6. 窗口 resize → `terminal.resize(cols, rows)`
7. 会话关闭 → `terminal.compress_scrollback()` 最终压缩 → 释放

### 3.2 Grid Diff 传输协议

**设计目标**：每次 `vt_write` 后，将终端状态变化高效传输到 JS。

**编码格式**（二进制，通过 Tauri `emit` 的 `Vec<u8>` 传输）：

```
Header:
  [version: u8 = 1]
  [cols: u16]
  [rows: u16]
  [cursor_x: u16]
  [cursor_y: u16]
  [cursor_visible: u8]
  [diff_count: u32]

Cell Diff (重复 diff_count 次):
  [x: u16]           // 列
  [y: u16]           // 行
  [codepoint: u32]   // Unicode codepoint (0 = 空 cell)
  [fg: u32]          // 前景色 RGB (0x00RRGGBB) + 标志位
  [bg: u32]          // 背景色 RGB
  [attrs: u16]       // bold/italic/underline/strikethrough/blink/inverse
```

**性能估算**：
- 全屏更新 (80×24 = 1920 cells): 1920 × 15 + 14 ≈ 29KB
- 增量更新 (典型 10–50 cells): 150–750 bytes
- 60fps 极端场景: 29KB × 60 = 1.7MB/s（远低于 USB 键盘回报率）

### 3.3 Effect 事件通道

libghostty-vt 的 effect callbacks 在 `vt_write` 期间同步调用。通过 channel 异步发送到 JS：

```rust
enum GhosttyEffect {
    Bell,
    TitleChanged(String),
    CwdChanged(String),
    ClipboardWrite { data: String },
    PtyWrite(Vec<u8>),           // shell 响应（DECRQM 等）
    Xtwinops { cols: u16, rows: u16 }, // shell 请求窗口尺寸
}
```

JS 侧通过 Tauri `listen('ghostty:effect', ...)` 接收。

### 3.4 渲染层改造策略

**渐进式方案**（Phase 1 → Phase 2 → Phase 3）：

**Phase 1：VT 序列回放（最小改动）**

利用 libghostty-vt 的 `Formatter` API 将终端状态重新输出为 VT 序列，喂给 xterm.js：

```
PTY bytes → Terminal.vt_write() → Formatter → VT 序列 → xterm.write()
```

- xterm.js 不再直接订阅 PTY 数据
- xterm.js 只负责渲染 Formatter 输出的 VT 序列
- **改动最小**：XtermSurface 的 `open/write/resize` 接口基本不变

**Phase 2：RenderState Cell Diff（性能优化）**

替换 VT 序列回放为二进制 cell diff：

```
PTY bytes → Terminal.vt_write() → RenderState.update() → cell diff → Canvas 直绘
```

- xterm.js 的 `write()` API 用于 VT 序列；cell diff 需要自定义渲染路径
- 可以用 xterm.js 的 `buffer` API + `writeSync` 注入，或自建 Canvas 渲染器

**Phase 3：自建 Canvas/WebGL 渲染器（可选，长期）**

完全替代 xterm.js，用 Canvas 2D 或 WebGL 直接渲染 cell grid：

- 性能最优（消除 xterm.js 的抽象层）
- 维护成本最高
- 仅在 Phase 2 性能不满足需求时实施

### 3.5 输入处理

输入路径保持不变：

```
键盘事件 → xterm.onData(data) → Tauri IPC pty_write → PTY/SSH write
```

libghostty-vt 的 `key::Encoder` 和 `mouse::Encoder` 提供 Kitty Keyboard Protocol 编码，可在 Phase 2+ 替代 xterm.js 的键盘处理。

### 3.6 PTY/SSH 后端保留

`pty.rs` 和 `ssh_session.rs` 保持不变。它们只负责：
- PTY 创建/读写/进程管理
- SSH 连接/读写/SFTP

数据流变为：

```
pty_reader thread → channel → ghostty_backend thread → Terminal.vt_write()
```

原来 `pty_reader → Tauri emit('pty:data') → JS` 的路径被替换。

### 3.7 与运维助手的集成

libghostty-vt 集成后，运维助手获得以下能力提升：

| 能力 | 现状 | libghostty-vt 后 |
|------|------|------------------|
| 命令边界 | 靠猜 prompt | Selection API + OSC 133 精确切分 |
| 输出提取 | 整段 ring 截取 | 命令块精确提取，不含回显 |
| 完成判定 | 正则启发式 | `on_pty_write` 响应 + 围栏信号 |
| 密码检测 | 无 | termios 轮询（可扩展） |
| Grid 语义 | 无 | `grid_ref()` 遍历，支持选择/搜索 |

---

## 4. 配置扩展

### 4.1 hip.toml `[terminal]` 新增字段

```toml
[terminal]
# 现有字段
shell = "default"           # cmd | powershell | pwsh | bash | zsh | default
color_theme = "follow"      # follow | light | dark | 预设名
bell = "visual"             # visual | off

# 新增字段
backend = "ghostty"         # ghostty | legacy (默认 ghostty)
max_scrollback = 10000      # scrollback 行数（默认 10000）
compression = true          # LZ4 scrollback 压缩（默认 true）
kitty_graphics = true       # Kitty 图片协议（默认 true）
kitty_keyboard = false      # Kitty 键盘协议（默认 false，Phase 2+）
```

### 4.2 JSON 配置（UI 使用）

```json
{
  "terminal": {
    "backend": "ghostty",
    "shell": "default",
    "colorTheme": "follow",
    "bell": "visual",
    "maxScrollback": 10000,
    "compression": true,
    "kittyGraphics": true,
    "kittyKeyboard": false
  }
}
```

---

## 5. 验收标准

### 5.1 功能验收

| # | 验收项 | 判定标准 |
|---|--------|----------|
| F1 | PTY 终端基本功能 | 打开终端、输入命令、看到输出、resize 正常 |
| F2 | SSH 终端基本功能 | SSH 连接远程主机、交互正常 |
| F3 | Shell 切换 | cmd/powershell/pwsh/bash/zsh 全部正常 |
| F4 | 色彩主题 | follow/light/dark/预设 切换正常 |
| F5 | Bell 通知 | visual 闪烁 + off 静默 |
| F6 | 搜索 | Ctrl+F 增量搜索正常 |
| F7 | 复制粘贴 | Ctrl+C/Ctrl+V + 右键菜单 |
| F8 | 字号调整 | Ctrl+/-/0 正常 |
| F9 | 滚动 | 鼠标滚轮 + Shift+PageUp/Down |
| F10 | 退出/重启 | shell 退出后可重启 |
| F11 | 多终端 | 8 个终端同时打开正常 |
| F12 | OSC 标题 | shell 设置标题后 chrome 显示 |
| F13 | OSC 超链接 | URL 可点击打开 |
| F14 | OSC 剪贴板 | OSC 52 写入剪贴板 |
| F15 | 连字 | JetBrains Mono `=>` `->` 正确渲染 |
| F16 | Nerd Font | 图标正确显示 |
| F17 | CJK 字符 | 中日韩字符对齐正确 |
| F18 | Emoji | 正确宽度渲染 |

### 5.2 性能验收

| # | 验收项 | 判定标准 |
|---|--------|----------|
| P1 | `cat` 大文件帧率 | `cat /dev/urandom \| base64 \| head -100000` 不卡顿，帧率 ≥ 30fps |
| P2 | 内存占用 | 10K 行 scrollback 内存 ≤ 5MB（含 LZ4 压缩） |
| P3 | 启动延迟 | 终端打开到首字符显示 ≤ 200ms |
| P4 | Resize 响应 | 窗口 resize 到 Grid 刷新 ≤ 100ms |
| P5 | 增量更新大小 | 典型命令输出 diff ≤ 1KB |

### 5.3 协议验收

| # | 验收项 | 判定标准 |
|---|--------|----------|
| T1 | Kitty Graphics | `kitten icat image.png` 显示图片 |
| T2 | Kitty Keyboard | vim 正确识别所有修饰键组合 |
| T3 | Sixel Graphics | `lsix` 显示缩略图 |
| T4 | OSC 133 | shell prompt 标记正确（Powerlevel10k/starship） |
| T5 | Synchronized Output | `while true; do echo $RANDOM; done` 无撕裂 |
| T6 | OSC 9/7 | CWD 跟踪正确 |

### 5.4 兼容性验收

| # | 验收项 | 判定标准 |
|---|--------|----------|
| C1 | legacy 后端回退 | `backend = "legacy"` 时使用原 xterm.js 路径 |
| C2 | Windows | ConPTY 终端正常工作 |
| C3 | macOS | PTY 终端正常工作 |
| C4 | Linux | PTY 终端正常工作 |
| C5 | AI 工具集成 | `terminal_exec` / `terminal_read` 工具正常 |
| C6 | 运维助手 | 命令执行 + 输出读取正常 |

---

## 6. 约束与边界

### 6.1 不做的事

- 不替换 xterm.js 的 UI 组件（搜索栏、右键菜单、状态栏）
- 不改动 PTY/SSH 后端的进程管理逻辑
- 不改动 AI 工具接口（terminal_exec/terminal_read/sftp）
- 不在 Phase 1 实现自定义 Canvas 渲染器

### 6.2 向后兼容

- `backend = "legacy"` 保留原 xterm.js 路径作为回退
- 现有 `[terminal]` 配置字段全部保留
- 现有 Tauri 命令（pty_open/write/resize/kill）保留，新增 ghostty_* 命令

### 6.3 依赖风险

| 依赖 | 版本 | 风险 | 缓解 |
|------|------|------|------|
| `libghostty-vt` | 0.2.x | API 未稳定 | 锁定版本，升级前回归测试 |
| `libghostty-vt-sys` | 0.2.x | Zig 编译链 | 使用 vendored 预编译模式 |
| xterm.js | 6.0 | 保持不变 | Phase 1 不改 xterm.js 内部 |
| Tauri v2 | 2.x | emit 二进制数据 | 已有 base64 传输路径 |

---

## 7. 术语表

| 术语 | 定义 |
|------|------|
| libghostty-vt | Ghostty 终端模拟器核心提取的 C/Zig 库，提供 Rust crate |
| Terminal | libghostty-vt 的核心类型，管理完整终端状态 |
| RenderState | 增量渲染状态，跟踪 Grid 脏区域 |
| GridRef | Grid 中某个 cell 的引用，用于遍历 |
| Cell Diff | 两个渲染帧之间的 cell 变化集合 |
| VT 序列 | 终端控制序列（ANSI escape sequences） |
| Effect | VT 序列处理过程中触发的副作用回调 |
| Formatter | 将终端内容格式化为 VT 序列/纯文本/HTML 的工具 |
| Page | Ghostty 的 Grid 存储单元，连续内存块 |
| LZ4 | 无损压缩算法，用于 scrollback 压缩 |
