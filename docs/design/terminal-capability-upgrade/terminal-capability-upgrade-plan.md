# 终端能力现代化升级 执行计划

- 系列：`docs/design/terminal-capability-upgrade/`
- 配套：`terminal-capability-upgrade-spec.md`（规格文档）
- 状态：待评审
- 日期：2026-08-25

---

## 1. 执行概览

本计划将终端能力从基础实现提升至现代终端标准，分 4 个阶段实施，预计总周期 10 周。

### 里程碑

| 里程碑 | 目标日期 | 交付物 |
|--------|----------|--------|
| M1: 渲染性能 | Week 2 | WebGL + 连字 + Unicode |
| M2: 协议基础 | Week 4 | OSC 8/52/633 + Synchronized Output |
| M3: 多媒体 + 标签页 | Week 7 | Sixel 图片 + 标签页架构 |
| M4: 分屏 + 持久化 | Week 9 | 分屏布局 + 会话恢复 |
| M5: 增强特性 | Week 10 | 键盘协议 + 主题导出 |

---

## 2. Phase 1: 渲染性能提升（Week 1-2）

### 2.1 WebGL 渲染启用

**任务清单**：

| # | 任务 | 文件 | 工时 | 验收 |
|---|------|------|------|------|
| 1.1 | 安装 `@xterm/addon-webgl` | `package.json` | 0.5h | 依赖安装成功 |
| 1.2 | 实现 WebGL 加载逻辑 | `XtermSurface.tsx` | 2h | WebGL 初始化无报错 |
| 1.3 | 实现自动降级 | `XtermSurface.tsx` | 1h | 无 GPU 环境自动回退 Canvas |
| 1.4 | 添加配置项禁用 WebGL | `hip.toml` + `GeneralSettings.tsx` | 1h | 配置生效 |
| 1.5 | 性能基准测试 | `e2e/terminal-perf.spec.ts` | 2h | 帧率 ≥ 30fps |
| 1.6 | macOS WKWebView 兼容性测试 | 手动测试 | 2h | 无黑屏/崩溃 |

**技术细节**：

```typescript
// XtermSurface.tsx - WebGL 加载逻辑
const loadWebGL = async (term: Terminal): Promise<boolean> => {
  const config = useHipConfigStore.getState().config.terminal
  if (config?.webgl === false) return false
  
  try {
    const { WebglAddon } = await import('@xterm/addon-webgl')
    const addon = new WebglAddon()
    
    addon.onContextLoss(() => {
      // WebGL 上下文丢失，降级到 Canvas
      console.warn('WebGL context lost, falling back to canvas')
      addon.dispose()
    })
    
    term.loadAddon(addon)
    return true
  } catch (e) {
    console.warn('WebGL initialization failed:', e)
    return false
  }
}
```

**性能基准**：
- 测试场景：`cat /dev/urandom | base64`（高频输出）
- 目标：Canvas 帧率 ≥ 15fps → WebGL 帧率 ≥ 30fps
- 测量方法：`requestAnimationFrame` 计数器

### 2.2 字体连字启用

**任务清单**：

| # | 任务 | 文件 | 工时 | 验收 |
|---|------|------|------|------|
| 2.1 | 安装 `@xterm/addon-ligatures` | `package.json` | 0.5h | 依赖安装成功 |
| 2.2 | 实现连字加载逻辑 | `XtermSurface.tsx` | 1h | 连字正确渲染 |
| 2.3 | 性能测试（大量输出） | `e2e/terminal-ligatures.spec.ts` | 1h | 无明显性能下降 |
| 2.4 | 连字视觉回归测试 | `terminalFonts.test.ts` | 1h | `=>`, `->`, `!=` 正确显示 |

**技术细节**：

```typescript
// XtermSurface.tsx - 连字加载
const loadLigatures = async (term: Terminal): Promise<void> => {
  try {
    const { LigaturesAddon } = await import('@xterm/addon-ligatures')
    const addon = new LigaturesAddon()
    term.loadAddon(addon)
  } catch (e) {
    // 连字 addon 加载失败不影响终端使用
    console.debug('Ligatures addon not available:', e)
  }
}
```

**注意**：
- 连字 addon 在某些环境下可能性能较差
- 需要测试高频输出场景（如 `find /`）

### 2.3 Unicode 宽度修正

**任务清单**：

| # | 任务 | 文件 | 工时 | 验收 |
|---|------|------|------|------|
| 3.1 | 安装 `@xterm/addon-unicode11` | `package.json` | 0.5h | 依赖安装成功 |
| 3.2 | 实现 Unicode 11 加载 | `XtermSurface.tsx` | 1h | Emoji 宽度正确 |
| 3.3 | CJK 对齐测试 | `terminalFonts.test.ts` | 1h | 中文字符对齐准确 |

**技术细节**：

```typescript
// XtermSurface.tsx - Unicode 11
const loadUnicode11 = (term: Terminal): void => {
  try {
    const { Unicode11Addon } = require('@xterm/addon-unicode11')
    const addon = new Unicode11Addon()
    term.loadAddon(addon)
    term.unicode.activeVersion = '11'
  } catch (e) {
    console.debug('Unicode11 addon not available:', e)
  }
}
```

---

## 3. Phase 2: 协议支持补全（Week 3-4）

### 3.1 OSC 8 超链接

**任务清单**：

| # | 任务 | 文件 | 工时 | 验收 |
|---|------|------|------|------|
| 4.1 | 实现 OSC 8 解析器 | `XtermSurface.tsx` | 3h | 正确解析 URI |
| 4.2 | 实现链接装饰层 | `terminalDecorations.ts` | 4h | 链接显示下划线 |
| 4.3 | 实现悬停预览 | `TerminalLinkPreview.tsx` | 3h | Ctrl 悬停显示 URL |
| 4.4 | 实现点击打开 | `XtermSurface.tsx` | 2h | 点击打开浏览器 |
| 4.5 | 集成测试 | `terminal-osc8.test.ts` | 2h | 各种 URI 格式正确 |

**协议解析**：

```typescript
// XtermSurface.tsx - OSC 8 处理
term.parser.registerOscHandler(8, (data: string) => {
  // OSC 8 ; params ; URI ST
  // data = "params;URI"
  const separatorIndex = data.indexOf(';')
  if (separatorIndex === -1) return
  
  const params = data.slice(0, separatorIndex)
  const uri = data.slice(separatorIndex + 1)
  
  if (!uri) {
    // 结束超链接
    currentLink = null
    return
  }
  
  currentLink = { uri, params }
  // 创建装饰
  addLinkDecoration(term, uri, params)
})
```

**UI 交互**：
- 链接默认显示下划线（浅色，不干扰阅读）
- Ctrl/Cmd 悬停时高亮显示
- 点击时确认对话框（可配置跳过确认）

### 3.2 OSC 52 剪贴板补全

**任务清单**：

| # | 任务 | 文件 | 工时 | 验收 |
|---|------|------|------|------|
| 5.1 | 实现 OSC 52 读取 | `XtermSurface.tsx` | 2h | 读取剪贴板 |
| 5.2 | 实现安全确认 | `ClipboardConfirm.tsx` | 2h | 读取时弹出确认 |
| 5.3 | 配置持久化 | `hip.toml` | 1h | 记住用户选择 |
| 5.4 | SSH 通道测试 | `ssh-session.test.ts` | 2h | 远程 vim 可用剪贴板 |

**安全策略**：

```typescript
// terminalStore.ts
interface ClipboardPolicy {
  read: 'ask' | 'allow' | 'deny'
  write: 'allow' | 'deny'
}

// 默认策略
const DEFAULT_CLIPBOARD_POLICY: ClipboardPolicy = {
  read: 'ask',  // 读取需确认
  write: 'allow' // 写入默认允许
}
```

### 3.3 Synchronized Output

**任务清单**：

| # | 任务 | 文件 | 工时 | 验收 |
|---|------|------|------|------|
| 6.1 | 验证 xterm.js 内置支持 | 测试 | 1h | DECSET 2026 生效 |
| 6.2 | htop 闪烁测试 | 手动测试 | 1h | 无闪烁 |
| 6.3 | tmux 兼容性测试 | 手动测试 | 1h | tmux 内正常 |

**注意**：
- xterm.js 5.5.0 已内置支持
- 主要工作是验证和测试

### 3.4 VS Code Shell Integration 完整实现

**任务清单**：

| # | 任务 | 文件 | 工时 | 验收 |
|---|------|------|------|------|
| 7.1 | 扩展 OSC 633 处理 | `XtermSurface.tsx` | 3h | A/B/C/D/E 全支持 |
| 7.2 | 命令历史结构化 | `terminalHistory.ts` | 3h | 命令块索引 |
| 7.3 | 与 shared-pty 集成 | `terminalAgentBridge.ts` | 2h | 围栏优先级正确 |
| 7.4 | 集成测试 | `terminal-shell-integration.test.ts` | 2h | 各 shell 正确 |

**命令块数据结构**：

```typescript
// terminalHistory.ts
interface CommandBlock {
  id: string
  command: string
  exitCode: number | null
  startCursor: number
  endCursor: number
  timestamp: number
  cwd: string
}

interface TerminalHistory {
  blocks: CommandBlock[]
  getBlockByCursor(cursor: number): CommandBlock | undefined
  getBlocksSince(timestamp: number): CommandBlock[]
}
```

---

## 4. Phase 3: 多媒体 + 标签页（Week 5-7）

### 4.1 Sixel 图片支持

**任务清单**：

| # | 任务 | 文件 | 工时 | 验收 |
|---|------|------|------|------|
| 8.1 | 评估 `xterm-addon-sixel` | 调研 | 4h | 可行性报告 |
| 8.2 | 实现/集成 Sixel 解析 | `XtermSurface.tsx` | 8h | Sixel 图片渲染 |
| 8.3 | 性能优化 | `sixelRenderer.ts` | 4h | 大图片不卡顿 |
| 8.4 | SSH 通道测试 | 手动测试 | 2h | 远程图片显示 |
| 8.5 | 集成测试 | `terminal-sixel.test.ts` | 2h | gnuplot 输出正确 |

**架构选择**：

选项 A：使用社区 addon `xterm-addon-sixel`
- 优点：开箱即用
- 缺点：维护不活跃

选项 B：自行实现 Sixel 解析
- 优点：完全控制
- 缺点：开发工作量大

**建议**：先尝试选项 A，如不可用再考虑选项 B

### 4.2 标签页架构

**任务清单**：

| # | 任务 | 文件 | 工时 | 验收 |
|---|------|------|------|------|
| 9.1 | 设计数据模型 | `terminalStore.ts` | 2h | 类型定义完成 |
| 9.2 | 实现标签页状态管理 | `terminalStore.ts` | 4h | CRUD 操作 |
| 9.3 | 实现标签页 UI | `TerminalTabs.tsx` | 6h | 标签页渲染 |
| 9.4 | 实现快捷键 | `terminalKeymap.ts` | 2h | Ctrl+Tab 切换 |
| 9.5 | 实现拖拽排序 | `TerminalTabs.tsx` | 3h | 拖拽生效 |
| 9.6 | 集成测试 | `terminal-tabs.test.ts` | 3h | 所有交互正确 |

**数据模型**：

```typescript
// terminalStore.ts
interface TerminalTab {
  id: string
  title: string
  icon?: string // shell icon 或自定义
  sessionId: string
  pinned: boolean
  order: number
  createdAt: number
}

// 扩展现有 TerminalState
interface TerminalState {
  // ... 现有字段
  tabs: TerminalTab[]
  activeTabId: string | null
  
  // 新增 actions
  createTab: (sessionId: string, opts?: { title?: string; icon?: string }) => string
  closeTab: (tabId: string) => void
  setActiveTab: (tabId: string) => void
  reorderTabs: (tabIds: string[]) => void
  pinTab: (tabId: string) => void
  updateTabTitle: (tabId: string, title: string) => void
}
```

**UI 组件**：

```tsx
// TerminalTabs.tsx
export function TerminalTabs() {
  const tabs = useTerminalStore(s => s.tabs)
  const activeTabId = useTerminalStore(s => s.activeTabId)
  const { createTab, closeTab, setActiveTab, reorderTabs } = useTerminalStore.getState()
  
  return (
    <div className="flex items-center border-b bg-surface-muted">
      <SortableContext items={tabs.map(t => t.id)} onSortEnd={reorderTabs}>
        {tabs.map(tab => (
          <TerminalTabItem
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            onClick={() => setActiveTab(tab.id)}
            onClose={() => closeTab(tab.id)}
          />
        ))}
      </SortableContext>
      <button
        className="p-2 hover:bg-state-hover"
        onClick={() => createTab(generateSessionId())}
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
```

---

## 5. Phase 4: 分屏 + 持久化（Week 8-9）

### 5.1 分屏布局

**任务清单**：

| # | 任务 | 文件 | 工时 | 验收 |
|---|------|------|------|------|
| 10.1 | 设计布局数据结构 | `terminalLayout.ts` | 3h | 类型定义完成 |
| 10.2 | 实现布局管理器 | `terminalLayoutManager.ts` | 6h | 分割/合并/调整 |
| 10.3 | 实现分屏 UI | `TerminalSplitPane.tsx` | 6h | 分割线可拖拽 |
| 10.4 | 实现快捷键 | `terminalKeymap.ts` | 2h | Ctrl+\ 分屏 |
| 10.5 | 实现最大化 | `TerminalSplitPane.tsx` | 2h | 双击标题最大化 |
| 10.6 | 集成测试 | `terminal-split.test.ts` | 3h | 所有交互正确 |

**数据模型**：

```typescript
// terminalLayout.ts
type LayoutNode = SplitPane | TerminalPane

interface SplitPane {
  id: string
  direction: 'horizontal' | 'vertical'
  size: number // 百分比 0-100
  children: LayoutNode[]
}

interface TerminalPane {
  id: string
  tabId: string
  size: number
}

interface TerminalLayout {
  root: LayoutNode
  activePaneId: string | null
}
```

**交互设计**：
- 垂直分屏：`Ctrl+\`（或 `Ctrl+Shift+|`）
- 水平分屏：`Ctrl+Shift+\`（或 `Ctrl+Shift+-`）
- 调整大小：拖拽分割线
- 最大化：双击面板标题栏
- 关闭面板：`Ctrl+W`（仅关闭当前面板，非标签页）

### 5.2 会话持久化

**任务清单**：

| # | 任务 | 文件 | 工时 | 验收 |
|---|------|------|------|------|
| 11.1 | 设计持久化格式 | `terminalPersistence.ts` | 2h | 格式定义完成 |
| 11.2 | 实现保存逻辑 | `terminalPersistence.ts` | 4h | 应用退出时保存 |
| 11.3 | 实现恢复逻辑 | `terminalPersistence.ts` | 4h | 启动时恢复 |
| 11.4 | 实现 UI 提示 | `TerminalRestorePrompt.tsx` | 2h | 恢复确认弹窗 |
| 11.5 | 配置项 | `hip.toml` | 1h | 可禁用自动恢复 |
| 11.6 | 集成测试 | `terminal-persistence.test.ts` | 3h | 保存/恢复正确 |

**持久化格式**：

```typescript
// terminalPersistence.ts
interface PersistedTerminalState {
  version: number
  savedAt: number
  
  tabs: PersistedTab[]
  layout: TerminalLayout
  activeTabId: string | null
}

interface PersistedTab {
  id: string
  title: string
  sessionId: string
  shell: string
  cwd: string
  env: Record<string, string> // 仅保存自定义环境变量
  scrollback: string[] // 最近 N 行
  pinned: boolean
  order: number
}
```

**存储位置**：
- `~/.hip/terminal-sessions.json`
- 限制大小（如最大 10MB）

---

## 6. Phase 5: 增强特性（Week 10）

### 6.1 CSI u 键盘编码

**任务清单**：

| # | 任务 | 文件 | 工时 | 验收 |
|---|------|------|------|------|
| 12.1 | 实现 CSI u 解析 | `terminalKeymap.ts` | 3h | Esc/Ctrl+[ 区分 |
| 12.2 | 测试 TUI 应用 | 手动测试 | 2h | htop/vim 按键正确 |

### 6.2 自定义快捷键

**任务清单**：

| # | 任务 | 文件 | 工时 | 验收 |
|---|------|------|------|------|
| 13.1 | 设计配置格式 | `hip.toml` | 1h | 格式定义完成 |
| 13.2 | 实现快捷键管理器 | `terminalKeymapManager.ts` | 3h | 配置生效 |
| 13.3 | 实现 UI 配置 | `TerminalKeybindingSettings.tsx` | 3h | 可视化配置 |
| 13.4 | 集成测试 | `terminal-keybindings.test.ts` | 2h | 自定义生效 |

### 6.3 主题导出

**任务清单**：

| # | 任务 | 文件 | 工时 | 验收 |
|---|------|------|------|------|
| 14.1 | 实现 iTermcolors 导出 | `terminalThemeExport.ts` | 2h | 格式正确 |
| 14.2 | 实现 Kitty/Alacritty 导出 | `terminalThemeExport.ts` | 2h | 格式正确 |
| 14.3 | 实现导入功能 | `terminalThemeImport.ts` | 2h | 可导入主题 |
| 14.4 | UI 集成 | `GeneralSettings.tsx` | 2h | 导入/导出按钮 |

---

## 7. 测试策略

### 7.1 单元测试

```typescript
// terminalWebgl.test.ts
describe('WebGL addon', () => {
  it('should load WebGL addon when supported', async () => {
    // Mock WebGL support
    const term = new Terminal()
    const loaded = await loadWebGL(term)
    expect(loaded).toBe(true)
  })
  
  it('should fallback to Canvas when WebGL not supported', async () => {
    // Mock no WebGL
    const term = new Terminal()
    const loaded = await loadWebGL(term)
    expect(loaded).toBe(false)
  })
})

// terminalOsc8.test.ts
describe('OSC 8 hyperlinks', () => {
  it('should parse hyperlink URI', () => {
    const term = new Terminal()
    const links: Link[] = []
    
    term.parser.registerOscHandler(8, (data) => {
      const link = parseOsc8(data)
      if (link) links.push(link)
    })
    
    // Write OSC 8 sequence
    term.write('\x1b]8;;https://example.com\x1b\\Link\x1b]8;;\x1b\\')
    
    expect(links).toHaveLength(1)
    expect(links[0].uri).toBe('https://example.com')
  })
})
```

### 7.2 集成测试

```typescript
// terminal-integration.spec.ts (e2e)
describe('Terminal capability upgrade', () => {
  it('should render ligatures correctly', async () => {
    // 打开终端
    await openTerminal()
    
    // 输入包含连字的文本
    await writeTerminal('echo "=>"')
    
    // 等待渲染
    await waitForRender()
    
    // 截图对比
    await expect(page).toHaveScreenshot('ligatures.png')
  })
  
  it('should display hyperlinks', async () => {
    await openTerminal()
    await writeTerminal('echo "https://example.com"')
    await waitForRender()
    
    // 检查链接元素
    const link = page.locator('.terminal-link')
    await expect(link).toBeVisible()
  })
})
```

### 7.3 性能测试

```typescript
// terminal-perf.spec.ts
describe('Terminal performance', () => {
  it('should maintain 30fps with high output', async () => {
    await openTerminal()
    
    // 启动高频输出
    await writeTerminal('cat /dev/urandom | base64')
    
    // 测量帧率
    const fps = await measureFrameRate(5000) // 5 秒
    
    expect(fps).toBeGreaterThanOrEqual(30)
  })
})
```

---

## 8. 回滚策略

### 8.1 特性开关

```typescript
// terminalFeature.ts - 扩展现有特性开关
export const TERMINAL_WEBGL = true
export const TERMINAL_LIGATURES = true
export const TERMINAL_UNICODE11 = true
export const TERMINAL_OSC8 = true
export const TERMINAL_OSC52 = true
export const TERMINAL_SIXEL = false // 实验性，默认关闭
export const TERMINAL_TABS = true
export const TERMINAL_SPLIT_PANES = true
export const TERMINAL_PERSISTENCE = true
```

### 8.2 回滚步骤

如出现问题，按以下顺序禁用：

1. 禁用 WebGL（最可能出问题）
2. 禁用连字（性能问题）
3. 禁用 Sixel（实验性）
4. 回退到单一面板（标签页/分屏问题）

---

## 9. 依赖清单

### 新增 npm 依赖

```json
{
  "@xterm/addon-webgl": "^0.18.0",
  "@xterm/addon-ligatures": "^0.7.0",
  "@xterm/addon-unicode11": "^0.8.0"
}
```

### 可选依赖（Sixel）

```json
{
  "xterm-addon-sixel": "^0.5.0"
}
```

### 无新增 Rust 依赖

---

## 10. 交付物清单

### 代码文件

**新增**：
- `src/components/artifact/terminalDecorations.ts`
- `src/components/artifact/TerminalTabs.tsx`
- `src/components/artifact/TerminalSplitPane.tsx`
- `src/components/artifact/TerminalLinkPreview.tsx`
- `src/components/artifact/TerminalRestorePrompt.tsx`
- `src/domain/terminalHistory.ts`
- `src/domain/terminalLayout.ts`
- `src/domain/terminalLayoutManager.ts`
- `src/domain/terminalPersistence.ts`
- `src/domain/terminalThemeExport.ts`
- `src/domain/terminalKeymapManager.ts`
- `src/components/account/TerminalKeybindingSettings.tsx`

**修改**：
- `src/components/artifact/XtermSurface.tsx`
- `src/store/terminalStore.ts`
- `src/components/artifact/terminalTheme.ts`
- `src/lib/terminalKeymap.ts`
- `src/components/account/GeneralSettings.tsx`
- `package.json`

### 测试文件

**新增**：
- `src/components/artifact/terminalWebgl.test.ts`
- `src/components/artifact/terminalOsc8.test.ts`
- `src/components/artifact/terminalTabs.test.ts`
- `src/components/artifact/terminalSplit.test.ts`
- `src/domain/terminalHistory.test.ts`
- `src/domain/terminalLayout.test.ts`
- `src/domain/terminalPersistence.test.ts`
- `e2e/terminal-perf.spec.ts`

### 文档

- [x] `docs/design/terminal-capability-upgrade/terminal-capability-upgrade-spec.md`
- [x] `docs/design/terminal-capability-upgrade/terminal-capability-upgrade-plan.md`
- [ ] `docs/design/terminal-capability-upgrade/terminal-capability-upgrade-preview.html`
- [ ] 用户文档更新
- [ ] 开发者文档更新
