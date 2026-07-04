# 标题栏与全局视觉刷新设计文档

## 目标

解决顶部标题栏 `shadow-sticky-top` 边缘阴影与整体视觉风格不搭的问题，并顺势统一全局分隔线语言，使 hip 的桌面界面从"带阴影的卡片感"转向"原生毛玻璃沉浸感"。

## 当前问题

- `src/components/layout/TitleBar.tsx:33` 使用 `shadow-sticky-top`（`0 1px 3px rgba(17, 17, 17, 0.06)`）+ `border-b border-[var(--glass-border)]` + `backdrop-blur-xl`。
- 阴影在毛玻璃背景上产生轻微"脏边"，与项目追求的极简单色 chrome 风格冲突。
- 全局其他区域的分隔方式不一致：有的用 `border`、有的用 `shadow-card-hover`、有的用背景色差异，缺乏统一语言。

## 设计决策

采用 **方案 A：原生毛玻璃沉浸**。

核心原则：

1. **标题栏去阴影、去硬边**：标题栏本身是一块毛玻璃面板，靠背景透明度和模糊与内容区分，不额外画线或投影。
2. **全局分隔改用 hairline + 背景色**：真正的结构分隔用 1px `var(--border)`；同一面板内的层级用 `bg-subtle` / `bg-muted` 区分，不用阴影。
3. **保留阴影仅用于浮层**：菜单、弹窗、下拉面板等真正浮在顶层的内容保留 `shadow-menu` / `shadow-overlay`。
4. **不动品牌色与字体**：保持现有 sage gray 强调色和系统字体栈，避免视觉方向漂移。

## 具体改动

### 1. Token 调整（`src/styles/tokens.css`）

- 提升标题栏毛玻璃不透明度，让它在内容滚动时仍能被感知为独立面板：
  - `--glass-bg`: `rgba(255, 255, 255, 0.72)` → `rgba(255, 255, 255, 0.85)`（light）
  - `--glass-bg`: `rgba(20, 20, 20, 0.72)` → `rgba(20, 20, 20, 0.85)`（dark）
- 降低边框对比度，让 hairline 更 subtle：
  - `--glass-border`: `rgba(0, 0, 0, 0.06)` → `rgba(0, 0, 0, 0.05)`（light）
  - `--glass-border`: `rgba(255, 255, 255, 0.08)` → `rgba(255, 255, 255, 0.06)`（dark）
- 保持 `--border` 不变，继续作为全局主要分隔线颜色。

### 2. 标题栏（`src/components/layout/TitleBar.tsx`）

- 移除 `shadow-sticky-top`。
- 移除 `border-b border-[var(--glass-border)]`。
- 保留 `backdrop-blur-xl`、`bg-[var(--glass-bg)]`、`data-tauri-drag-region`。
- 可选：当内容区滚动到顶部附近时，用 JS 动态添加一条极淡的 hairline；但默认状态下保持无边框。

### 3. Tailwind 阴影系统（`tailwind.config.js`）

- 将 `boxShadow` 中除 `menu`、`overlay` 外的其余有值项统一语义：
  - `sticky-top` 保留但值改为 `none`，或整个移除（因为不再使用）。
  - `card-hover` 改为 `none`，卡片 hover 改用背景色变化。
- 保留 `menu`、`overlay`，因为浮层仍需要阴影。

### 4. 全局组件分隔线统一

以下组件/区域需要检查并改用 hairline / 背景色，而不是阴影：

- `src/routes/AppLayout.tsx`：侧栏与主内容、主内容与右面板的分隔已使用 `bg-border`，保持；若面板无边框，改用 `bg-subtle` / `bg-muted` 背景色区分。
- `src/components/chat/InputBar.tsx`：输入栏顶部 border 保持，移除任何阴影。
- `src/components/chat/ChatPane.tsx`、`src/components/chat/Composer.tsx`、`src/components/chat/ActivityBar.tsx`：检查是否有 `shadow-*` 或硬编码投影，改用 border 或背景色。
- `src/components/ui/Modal.tsx`、`src/components/ui/DropdownMenu.tsx`、`src/components/ui/ContextMenu.tsx`：浮层保留阴影。
- `src/components/account/AgentToolbar.tsx`、卡片类组件（`AgentCard.tsx` 等）：移除卡片阴影，hover 用背景色变化。

### 5. 滚动时标题栏 hairline（可选增强）

- 在 `AppLayout` 中监听主内容区 scroll。
- 当 scrollTop > 0 时，给 `TitleBar` 添加一个 subtle 的底部 border（如 `border-b border-[var(--glass-border)]`）。
- 当 scrollTop === 0 时移除。
- 这一步是可选的；如果实现，需要确保动画/状态切换不突兀。

## 非目标

- 不更换品牌色（sage gray 保持不变）。
- 不更换字体栈（保持系统字体）。
- 不改整体布局结构（侧栏、主内容、右面板的尺寸关系不变）。
- 不引入新的动画或动效（遵循 `prefers-reduced-motion`）。

## 边界情况

- **macOS 红绿灯区域**：标题栏去边框后，左侧红绿灯让位区保持不变，避免内容重叠。
- **暗色模式**：毛玻璃不透明度提升在暗色模式下同样生效，避免标题栏过透导致文字难读。
- **右面板折叠/展开**：分隔线应跟随面板状态，不因视觉刷新而消失或错位。
- **设置页/历史页**：`isSpecialView` 状态下的标题栏同样去阴影，保持统一。

## 验收标准

- [x] `TitleBar` 不再使用 `shadow-sticky-top` 和底部 border（可选滚动 hairline 除外）。
- [x] 亮色/暗色模式下标题栏均呈现干净毛玻璃效果，无明显"脏边"。
- [x] 全局非浮层组件不再使用 `shadow-*` 做层级分隔，改用 border 或背景色。
- [x] 菜单、弹窗、下拉面板等浮层仍保留适当阴影。
- [x] `yarn test` 通过（包括 `TitleBar.test.tsx` 相关快照/断言）。
- [x] `yarn tsc` 通过。

## 参考

- 预览文件：`.superpowers/brainstorm/38784-1783177736/content/titlebar-visual-options.html`
- 相关代码：
  - `src/components/layout/TitleBar.tsx`
  - `src/styles/tokens.css`
  - `tailwind.config.js`
  - `src/routes/AppLayout.tsx`
