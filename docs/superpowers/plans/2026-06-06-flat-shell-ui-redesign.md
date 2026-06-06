# 统一平面外壳 UI 重构 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `/app` 三栏从「浮窗卡片」改为「统一平面外壳 + 对话内安静标题」，并修掉产物面板标签竖排换行与智能体卡片密度问题。

**Architecture:** 纯展示层重构，零业务/逻辑改动。三栏共处一块白色表面，列间用 1px 细线分隔（细线即拖拽把手）；侧栏用 `--bg-subtle` 淡色分区；全局顶栏删除，会话标题改为对话列内 44px 内嵌头。删除去卡片化后变成死代码的 `PanelCard.tsx` 与遗留的 `App.css`。

**Tech Stack:** React 18 + TypeScript + Tailwind 3 + `react-resizable-panels` + Radix Tabs + Zustand。设计 token 在 `src/styles/tokens.css`，Tailwind 映射在 `tailwind.config.js`。

**Spec:** [`docs/superpowers/specs/2026-06-06-flat-shell-ui-redesign-design.md`](../specs/2026-06-06-flat-shell-ui-redesign-design.md)

**测试现状（重要）：** Vitest 跑在 **node 环境**、仅匹配 `src/**/*.test.ts`（纯逻辑：mock/utils/sessions/stream/hoverPeek），**无组件/DOM 测试基础设施**。本重构是纯 CSS/布局改动，不新增测试框架（YAGNI，且断言 class 名属于脆弱的实现细节测试）。每个任务的验证 = `yarn type-check` + 现有逻辑测试回归 + 视觉截图比对 spec §10；E2E 作为收尾门禁。E2E 仅断言文本存在（"重构 WebSocket 客户端" / "hip" / 登录页 `h1`），本次改动不影响这些文本，故不破坏选择器。

---

## File Structure

| 文件 | 动作 | 责任 |
|------|------|------|
| `src/App.css` | **删除** | Tauri 模板残留，无 import |
| `src/components/ui/Tabs.tsx` | 修改 | `TabsTrigger` 改纯文字 + 下划线（仅被 ArtifactPanel 使用） |
| `src/components/artifact/ArtifactPanel.tsx` | 修改 | 去标签图标、标签头 `h-11`、根节点去卡片内边距改白底 |
| `src/components/artifact/AgentDashboard.tsx` | 修改 | 子智能体改恒定单列 |
| `src/components/chat/ChatHeader.tsx` | 修改 | 全局浮动条 → 对话列内 44px 内嵌头 |
| `src/routes/AppLayout.tsx` | 修改 | 去 `PanelCard` 卡片化、把手改 1px 细线、`ChatHeader` 移入对话列、侧栏淡色 wrapper |
| `src/components/layout/PanelCard.tsx` | **删除** | 去卡片化后无引用 |
| `tailwind.config.js` | 修改 | 移除无引用的 `in-left`/`in-right` keyframes 与 animation |
| `src/components/sidebar/Sidebar.tsx` | **不改** | 根节点本就无背景色，底色由 wrapper / Peek 各自提供 |
| `src/components/sidebar/SidebarPeek.tsx` | 微调（可选） | 圆角 `rounded-r-xl` → `rounded-r-lg`；仍为白底浮层 |

执行顺序按「每次提交都能编译且界面连贯」设计：先删孤儿文件 → 修产物面板内部 → 落地外壳+头部（含删 PanelCard）→ 清理动画工具类 + 全量验收。

---

## Task 1: 删除孤儿 `App.css`

**Files:**
- Delete: `src/App.css`

- [ ] **Step 1: 确认无任何引用**

Run: `grep -rn "App.css" src/ index.html`
Expected: 无输出（exit 1）。`src/main.tsx` 只 import `./styles/tokens.css`。

- [ ] **Step 2: 删除文件**

Run: `git rm src/App.css`
Expected: `rm 'src/App.css'`

- [ ] **Step 3: 类型检查通过**

Run: `yarn type-check`
Expected: 无错误（exit 0）。

- [ ] **Step 4: 提交**

```bash
git commit -m "chore: remove orphaned App.css Tauri template styles

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: 修复产物面板标签栏与智能体密度

把标签改纯文字 + 下划线（永不竖排换行），标签头降到 44px，智能体卡片恒定单列。此阶段 `ArtifactPanel` 仍被 `PanelCard` 包裹，界面照常工作。

**Files:**
- Modify: `src/components/ui/Tabs.tsx`
- Modify: `src/components/artifact/ArtifactPanel.tsx`
- Modify: `src/components/artifact/AgentDashboard.tsx`

- [ ] **Step 1: `Tabs.tsx` — `TabsTrigger` 改下划线样式**

把 `TabsTrigger` 的 `className` 三段（旧的胶囊样式）整体替换为：

```tsx
className={cn(
  'relative inline-flex h-full items-center text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink',
  'after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:rounded-full after:bg-accent after:opacity-0',
  'data-[state=active]:text-ink data-[state=active]:after:opacity-100',
  className,
)}
```

（`after:bottom-[-1px]` 让下划线压在标签头 `border-b` 之上；激活态文字转 `text-ink` 并显现 2px 强调色下划线。`Tabs` 仅被 `ArtifactPanel` 使用，改默认样式安全。）

- [ ] **Step 2: `ArtifactPanel.tsx` — 精简 import**

把第 1 行：

```tsx
import { FileText, FolderTree, Network, GitCompare, Maximize2, Minimize2, X } from 'lucide-react'
```

改为：

```tsx
import { Maximize2, Minimize2, X } from 'lucide-react'
```

- [ ] **Step 3: `ArtifactPanel.tsx` — `TABS` 去掉 icon 字段**

把 `TABS` 常量替换为：

```tsx
const TABS: { value: ArtifactTab; label: string }[] = [
  { value: 'doc', label: '文档' },
  { value: 'files', label: '文件' },
  { value: 'agents', label: '智能体' },
  { value: 'diff', label: 'Diff' },
]
```

- [ ] **Step 4: `ArtifactPanel.tsx` — 标签头降高 + 标签只渲染文字**

把标签头那段（`<div className="flex h-12 ...">` 到对应 `</TabsList>` 之间）替换为：

```tsx
<div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2">
  <TabsList className="h-full gap-4">
    {TABS.map((t) => (
      <TabsTrigger key={t.value} value={t.value}>
        {t.label}
      </TabsTrigger>
    ))}
  </TabsList>
  <div className="flex items-center gap-0.5">
    <Button variant="ghost" size="icon" onClick={toggleFullscreen} title={fullscreen ? '还原' : '全屏'}>
      {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
    </Button>
    <Button variant="ghost" size="icon" onClick={togglePanel} title="关闭面板">
      <X size={16} />
    </Button>
  </div>
</div>
```

（仅改：`h-12`→`h-11`、`TabsList` 加 `h-full gap-4`、`TabsTrigger` 内去掉 `<t.icon size={14} />`。动作按钮区不变。）

- [ ] **Step 5: `AgentDashboard.tsx` — 子智能体恒定单列**

把第 63 行：

```tsx
<div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
```

改为：

```tsx
<div className="flex flex-col gap-2.5">
```

（根因：`xl:grid-cols-2` 以视口宽度触发两列，导致窄面板断词截断。）

- [ ] **Step 6: 类型检查通过**

Run: `yarn type-check`
Expected: 无错误（exit 0）。确认 Step 2 删掉的 4 个图标无残留引用。

- [ ] **Step 7: 视觉验证**

确保 `yarn dev` 运行中（`http://localhost:1420`），用浏览器预览/截图工具打开 `http://localhost:1420/#/app`，确认：
- 产物面板四标签 **单行**显示（文档 / 文件 / 智能体 / Diff），激活态有下划线，「智能体」不再竖排。
- 「智能体」标签页下卡片为单列、描述整行不截断。

- [ ] **Step 8: 提交**

```bash
git add src/components/ui/Tabs.tsx src/components/artifact/ArtifactPanel.tsx src/components/artifact/AgentDashboard.tsx
git commit -m "fix: text-only underline tabs and single-column agent cards

Artifact tabs no longer wrap vertically in a narrow panel; agent
cards drop the viewport-keyed xl:grid-cols-2 that cramped them.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: 落地统一平面外壳 + 内嵌安静标题

把 `ChatHeader` 改内嵌头、`AppLayout` 去卡片化、`ArtifactPanel` 根节点改白底，最后删除无引用的 `PanelCard`。按下面步骤顺序每步都可编译。

**Files:**
- Modify: `src/components/chat/ChatHeader.tsx`
- Modify: `src/components/artifact/ArtifactPanel.tsx`
- Modify: `src/routes/AppLayout.tsx`
- Delete: `src/components/layout/PanelCard.tsx`

- [ ] **Step 1: `ChatHeader.tsx` — 改为对话列内嵌头**

整体替换 `return (...)` 内的根 `<div>`（旧的 `mx-2 mb-2 ... rounded-xl border ... shadow-pop` 浮动条）为：

```tsx
return (
  <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-surface px-3">
    <Button variant="ghost" size="icon" onClick={toggleCollapsed} title="折叠侧边栏">
      <PanelLeft size={17} />
    </Button>
    <span className="truncate text-[13px] font-medium text-ink">{active?.title ?? '对话'}</span>
    <div className="flex-1" />
    <Button variant="ghost" size="icon" onClick={togglePanel} title="切换产物面板">
      <PanelRight size={17} />
    </Button>
  </div>
)
```

（store selector、`active` 计算、事件绑定全部不变；只改容器样式与布局。此刻它仍在 `AppLayout` 里作全局渲染——会暂时呈现为一条扁平带边的横条，下一步移入对话列即归位。）

- [ ] **Step 2: 类型检查通过**

Run: `yarn type-check`
Expected: 无错误（exit 0）。

- [ ] **Step 3: `ArtifactPanel.tsx` — 根节点去卡片内边距、改白底**

把常规模式返回（文件末尾）：

```tsx
return <div className="h-full p-3">{body}</div>
```

改为：

```tsx
return <div className="h-full bg-surface">{body}</div>
```

（全屏分支 `if (fullscreen) {...}` 不变。）

- [ ] **Step 4: `AppLayout.tsx` — 去卡片化 + 把手改细线 + 头部移入对话列**

4a. 删除 `PanelCard` 的 import 行：

```tsx
import { PanelCard } from '@/components/layout/PanelCard'
```

4b. 把整个 `return (...)` 替换为：

```tsx
return (
  <div className="relative h-screen w-screen overflow-hidden bg-surface">
    <PanelGroup direction="horizontal" className="h-full w-full">
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
          <div className="h-full bg-surface-subtle">
            <Sidebar />
          </div>
        )}
      </Panel>

      <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
        <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
      </PanelResizeHandle>

      <Panel minSize={34}>
        <div className="flex h-full flex-col bg-surface">
          <ChatHeader />
          <ChatPane />
          <InputBar />
        </div>
      </Panel>

      <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
        <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
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
        {panelOpen && <ArtifactPanel />}
      </Panel>
    </PanelGroup>

    <SidebarPeek />
  </div>
)
```

（两个 `useEffect`（折叠/面板双向同步）与所有 `useUiStore` selector、ref 声明保持不变。只去掉了外层 `flex-col` + 全局 `ChatHeader` + 三处 `PanelCard` 包裹，把手内层圆点改 1px 细线。）

- [ ] **Step 4 验证: 类型检查通过**

Run: `yarn type-check`
Expected: 无错误（exit 0）。此时 `PanelCard` 已无人引用但文件仍在——下一步删除。

- [ ] **Step 5: 删除 `PanelCard.tsx`**

Run: `grep -rn "PanelCard" src/`
Expected: 无输出（确认零引用）。

Run: `git rm src/components/layout/PanelCard.tsx`
Expected: `rm 'src/components/layout/PanelCard.tsx'`

- [ ] **Step 6: 类型检查 + 构建通过**

Run: `yarn type-check`
Expected: exit 0。

Run: `yarn build`
Expected: `tsc && vite build` 成功，产出 `dist/`，无未引用 import 报错。

- [ ] **Step 7: 视觉验证（比对 spec §10）**

打开 `http://localhost:1420/#/app`，截图确认：
- 三栏共处一块白底，列间仅 1px 细线，**无间隙、无卡片阴影**。
- 无全局横向顶栏；会话标题以 44px 内嵌头位于对话列顶部左侧，三栏顶部对齐。
- 侧栏为淡灰底（`--bg-subtle`），对话/产物面板为白底。
- 拖拽列间细线可改宽，hover/drag 变强调色。
- 点对话头左侧按钮折叠侧栏 → 从左缘 hover 触发 `SidebarPeek` 浮层正常滑入；图钉重新停靠正常。
- 点对话头右侧按钮可开关产物面板；产物面板全屏遮罩样式未破。

- [ ] **Step 8: 提交**

```bash
git add src/components/chat/ChatHeader.tsx src/components/artifact/ArtifactPanel.tsx src/routes/AppLayout.tsx
git commit -m "feat: unified flat shell with in-column quiet header

Replace floating PanelCards with one continuous surface split by
hairline dividers (which double as resize handles). Remove the global
top bar; the session title becomes a 44px header inside the chat
column. Delete the now-unreferenced PanelCard.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: 清理无用动画工具类 + 全量验收

**Files:**
- Modify: `tailwind.config.js`
- Modify（可选）: `src/components/sidebar/SidebarPeek.tsx`

- [ ] **Step 1: 确认 `in-left`/`in-right` 动画已无引用**

Run: `grep -rn "animate-in-left\|animate-in-right" src/`
Expected: 无输出（`PanelCard` 删除后这两个类已无人用）。

- [ ] **Step 2: `tailwind.config.js` — 移除无用 keyframes 与 animation**

在 `theme.extend.keyframes` 中删除 `'in-left'` 和 `'in-right'` 两个键（保留 `blink`、`pulse`——`StreamingCursor`/`StatusDot` 在用）。
在 `theme.extend.animation` 中删除 `'in-left': 'in-left 0.3s ease-out'` 和 `'in-right': 'in-right 0.3s ease-out'` 两行（保留 `blink`、`pulse`）。

- [ ] **Step 3:（可选）`SidebarPeek.tsx` — 收圆角**

把浮层 `aside` 的 `rounded-r-xl` 改为 `rounded-r-lg`（仅观感微调；`bg-surface` 白底 + `shadow-float` 保留，因为它确实悬浮于内容之上）。若不需要可跳过。

- [ ] **Step 4: 类型检查 + 构建**

Run: `yarn type-check`
Expected: exit 0。

Run: `yarn build`
Expected: 成功。

- [ ] **Step 5: 逻辑测试回归**

Run: `yarn test`
Expected: 6 个测试文件全部通过（mock/click/utils/sessions/stream/hoverPeek）——本重构未碰逻辑，应全绿。

- [ ] **Step 6: E2E 门禁（若 Tauri 工具链可用）**

Run: `yarn test:e2e`
Expected: 2 个用例通过（登录页 `h1` 含 "hip"；跳过登录后 `#/app` 的 `#root` 文本含 "重构 WebSocket 客户端" 与 "hip"）。
> 注：E2E 需先构建 Tauri 应用，较重且依赖本地工具链。若环境不具备，以 type-check + build + 视觉验收为准，并在交付说明中标注 E2E 未运行。

- [ ] **Step 7: 对照 spec §10 验收清单逐项打勾**

打开 `http://localhost:1420/#/app` 截图，逐项核对 spec 第 10 节「验收标准」六条全部满足。

- [ ] **Step 8: 提交**

```bash
git add tailwind.config.js src/components/sidebar/SidebarPeek.tsx
git commit -m "chore: drop unused panel entrance animations

Remove the in-left/in-right keyframes left dead by the PanelCard
deletion; minor SidebarPeek corner-radius tidy.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage（逐条核对 spec §6 + §10）：**
- §6.1 AppLayout 去卡片化/把手/头部移入/侧栏 wrapper → Task 3 Step 4 ✓
- §6.2 ChatHeader 内嵌头 → Task 3 Step 1 ✓
- §6.3 Sidebar 不内置背景 → File Structure 标注「不改」，底色由 Task 3 Step 4 的 wrapper 提供 ✓
- §6.4 ArtifactPanel 标签头/去图标/根节点白底 → Task 2 Step 2-4 + Task 3 Step 3 ✓
- §6.5 Tabs 下划线 → Task 2 Step 1 ✓
- §6.6 AgentDashboard 单列 → Task 2 Step 5 ✓
- §6.7 删 PanelCard → Task 3 Step 5；连带动画类 → Task 4 Step 2 ✓
- §6.8 删 App.css → Task 1 ✓
- §6.9 SidebarPeek 可选微调 → Task 4 Step 3 ✓
- §10 验收六条 → Task 4 Step 7 逐项核对 ✓

**2. Placeholder 扫描：** 无 TBD/TODO；每个改动步骤都给了完整可粘贴代码与确切命令/预期输出。视觉验证步骤给了明确核对项而非「检查一下样式」。✓

**3. 类型/命名一致性：**
- `bg-surface` / `bg-surface-subtle` / `border-border` / `bg-accent` 均为 `tailwind.config.js` 既有映射（对应 `--bg-app`/`--bg-subtle`/`--border`/`--accent`），非杜撰。✓
- `Button variant="ghost" size="icon"`、`PanelLeft`/`PanelRight`、`Maximize2`/`Minimize2`/`X`、`TabsList`/`TabsTrigger`、`useUiStore` 各 selector 均与现有代码签名一致。✓
- `data-[resize-handle-state=drag]` 与现有 `AppLayout` 把手用法一致。✓
- 任务顺序保证每次提交都能 `yarn type-check` 通过（删 PanelCard 在 AppLayout 去引用之后；删图标 import 与去图标渲染同任务）。✓

无遗留问题。
