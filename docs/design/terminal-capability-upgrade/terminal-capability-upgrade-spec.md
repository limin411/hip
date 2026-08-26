# 终端能力现代化升级 Spec

- 系列：`docs/design/terminal-capability-upgrade/`
- 配套：`terminal-capability-upgrade-plan.md`（执行计划）、`terminal-capability-upgrade-preview.html`（视觉对照原型）
- 状态：待评审
- 日期：2026-08-25
- 前置基线：
  - `docs/design/terminal-shared-pty/terminal-shared-pty-spec.md`（共享终端协同整改，已完成 P0–P1）
  - `docs/design/doc-terminal-nerd-fonts/terminal_nerd_font_spec.md`（Nerd Font 内嵌，已完成）
  - `docs/design/terminal-agent-parity/terminal-agent-parity-plan.md`（运维助手视觉对齐，已完成）
- 涉及模块：
  - `src/components/artifact/XtermSurface.tsx`（终端渲染层）
  - `src/store/terminalStore.ts`（会话状态管理）
  - `src-tauri/src/pty.rs`（PTY 后端）
  - `src-tauri/src/ssh_session.rs`（SSH 会话）
  - `packages/protocol/`（WebSocket 协议类型）

---

## 1. 根因：终端能力的结构性差距

### 1.1 对标分析

通过与 Kitty、Alacritty、WezTerm、Ghostty 等现代终端的系统性对比，当前实现在以下维度存在显著差距：

| 维度 | 现代终端标准 | 当前实现 | 差距等级 |
|------|-------------|----------|----------|
| **渲染引擎** | GPU 加速（OpenGL/Vulkan/Metal） | 软件 Canvas（xterm.js 默认） | 🔴 关键 |
| **字体渲染** | 连字（Ligatures）、Emoji 宽度正确 | 无连字、Emoji 宽度不一致 | 🟡 重要 |
| **协议支持** | OSC 8/52/633、Synchronized Output、Kitty Keyboard | 仅 OSC 0/2 标题、部分 OSC 633 | 🔴 关键 |
| **图片显示** | Kitty Graphics / iTerm2 / Sixel | 完全缺失 | 🟡 重要 |
| **会话管理** | 多标签、分屏、会话持久化 | 单一面板、无持久化 | 🟡 重要 |
| **键盘协议** | CSI u、Kitty Keyboard Protocol | 仅传统模式 | 🟢 增强 |

### 1.2 根因分解

#### 根因 A：渲染性能瓶颈

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| A1 | 大量输出时（如 `cat large-file`）UI 卡顿，帧率下降 | `XtermSurface.tsx` 使用默认 Canvas 渲染 | 未启用 WebGL addon，软件渲染无法处理高频更新 |
| A2 | 编程字体连字（如 `=>`、`->`、`!=`）显示为分离字符 | 无 LigaturesAddon 配置 | xterm.js 连字支持需额外 addon |
| A3 | Emoji 和 CJK 字符宽度计算不一致，导致对齐错位 | `terminalFonts.test.ts` 仅测试 Nerd Font | 未配置 Unicode 宽度属性 |

#### 根因 B：协议兼容性不足

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| B1 | 终端内 URL 不可点击，需手动复制 | 无 OSC 8 处理 | 现代终端标配超链接协议未实现 |
| B2 | 应用无法通过 OSC 52 读取剪贴板 | `terminalCanvasUi.ts` 仅处理写入 | 剪贴板协议不完整 |
| B3 | 快速输出时画面闪烁/撕裂 | 无 Synchronized Output 处理 | 缺少 DECSET 2026 帧同步 |
| B4 | 某些 TUI 应用（如 htop）按键不响应 | 无 Kitty Keyboard Protocol | 传统键盘编码无法区分某些按键组合 |
| B5 | Shell 集成不完整，命令边界检测依赖启发式 | OSC 633 仅部分实现 | VS Code Shell Integration 协议支持不全 |

#### 根因 C：多媒体能力缺失

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| C1 | 无法在终端内预览图片（如 `ls *.png`） | 无图片协议实现 | 需选择并实现 Kitty Graphics / Sixel |
| C2 | SSH 远程服务器的图表/图像无法本地显示 | 同上 | 图片协议需同时支持本地和 SSH 通道 |

#### 根因 D：会话管理简陋

| # | 现象 | 代码证据 | 根因 |
|---|---|---|---|
| D1 | 无法同时查看多个终端（如日志 + 编辑 + 运行） | 单一 `XtermSurface` 挂载 | 无多面板/标签页架构 |
| D2 | 关闭应用后终端历史丢失 | `terminalStore` 内存态 | 无会话持久化机制 |
| D3 | SSH 会话断开后需手动重连 | `ssh_session.rs` 无自动重连 | 缺少重连策略和状态恢复 |

---

## 2. 行业最佳实践调研

| 终端 | 关键特性 | 对照 hip 的启示 |
|------|----------|-----------------|
| **Kitty** | GPU 渲染、Graphics Protocol（RGBA/Sixel 兼容）、Keyboard Protocol、连字、超链接、单实例多窗口 | 图片协议的事实标准；键盘协议是未来方向 |
| **Alacritty** | 纯 GPU 渲染、极简配置、高性能、Vi 模式滚动 | 渲染性能标杆；配置简洁性参考 |
| **WezTerm** | Lua 配置、多路复用（标签/分屏）、SSH 自动重连、串口支持、图片（Sixel/iTerm2） | 会话管理标杆；Lua 扩展性参考 |
| **Ghostty** | Zig 实现、libvterm 内核、完整 VT 序列支持、GTK/AppKit 原生 UI | 协议完整性参考 |
| **VS Code 终端** | WebGL 渲染、Shell Integration（OSC 633）、连字、超链接、任务集成 | xterm.js 最佳实践；Shell Integration 标准 |
| **Warp** | GPU 渲染、块状命令历史、AI 集成、Shell Integration、团队共享 | 命令块 UI 参考；AI 集成深度 |
| **Hyper** | Electron 架构、插件系统、主题丰富 | 与 hip 架构相似（Web 技术栈）；性能问题警示 |

### 技术选型决策

| 选项 | 优点 | 缺点 | 决策 |
|------|------|------|------|
| **升级 xterm.js + addons** | 成熟生态、WebGL addon、连字 addon、Search addon 已用 | 某些高级特性需自行实现 | ✅ 采用（渐进增强） |
| **切换到 TerminalKit / blessed** | Node.js 原生 | 生态小、维护不活跃 | ❌ 不采用 |
| **嵌入 Alacritty/Kitty** | 原生性能 | 架构割裂、IPC 复杂 | ❌ 不采用 |
| **使用 UnicodeWidth 新实现** | Emoji/CJK 精确 | 需维护 | 🟡 评估中 |

---

## 3. 改进项

### T1 渲染性能提升（P0 核心）

#### T1.1 启用 WebGL 渲染

```typescript
// XtermSurface.tsx
import { WebglAddon } from '@xterm/addon-webgl'

// 在 Terminal 初始化后加载
try {
  const webgl = new WebglAddon()
  term.loadAddon(webgl)
  // 可选：启用纹理 atlas 优化
  webgl.onChangeTextureAtlas?.(handleTextureChange)
} catch (e) {
  // 降级到 Canvas 渲染（已有行为）
  console.warn('WebGL not available, falling back to canvas:', e)
}
```

**收益**：
- 渲染性能提升 3-10x（取决于输出量）
- GPU 卸载 CPU 渲染负担
- 支持更高帧率（60fps 目标）

**风险**：
- 某些旧显卡/驱动不支持 WebGL 2.0
- WKWebView（macOS）的 WebGL 支持有限制

**降级策略**：
- 自动检测 WebGL 支持，不支持时静默降级
- 保留 Canvas 渲染作为 fallback

#### T1.2 启用字体连字

```typescript
// XtermSurface.tsx
import { LigaturesAddon } from '@xterm/addon-ligatures'

// 在字体加载完成后启用
const ligatures = new LigaturesAddon()
term.loadAddon(ligatures)
```

**收益**：
- 编程字体连字正确显示（`=>`, `->`, `!=`, `===` 等）
- 提升代码可读性

**依赖**：
- 字体必须支持连字（JetBrains Mono ✅）
- 需要 `@xterm/addon-ligatures` 包

#### T1.3 Unicode 宽度修正

```typescript
// terminalStore.ts 或独立配置
import { Unicode11Addon } from '@xterm/addon-unicode11'

const unicode11 = new Unicode11Addon()
term.loadAddon(unicode11)
term.unicode.activeVersion = '11'
```

**收益**：
- Emoji 宽度正确（2 列）
- CJK 字符对齐准确
- 与现代终端行为一致

---

### T2 协议支持补全（P0 核心）

#### T2.1 OSC 8 超链接

**协议定义**：
```
OSC 8 ; params ; URI ST
显示文本
OSC 8 ; ; ST
```

**实现要点**：
```typescript
// XtermSurface.tsx - 注册 OSC handler
term.parser.registerOscHandler(8, (data) => {
  // 解析 params 和 URI
  // 创建可点击链接装饰
  // 与现有 TerminalSearchBar 共用装饰层
})
```

**交互**：
- 链接默认带下划线（Ctrl/Cmd 悬停显示）
- 点击打开外部浏览器
- 支持 `file://` 协议在应用内打开

**收益**：
- `ls`、`git log`、`npm outdated` 等输出中的 URL 可点击
- 与 Kitty/Alacritty/WezTerm 行为一致

#### T2.2 OSC 52 剪贴板完整支持

**当前状态**：仅支持写入（`clipboard.writeText`）

**补全**：
```typescript
// XtermSurface.tsx
term.parser.registerOscHandler(52, (data) => {
  const [target, content] = data.split(';')
  if (target === 'c' || target === '') {
    // 读取剪贴板
    readText().then(text => {
      // 响应请求（需 PTY 通道支持）
      write(`\x1b]52;c;${btoa(text)}\x1b\\`)
    })
  }
})
```

**安全考虑**：
- 读取剪贴板需用户确认（配置项 `[terminal].clipboardRead: 'ask' | 'allow' | 'deny'`）
- 写入保持现有行为

**收益**：
- TUI 应用（如 vim）可访问系统剪贴板
- 与 SSH 远程应用协同工作

#### T2.3 Synchronized Output（DECSET 2026）

**协议**：
```
\x1b[?2026h  // 开始同步
... 渲染内容 ...
\x1b[?2026l  // 结束同步
```

**实现**：
```typescript
// xterm.js 内部已支持，需确保启用
// 检查 xterm.js 版本 >= 5.3.0
term.parser.registerDcsHandler('2026', (data) => {
  // 缓冲输出直到同步结束
  // 防止中间状态渲染
})
```

**收益**：
- 消除 TUI 应用（vim、htop、tmux）的闪烁
- 帧完整性保证

**注意**：
- xterm.js 5.5.0 已内置支持，需验证配置

#### T2.4 VS Code Shell Integration 完整实现

**OSC 633 序列**：
```
OSC 633 ; A  // Prompt start
OSC 633 ; B  // Prompt end / Command start
OSC 633 ; C  // Pre-execution (optional)
OSC 633 ; D ; ExitCode  // Command finished
OSC 633 ; E ; CommandLine  // Set command line (for history)
```

**当前状态**：仅在 `terminalAgentBridge.ts` 中用于命令围栏

**补全**：
```typescript
// XtermSurface.tsx
term.parser.registerOscHandler(633, (data) => {
  const parts = data.split(';')
  const action = parts[0]
  
  switch (action) {
    case 'A':
      // 标记 prompt 开始（装饰层）
      break
    case 'B':
      // 标记 prompt 结束
      break
    case 'D':
      // 命令完成 + 退出码
      // 通知 terminalStore 更新命令历史
      break
    case 'E':
      // 设置命令行（可用于历史搜索）
      break
  }
})
```

**收益**：
- 命令边界精确检测（替代 `hasPromptTail` 启发式）
- 命令历史结构化
- 退出码自动捕获

**集成**：
- 与 `terminal-shared-pty` spec 的 T1 围栏机制协同
- 为 Warp 式命令块 UI 奠定基础

#### T2.5 Kitty Keyboard Protocol（P1 增强）

**协议模式**：
```
CSI > Pu ; Pm u  // 启用
CSI = Pu ; Pm u  // 推送模式
CSI < u          // 禁用
```

**实现优先级**：
- P1：支持 `DISAMBIGUATE` 模式（区分 Esc 和 Ctrl+[）
- P2：支持 `REPORT_ALL_KEYS`（完整按键上报）

**收益**：
- 解决传统 VT 编码的歧义问题
- 支持更多按键组合
- 与现代 TUI 框架（Ratatui 等）兼容

---

### T3 图片显示能力（P1 重要）

#### T3.1 协议选型

| 协议 | 优点 | 缺点 | 决策 |
|------|------|------|------|
| **Kitty Graphics** | 功能最强、支持 RGBA/动画/Unicode 占位符 | 复杂度高、需 GPU 纹理管理 | 🟡 P2 评估 |
| **Sixel** | 历史兼容性好、终端支持广泛 | 色彩限制（256）、无透明度 | ✅ P1 采用 |
| **iTerm2 Inline Images** | macOS 生态 | 仅限 iTerm2 | ❌ 不采用 |

#### T3.2 Sixel 实现方案

**依赖**：
- `libsixel` 或 `sixel-rs`（Rust 绑定）
- xterm.js 社区 addon（`xterm-addon-sixel`，实验性）

**架构**：
```
应用输出 Sixel 数据
  ↓
xterm.js 解析 Sixel DCS 序列
  ↓
Canvas/WebGL 纹理渲染
  ↓
图片显示在终端内
```

**实现要点**：
```typescript
// XtermSurface.tsx
import { SixelAddon } from 'xterm-addon-sixel' // 社区 addon

try {
  const sixel = new SixelAddon()
  term.loadAddon(sixel)
} catch (e) {
  console.warn('Sixel addon not available:', e)
}
```

**收益**：
- 服务器监控图表（gnuplot、matplotlib）内联显示
- 文件管理器图片预览
- SSH 远程图片本地渲染

**限制**：
- WKWebView 兼容性需验证
- 性能需 benchmark

#### T3.3 Kitty Graphics 评估（P2）

**适用场景**：
- 需要 RGBA 透明度
- 需要动画支持
- 需要 Unicode 占位符精确布局

**实现路径**：
- 评估 `kitty-rs` 或自行实现 DCS 解析
- WebGL 纹理管理
- 与现有渲染管线集成

---

### T4 多面板与会话管理（P1 重要）

#### T4.1 标签页架构

**数据模型扩展**：
```typescript
// terminalStore.ts
interface TerminalTab {
  id: string
  title: string
  icon?: string
  sessionId: string
  pinned: boolean
  order: number
}

interface TerminalState {
  // ... 现有字段
  tabs: TerminalTab[]
  activeTabId: string | null
  
  // 新增 actions
  createTab: (sessionId: string, title?: string) => string
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  reorderTabs: (tabIds: string[]) => void
  pinTab: (tabId: string) => void
}
```

**UI 组件**：
```tsx
// TerminalTabs.tsx
export function TerminalTabs() {
  const tabs = useTerminalStore(s => s.tabs)
  const activeTabId = useTerminalStore(s => s.activeTabId)
  
  return (
    <div className="flex items-center border-b">
      {tabs.map(tab => (
        <TabItem
          key={tab.id}
          tab={tab}
          active={tab.id === activeTabId}
          onClick={() => setActiveTab(tab.id)}
          onClose={() => closeTab(tab.id)}
        />
      ))}
      <button onClick={createNewTab}>+</button>
    </div>
  )
}
```

**收益**：
- 同时管理多个终端会话
- 快速切换（Ctrl+Tab）
- 拖拽排序

#### T4.2 分屏布局

**布局模型**：
```typescript
// terminalLayout.ts
interface SplitPane {
  id: string
  direction: 'horizontal' | 'vertical'
  size: number // 百分比 0-100
  children: (SplitPane | TerminalPane)[]
}

interface TerminalPane {
  id: string
  sessionId: string
  size: number
}

type Layout = SplitPane | TerminalPane
```

**交互**：
- 分屏快捷键：`Ctrl+\`（垂直）、`Ctrl+Shift+\`（水平）
- 拖拽分割线调整大小
- 最大化单面板（`Ctrl+Shift+Enter`）

**收益**：
- 并排查看日志和代码
- 同时运行测试和编辑
- 与 tmux/screen 体验一致

#### T4.3 会话持久化

**存储格式**：
```typescript
// sessionPersistence.ts
interface PersistedSession {
  id: string
  cwd: string
  shell: string
  env: Record<string, string>
  scrollback: string[] // 限制行数
  createdAt: number
  lastActiveAt: number
}
```

**持久化策略**：
- 应用退出时保存活跃会话元数据
- 启动时提供"恢复上次会话"选项
- Scrollback 限制（如最近 1000 行）

**收益**：
- 意外退出后恢复工作环境
- 跨启动保持上下文

---

### T5 键盘与输入增强（P2 增强）

#### T5.1 CSI u 编码支持

**协议**：
```
CSI unicode-key ; modifiers u
```

**收益**：
- 区分 `Esc` 和 `Ctrl+[`
- 支持更多修饰键组合
- 与现代 TUI 框架兼容

#### T5.2 自定义快捷键配置

**配置格式**（hip.toml）：
```toml
[terminal.keybindings]
copy = "Ctrl+Shift+C"
paste = "Ctrl+Shift+V"
search = "Ctrl+F"
font-up = "Ctrl+="
font-down = "Ctrl+-"
new-tab = "Ctrl+T"
close-tab = "Ctrl+W"
next-tab = "Ctrl+Tab"
prev-tab = "Ctrl+Shift+Tab"
split-vertical = "Ctrl+\\"
split-horizontal = "Ctrl+Shift+\\"
```

**收益**：
- 用户自定义工作流
- 避免与系统/应用快捷键冲突

---

### T6 主题与视觉增强（P2 增强）

#### T6.1 动态主题切换

**当前状态**：主题跟随应用深色/浅色，或静态选择

**增强**：
```typescript
// terminalTheme.ts
export function watchTerminalTheme(callback: (theme: ITheme) => void) {
  // 监听系统主题变化
  // 监听 hip.toml 配置变化
  // 监听 OSC 11/10（终端颜色查询）
}
```

#### T6.2 终端颜色方案导出

**功能**：
- 导出为 `.itermcolors`、`.kitty.conf`、`alacritty.toml`
- 导入外部主题

---

## 4. 实施计划概要

### 阶段划分

| 阶段 | 内容 | 周期 | 依赖 |
|------|------|------|------|
| **P0-Phase1** | T1 渲染性能 + T2.3/T2.4 协议基础 | 2 周 | 无 |
| **P0-Phase2** | T2.1/T2.2 协议补全 | 1 周 | Phase1 |
| **P1-Phase1** | T3.2 Sixel 图片 + T4.1 标签页 | 3 周 | P0 |
| **P1-Phase2** | T4.2 分屏 + T4.3 持久化 | 2 周 | P1-Phase1 |
| **P2-Phase1** | T5 键盘增强 + T6 视觉增强 | 2 周 | P1 |

### 依赖包升级

```json
{
  "@xterm/xterm": "^5.5.0",           // 已满足
  "@xterm/addon-fit": "^0.10.0",      // 已满足
  "@xterm/addon-search": "^0.16.0",   // 已满足
  "@xterm/addon-webgl": "^0.18.0",    // 需新增
  "@xterm/addon-ligatures": "^0.7.0", // 需新增
  "@xterm/addon-unicode11": "^0.8.0", // 需新增
  "xterm-addon-sixel": "^0.5.0"      // 社区包，需评估
}
```

---

## 5. 验收清单

### P0 验收

| # | 验收点 | 关联 |
|---|--------|------|
| 1 | WebGL 渲染启用，`cat /dev/urandom | base64` 帧率 ≥ 30fps | T1.1 |
| 2 | 连字正确显示（`=>`, `->`, `!=`），字体回退正常 | T1.2 |
| 3 | Emoji 显示宽度正确（2 列），CJK 对齐准确 | T1.3 |
| 4 | `ls` 输出中 URL 可点击，Ctrl 悬停显示下划线 | T2.1 |
| 5 | vim 内 `"+y` 可写入系统剪贴板 | T2.2 |
| 6 | `htop` 运行无闪烁 | T2.3 |
| 7 | 命令退出码自动捕获（替代 wrapEc 启发式） | T2.4 |

### P1 验收

| # | 验收点 | 关联 |
|---|--------|------|
| 8 | 终端内显示 Sixel 图片（gnuplot 输出） | T3.2 |
| 9 | 可创建多个标签页，Ctrl+Tab 切换 | T4.1 |
| 10 | 可垂直/水平分屏，拖拽调整大小 | T4.2 |
| 11 | 应用重启后可恢复上次会话 | T4.3 |

### P2 验收

| # | 验收点 | 关联 |
|---|--------|------|
| 12 | Esc 和 Ctrl+[ 可区分 | T5.1 |
| 13 | 快捷键可通过 hip.toml 自定义 | T5.2 |
| 14 | 主题导出为 .itermcolors 格式 | T6.2 |

---

## 6. 非目标

- 不替换 xterm.js 为其他终端库（渐进增强策略）
- 不实现完整的 Kitty Graphics Protocol（P2 评估）
- 不实现终端内视频播放
- 不实现串口连接（WezTerm 特性，非桌面 AI 工作台核心需求）
- 不实现远程终端协作（Warp Teams 特性，超出范围）
- 不改变现有 PTY/SSH 后端架构

---

## 7. 风险与缓解

| 风险 | 等级 | 缓解 |
|------|------|------|
| WebGL addon 在 WKWebView (macOS) 不工作 | 中 | 自动降级到 Canvas；提供配置项禁用 WebGL |
| Ligatures addon 性能开销（大量输出时） | 低 | 仅在终端空闲时启用连字测量 |
| Sixel addon 社区维护不活跃 | 中 | 评估 fork 维护或自行实现核心解析 |
| 标签页/分屏状态管理复杂 | 中 | 复用现有 Zustand 模式；单元测试覆盖 |
| 图片协议与 SSH 通道的兼容性 | 中 | Sixel 数据通过 base64 传输，与现有架构兼容 |
| Unicode 版本切换影响现有 scrollback | 低 | 仅对新内容生效；旧内容保持原渲染 |

---

## 8. 交付物

### 代码变更

- [ ] `XtermSurface.tsx`：WebGL/Ligatures/Unicode11 addon 加载、OSC 8/52/633 handler、Sixel 支持
- [ ] `terminalStore.ts`：标签页状态、分屏布局、会话持久化接口
- [ ] `terminalTheme.ts`：动态主题切换、主题导出
- [ ] `terminalKeymap.ts`：CSI u 支持、自定义快捷键配置
- [ ] `src-tauri/src/pty.rs`：Sixel 数据传输优化（如需要）
- [ ] `packages/protocol/`：新增终端能力协商消息类型

### 依赖变更

- [ ] `package.json`：新增 addon 依赖
- [ ] `Cargo.toml`：如需 Rust 侧 Sixel 解析

### 测试

- [ ] WebGL 降级测试（无 GPU 环境）
- [ ] 连字渲染回归测试
- [ ] OSC 协议解析测试
- [ ] 标签页/分屏交互测试
- [ ] 会话持久化/恢复测试
- [ ] e2e：终端基础功能回归

### 文档

- [ ] 用户文档：新终端功能说明
- [ ] 开发者文档：协议实现细节
- [ ] 配置文档：hip.toml 终端配置项

---

## 9. 参考资料

- [xterm.js 官方文档](https://xtermjs.org/)
- [xterm.js addons](https://github.com/xtermjs/xterm.js/tree/master/addons)
- [Kitty Graphics Protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/)
- [Kitty Keyboard Protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/)
- [VS Code Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration)
- [Sixel Graphics](https://www.vt100.net/ansicode/)
- [Terminal Feature Comparison](https://terminfo.dev/)
- [OSC 8 Hyperlinks](https://gist.github.com/egmontkob/eb114258358b8b1faf39c4b308b84770)
