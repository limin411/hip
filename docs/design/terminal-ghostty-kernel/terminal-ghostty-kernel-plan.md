# 终端内核替换：集成 libghostty-vt 执行计划

- 系列：`docs/design/terminal-ghostty-kernel/`
- 配套：`terminal-ghostty-kernel-spec.md`（根因 K1–K9 + 架构设计 + 验收 30 项）
- 状态：草案待评审
- 日期：2026-08-27
- 前置：
  - `terminal-capability-upgrade` 待实施（终端能力现代化升级）
  - `terminal-shared-pty` P0–P1 已落地
  - `terminal-agent-comprehensive-improvement` 待实施
- 约束：
  - 本系列不改动 PTY/SSH 后端的进程管理逻辑
  - `backend = "legacy"` 保留原 xterm.js 路径作为回退
  - Phase 1 使用 VT 序列回放（Formatter），不做自定义渲染器
  - libghostty-vt API 未稳定，锁定版本 + 升级回归测试

---

## 1. 策略

### 1.1 核心原则

1. **PoC 验证先行**（PR-0）：在改动任何生产代码前，先验证 libghostty-vt 在 Tauri 构建环境中能编译、Terminal API 能工作、Formatter 输出的 VT 序列能被 xterm.js 正确渲染。PoC 失败则回退到 Path A（增强 xterm.js）。

2. **VT 序列回放优先**（PR-1）：Phase 1 用 Formatter 将 libghostty-vt 的 Grid 状态重新输出为 VT 序列喂给 xterm.js。这样 xterm.js 只做渲染，不做解析。改动最小，风险最低。

3. **渐进替换**：Phase 1 替换 VT 解析层 → Phase 2 替换渲染传输层 → Phase 3 可选替换 xterm.js。每一步都可独立回退。

4. **保留回退路径**：`backend = "legacy"` 配置项保留原 xterm.js 路径。如果 ghostty 后端有问题，用户可以切回。

5. **PTY/SSH 不动**：`pty.rs` 和 `ssh_session.rs` 的进程管理逻辑不变，只改变数据流路径（从直接 emit JS 改为喂入 Terminal）。

### 1.2 风险缓解策略

| 风险 | 概率 | 缓解 |
|------|------|------|
| libghostty-vt 在 Windows 构建失败 | 中 | PR-0 首先验证；备选：仅 Windows 用 legacy |
| Formatter VT 回放有性能损失 | 中 | Phase 2 用 RenderState cell diff 替代 |
| xterm.js 对 Formatter 输出的序列处理有差异 | 中 | PR-0 对比测试；必要时调整 Formatter 选项 |
| libghostty-vt API breaking change | 高 | 锁版本 + 全面回归测试 |
| Zig 工具链在 CI 中不可用 | 低 | 使用 vendored 预编译静态库 |

---

## 2. 依赖图

```
PR-0  PoC 验证 (1–2 天)
  │
  ├── 验证通过 ──▶ PR-1  Rust Terminal 后端 (3–5 天)
  │                    │
  │                    └──▶ PR-2  JS 渲染层适配 (2–3 天)
  │                              │
  │                              └──▶ PR-3  效果通道 + 配置 (2–3 天)
  │                                        │
  │                                        └──▶ PR-4  性能优化 + LZ4 (2–3 天)
  │                                                  │
  │                                                  └──▶ PR-5  协议增强 (持续)
  │
  └── 验证失败 ──▶ 回退到 Path A (增强 xterm.js)
```

### 依赖关系说明

- **串行**：PR-0 → PR-1 → PR-2 → PR-3 → PR-4 → PR-5（每步依赖前一步的产出）
- **不可并行**：本系列是架构替换，各 PR 高度耦合，不适合并行开发
- **回退点**：PR-0 失败则回退；PR-1/PR-2 完成后可通过 `backend = "legacy"` 回退

---

## 3. PR 明细

### PR-0  PoC 验证（1–2 天）

**目标**：验证 libghostty-vt 在项目环境中可构建、可运行、与 xterm.js 可集成。

**范围**：
- 新增 `src-tauri/src/ghostty_poc.rs`（测试模块，不影响生产代码）
- 新增 `src-tauri/Cargo.toml` 中 `libghostty-vt` 依赖
- 新增 `docs/design/terminal-ghostty-kernel/poc/` 测试结果记录

**验证项**：

| # | 验证项 | 判定标准 | 失败则 |
|---|--------|----------|--------|
| V1 | `cargo add libghostty-vt` 成功 | crate 解析 + 编译无报错 | 尝试 `libghostty-vt-sys` vendored |
| V2 | `Terminal::new()` + `vt_write()` 正常 | 单元测试通过 | 检查 Zig 工具链 |
| V3 | `Formatter` 输出 VT 序列 | `echo "hello"` → 可见 VT 序列输出 | 检查 Formatter API |
| V4 | VT 序列被 xterm.js 正确渲染 | 手动 `term.write(vt_seq)` 显示 "hello" | 调整 Formatter 选项 |
| V5 | Windows 构建成功 | `cargo build --target x86_64-pc-windows-msvc` | 尝试 cross 编译 |
| V6 | macOS 构建成功 | `cargo build --target aarch64-apple-darwin` | 检查 Zig macOS 支持 |
| V7 | Linux 构建成功 | `cargo build --target x86_64-unknown-linux-gnu` | — |

**产出**：
- PoC 测试文件（含 `#[test]` 单元测试）
- 构建结果记录（三个平台）
- xterm.js 渲染截图对比
- 决策：通过 → 进入 PR-1；失败 → 回退 Path A

**验收**：
- `cargo test ghostty_poc` 通过
- 手动验证 xterm.js 渲染 Formatter 输出正确

---

### PR-1  Rust Terminal 后端（3–5 天）

**目标**：建立 `ghostty_backend.rs`，实现 Terminal 生命周期管理和 PTY 数据管道。

**范围**：
- 新增 `src-tauri/src/ghostty_backend.rs`
- 新增 `src-tauri/src/ghostty_render_bridge.rs`
- 修改 `src-tauri/src/lib.rs`（注册新模块 + Tauri 命令）
- 修改 `src-tauri/Cargo.toml`（正式添加 libghostty-vt 依赖）

**新增 Tauri 命令**：

```rust
#[tauri::command]
fn ghostty_open(
    state: State<'_, GhosttyManager>,
    budget: State<'_, TerminalBudget>,
    session_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<GhosttyOpenResult, String>

#[tauri::command]
fn ghostty_write(
    state: State<'_, GhosttyManager>,
    session_id: String,
    data: String,
) -> Result<(), String>

#[tauri::command]
fn ghostty_resize(
    state: State<'_, GhosttyManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String>

#[tauri::command]
fn ghostty_kill(
    state: State<'_, GhosttyManager>,
    budget: State<'_, TerminalBudget>,
    session_id: String,
) -> Result<(), String>

#[tauri::command]
fn ghostty_scroll(
    state: State<'_, GhosttyManager>,
    session_id: String,
    delta: i32,
) -> Result<(), String>
```

**核心数据结构**：

```rust
pub struct GhosttyManager {
    sessions: Mutex<HashMap<String, GhosttySession>>,
    next_generation: AtomicU64,
}

struct GhosttySession {
    terminal: Terminal<'static, 'static>,
    render_state: RenderState,
    writer: Mutex<Box<dyn Write + Send>>,   // PTY writer
    alive: Arc<AtomicBool>,
    generation: u64,
    event_tx: mpsc::Sender<GhosttyEffect>,
    diff_tx: mpsc::Sender<Vec<u8>>,
}
```

**数据管道**：

```
PTY Reader Thread
    │
    ├── 原路径: emit('pty:data', base64) → JS terminalStore → xterm.write()
    │
    └── 新路径: channel → Ghostty Thread → terminal.vt_write()
                                              │
                                              ├── effect callbacks → event_tx → emit('ghostty:effect')
                                              └── RenderState.update() → diff_tx → emit('ghostty:diff')
```

**Formatter 集成**：

```rust
// 在 vt_write 之后，获取 VT 序列输出
let formatter = FormatterTerminal::new(
    &terminal,
    FormatterTerminalOptions {
        emit: FormatterFormat::Vt,
        trim: true,
        ..Default::default()
    },
)?;
let vt_bytes = formatter.format_alloc()?;
// 通过 diff_tx 发送到 JS
diff_tx.send(vt_bytes)?;
```

**验收**：
- `cargo test` 通过（含 GhosttyManager 生命周期测试）
- `cargo build` 三平台成功
- Tauri 命令可通过前端调用
- PTY 数据经 Terminal 处理后，Formatter 输出正确

---

### PR-2  JS 渲染层适配（2–3 天）

**目标**：改造 XtermSurface，使其从 Rust 接收 VT 序列而非直接订阅 PTY 数据。

**范围**：
- 修改 `src/components/artifact/XtermSurface.tsx`
- 修改 `src/ipc/ghostty.ts`（**新增**：ghostty Tauri 命令封装）
- 修改 `src/store/terminalStore.ts`（适配新数据源）
- 修改 `src/components/artifact/codeTerminalController.ts`（后端选择）

**核心改动**：

```typescript
// XtermSurface.tsx 改动

// 1. 根据 backend 选择数据源
if (backend === 'ghostty') {
  // 新路径：监听 Rust 发来的 VT 序列
  const unlisten = await listen<GhosttyDiffPayload>(
    'ghostty:diff',
    (event) => {
      if (event.payload.sessionId === terminalId) {
        // Formatter 输出的 VT 序列，直接写入 xterm
        const vtBytes = atob(event.payload.data)
        term.write(vtBytes)
      }
    }
  )
} else {
  // legacy 路径：保持原 pty:data 订阅
  // ... 现有逻辑不变
}

// 2. 输入转发统一
xterm.onData((data) => {
  if (backend === 'ghostty') {
    void ghosttyWrite(terminalId, data)
  } else {
    void ptyWrite(terminalId, data)
  }
})

// 3. resize 统一
const doResize = (cols: number, rows: number) => {
  if (backend === 'ghostty') {
    void ghosttyResize(terminalId, cols, rows)
  } else {
    void ptyResize(terminalId, cols, rows)
  }
}
```

**后端选择逻辑**：

```typescript
// codeTerminalController.ts
const backend = useHipConfigStore(s => s.config.terminal?.backend ?? 'ghostty')

// 根据后端选择 open 函数
const openFn = backend === 'ghostty'
  ? (cols, rows) => ghosttyOpen(sessionId, cwd, cols, rows)
  : (cols, rows) => ptyOpen(sessionId, cwd, cols, rows)
```

**验收**：
- `yarn tsc` 通过
- 终端打开后输入 `echo hello` 显示正确
- 色彩、光标、滚动正常
- `backend = "legacy"` 回退到原路径正常

---

### PR-3  效果通道 + 配置（2–3 天）

**目标**：实现 effect 事件处理（bell/title/clipboard/cwd），新增 hip.toml 配置字段。

**范围**：
- 修改 `src/store/terminalStore.ts`（新增 effect 处理）
- 修改 `src-tauri/src/ghostty_backend.rs`（effect callback 注册）
- 修改 `src-tauri/src/hip_config.rs`（新增 `backend`/`max_scrollback`/`compression`/`kitty_graphics` 字段）
- 修改 `src/components/account/GeneralSettings.tsx`（新增终端设置 UI）
- 修改 `src/i18n/`（新增翻译 key）

**Effect 处理**：

```typescript
// terminalStore.ts 新增
listen<GhosttyEffectPayload>('ghostty:effect', (event) => {
  const { sessionId, type, data } = event.payload
  switch (type) {
    case 'bell':
      // 触发 bell flash（复用现有 XtermSurface bellVisible 逻辑）
      break
    case 'titleChanged':
      useTerminalStore.getState().setTitle(sessionId, data)
      break
    case 'cwdChanged':
      useTerminalStore.getState().setCwd(sessionId, data)
      break
    case 'clipboardWrite':
      void copyText(data)
      break
  }
})
```

**配置字段**：

```rust
// hip_config.rs TerminalConfig 新增
pub(crate) backend: Option<String>,        // "ghostty" | "legacy"
pub(crate) max_scrollback: Option<u32>,    // 默认 10000
pub(crate) compression: Option<bool>,      // 默认 true
pub(crate) kitty_graphics: Option<bool>,   // 默认 true
```

**验收**：
- `cargo test` + `yarn tsc` + `yarn test` 通过
- Bell 通知正常触发
- Shell 设置标题后 chrome 更新
- OSC 52 剪贴板写入正常
- hip.toml 新字段读写正确
- General Settings 新增终端设置 UI 可见

---

### PR-4  性能优化 + LZ4（2–3 天）

**目标**：优化 Grid diff 传输性能，启用 LZ4 scrollback 压缩。

**范围**：
- 修改 `src-tauri/src/ghostty_render_bridge.rs`（二进制 diff 编码）
- 修改 `src-tauri/src/ghostty_backend.rs`（idle 压缩调度）
- 修改 `src/ipc/ghostty.ts`（二进制 diff 解码）

**二进制 diff 传输**（替代 VT 序列回放）：

```rust
// ghostty_render_bridge.rs
fn encode_diff(
    terminal: &Terminal,
    render_state: &mut RenderState,
) -> Vec<u8> {
    let mut buf = Vec::with_capacity(4096);

    // Header
    buf.push(1); // version
    buf.extend_from_slice(&terminal.cols().to_le_bytes());
    buf.extend_from_slice(&terminal.rows().to_le_bytes());
    buf.extend_from_slice(&terminal.cursor_x().to_le_bytes());
    buf.extend_from_slice(&terminal.cursor_y().to_le_bytes());
    buf.push(if terminal.cursor_visible() { 1 } else { 0 });

    // Cell diffs
    let changes = render_state.update(terminal);
    buf.extend_from_slice(&(changes.len() as u32).to_le_bytes());

    for change in changes {
        buf.extend_from_slice(&change.x.to_le_bytes());
        buf.extend_from_slice(&change.y.to_le_bytes());
        buf.extend_from_slice(&change.codepoint.to_le_bytes());
        buf.extend_from_slice(&change.fg.to_le_bytes());
        buf.extend_from_slice(&change.bg.to_le_bytes());
        buf.extend_from_slice(&change.attrs.to_le_bytes());
    }

    buf
}
```

**JS 侧二进制解码**：

```typescript
// ghostty.ts
function decodeGhosttyDiff(buffer: ArrayBuffer): GhosttyFrame {
  const view = new DataView(buffer)
  let offset = 0

  const version = view.getUint8(offset); offset += 1
  const cols = view.getUint16(offset, true); offset += 2
  const rows = view.getUint16(offset, true); offset += 2
  const cursorX = view.getUint16(offset, true); offset += 2
  const cursorY = view.getUint16(offset, true); offset += 2
  const cursorVisible = view.getUint8(offset) === 1; offset += 1
  const diffCount = view.getUint32(offset, true); offset += 4

  const cells: CellDiff[] = []
  for (let i = 0; i < diffCount; i++) {
    cells.push({
      x: view.getUint16(offset, true), offset += 2,
      y: view.getUint16(offset, true), offset += 2,
      codepoint: view.getUint32(offset, true), offset += 4,
      fg: view.getUint32(offset, true), offset += 4,
      bg: view.getUint32(offset, true), offset += 4,
      attrs: view.getUint16(offset, true), offset += 2,
    })
  }

  return { cols, rows, cursorX, cursorY, cursorVisible, cells }
}
```

**LZ4 压缩调度**：

```rust
// ghostty_backend.rs — 在 vt_write 后检查是否需要压缩
fn maybe_compress(terminal: &mut Terminal) {
    // 当 terminal.compress_scrollback_activity() 变化时触发
    // 在专用线程上执行，不阻塞 vt_write
    match terminal.compress_scrollback(CompressionMode::Incremental) {
        Ok(CompressionResult::Pending) => {
            // 还有工作要做，下次 idle 继续
        }
        Ok(CompressionResult::Complete) => {
            // 压缩完成，等待下次 activity 变化
        }
        Err(e) => {
            log::warn!("[ghostty] compression error: {e}");
        }
    }
}
```

**验收**：
- `cargo test` 通过
- 二进制 diff 传输正常（终端显示正确）
- `cat /dev/urandom | base64 | head -100000` 不卡顿
- LZ4 压缩后 scrollback 内存下降
- 增量更新大小 ≤ 1KB（典型命令输出）

---

### PR-5  协议增强（持续）

**目标**：利用 libghostty-vt 内置能力，逐步启用高级终端协议。

**范围**（按优先级排序）：

| 优先级 | 协议 | 工作量 | 说明 |
|--------|------|--------|------|
| P0 | Kitty Graphics | 2 天 | `features = ["kitty-graphics"]`，JS 侧图片渲染 |
| P1 | Kitty Keyboard | 1 天 | `key::Encoder` 替代 xterm.js 键盘处理 |
| P2 | Sixel Graphics | 3 天 | 需要 JS 侧图片渲染支持 |
| P2 | OSC 133 Shell Integration | 1 天 | 命令边界标记 |
| P3 | tmux DCS Control Mode | 2 天 | tmux 集成 |
| P3 | Glyph Protocol | 1 天 | 运行时自定义字形注册 |
| P3 | Terminal Snapshot | 2 天 | 状态序列化/恢复 |

**验收**：
- `kitten icat image.png` 显示图片（Kitty Graphics）
- vim 中所有修饰键组合正确（Kitty Keyboard）
- `lsix` 显示缩略图（Sixel）

---

## 4. 文件变更清单

### 新增文件

| 文件 | PR | 说明 |
|------|----|------|
| `src-tauri/src/ghostty_backend.rs` | PR-1 | Terminal 生命周期管理 |
| `src-tauri/src/ghostty_render_bridge.rs` | PR-1 | Grid diff 编码 |
| `src/ipc/ghostty.ts` | PR-2 | JS 侧 Tauri 命令封装 |
| `docs/design/terminal-ghostty-kernel/poc/` | PR-0 | PoC 测试结果 |

### 修改文件

| 文件 | PR | 改动 |
|------|----|------|
| `src-tauri/Cargo.toml` | PR-0/1 | 添加 `libghostty-vt` 依赖 |
| `src-tauri/src/lib.rs` | PR-1 | 注册 ghostty 模块 + Tauri 命令 |
| `src-tauri/src/hip_config.rs` | PR-3 | 新增配置字段 |
| `src/components/artifact/XtermSurface.tsx` | PR-2 | 后端选择 + 数据源切换 |
| `src/components/artifact/codeTerminalController.ts` | PR-2 | 后端选择逻辑 |
| `src/store/terminalStore.ts` | PR-2/3 | 新数据源 + effect 处理 |
| `src/components/account/GeneralSettings.tsx` | PR-3 | 终端设置 UI |
| `src/i18n/*.json` | PR-3 | 新增翻译 key |

### 不改动文件

| 文件 | 说明 |
|------|------|
| `src-tauri/src/pty.rs` | PTY 后端保留，数据流路径变 |
| `src-tauri/src/ssh_session.rs` | SSH 后端保留 |
| `src/components/artifact/terminalEnhancements.ts` | WebGL/Ligatures/Unicode11 保留 |
| `src/components/artifact/terminalProtocols.ts` | Phase 1 保留，Phase 5 迁移到 Rust |
| `src/components/artifact/terminalTheme.ts` | 色彩主题保留 |
| `src/components/artifact/TerminalSearchBar.tsx` | 搜索 UI 保留 |

---

## 5. 工期估算

| PR | 工作量 | 前置 | 预计完成 |
|----|--------|------|----------|
| PR-0 | 1–2 天 | 无 | Week 1 |
| PR-1 | 3–5 天 | PR-0 通过 | Week 2–3 |
| PR-2 | 2–3 天 | PR-1 | Week 3 |
| PR-3 | 2–3 天 | PR-2 | Week 4 |
| PR-4 | 2–3 天 | PR-3 | Week 4–5 |
| PR-5 | 持续 | PR-4 | Week 5+ |
| **总计** | **12–19 天** | | **5–6 周** |

---

## 6. 门禁

每个 PR 必须通过：

```bash
# Rust
cargo test
cargo build --target x86_64-pc-windows-msvc   # Windows
cargo build --target a86_64-apple-darwin        # macOS
cargo build --target x86_64-unknown-linux-gnu   # Linux

# TypeScript
yarn tsc
yarn test

# Tauri
yarn tauri build  # 至少一个平台

# 回归
yarn test:e2e:smoke
```

---

## 7. 回退策略

| 阶段 | 回退条件 | 回退方式 |
|------|----------|----------|
| PR-0 | libghostty-vt 构建失败 | 回退到 Path A（增强 xterm.js） |
| PR-1 | Terminal 集成问题 | 删除 ghostty_backend.rs，恢复 pty 直接 emit |
| PR-2 | xterm.js 渲染问题 | `backend = "legacy"` 切回原路径 |
| PR-3 | 效果处理问题 | effect 回调不注册，降级为无 effect |
| PR-4 | 二进制 diff 问题 | 回退到 VT 序列回放（Phase 1 模式） |
| 生产后 | 用户反馈问题 | `backend = "legacy"` 配置回退 |
