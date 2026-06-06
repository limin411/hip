# 浮窗卡片化布局设计文档

**日期：** 2026-06-05  
**状态：** 已确认  
**范围：** `AppLayout` 标题栏与左右侧边栏视觉升级

---

## 1. 目标

美化 `AppLayout` 中的标题栏（`ChatHeader`）和左右侧边栏（`Sidebar` / `ArtifactPanel`）打开时的视觉表现，使其呈现统一的“浮窗卡片”效果，提升层级感与现代感，同时保持现有交互行为不变。

---

## 2. 设计原则

1. **标题栏保持贴顶**：`ChatHeader` 作为全局顶部栏贴顶，下方左 / 中 / 右三块面板像浮窗卡片。
2. **左右侧边栏像浮窗卡片**：打开时从两侧滑入，圆角、白底、阴影明显，与主内容之间留出间隙。
3. **复用现有设计 token**：背景、边框、阴影全部使用项目已有 CSS 变量和 Tailwind 类，不引入新主题。
4. **保留可拖拽折叠行为**：`react-resizable-panels` 的拖拽、折叠、展开逻辑保持原样，Zustand 状态接口不变。
5. **动效克制**：仅在卡片挂载时加入入场动效，避免与面板尺寸变化产生冲突。

---

## 3. 视觉方案

用户选定方向：

- **A. 微悬浮卡片** + 标题栏贴顶 + 左右与主内容留间隙 + 保持浅色背景靠阴影

实现要点：

- 最外层容器使用 `bg-surface-subtle`（`#f7f7f8`），让白色卡片凸显。
- `ChatHeader` 作为全局顶部栏贴顶，不参与下方卡片布局。
- 下方左 / 中 / 右三块面板内容分别包上圆角卡片：
  - 卡片基础样式：`m-2 rounded-xl border border-border bg-surface`
  - 左、右侧边栏加 `shadow-float`，营造浮于主内容之上的感觉。
  - 中间主区域加较轻的 `shadow-pop`。
- 拖拽把手（`PanelResizeHandle`）改成间隙中的隐形热区，带一个居中小圆点，不破坏卡片感。
- `ChatHeader` 增加水平内边距、统一图标按钮尺寸，让它更像全局标题栏。

---

## 4. 组件/文件改动

### 4.1 新增：`src/components/layout/PanelCard.tsx`

通用浮窗卡片容器。

Props 设计：

```ts
interface PanelCardProps {
  children: React.ReactNode
  className?: string
  /** 阴影强度，默认 'pop' */
  shadow?: 'pop' | 'float'
  /** 挂载入场方向，默认 'none' */
  direction?: 'left' | 'right' | 'none'
}
```

职责：

- 提供统一的外层卡片样式：`h-full w-full overflow-hidden rounded-xl border border-border bg-surface transition-shadow duration-200`。
- 根据 `shadow` 添加 `shadow-pop` 或 `shadow-float`。
- 根据 `direction` 在挂载时添加 `animate-in fade-in slide-in-from-left-2 duration-300` 或 `slide-in-from-right-2`。
- 所有卡片使用 `transition-shadow duration-200`，便于后续统一扩展 hover 状态。

### 4.2 修改：`src/routes/AppLayout.tsx`

- 最外层 `div` 背景从 `bg-surface` 改为 `bg-surface-subtle`，并使用垂直 flex 布局：
  - 顶部固定高度区域放置 `ChatHeader`。
  - 下方 `flex-1` 区域放置 `PanelGroup`（水平三栏）。
- 左侧 `Panel` 内容：条件渲染整个 `PanelCard`，保证挂载时触发入场动效：
  ```tsx
  {!collapsed && (
    <PanelCard shadow="float" direction="left">
      <Sidebar />
    </PanelCard>
  )}
  ```
- 中间 `Panel` 内容包裹：
  ```tsx
  <PanelCard shadow="pop">
    <ChatPane />
    <InputBar />
  </PanelCard>
  ```
- 右侧 `Panel` 内容：同样条件渲染整个 `PanelCard`：
  ```tsx
  {panelOpen && (
    <PanelCard shadow="float" direction="right">
      <ArtifactPanel />
    </PanelCard>
  )}
  ```
- `PanelResizeHandle` 样式更新为隐形热区：
  ```tsx
  <PanelResizeHandle className="group relative z-10 w-3 -mx-1 flex items-center justify-center bg-transparent transition-colors hover:bg-accent/5 data-[resize-handle-state=drag]:bg-accent/10">
    <div className="h-8 w-1 rounded-full bg-border transition-colors group-hover:bg-accent/40 group-data-[resize-handle-state=drag]:bg-accent" />
  </PanelResizeHandle>
  ```

### 4.3 修改：`src/components/sidebar/Sidebar.tsx`

- 根节点移除可能存在的背景/边框/阴影（如 `bg-surface`、`border-r`），交由 `PanelCard` 统一提供。
- 内部结构和滚动行为保持不变。

### 4.4 修改：`src/components/artifact/ArtifactPanel.tsx`

- 常规模式（非全屏）下，根节点移除背景/边框/阴影，由 `PanelCard` 提供。
- 全屏浮层模式（`panelFullscreen === true`）保持现有 `fixed inset-0 z-40` 遮罩和内部卡片样式，不受 `PanelCard` 影响。

### 4.5 修改：`src/components/chat/ChatHeader.tsx`

- 将 `ChatHeader` 从中间 Panel 内部移至 `AppLayout` 的全局顶部，作为整页标题栏。
- 增加水平内边距：`px-4` 或 `px-5`。
- 统一标题字体大小和字重，增强标题感。
- 折叠/展开侧边栏的图标按钮统一尺寸和 hover 背景色。
- 保持现有功能和事件绑定不变。

---

## 5. 动画策略

- **入场动效**：`PanelCard` 在挂载时根据 `direction` 应用 Tailwind animate 类（如 `animate-in fade-in slide-in-from-left-2 duration-300`）。
- **出场策略**：不出场动画。`react-resizable-panels` 折叠面板时会将宽度瞬间变为 0，再叠加出场动画容易产生抖动或 clipping 问题；因此卸载时直接移除。
- **Hover 阴影过渡**：卡片统一使用 `transition-shadow duration-200`，后续可一致扩展 hover 阴影，当前保持静态以稳定为先。
- **把手反馈**：拖拽把手在 hover / drag 状态时显示微弱的强调色背景，提供交互反馈。

> 如果项目未启用 `tailwindcss-animate`，则在 `tokens.css` 中补充对应的简单 keyframes，避免引入新依赖。

---

## 6. 边界情况

1. **`SidebarPeek` 折叠浮层**：不使用 `PanelCard`（它已是 absolute overlay），但将其圆角统一为 `rounded-xl`、阴影统一为 `shadow-float`，保持视觉一致。
2. **`ArtifactPanel` 全屏模式**：全屏时使用自己现有的 `fixed inset-0 z-40` 遮罩，内部容器保持 `rounded-xl border border-border bg-surface shadow-float`，不受外部 `PanelCard` 影响。
3. **暗色模式**：当前项目无暗黑模式，设计仅基于浅色 token。后续若增加暗黑模式，只需覆盖 CSS 变量即可，无需修改组件。
4. **Zustand selector**：所有 `useUiStore` 调用继续遵守 AGENTS.md 规范，只选取 primitive 值，避免返回新对象导致 React #185。
5. **`react-resizable-panels` 尺寸计算**：`PanelCard` 的 `m-2` 位于 Panel 内容内部，不影响 `react-resizable-panels` 本身的百分比尺寸计算。

---

## 7. 测试计划

1. **E2E 回归**：
   - `cargo tauri build --debug`
   - `yarn test:e2e`
   - 验证应用启动、页面元素可定位、基础点击流程不崩溃。
2. **手动验证**：
   - 反复打开/关闭左右面板，确认动画不卡顿、不触发 React #185。
   - 拖拽调整左/右面板宽度，确认把手热区正常、卡片间隙保持。
   - 触发 `ArtifactPanel` 全屏，确认全屏浮层样式未被 PanelCard 破坏。
   - 折叠左侧后触发 `SidebarPeek`，确认浮层圆角/阴影与设计方案一致。
3. **视觉走查**：
   - 检查三处卡片的圆角、边距、阴影是否统一。
   - 检查 `ChatHeader` 作为全局顶部栏的对齐和间距，以及下方卡片间隙是否均匀。

---

## 8. 明确不做

- 不新增深色模式。
- 不引入 `framer-motion` 等大型动画库。
- 不改 Zustand store 接口或状态逻辑。
- 不改动路由、业务逻辑、后端 / Rust 代码。
- 不修改 E2E 测试用例本身（仅验证现有测试通过）。
