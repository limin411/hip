# 四栏布局（左侧菜单栏 + 设置独立页）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有三栏布局改为四栏 —— 最左侧新增一条常驻窄图标菜单栏，承载「对话」入口、「设置」（独立页面，非弹窗）与「退出登录」（带二次确认）。

**Architecture:** 用 `uiStore.activeView: 'chat' | 'settings'` 视图状态驱动（不新增路由）。`AppLayout` 改为 `[MenuRail 固定 52px] + [右侧 flex-1]`；右侧始终挂载现有三栏 `PanelGroup`，当 `activeView==='settings'` 时在其上叠加一层不透明 `SettingsPage`（`absolute inset-0`）—— 既呈现「独立页面」观感，又不卸载对话区，保留面板宽度 / 滚动 / 流式状态。设置内容复用既有 `SettingsPanel`（通用/模型/智能体子标签不变）。

**Tech Stack:** React 18 + TypeScript、Zustand、react-resizable-panels、Radix（Dialog/Tabs）、Tailwind、react-i18next、lucide-react；Tauri 桌面壳。

**测试约定（重要）：** vitest 跑在 **node** 环境，`include` 仅 `src/**/*.test.ts`（不含 `.tsx`），无 jsdom/RTL。因此 UI 组件不写组件单测；只对 store 纯逻辑写 node 单测，其余交手动 GUI 验收（可选补 wdio e2e）。每个 Task 结束时 `yarn type-check` 必须通过。

> ⚠️ 避免付费真实 LLM 用例：`yarn test`（= `vitest run`）会一并跑 `packages/sidecar/src/**` 的真实 LLM 套件。本计划用**精确路径** `yarn vitest run src/store/uiStore.test.ts` 跑前端 store 单测（精确子串不会命中 sidecar）；不要用裸 `yarn vitest run src`。全量 `yarn test` 仅在把 `~/.hip/config/auth.json` 临时移开后运行（见参考记忆 `vitest-src-filter-runs-paid-tests`）。

---

## File Structure

**新建**
- `src/components/rail/RailButton.tsx` —— 单个菜单项（图标 + 小标签 + 激活态 + tooltip + a11y）。
- `src/components/rail/MenuRail.tsx` —— 52px 竖直菜单栏（品牌标志 / 对话 / 设置 / 头像 / 退出 + 退出确认框）。
- `src/components/account/SettingsPage.tsx` —— 设置页外壳（标题栏 + 复用 `SettingsPanel`）。

**修改**
- `src/store/uiStore.ts` —— 新增 `activeView` / `setActiveView`，最终移除 `settingsOpen` / `setSettingsOpen`。
- `src/store/uiStore.test.ts` —— 新增 `activeView` 单测。
- `src/i18n/zh-CN.ts` / `src/i18n/en.ts` / `src/i18n/zh-TW.ts` —— 新增 `nav.*` 与 `common.logoutConfirm*`。
- `src/routes/AppLayout.tsx` —— 四栏化 + 设置页叠加。
- `src/components/sidebar/Sidebar.tsx` —— 移除 `hip` 品牌字与底部 `UserMenu`，header 只留折叠按钮。
- `src/components/chat/ChatPane.tsx` —— 「前往设置」按钮改走 `setActiveView('settings')`。

**删除**
- `src/components/sidebar/UserMenu.tsx` —— 职责由菜单栏接管。

---

## Task 1: uiStore 增加 `activeView` 视图状态（TDD）

本任务只做**新增**（暂保留 `settingsOpen` 以保证每次提交都能编译）；旧状态在 Task 7 移除。

**Files:**
- Modify: `src/store/uiStore.ts`
- Test: `src/store/uiStore.test.ts`

- [ ] **Step 1: 写失败测试**

在 `src/store/uiStore.test.ts` 末尾（最后一个 `describe` 之后、文件结束前）追加：

```ts
describe('uiStore - activeView', () => {
  it('defaults to chat', () => {
    useUiStore.setState({ activeView: 'chat' })
    expect(useUiStore.getState().activeView).toBe('chat')
  })

  it('setActiveView switches between chat and settings', () => {
    useUiStore.getState().setActiveView('settings')
    expect(useUiStore.getState().activeView).toBe('settings')

    useUiStore.getState().setActiveView('chat')
    expect(useUiStore.getState().activeView).toBe('chat')
  })

  it('setActiveView to the same value is a no-op (same reference)', () => {
    useUiStore.getState().setActiveView('chat')
    const before = useUiStore.getState()
    useUiStore.getState().setActiveView('chat')
    expect(useUiStore.getState()).toBe(before)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `yarn vitest run src/store/uiStore.test.ts`
Expected: FAIL —— `setActiveView is not a function` / `activeView` 为 `undefined`。

- [ ] **Step 3: 实现 store 改动**

在 `src/store/uiStore.ts` 顶部、`ArtifactTab` 类型旁新增视图类型：

```ts
export type ActiveView = 'chat' | 'settings'
```

在 `UiState` 接口里、`settingsOpen` 两行的**下方**新增：

```ts
  // 主视图：对话区（三栏）或设置独立页。视图状态驱动，不走路由。
  activeView: ActiveView
  setActiveView: (v: ActiveView) => void
```

在 `create<UiState>((set) => ({ ... }))` 内、`setSettingsOpen` 那行**下方**新增：

```ts
  activeView: 'chat',
  setActiveView: (v) => set((s) => (s.activeView === v ? s : { activeView: v })),
```

- [ ] **Step 4: 跑测试确认通过**

Run: `yarn vitest run src/store/uiStore.test.ts`
Expected: PASS（全部用例通过）。

- [ ] **Step 5: 类型检查**

Run: `yarn type-check`
Expected: 无错误。

- [ ] **Step 6: 提交**

```bash
git add src/store/uiStore.ts src/store/uiStore.test.ts
git commit -m "feat(ui): uiStore 增加 activeView 视图状态"
```

---

## Task 2: i18n —— 新增 `nav.*` 与 `common.logoutConfirm*`（三语）

`i18next.d.ts` 以 `zh-CN` 为键名类型源，故 **zh-CN 必须最先且必须包含**全部新键，否则 `t('nav.chat')` 等调用 TS 报错。三份同步以保证运行时不回退。

**Files:**
- Modify: `src/i18n/zh-CN.ts`, `src/i18n/en.ts`, `src/i18n/zh-TW.ts`

- [ ] **Step 1: zh-CN.ts**

把文件末尾的 `common` 块（`common: { cancel: '取消', close: '关闭', logout: '退出登录' },`）整体替换为下面这段（在它前面插入 `nav` 块，并给 `common` 补两条确认文案）：

```ts
    nav: {
      chat: '对话',
      settings: '设置',
    },
    common: {
      cancel: '取消',
      close: '关闭',
      logout: '退出登录',
      logoutConfirmTitle: '退出登录？',
      logoutConfirmDesc: '退出后需要重新登录才能继续。',
    },
```

- [ ] **Step 2: en.ts**

把 `common: { cancel: 'Cancel', close: 'Close', logout: 'Log Out', },` 整体替换为：

```ts
    nav: {
      chat: 'Chat',
      settings: 'Settings',
    },
    common: {
      cancel: 'Cancel',
      close: 'Close',
      logout: 'Log Out',
      logoutConfirmTitle: 'Log out?',
      logoutConfirmDesc: 'You will need to log in again to continue.',
    },
```

- [ ] **Step 3: zh-TW.ts**

把 `common: { cancel: '取消', close: '關閉', logout: '登出', },` 整体替换为：

```ts
    nav: {
      chat: '對話',
      settings: '設定',
    },
    common: {
      cancel: '取消',
      close: '關閉',
      logout: '登出',
      logoutConfirmTitle: '登出？',
      logoutConfirmDesc: '登出後需要重新登入才能繼續。',
    },
```

- [ ] **Step 4: 类型检查**

Run: `yarn type-check`
Expected: 无错误（zh-CN 新键已被类型源识别）。

- [ ] **Step 5: 提交**

```bash
git add src/i18n/zh-CN.ts src/i18n/en.ts src/i18n/zh-TW.ts
git commit -m "i18n(nav): 新增菜单栏导航与退出确认文案（zh-CN/en/zh-TW）"
```

---

## Task 3: `RailButton` 组件

菜单项原子组件：图标 + 9px 小标签 + 激活/危险态 + tooltip + 键盘可聚焦 + `aria-current`。

**Files:**
- Create: `src/components/rail/RailButton.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface RailButtonProps {
  icon: LucideIcon
  label: string
  active?: boolean
  danger?: boolean
  onClick: () => void
}

export function RailButton({ icon: Icon, label, active = false, danger = false, onClick }: RailButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      data-tauri-drag-region="false"
      className={cn(
        'flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        active
          ? 'bg-accent-active text-accent-strong'
          : danger
            ? 'text-ink-tertiary hover:bg-danger/10 hover:text-danger'
            : 'text-ink-tertiary hover:bg-surface-muted hover:text-ink',
      )}
    >
      <Icon size={18} />
      <span className="text-[9px] leading-none">{label}</span>
    </button>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `yarn type-check`
Expected: 无错误（组件暂未被引用，能独立编译）。

- [ ] **Step 3: 提交**

```bash
git add src/components/rail/RailButton.tsx
git commit -m "feat(rail): RailButton 菜单项组件"
```

---

## Task 4: `MenuRail` 组件

52px 竖直栏：顶部红绿灯偏移 + 品牌标志；主导航「对话」；底部「设置 / 头像 / 退出」；退出走 `Modal` 二次确认。

**Files:**
- Create: `src/components/rail/MenuRail.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Settings, LogOut } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { HipLogo } from '@/components/login/HipLogo'
import { RailButton } from './RailButton'

// TODO: replace with real authenticated user once auth flow is implemented
const currentUser = { name: 'User', email: 'user@example.com', avatarUrl: undefined }

export function MenuRail() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const [confirmLogout, setConfirmLogout] = useState(false)

  return (
    <div
      data-tauri-drag-region
      className="flex h-full w-[52px] shrink-0 flex-col items-center border-r border-border bg-surface-subtle"
    >
      {/* 红绿灯偏移 + 品牌标志（drag region） */}
      <div
        className="flex w-full flex-col items-center"
        style={{ paddingTop: 'var(--traffic-lights-offset, 40px)' }}
      >
        <HipLogo variant="minimal" size={26} decorative />
      </div>

      {/* 主导航 */}
      <nav className="mt-3 flex w-full flex-col items-center gap-1">
        <RailButton
          icon={MessageSquare}
          label={t('nav.chat')}
          active={activeView === 'chat'}
          onClick={() => setActiveView('chat')}
        />
      </nav>

      <div className="flex-1" />

      {/* 账户簇：设置 / 头像 / 退出 */}
      <div className="mb-2 flex w-full flex-col items-center gap-1.5">
        <RailButton
          icon={Settings}
          label={t('nav.settings')}
          active={activeView === 'settings'}
          onClick={() => setActiveView('settings')}
        />
        <span title={currentUser.email} className="inline-flex" data-tauri-drag-region="false">
          <Avatar name={currentUser.name} src={currentUser.avatarUrl} size={28} />
        </span>
        <RailButton
          icon={LogOut}
          label={t('common.logout')}
          danger
          onClick={() => setConfirmLogout(true)}
        />
      </div>

      <Modal open={confirmLogout} onOpenChange={setConfirmLogout} title={t('common.logoutConfirmTitle')}>
        <div className="flex flex-col gap-5 p-5">
          <p className="text-body text-ink-secondary">{t('common.logoutConfirmDesc')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmLogout(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="bg-danger text-white hover:bg-danger/90"
              onClick={() => {
                setConfirmLogout(false)
                logout()
                navigate('/login')
              }}
            >
              {t('common.logout')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `yarn type-check`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/components/rail/MenuRail.tsx
git commit -m "feat(rail): MenuRail 菜单栏（对话/设置/退出 + 退出确认）"
```

---

## Task 5: `SettingsPage` 组件

设置独立页外壳：顶部标题栏（`h-11`，drag region）+ 复用现有 `SettingsPanel`。

**Files:**
- Create: `src/components/account/SettingsPage.tsx`

- [ ] **Step 1: 创建组件**

```tsx
import { useTranslation } from 'react-i18next'
import { SettingsPanel } from './SettingsPanel'

export function SettingsPage() {
  const { t } = useTranslation()
  return (
    <div className="flex h-full flex-col bg-surface">
      <div
        data-tauri-drag-region
        className="flex h-11 shrink-0 items-center border-b border-border px-5"
      >
        <span className="text-body font-medium text-ink">{t('settings.title')}</span>
      </div>
      <div className="min-h-0 flex-1">
        <SettingsPanel />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 类型检查**

Run: `yarn type-check`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/components/account/SettingsPage.tsx
git commit -m "feat(settings): SettingsPage 独立页外壳（复用 SettingsPanel）"
```

---

## Task 6: AppLayout 四栏化 + 设置页叠加（保留旧入口，保持绿）

本步只**新增**菜单栏与设置页叠加；旧的 `UserMenu` 设置弹窗暂时并存（Task 7 再清理）。这样每次提交都可运行。

**Files:**
- Modify: `src/routes/AppLayout.tsx`

- [ ] **Step 1: 加导入**

在现有 import 区底部新增两行：

```tsx
import { MenuRail } from '@/components/rail/MenuRail'
import { SettingsPage } from '@/components/account/SettingsPage'
```

- [ ] **Step 2: 订阅 activeView**

在 `const activeSessionId = useActiveSessionId()` **上一行**新增：

```tsx
  const activeView = useUiStore((s) => s.activeView)
```

- [ ] **Step 3: 包裹布局为四栏**

把 `return (...)` 内最外层 `<div className="relative h-dvh w-screen overflow-hidden bg-surface">` 改为带 `flex` 的行容器，并把现有 `<PanelGroup>...</PanelGroup>` 与 `<SidebarPeek />` 一起包进右侧容器；在右侧容器内、`SidebarPeek` 之后叠加设置页。最终 `return` 结构如下（中间 `<Panel>` 三块内容**保持不变**，此处用注释省略）：

```tsx
  return (
    <div className="relative flex h-dvh w-screen overflow-hidden bg-surface">
      <MenuRail />
      <div className="relative min-w-0 flex-1">
        <PanelGroup direction="horizontal" className="h-full w-full">
          {/* ↓↓↓ 保持原有 sidebar Panel / ResizeHandle / chat Panel / artifact Panel 三块完全不变 ↓↓↓ */}
          {/* ...原有内容... */}
          {/* ↑↑↑ 不改动 ↑↑↑ */}
        </PanelGroup>

        {activeView === 'chat' && <SidebarPeek />}

        {activeView === 'settings' && (
          <div className="absolute inset-0 z-20 bg-surface">
            <SettingsPage />
          </div>
        )}
      </div>
    </div>
  )
```

实施要点：
1. 仅改最外层 `<div>`：加 `flex`，在其内首位插入 `<MenuRail />`，随后用 `<div className="relative min-w-0 flex-1"> … </div>` 包住原 `PanelGroup`。
2. 原本位于 `PanelGroup` 之后、最外层 `<div>` 内的 `<SidebarPeek />` 移进右侧容器，并改为 `{activeView === 'chat' && <SidebarPeek />}`。
3. 在右侧容器内追加 `activeView === 'settings'` 的绝对定位设置页叠加层。
4. `PanelGroup` 里三块 `<Panel>`（会话 / 对话 / Artifact）内容**一字不改**。

- [ ] **Step 4: 类型检查**

Run: `yarn type-check`
Expected: 无错误。

- [ ] **Step 5: 提交**

```bash
git add src/routes/AppLayout.tsx
git commit -m "feat(layout): AppLayout 四栏化 —— 左侧菜单栏 + 设置页叠加"
```

---

## Task 7: 切换旧入口到 activeView，移除 UserMenu 与 settingsOpen（原子提交）

一次性完成「新路径接管 + 旧路径删除」，保证 `type-check` 始终通过。

**Files:**
- Modify: `src/components/chat/ChatPane.tsx`
- Modify: `src/components/sidebar/Sidebar.tsx`
- Modify: `src/store/uiStore.ts`
- Delete: `src/components/sidebar/UserMenu.tsx`

- [ ] **Step 1: ChatPane 改走 activeView**

在 `src/components/chat/ChatPane.tsx`：

把
```tsx
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
```
改为
```tsx
  const setActiveView = useUiStore((s) => s.setActiveView)
```

把（约 154 行）
```tsx
                  onClick={() => setSettingsOpen(true)}
```
改为
```tsx
                  onClick={() => setActiveView('settings')}
```

- [ ] **Step 2: Sidebar 去掉品牌字与 UserMenu**

把 `src/components/sidebar/Sidebar.tsx` 整个文件替换为：

```tsx
import { useTranslation } from 'react-i18next'
import { PanelLeft } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { NewChatButton } from './NewChatButton'
import { SearchBox } from './SearchBox'
import { SessionList } from './SessionList'

export function Sidebar() {
  const { t } = useTranslation()
  const toggleCollapsed = useUiStore((s) => s.toggleCollapsed)

  return (
    <div className="flex h-full flex-col">
      {/* 顶部：红绿灯偏移 + 折叠按钮（品牌标志已移至菜单栏） */}
      <div
        data-tauri-drag-region
        className="flex shrink-0 items-center justify-end px-2"
        style={{ paddingTop: 'var(--traffic-lights-offset, 40px)' }}
      >
        <button
          onClick={toggleCollapsed}
          title={t('sidebar.collapse')}
          className="flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:text-ink"
          data-tauri-drag-region="false"
        >
          <PanelLeft size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-2.5 p-2">
        <NewChatButton />
        <SearchBox />
      </div>
      <div className="flex-1 overflow-y-auto px-2">
        <SessionList />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: uiStore 移除 settingsOpen**

在 `src/store/uiStore.ts`：

删除 `UiState` 接口里的两行：
```ts
  settingsOpen: boolean
  setSettingsOpen: (v: boolean) => void
```
（连同其上方那段 `// Settings modal open state ...` 注释一并删除。）

删除 `create(...)` 里的两行：
```ts
  settingsOpen: false,
  setSettingsOpen: (v) => set((s) => (s.settingsOpen === v ? s : { settingsOpen: v })),
```

- [ ] **Step 4: 删除 UserMenu**

```bash
git rm src/components/sidebar/UserMenu.tsx
```

- [ ] **Step 5: 类型检查（确认无残留引用）**

Run: `yarn type-check`
Expected: 无错误。若报 `settingsOpen` 相关错误，说明仍有未改的引用 —— 用 `grep -rn "settingsOpen\|setSettingsOpen\|UserMenu" src` 定位并清理。

- [ ] **Step 6: 跑 store 单测**

Run: `yarn vitest run src/store/uiStore.test.ts`
Expected: PASS。

- [ ] **Step 7: 提交**

```bash
git add src/components/chat/ChatPane.tsx src/components/sidebar/Sidebar.tsx src/store/uiStore.ts
git commit -m "refactor(ui): 设置/退出收归菜单栏，移除 UserMenu 与 settingsOpen"
```

---

## Task 8: 验证与手动 GUI 验收

**Files:** （无代码改动；如发现问题回到对应 Task 修复）

- [ ] **Step 1: 类型检查 + 生产构建（不触发付费用例）**

Run: `yarn type-check && yarn build`
Expected: 均成功，无 TS / 构建错误。

- [ ] **Step 2: 前端 store 单测**

Run: `yarn vitest run src/store/uiStore.test.ts`
Expected: PASS。

- [ ] **Step 3:（可选）全量单测，付费安全**

把 `~/.hip/config/auth.json` 临时移开后再跑，避免触发 sidecar 真实 LLM 套件：

```bash
mv ~/.hip/config/auth.json ~/.hip/config/auth.json.bak 2>/dev/null; \
yarn test; rc=$?; \
mv ~/.hip/config/auth.json.bak ~/.hip/config/auth.json 2>/dev/null; \
exit $rc
```
Expected: 全绿（真实 LLM 套件 skipIf 跳过）。

- [ ] **Step 4: 手动 GUI 验收（`yarn tauri dev`）**

逐条确认：
- [ ] 出现四栏：最左 52px 菜单栏 → 会话侧栏 → 对话 → （可选）Artifact。
- [ ] 菜单栏顶部显示 hip 标志；macOS 红绿灯不遮挡标志/图标。
- [ ] 「对话」高亮且显示三栏；点「设置」整片切到设置独立页（**非弹窗**），会话侧栏/对话/Artifact 隐藏；菜单栏「设置」高亮。
- [ ] 设置页内 通用/模型/智能体 子标签与内容正常。
- [ ] 点回「对话」恢复三栏，且**面板宽度/滚动位置保留**（叠加层未卸载对话区）。
- [ ] 未配置 Key 时对话区「前往设置」按钮跳转设置页。
- [ ] 点退出图标弹出确认框；「取消」不登出；「退出登录」登出并回到登录页。
- [ ] 会话侧栏折叠/展开与 SidebarPeek 仍正常（设置页下不出现 peek）。
- [ ] 切换语言（zh-CN/en/zh-TW）菜单栏与确认框文案正确。

- [ ] **Step 5:（可选）补一条 wdio e2e**

参考 `e2e/specs/app-launch.spec.ts` 的启动与选择器约定，新增一条断言「菜单栏存在 + 点设置切换到设置页 + 点对话切回」的 spec；按 `e2e-gui-launch-gotchas` 记忆注意启动陷阱。非阻塞。

---

## Self-Review（计划自检）

- **Spec 覆盖**：四栏布局✓(T6)、对话入口✓(T4/T6)、设置独立页非弹窗✓(T5/T6)、退出+二次确认✓(T4)、`activeView` 取代 `settingsOpen`✓(T1/T7)、删除 UserMenu✓(T7)、品牌字移至菜单栏✓(T4/T7)、三语 i18n✓(T2)、红绿灯偏移✓(T4/T7)、store 单测✓(T1)、不写 jsdom 组件测试✓（约定一致）、手动 GUI + 可选 e2e✓(T8)。范围外项（不加路由 / 不接真实头像 / 菜单栏不可折叠 / 不动 SettingsPanel 内部）均未触碰。
- **占位符扫描**：无 TBD/“稍后实现”/空泛“加错误处理”；除「保持原有 Panel 三块不变」处用注释指代既有未改代码外，所有改动均给出完整代码。
- **类型一致性**：`activeView: 'chat' | 'settings'`、`setActiveView`、`ActiveView`、`nav.chat`/`nav.settings`、`common.logoutConfirmTitle`/`logoutConfirmDesc` 在各 Task 间命名一致；`RailButton` props（icon/label/active/danger/onClick）与 `MenuRail` 调用一致。
