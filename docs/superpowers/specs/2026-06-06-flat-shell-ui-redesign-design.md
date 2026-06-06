# 统一平面外壳 UI 重构设计文档

**日期：** 2026-06-06  
**状态：** 已确认  
**范围：** `AppLayout` 三栏外壳去卡片化 + `ChatHeader` 内嵌化 + `ArtifactPanel` 标签栏修复 + `AgentDashboard` 密度修复  
**关联：** 取代 [`2026-06-05-floating-panels-design.md`](./2026-06-05-floating-panels-design.md) 的「浮窗卡片」视觉方向

---

## 1. 目标

当前 `/app` 主界面观感「凌乱」。根因是上一轮「浮窗卡片」改造把界面拆成了**四个独立的描边 + 阴影矩形**（全局顶栏、侧栏、对话、产物面板），各自带 `m-2` 间隙，再加上拖拽把手分割线——眼睛要先解析约 5 条轮廓和 4 条沟槽才能看到内容。

本次重构把三栏改为**统一平面外壳**（一整块连续表面、列间仅 1px 细线、零间隙零阴影），并把全局顶栏改为对话列内的**安静标题**，从而消除碎片感。色彩 token、字体、登录页、所有 mock 数据与逻辑保持不变——这是**结构/层级**问题，不是配色问题。

---

## 2. 背景与问题诊断

对运行中的界面走查，确认五处凌乱来源：

1. **浮动盒子过多**：4 个 `rounded-xl border shadow` 矩形浮在 `bg-surface-subtle` 灰底上，间隙 + 把手把画面切碎。（[`AppLayout.tsx`](../../../src/routes/AppLayout.tsx) + [`PanelCard.tsx`](../../../src/components/layout/PanelCard.tsx)）
2. **产物面板标签栏渲染破损**：4 个「图标 + 文字」标签加上全屏 / 关闭按钮挤不下面板宽度，激活的「智能体」标签**竖排换行**（智 / 能 / 体）。（[`ArtifactPanel.tsx`](../../../src/components/artifact/ArtifactPanel.tsx)）
3. **全局顶栏冗余**：[`ChatHeader.tsx`](../../../src/components/chat/ChatHeader.tsx) 是第 4 个浮动条，重复显示侧栏已高亮的会话标题，仅多压一条横带。
4. **密度失衡**：`AgentDashboard` 的 `xl:grid-cols-2` 以**视口宽度**（非面板宽度）触发两列，导致窄面板里卡片被挤到断词截断；而中间对话区大量留白。（[`AgentDashboard.tsx`](../../../src/components/artifact/AgentDashboard.tsx)）
5. **遗留死代码**：[`App.css`](../../../src/App.css) 是 Tauri 模板残留（vite/react logo 样式 + 一段 `prefers-color-scheme: dark`），未被任何文件 import。

---

## 3. 设计决策

头脑风暴中通过线框图对比后用户选定：

- **整体结构 → A. 统一平面外壳**（候选还有 B 平面 + 轻微分层、C 更克制的浮层卡片）。
- **标题栏 → H1. 无独立顶栏，安静的对话内标题**（候选还有 H2 细贯通顶栏、H3 居中面包屑）。

窗口使用 **Tauri 原生窗口装饰**（`tauri.conf.json` 未设 `decorations: false`），交通灯 / 标题由操作系统在独立的系统栏绘制，因此应用内标题区是纯内容，无需作为拖拽区或为交通灯让位。

---

## 4. 设计原则

1. **一块表面，细线分栏**：三栏共处同一连续表面，列与列之间仅一条 1px `var(--border)` 细线，零间隙、零卡片阴影。
2. **用色调分区，不用更多描边**：侧栏用 `--bg-subtle`（#f7f7f8）淡色，对话 / 产物面板保持白色；靠色调差异区分「导航」与「内容」，而非再叠加轮廓。
3. **把手即分割线**：`PanelResizeHandle` 渲染为那条 1px 细线本身，外加更宽的隐形抓取热区与 hover 强调色——静止时是干净分割线，仍可拖拽改宽。
4. **三栏顶部对齐**：删除全局横栏后，侧栏顶、对话标题、产物面板标签三者起始于同一 Y。
5. **复用现有 token 与交互**：不引入新主题、不改 Zustand store 接口、不动 `react-resizable-panels` 的折叠 / 拖拽逻辑。
6. **动效克制**：停靠态面板直接出现 / 隐藏（不再做入场滑入）；仅 `SidebarPeek` 悬浮浮层保留滑入（它确实悬浮于内容之上）。

---

## 5. 视觉方案

- **外壳**：最外层 `bg-surface`（白），`PanelGroup` 铺满全高；移除全局 `ChatHeader`。
- **侧栏列**：`bg-surface-subtle`，无描边 / 阴影 / 圆角 / 外边距，内部结构不变。
- **对话列**：白底 `flex-col`，顶部 44px 安静标题（折叠幽灵图标 + 小号会话标题 + 右侧面板开关幽灵图标，底部一条 `border-b`），下方 `ChatPane` + `InputBar` 不变。
- **产物面板列**：白底；标签改为**纯文字 + 激活下划线**（文档 / 文件 / 智能体 / Diff），不再带图标，永不竖排换行；全屏 / 关闭按钮缩到最右。
- **分割线 / 把手**：列间 1px `var(--border)`，hover / drag 变 `--accent`。
- **智能体卡片**：恒定**单列**，描述整行展开，不再断词截断。

参考线框图（持久化于 `.superpowers/brainstorm/`，已被 `.gitignore`）：`layout-direction.html`、`header-treatment.html`、`assembled.html`。

---

## 6. 组件 / 文件改动

### 6.1 修改：`src/routes/AppLayout.tsx`

- 最外层：`relative flex h-screen w-screen flex-col overflow-hidden bg-surface-subtle` → `relative h-screen w-screen overflow-hidden bg-surface`。
- **删除**全局 `<ChatHeader />` 与包裹它的 `flex-1` 容器；`PanelGroup` 直接铺满：`<PanelGroup direction="horizontal" className="h-full w-full">`。
- 三个 `Panel` 的尺寸约束（`defaultSize` / `minSize` / `maxSize` / `collapsible` / `collapsedSize`）与折叠同步 `useEffect` **保持不变**。
- **移除 `PanelCard` 包裹**，各列直接渲染内容：
  ```tsx
  {/* 侧栏列：用 wrapper 提供淡色底，避免把 bg 耦合进 Sidebar（SidebarPeek 复用同一组件） */}
  <Panel ref={sidebarRef} defaultSize={14} minSize={12} maxSize={22} collapsible collapsedSize={0} onCollapse={...} onExpand={...}>
    {!collapsed && (
      <div className="h-full bg-surface-subtle">
        <Sidebar />
      </div>
    )}
  </Panel>

  {/* 对话列 */}
  <Panel minSize={34}>
    <div className="flex h-full flex-col bg-surface">
      <ChatHeader />
      <ChatPane />
      <InputBar />
    </div>
  </Panel>

  {/* 产物面板列 */}
  <Panel ref={panelRef} defaultSize={26} minSize={18} maxSize={44} collapsible collapsedSize={0} onCollapse={...} onExpand={...}>
    {panelOpen && <ArtifactPanel />}
  </Panel>
  ```
- `PanelResizeHandle` 由「胶囊圆点」改为「1px 细线 + 隐形热区」：
  ```tsx
  <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
    <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
  </PanelResizeHandle>
  ```
  （`w-2 -mx-1` → 8px 抓取热区但 0 布局占位；居中 1px 线。）
- `<SidebarPeek />` 仍作为 `PanelGroup` 之后的兄弟节点保留。

### 6.2 修改：`src/components/chat/ChatHeader.tsx`

- 从「全局浮动条」改为「对话列内嵌标题」。容器：
  - 旧：`mx-2 mb-2 flex h-12 ... rounded-xl border border-border bg-surface px-4 shadow-pop`
  - 新：`flex h-11 shrink-0 items-center gap-1.5 border-b border-border bg-surface px-3`
- 左：`Button variant="ghost" size="icon"`（`PanelLeft`）+ 会话标题 `text-[13px] font-medium text-ink truncate`。
- 中：`<div className="flex-1" />` 占位。
- 右：`Button variant="ghost" size="icon"`（`PanelRight`）。
- store selector、事件绑定、`active` 计算逻辑不变。

### 6.3 修改：`src/components/sidebar/Sidebar.tsx`

- 根节点保持 `flex h-full flex-col p-3`，**不内置背景色**（底色由 6.1 的 wrapper 或 `SidebarPeek` 各自提供，避免耦合）。内部结构与滚动不变。

### 6.4 修改：`src/components/artifact/ArtifactPanel.tsx`

- 常规模式根节点：`<div className="h-full p-3">` → `<div className="flex h-full flex-col bg-surface">`（去掉卡片内边距，改由各 `TabsContent` 自带 padding）。
- 标签头高度 `h-12` → `h-11`，与对话列标题对齐：`flex h-11 shrink-0 items-center justify-between border-b border-border px-2`。
- `TabsList` 改 `className="h-full gap-4"`；`TabsTrigger` **不再渲染图标**，只渲染 `{t.label}`。
- `TABS` 数组移除 `icon` 字段；移除随之不再使用的图标 import（`FileText` / `FolderTree` / `Network` / `GitCompare`），保留动作按钮用的 `Maximize2` / `Minimize2` / `X`。
- 全屏模式（`panelFullscreen`）的 `fixed inset-0 z-40` 遮罩保持不变。

### 6.5 修改：`src/components/ui/Tabs.tsx`

- `Tabs` 仅被 `ArtifactPanel` 使用，可安全改默认样式。`TabsTrigger` 由「胶囊」改为「纯文字 + 下划线」：
  ```tsx
  className={cn(
    'relative inline-flex h-full items-center text-[13px] font-medium text-ink-secondary transition-colors hover:text-ink',
    'after:absolute after:inset-x-0 after:bottom-[-1px] after:h-0.5 after:rounded-full after:bg-accent after:opacity-0',
    'data-[state=active]:text-ink data-[state=active]:after:opacity-100',
    className,
  )}
  ```
  下划线 `bottom-[-1px]` 压在标签头 `border-b` 之上；激活态文字转 `text-ink` 并显现下划线。

### 6.6 修改：`src/components/artifact/AgentDashboard.tsx`

- 子智能体容器 `grid grid-cols-1 gap-2.5 xl:grid-cols-2` → `flex flex-col gap-2.5`（恒定单列，消除窄面板断词截断）。
- 可选打磨：`AgentCard` 底色由 `bg-surface` 改 `bg-surface-subtle`，在白色面板上获得轻微对比（非必须）。

### 6.7 删除：`src/components/layout/PanelCard.tsx`

- 去卡片化后无任何引用（`SidebarPeek` 自带 `aside` 浮层，不依赖 `PanelCard`），删除以免留死代码。
- 连带：`tailwind.config.js` 中的 `animate-in-left` / `animate-in-right` 工具类随之无引用，可一并移除（低优先，留着无害）。

### 6.8 删除：`src/App.css`

- Tauri 模板残留、无 import，删除。

### 6.9 微调：`src/components/sidebar/SidebarPeek.tsx`

- 仍是 `absolute` 悬浮浮层，保留 `bg-surface`（白）+ `shadow-float`（它确实悬浮于内容之上）。圆角可由 `rounded-r-xl` 收为 `rounded-r-lg`（可选）。功能逻辑不变。

---

## 7. 边界情况

1. **折叠 ↔ 展开**：`ChatHeader` 折叠按钮与 `SidebarPeek` 图钉都调用同一 `collapsed` 状态；折叠后既可经悬浮浮层临时窥视，也可点对话列标题左侧按钮 / 图钉重新停靠。
2. **`SidebarPeek` 底色**：停靠态侧栏为淡色（`--bg-subtle`），悬浮浮层保持白色 `--bg-surface` + 阴影——「悬浮表面更亮」是常见约定，刻意区分。
3. **产物面板全屏**：沿用自身 `fixed inset-0 z-40` 遮罩与内部卡片样式，不受外壳去卡片化影响。
4. **`react-resizable-panels` 尺寸计算**：移除 `PanelCard` 的 `m-2` 后，各列内容铺满 Panel，百分比尺寸计算更直接，无副作用；折叠到 `collapsedSize={0}` 时相邻列自动补位，外层白底极少外露。
5. **Zustand selector**：所有 `useUiStore` 调用继续遵守 `AGENTS.md` 规范，只选取 primitive 值，避免返回新对象触发 React #185。
6. **暗色模式**：当前无暗黑模式，方案仅基于浅色 token；删除 `App.css` 反而移除了一段可能泄漏的 `prefers-color-scheme: dark`。

---

## 8. 测试计划

1. **类型 / 构建**：`yarn type-check`、`yarn build` 通过（确认删除图标 import / `PanelCard` / `App.css` 后无残留引用）。
2. **E2E 回归**：`yarn test:e2e`，验证启动、元素可定位、基础点击流程不崩溃。
3. **手动 / 视觉走查**：
   - 三栏共处一块白底，列间仅 1px 细线，无间隙无卡片阴影。
   - 对话列顶部 44px 安静标题；三栏顶部对齐。
   - 产物面板四个标签**单行**显示，激活态下划线，绝不竖排换行。
   - 智能体面板单列、描述整行不截断。
   - 拖拽列间细线可改宽，hover / drag 变强调色。
   - 折叠侧栏 → 悬浮浮层正常滑入；图钉重新停靠正常。
   - 产物面板全屏 → 遮罩样式未破。

---

## 9. 明确不做

- 不改色彩 token、字体、登录页。
- 不改 Zustand store 接口或任何业务 / mock 逻辑。
- 不动路由、后端 / Rust / sidecar 代码。
- 不引入新动画库或新主题（含暗色模式）。
- 不重做智能体卡片内部信息架构（仅改单列布局）。
- 不修改 E2E 用例本身（仅验证现有测试通过）。

---

## 10. 验收标准

- [ ] `/app` 首屏不再出现「灰底上浮着多个描边 + 阴影卡片」的观感；整体为一块白色平面、细线分栏。
- [ ] 无全局横向顶栏；会话标题以 44px 安静标题内嵌于对话列顶部，三栏顶部对齐。
- [ ] 产物面板四标签单行 + 下划线指示，任意面板宽度下都不竖排换行。
- [ ] 智能体卡片单列、文本不断词截断。
- [ ] 列间分割线可拖拽改宽，反馈正常。
- [ ] `PanelCard.tsx`、`App.css` 已删除且 `yarn build` / `yarn type-check` 通过。
