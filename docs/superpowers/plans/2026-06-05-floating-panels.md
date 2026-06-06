# 浮窗卡片化布局实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `AppLayout` 的标题栏改为全局顶部栏，并把左 / 中 / 右三块面板包装成带入场动效的浮窗卡片。

**Architecture：** 新增一个无状态 `PanelCard` 组件负责统一的外边距、圆角、边框、阴影和挂载动效；`AppLayout` 改为垂直 flex（顶部 `ChatHeader` + 下方 `PanelGroup`）；`Sidebar` 与 `ArtifactPanel` 剥离外层样式，完全由 `PanelCard` 控制卡片壳；通过 Tailwind 自定义 keyframes 提供左右入场动画。

**Tech Stack：** React + TypeScript + Tailwind CSS + `react-resizable-panels` + Zustand

---

## 文件清单

| 文件 | 动作 | 说明 |
|---|---|---|
| `tailwind.config.js` | 修改 | 添加 `in-left` / `in-right` 自定义动画 keyframes |
| `src/components/layout/PanelCard.tsx` | 创建 | 通用浮窗卡片容器 |
| `src/routes/AppLayout.tsx` | 修改 | 顶部标题栏 + 三栏卡片包装 |
| `src/components/sidebar/Sidebar.tsx` | 修改 | 移除根节点背景/边框 |
| `src/components/artifact/ArtifactPanel.tsx` | 修改 | 非全屏模式下移除根节点背景/边框 |
| `src/components/chat/ChatHeader.tsx` | 修改 | 增加内边距、显式背景 |
| `src/components/sidebar/SidebarPeek.tsx` | 修改 | 统一浮层圆角和背景，与左右卡片视觉一致 |

---

## Task 1：添加入场动画 keyframes

**Files:**
- Modify: `tailwind.config.js:41-48`

当前 `tailwind.config.js` 里没有 `tailwindcss-animate`，因此我们自己定义两个最简 keyframes。

- [ ] **Step 1：在 `extend.keyframes` 中加入 `in-left` 和 `in-right`**

```js
keyframes: {
  blink: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0' } },
  pulse: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.4' } },
  'in-left': {
    '0%': { opacity: '0', transform: 'translateX(-8px) scale(0.98)' },
    '100%': { opacity: '1', transform: 'translateX(0) scale(1)' },
  },
  'in-right': {
    '0%': { opacity: '0', transform: 'translateX(8px) scale(0.98)' },
    '100%': { opacity: '1', transform: 'translateX(0) scale(1)' },
  },
},
```

- [ ] **Step 2：在 `extend.animation` 中注册对应的 animation 类**

```js
animation: {
  blink: 'blink 1s step-start infinite',
  pulse: 'pulse 1.2s ease-in-out infinite',
  'in-left': 'in-left 0.3s ease-out',
  'in-right': 'in-right 0.3s ease-out',
},
```

- [ ] **Step 3：验证配置无语法错误**

Run: `npx tsc --noEmit -p tsconfig.node.json`  
Expected: 无错误（若该命令不存在，则直接跳到下一步运行 dev/build 验证）。

- [ ] **Step 4：Commit**

```bash
git add tailwind.config.js
git commit -m "feat: add panel-card entrance animations"
```

---

## Task 2：创建 `PanelCard` 组件

**Files:**
- Create: `src/components/layout/PanelCard.tsx`

- [ ] **Step 1：编写组件代码**

```tsx
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export interface PanelCardProps {
  children: ReactNode
  className?: string
  /** 阴影强度，默认 'pop' */
  shadow?: 'pop' | 'float'
  /** 挂载入场方向，默认 'none' */
  direction?: 'left' | 'right' | 'none'
}

export function PanelCard({
  children,
  className,
  shadow = 'pop',
  direction = 'none',
}: PanelCardProps) {
  return (
    <div
      className={cn(
        'flex flex-col h-full w-full overflow-hidden rounded-xl border border-border bg-surface transition-shadow duration-200',
        shadow === 'float' ? 'shadow-float' : 'shadow-pop',
        direction === 'left' && 'animate-in-left',
        direction === 'right' && 'animate-in-right',
        className,
      )}
    >
      {children}
    </div>
  )
}
```

- [ ] **Step 2：运行 TypeScript 检查**

Run: `npx tsc --noEmit`  
Expected: 无新增错误。

- [ ] **Step 3：Commit**

```bash
git add src/components/layout/PanelCard.tsx
git commit -m "feat: add PanelCard layout component"
```

---

## Task 3：重构 `AppLayout.tsx`

**Files:**
- Modify: `src/routes/AppLayout.tsx`

目标：
1. 最外层背景改为 `bg-surface-subtle`。
2. `ChatHeader` 提到 `PanelGroup` 上方作为全局顶部栏。
3. 左 / 中 / 右 Panel 内容用 `PanelCard` 包裹；左右侧边栏条件渲染整个 `PanelCard` 以触发挂载动画。
4. `PanelResizeHandle` 改为间隙中的隐形热区。

- [ ] **Step 1：修改导入并重构布局**

```tsx
import { useEffect, useRef } from 'react'
import { Panel, PanelGroup, PanelResizeHandle, type ImperativePanelHandle } from 'react-resizable-panels'
import { useUiStore } from '@/store/uiStore'
import { Sidebar } from '@/components/sidebar/Sidebar'
import { ChatHeader } from '@/components/chat/ChatHeader'
import { ChatPane } from '@/components/chat/ChatPane'
import { InputBar } from '@/components/chat/InputBar'
import { ArtifactPanel } from '@/components/artifact/ArtifactPanel'
import { SidebarPeek } from '@/components/sidebar/SidebarPeek'
import { PanelCard } from '@/components/layout/PanelCard'

export function AppLayout() {
  const sidebarRef = useRef<ImperativePanelHandle>(null)
  const panelRef = useRef<ImperativePanelHandle>(null)
  const collapsed = useUiStore((s) => s.collapsed)
  const panelOpen = useUiStore((s) => s.panelOpen)
  const setCollapsed = useUiStore((s) => s.setCollapsed)
  const setPanelOpen = useUiStore((s) => s.setPanelOpen)

  useEffect(() => {
    const p = sidebarRef.current
    if (!p) return
    const t = setTimeout(() => {
      if (collapsed && !p.isCollapsed()) p.collapse()
      if (!collapsed && p.isCollapsed()) p.expand()
    }, 0)
    return () => clearTimeout(t)
  }, [collapsed])

  useEffect(() => {
    const p = panelRef.current
    if (!p) return
    const t = setTimeout(() => {
      if (!panelOpen && !p.isCollapsed()) p.collapse()
      if (panelOpen && p.isCollapsed()) p.expand()
    }, 0)
    return () => clearTimeout(t)
  }, [panelOpen])

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-surface-subtle">
      <ChatHeader />

      <div className="flex-1">
        <PanelGroup direction="horizontal">
          <Panel
            ref={sidebarRef}
            defaultSize={14}
            minSize={12}
            maxSize={22}
            collapsible
            collapsedSize={0}
            onCollapse={() => setCollapsed(true)}
            onExpand={() => setCollapsed(false)}
          >
            {!collapsed && (
              <PanelCard shadow="float" direction="left">
                <Sidebar />
              </PanelCard>
            )}
          </Panel>

          <PanelResizeHandle className="group relative z-10 w-3 -mx-1 flex items-center justify-center bg-transparent transition-colors hover:bg-accent/5 data-[resize-handle-state=drag]:bg-accent/10">
            <div className="h-8 w-1 rounded-full bg-border transition-colors group-hover:bg-accent/40 group-data-[resize-handle-state=drag]:bg-accent" />
          </PanelResizeHandle>

          <Panel minSize={34}>
            <PanelCard shadow="pop">
              <ChatPane />
              <InputBar />
            </PanelCard>
          </Panel>

          <PanelResizeHandle className="group relative z-10 w-3 -mx-1 flex items-center justify-center bg-transparent transition-colors hover:bg-accent/5 data-[resize-handle-state=drag]:bg-accent/10">
            <div className="h-8 w-1 rounded-full bg-border transition-colors group-hover:bg-accent/40 group-data-[resize-handle-state=drag]:bg-accent" />
          </PanelResizeHandle>

          <Panel
            ref={panelRef}
            defaultSize={26}
            minSize={18}
            maxSize={44}
            collapsible
            collapsedSize={0}
            onCollapse={() => setPanelOpen(false)}
            onExpand={() => setPanelOpen(true)}
          >
            {panelOpen && (
              <PanelCard shadow="float" direction="right">
                <ArtifactPanel />
              </PanelCard>
            )}
          </Panel>
        </PanelGroup>
      </div>

      <SidebarPeek />
    </div>
  )
}
```

- [ ] **Step 2：TypeScript 检查**

Run: `npx tsc --noEmit`  
Expected: 无新增错误。

- [ ] **Step 3：Commit**

```bash
git add src/routes/AppLayout.tsx
git commit -m "feat: float AppLayout panels with PanelCard"
```

---

## Task 4：剥离 `Sidebar` 外层样式

**Files:**
- Modify: `src/components/sidebar/Sidebar.tsx:8`

`Sidebar` 根节点现在由 `PanelCard` 提供背景和边框，内部保持原样。

- [ ] **Step 1：修改根节点 className**

```tsx
export function Sidebar() {
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-col gap-2 p-2.5">
        <NewChatButton />
        <SearchBox />
      </div>

      <div className="flex-1 overflow-y-auto px-2">
        <SessionList />
      </div>

      <div className="border-t border-border p-2">
        <UserMenu />
      </div>
    </div>
  )
}
```

- [ ] **Step 2：Commit**

```bash
git add src/components/sidebar/Sidebar.tsx
git commit -m "refactor: remove Sidebar outer shell, let PanelCard own it"
```

---

## Task 5：统一 `SidebarPeek` 浮层样式

**Files:**
- Modify: `src/components/sidebar/SidebarPeek.tsx:51-58`

`SidebarPeek` 折叠浮层需要与左右 `PanelCard` 保持视觉一致：显式白色背景、右侧圆角、`shadow-float`。

- [ ] **Step 1：修改 `aside` 的 className**

```tsx
<aside
  onMouseEnter={() => dispatch({ type: 'enter' })}
  onMouseLeave={() => dispatch({ type: 'leave' })}
  style={{ width: PEEK_WIDTH, transitionDuration: `${PEEK_ANIM_MS}ms` }}
  className={cn(
    'absolute left-0 top-0 z-40 h-full bg-surface rounded-r-xl border-r border-border shadow-float transition-transform ease-out motion-reduce:transition-none',
    state.open ? 'translate-x-0' : '-translate-x-full',
  )}
>
```

- [ ] **Step 2：Commit**

```bash
git add src/components/sidebar/SidebarPeek.tsx
git commit -m "style: unify SidebarPeek floating panel visuals"
```

---

## Task 6：剥离 `ArtifactPanel` 非全屏外层样式

**Files:**
- Modify: `src/components/artifact/ArtifactPanel.tsx:76`

- [ ] **Step 1：修改非全屏返回节点的 className**

当前代码：
```tsx
return <div className={cn('h-full border-l border-border bg-surface-subtle')}>{body}</div>
```

改为：
```tsx
return <div className="h-full">{body}</div>
```

由于 `cn` 不再被使用，删除 `cn` 的 import：

```tsx
import { FileText, FolderTree, Network, GitCompare, Maximize2, Minimize2, X } from 'lucide-react'
import type { ArtifactTab } from '@/mock/types'
import { useUiStore } from '@/store/uiStore'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/Tabs'
import { Button } from '@/components/ui/Button'
import { DocRenderer } from './DocRenderer'
import { FileTree } from './FileTree'
import { AgentDashboard } from './AgentDashboard'
import { DiffViewer } from './DiffViewer'
```

> 全屏浮层部分（`if (fullscreen) { ... }`）**保持原样不动**。

- [ ] **Step 2：Commit**

```bash
git add src/components/artifact/ArtifactPanel.tsx
git commit -m "refactor: remove ArtifactPanel outer shell in normal mode"
```

---

## Task 7：微调 `ChatHeader`

**Files:**
- Modify: `src/components/chat/ChatHeader.tsx:14`

- [ ] **Step 1：增加水平内边距并显式设置背景**

```tsx
return (
  <div className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-4">
    <div className="flex items-center gap-2">
      <Button variant="ghost" size="icon" onClick={toggleCollapsed} title="折叠侧边栏">
        <PanelLeft size={17} />
      </Button>
      <span className="text-[13px] font-medium text-ink">{active?.title ?? '对话'}</span>
    </div>
    <Button variant="ghost" size="icon" onClick={togglePanel} title="切换产物面板">
      <PanelRight size={17} />
    </Button>
  </div>
)
```

- [ ] **Step 2：Commit**

```bash
git add src/components/chat/ChatHeader.tsx
git commit -m "style: polish ChatHeader padding and background for global top bar"
```

---

## Task 8：视觉与功能自测

- [ ] **Step 1：构建前端以检查 Tailwind 类名是否生效**

Run: `yarn build`  
Expected: 构建成功，无 CSS/Tailwind 类名报错。

- [ ] **Step 2：启动开发模式查看效果**

Run: `yarn tauri dev`（仅用于视觉自测，不用于 E2E）  
Checklist:
- [ ] 最外层背景为浅灰 `bg-surface-subtle`，三块卡片为白色。
- [ ] 左 / 右卡片打开时有从两侧滑入的淡入动画。
- [ ] 左 / 右卡片有较深阴影，中间卡片阴影较轻。
- [ ] 拖拽把手悬浮在卡片间隙中，hover/drag 时显示强调色。
- [ ] 折叠左侧后 `SidebarPeek` 浮层样式与左右卡片一致（圆角 `rounded-xl`、阴影 `shadow-float`）。
- [ ] 右侧 `ArtifactPanel` 全屏浮层正常显示，不被外部 `PanelCard` 破坏。
- [ ] 反复打开/关闭左右面板，页面不崩溃、不触发 React #185。

---

## Task 9：E2E 回归

- [ ] **Step 1：构建 Tauri debug 包**

Run: `cargo tauri build --debug`  
Expected: 构建成功，生成 `src-tauri/target/debug/hip`。

- [ ] **Step 2：运行 E2E 测试**

Run: `yarn test:e2e`  
Expected: 现有测试全部通过。

- [ ] **Step 3：最终 commit（如需）**

```bash
git add -A
git commit -m "feat: floating panel layout with PanelCard and entrance animations"
```

---

## 回滚方案

如果任何一步导致布局崩坏或 E2E 失败：

1. **最快的回滚：** 逐条 `git revert` 上述 7 个代码 commit（从最新到最旧），即可还原到原始布局。
2. **若只想临时禁用动画：** 将 `PanelCard` 中的 `direction === 'left' && 'animate-in-left'` 和 `direction === 'right' && 'animate-in-right'` 注释掉，保留静态浮窗效果。
3. **若拖拽把手热区干扰操作：** 将 `PanelResizeHandle` 的 className 改回原始 `w-px bg-border transition-colors hover:bg-accent data-[resize-handle-state=drag]:bg-accent`。

---

## 自检

- **Spec 覆盖：** 所有设计要点（全局标题栏、PanelCard、三栏卡片、Sidebar/ArtifactPanel 剥离外层、ChatHeader 微调、入场动画、拖拽把手、测试计划）均已对应到任务。
- **Placeholder 扫描：** 无 TBD/TODO，所有代码片段完整。
- **类型一致性：** `PanelCard` 的 `direction` 与 Tailwind 自定义动画类 `animate-in-left` / `animate-in-right` 一一对应；`shadow` 与 `shadow-pop` / `shadow-float` 一一对应。
