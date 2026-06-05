# 折叠侧边栏「悬停浮出」(C2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 折叠侧边栏不再是丑陋的窄图标栏；折叠 = 宽度归零整条消失，鼠标移到左缘时整条侧栏作为浮层滑出覆盖在对话之上，移开缩回。

**Architecture:** 「折叠」从侧栏内部上移到布局层 —— `Sidebar` 永远渲染完整形态，折叠态由「`Panel` 收到 0 宽 + 一个绝对定位的浮层 `SidebarPeek`」共同表达。浮层的「悬停开 / 延迟关 / 锁定」时序逻辑抽成 `src/lib` 里的纯 reducer（vitest 单测），React 组件只负责把指针事件、定时器、滑动动画接上去。

**Tech Stack:** React 18 + TypeScript、Zustand、react-resizable-panels v2、@radix-ui/react-dropdown-menu、Tailwind、vitest。

**与 spec 的一处偏差（执行前请知悉）：** spec 列了「折叠时拖左缘 → 拉回停靠」。本计划**不实现拖拽恢复** —— 左缘的 hover 热区会和 resize handle 的拖拽抢手势。恢复停靠走两条路：浮层里的**图钉**按钮 + 对话头部的 **▣**。停靠态下拖 handle 调整宽度照常可用。可见的「淡线」直接复用已有的 `PanelResizeHandle`（无需新画线）。

---

## File Structure

| 文件 | 动作 | 职责 |
|---|---|---|
| `src/lib/hoverPeek.ts` | 新增 | 纯 reducer + 常量：浮层 open/pendingClose/locked 状态机、关闭延迟与动画时长 |
| `src/lib/hoverPeek.test.ts` | 新增 | reducer 单测（vitest, node 环境） |
| `src/components/sidebar/sidebarPeekContext.ts` | 新增 | `SidebarPeekLockContext` —— 让浮层内的 `UserMenu` 在下拉打开时锁住 peek |
| `src/components/sidebar/SidebarPeek.tsx` | 新增 | 左缘 hover 热区 + 滑动浮层 + 图钉停靠；接 reducer/定时器 |
| `src/components/sidebar/Sidebar.tsx` | 改 | 删除全部 `collapsed` 分支，永远完整形态 |
| `src/components/sidebar/NewChatButton.tsx` | 改 | 删除 `collapsed` prop 与图标-only 变体 |
| `src/components/sidebar/UserMenu.tsx` | 改 | 删除 `collapsed` prop；消费锁定 context |
| `src/routes/AppLayout.tsx` | 改 | `collapsedSize` 4→0；折叠时不渲染 `Sidebar`；挂载 `SidebarPeek`；根容器 `relative` |

依赖顺序：reducer → context → 简化 Sidebar 三件套 → SidebarPeek → 接 AppLayout → 手测。

---

## Task 1: 丢弃被取代的未提交改动

working tree 里 `NewChatButton.tsx` / `Sidebar.tsx` / `UserMenu.tsx` 有手调折叠图标栏的未提交改动，本方案会整体重写它们。先还原到 HEAD，后续 Modify 步骤才有干净基线。（用户已确认可丢弃。）

**Files:**
- Modify (还原): `src/components/sidebar/NewChatButton.tsx`, `src/components/sidebar/Sidebar.tsx`, `src/components/sidebar/UserMenu.tsx`

- [ ] **Step 1: 还原三个文件的 WIP**

Run:
```bash
git checkout -- src/components/sidebar/NewChatButton.tsx src/components/sidebar/Sidebar.tsx src/components/sidebar/UserMenu.tsx
```

- [ ] **Step 2: 确认 working tree 干净**

Run: `git status --short`
Expected: 没有 `src/components/sidebar/` 下的改动行（输出为空或只剩与本任务无关的文件）。

> 本任务只是丢弃未提交改动，无需 commit。

---

## Task 2: 浮层时序 reducer（TDD）

把「悬停开、移开延迟关、再进取消关、下拉锁定」做成纯函数，先写测试。

**Files:**
- Create: `src/lib/hoverPeek.ts`
- Test: `src/lib/hoverPeek.test.ts`

- [ ] **Step 1: 写失败测试**

Create `src/lib/hoverPeek.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { peekReducer, initialPeekState, type PeekState } from './hoverPeek'

describe('peekReducer', () => {
  it('starts closed', () => {
    expect(initialPeekState).toEqual({ open: false, pendingClose: false, locked: false })
  })

  it('opens on enter', () => {
    expect(peekReducer(initialPeekState, { type: 'enter' })).toEqual({
      open: true, pendingClose: false, locked: false,
    })
  })

  it('schedules a close on leave while open', () => {
    const open: PeekState = { open: true, pendingClose: false, locked: false }
    expect(peekReducer(open, { type: 'leave' })).toEqual({
      open: true, pendingClose: true, locked: false,
    })
  })

  it('ignores leave when already closed', () => {
    expect(peekReducer(initialPeekState, { type: 'leave' })).toEqual(initialPeekState)
  })

  it('re-entering cancels a pending close', () => {
    const pending: PeekState = { open: true, pendingClose: true, locked: false }
    expect(peekReducer(pending, { type: 'enter' })).toEqual({
      open: true, pendingClose: false, locked: false,
    })
  })

  it('closes when the grace timer elapses', () => {
    const pending: PeekState = { open: true, pendingClose: true, locked: false }
    expect(peekReducer(pending, { type: 'closeElapsed' })).toEqual({
      open: false, pendingClose: false, locked: false,
    })
  })

  it('stays open on leave while locked', () => {
    const locked: PeekState = { open: true, pendingClose: false, locked: true }
    expect(peekReducer(locked, { type: 'leave' })).toEqual(locked)
  })

  it('ignores an elapsed close while locked', () => {
    const locked: PeekState = { open: true, pendingClose: true, locked: true }
    expect(peekReducer(locked, { type: 'closeElapsed' })).toEqual({
      open: true, pendingClose: false, locked: true,
    })
  })

  it('lock forces open and clears any pending close', () => {
    const pending: PeekState = { open: true, pendingClose: true, locked: false }
    expect(peekReducer(pending, { type: 'lock' })).toEqual({
      open: true, pendingClose: false, locked: true,
    })
  })

  it('unlock releases the hold without closing', () => {
    const locked: PeekState = { open: true, pendingClose: false, locked: true }
    expect(peekReducer(locked, { type: 'unlock' })).toEqual({
      open: true, pendingClose: false, locked: false,
    })
  })

  it('reset returns to the initial closed state', () => {
    const locked: PeekState = { open: true, pendingClose: true, locked: true }
    expect(peekReducer(locked, { type: 'reset' })).toEqual(initialPeekState)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `yarn test src/lib/hoverPeek.test.ts`
Expected: FAIL —— 无法解析 `./hoverPeek`（文件还没建）。

- [ ] **Step 3: 写实现**

Create `src/lib/hoverPeek.ts`:
```ts
/** 指针离开后，浮层缩回前的宽限时长（ms）—— 防手抖闪烁。 */
export const PEEK_CLOSE_DELAY_MS = 250
/** 浮层滑入 / 滑出动画时长（ms）。 */
export const PEEK_ANIM_MS = 180

export interface PeekState {
  /** 浮层可见（已滑入）。宽限期内仍为 true。 */
  open: boolean
  /** 已安排关闭、正在等宽限延迟。 */
  pendingClose: boolean
  /** 不管指针在哪都保持打开（如浮层内的下拉菜单正开着）。 */
  locked: boolean
}

export const initialPeekState: PeekState = { open: false, pendingClose: false, locked: false }

export type PeekEvent =
  | { type: 'enter' } // 指针进入左缘热区或浮层
  | { type: 'leave' } // 指针离开热区与浮层
  | { type: 'closeElapsed' } // 宽限定时器到点
  | { type: 'lock' } // 保持打开（下拉打开）
  | { type: 'unlock' } // 解除保持（下拉关闭）
  | { type: 'reset' } // 强制关闭（侧栏已停靠 / 不再折叠）

export function peekReducer(state: PeekState, event: PeekEvent): PeekState {
  switch (event.type) {
    case 'enter':
      return { ...state, open: true, pendingClose: false }
    case 'leave':
      if (state.locked || !state.open) return state
      return { ...state, pendingClose: true }
    case 'closeElapsed':
      if (state.locked) return { ...state, pendingClose: false }
      return { ...state, open: false, pendingClose: false }
    case 'lock':
      return { ...state, locked: true, open: true, pendingClose: false }
    case 'unlock':
      return { ...state, locked: false }
    case 'reset':
      return initialPeekState
    default:
      return state
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `yarn test src/lib/hoverPeek.test.ts`
Expected: PASS，11 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/lib/hoverPeek.ts src/lib/hoverPeek.test.ts
git commit -m "feat(sidebar): add hover-peek timing reducer" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 锁定用的 React Context

浮层内的 `UserMenu` 下拉用 portal 渲染到 body，鼠标移过去会触发浮层 `mouseleave`。用一个 context 让下拉在打开时锁住 peek。

**Files:**
- Create: `src/components/sidebar/sidebarPeekContext.ts`

- [ ] **Step 1: 写 context**

Create `src/components/sidebar/sidebarPeekContext.ts`:
```ts
import { createContext } from 'react'

export interface SidebarPeekLock {
  /** 保持浮层打开（如内部下拉菜单打开时）。 */
  lock: () => void
  /** 解除之前的保持。 */
  unlock: () => void
}

/** 由 SidebarPeek 向其浮层子树提供；不在浮层里时为 null。 */
export const SidebarPeekLockContext = createContext<SidebarPeekLock | null>(null)
```

- [ ] **Step 2: 类型检查**

Run: `yarn type-check`
Expected: 无报错。

- [ ] **Step 3: 提交**

```bash
git add src/components/sidebar/sidebarPeekContext.ts
git commit -m "feat(sidebar): add peek-lock context" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 简化 Sidebar 三件套

删掉折叠图标栏变体：`Sidebar` 永远完整；`NewChatButton` / `UserMenu` 不再收 `collapsed`；`UserMenu` 接锁定 context。

**Files:**
- Modify: `src/components/sidebar/NewChatButton.tsx`（整文件替换）
- Modify: `src/components/sidebar/UserMenu.tsx`（整文件替换）
- Modify: `src/components/sidebar/Sidebar.tsx`（整文件替换）

- [ ] **Step 1: 重写 `NewChatButton.tsx`**

整个文件替换为：
```tsx
import { Plus } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'

export function NewChatButton() {
  const newSession = useUiStore((s) => s.newSession)
  return (
    <button
      onClick={newSession}
      className="flex h-9 w-full items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
      title="新对话"
    >
      <Plus size={18} />
      <span>新对话</span>
    </button>
  )
}
```

- [ ] **Step 2: 重写 `UserMenu.tsx`**

整个文件替换为：
```tsx
import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Settings, CreditCard, HelpCircle, LogOut, ChevronsUpDown } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/DropdownMenu'
import { SidebarPeekLockContext } from './sidebarPeekContext'
import { mockUser } from '@/mock/user'

const PAGES = [
  { icon: User, label: '个人资料', path: '/profile' },
  { icon: Settings, label: '设置', path: '/settings' },
  { icon: CreditCard, label: '账单与用量', path: '/billing' },
  { icon: HelpCircle, label: '帮助与支持', path: '/help' },
]

export function UserMenu() {
  const navigate = useNavigate()
  const peekLock = useContext(SidebarPeekLockContext)

  return (
    <DropdownMenu onOpenChange={(open) => (open ? peekLock?.lock() : peekLock?.unlock())}>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2.5 rounded-md p-1.5 transition-colors hover:bg-surface-muted">
          <Avatar name={mockUser.name} src={mockUser.avatarUrl} size={28} />
          <div className="flex min-w-0 flex-1 flex-col items-start">
            <span className="truncate text-[13px] font-medium text-ink">{mockUser.name}</span>
            <span className="truncate text-[11px] text-ink-tertiary">{mockUser.email}</span>
          </div>
          <ChevronsUpDown size={14} className="shrink-0 text-ink-tertiary" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-[240px]">
        <DropdownMenuLabel>{mockUser.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PAGES.map((page) => (
          <DropdownMenuItem key={page.label} onSelect={() => navigate(page.path)}>
            <page.icon size={15} className="text-ink-secondary" />
            {page.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem className="text-danger focus:bg-danger/10" onSelect={() => navigate('/login')}>
          <LogOut size={15} />
          退出登录
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
```

- [ ] **Step 3: 重写 `Sidebar.tsx`**

整个文件替换为：
```tsx
import { NewChatButton } from './NewChatButton'
import { SearchBox } from './SearchBox'
import { SessionList } from './SessionList'
import { UserMenu } from './UserMenu'

export function Sidebar() {
  return (
    <div className="flex h-full flex-col bg-surface-subtle">
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

- [ ] **Step 4: 类型检查**

Run: `yarn type-check`
Expected: 无报错（`collapsed` prop 已从 `Sidebar` 内部及子组件移除；`AppLayout` 本就以无 prop 形式 `<Sidebar />` 调用，不受影响）。

- [ ] **Step 5: 提交**

```bash
git add src/components/sidebar/NewChatButton.tsx src/components/sidebar/UserMenu.tsx src/components/sidebar/Sidebar.tsx
git commit -m "refactor(sidebar): drop collapsed icon-rail variant; Sidebar always full" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: SidebarPeek 浮层组件

左缘 hover 热区（含发现用 chevron）+ 滑动浮层（复用 `Sidebar`）+ 图钉停靠。接 Task 2 的 reducer 与 Task 3 的 context。

**Files:**
- Create: `src/components/sidebar/SidebarPeek.tsx`

- [ ] **Step 1: 写组件**

Create `src/components/sidebar/SidebarPeek.tsx`:
```tsx
import { useEffect, useMemo, useReducer } from 'react'
import { ChevronRight, Pin } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import { peekReducer, initialPeekState, PEEK_CLOSE_DELAY_MS, PEEK_ANIM_MS } from '@/lib/hoverPeek'
import { Sidebar } from './Sidebar'
import { SidebarPeekLockContext } from './sidebarPeekContext'

/** 浮层宽度（px）—— 舒适阅读宽度，独立于停靠态面板尺寸。 */
const PEEK_WIDTH = 260

export function SidebarPeek() {
  const collapsed = useUiStore((s) => s.collapsed)
  const setCollapsed = useUiStore((s) => s.setCollapsed)
  const [state, dispatch] = useReducer(peekReducer, initialPeekState)

  // 侧栏重新停靠时，强制关闭浮层。
  useEffect(() => {
    if (!collapsed) dispatch({ type: 'reset' })
  }, [collapsed])

  // 有待关闭时跑宽限定时器。
  useEffect(() => {
    if (!state.pendingClose) return
    const t = setTimeout(() => dispatch({ type: 'closeElapsed' }), PEEK_CLOSE_DELAY_MS)
    return () => clearTimeout(t)
  }, [state.pendingClose])

  const lockValue = useMemo(
    () => ({ lock: () => dispatch({ type: 'lock' }), unlock: () => dispatch({ type: 'unlock' }) }),
    [],
  )

  if (!collapsed) return null

  return (
    <>
      {/* 左缘 hover 热区 + 发现用 chevron；可见的「淡线」是底下的 PanelResizeHandle。 */}
      <div
        aria-hidden
        onMouseEnter={() => dispatch({ type: 'enter' })}
        className="group absolute left-0 top-0 z-30 h-full w-3"
      >
        <ChevronRight
          size={16}
          className="absolute left-0.5 top-1/2 -translate-y-1/2 rounded bg-surface text-ink-tertiary opacity-0 shadow-pop transition-opacity group-hover:opacity-100"
        />
      </div>

      {/* 滑动浮层侧栏。 */}
      <aside
        onMouseEnter={() => dispatch({ type: 'enter' })}
        onMouseLeave={() => dispatch({ type: 'leave' })}
        style={{ width: PEEK_WIDTH, transitionDuration: `${PEEK_ANIM_MS}ms` }}
        className={cn(
          'absolute left-0 top-0 z-40 h-full border-r border-border shadow-float transition-transform ease-out motion-reduce:transition-none',
          state.open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <SidebarPeekLockContext.Provider value={lockValue}>
          <div className="relative h-full">
            {/* 图钉 = 停靠（变回常驻）。位置可在打磨阶段微调，避免与「新对话」按钮视觉相撞。 */}
            <button
              onClick={() => setCollapsed(false)}
              title="固定侧边栏"
              className="absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-md bg-surface text-ink-tertiary shadow-pop transition-colors hover:text-ink"
            >
              <Pin size={15} />
            </button>
            <Sidebar />
          </div>
        </SidebarPeekLockContext.Provider>
      </aside>
    </>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `yarn type-check`
Expected: 无报错。（组件此时尚未被任何地方渲染，下一步接上。）

- [ ] **Step 3: 提交**

```bash
git add src/components/sidebar/SidebarPeek.tsx
git commit -m "feat(sidebar): add hover-peek overlay component" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: 接进 AppLayout

`collapsedSize` 4→0、折叠时不渲染停靠 `Sidebar`、挂载 `SidebarPeek`、根容器加 `relative` 给浮层定位。

**Files:**
- Modify: `src/routes/AppLayout.tsx`

- [ ] **Step 1: 加 import**

在第 8 行 `import { ArtifactPanel } ...` 之后新增一行：
```tsx
import { SidebarPeek } from '@/components/sidebar/SidebarPeek'
```

- [ ] **Step 2: 根容器加 `relative`**

把：
```tsx
    <div className="h-screen w-screen overflow-hidden bg-surface">
```
改为：
```tsx
    <div className="relative h-screen w-screen overflow-hidden bg-surface">
```

- [ ] **Step 3: 侧栏 Panel 折叠尺寸归零**

把侧栏 `Panel` 上的：
```tsx
          collapsedSize={4}
```
改为：
```tsx
          collapsedSize={0}
```

- [ ] **Step 4: 折叠时不渲染停靠 Sidebar**

把侧栏 `Panel` 内的：
```tsx
          <Sidebar />
        </Panel>
```
改为：
```tsx
          {!collapsed && <Sidebar />}
        </Panel>
```

- [ ] **Step 5: 挂载浮层**

把结尾的：
```tsx
      </PanelGroup>
    </div>
  )
}
```
改为：
```tsx
      </PanelGroup>

      <SidebarPeek />
    </div>
  )
}
```

- [ ] **Step 6: 类型检查 + 单测 + 生产构建**

Run: `yarn type-check && yarn test && yarn build`
Expected: 类型无报错；vitest 全绿；`tsc && vite build` 成功产出（历史上有过生产构建崩溃，必须确认能 build）。

- [ ] **Step 7: 提交**

```bash
git add src/routes/AppLayout.tsx
git commit -m "feat(layout): wire collapsed sidebar to hover-peek overlay" -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: 手动验收（对照 spec）

hover / 浮层 / 动画属交互视觉，本仓库靠跑应用验证（E2E 为重型 Tauri+wdio，不在本计划内）。

**Files:** 无（仅验证）

- [ ] **Step 1: 起开发服务器**

Run: `yarn dev`
打开 `http://localhost:1420` → 点「跳过登录」→ 进入 `#/app`，看到三列布局。

- [ ] **Step 2: 逐条对照验收**

- [ ] 停靠 → 点头部 `▣` → 折叠：侧栏整条消失、对话铺满全宽、左缘可见一道淡线。
- [ ] 折叠态把鼠标移到最左缘：约 180ms 内整条侧栏从左滑出，**浮在对话之上、不把内容推开**；hover 时左缘出现一个小 chevron 提示。
- [ ] 把鼠标从浮层移开到对话区：约 250ms 后浮层滑回消失（中途再移回去则不关）。
- [ ] 浮层里点右上角**图钉**或头部 `▣`：侧栏变回常驻、推开内容、浮层消失。
- [ ] 浮层里打开底部头像的 `UserMenu` 下拉，并把鼠标移到下拉项上：**浮层不消失**（锁定生效）；关掉下拉后移开 → 正常缩回。
- [ ] 系统开启「减弱动态效果」（macOS 设置 → 辅助功能 → 显示）后：浮层直接显隐、无滑动动画。
- [ ] 拖动窗口改变宽度：折叠态稳定，不再有旧的 4% 抖动。

- [ ] **Step 3: 若图钉与「新对话」按钮视觉相撞**

在 `SidebarPeek.tsx` 微调图钉按钮的位置/底色（`right-2 top-2` / `bg-surface`）直到不挡按钮文字；改完重跑 `yarn type-check` 并补一个 commit。

---

## 验收完成标准

上面 Task 7 的每条勾选项通过，且 `yarn type-check && yarn test && yarn build` 全绿。
