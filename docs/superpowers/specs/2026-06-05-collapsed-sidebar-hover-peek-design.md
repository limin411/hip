# 折叠侧边栏：悬停浮出（C2）设计

> 状态：待评审 · 日期：2026-06-05 · 范围：mock UI（`AppLayout` 这套三列布局）

## 背景与问题

折叠侧边栏当前很难看。`AppLayout` 里侧栏 `Panel` 用 `collapsedSize={4}`（视口宽度的 4%），折叠后只剩一条窄栏：顶部一个「+」、底部一个头像，**中间一整块空白悬着**。具体问题：

- 中间悬空 —— 会话列表整块被藏掉，留下大片无用留白。
- 两头沉 —— 顶 + 底各一个元素、中间断开，不像「设计过」。
- 栏内没有展开入口 —— 想展开得跑去右侧对话头部找 `▣` 图标。
- 宽度按百分比算 —— 视口一变，图标忽宽忽窄、容易顶边或被裁。

working tree 里 `NewChatButton.tsx` / `Sidebar.tsx` / `UserMenu.tsx` 的未提交改动，正是在手调这条折叠图标栏（`shrink-0`、`items-center`、头像底色等）。本方案换方向，**这些图标栏变体将被整体删除**。

## 目标

- 折叠 = 侧栏宽度归零、整条消失，主内容铺满。
- 鼠标移到左缘 → 整条侧栏作为**浮层**从左滑出，**覆盖在对话之上（不挤占内容）**；移开后缩回。
- 左缘保留 1–2px 淡线 + hover 时浮现一个小箭头，作为「这里能划出来」的发现线索。
- 平滑滑动动画；移开延迟缩回防闪烁；头部 `▣` 永远是显式开关；拖左缘 / 点图钉可「停靠」。
- 删除折叠图标栏变体，`Sidebar` 永远渲染完整形态。

## 非目标

- 折叠状态跨刷新持久化（mock store 本就不持久化，维持现状）。
- 移动端 / 响应式重排。
- 右侧产物面板行为（不改动）。
- 接通真实逻辑层（仍是 mock UI）。

## 状态模型

三个状态：

| 状态 | 条件 | 表现 |
|---|---|---|
| **docked**（停靠/常驻） | `collapsed === false` | 正常三列布局，侧栏占位、推开内容 |
| **collapsed-idle**（折叠待命） | `collapsed === true` 且未悬停 | 侧栏宽度 0、不可见，左缘一道淡线 |
| **peeking**（浮出） | `collapsed === true` 且 hover 触发 | 整条侧栏作为浮层滑出，覆盖在对话之上 |

- `collapsed` 沿用现有 `uiStore`（docked ↔ collapsed 的持久开关，由头部 `▣` 与拖拽驱动）。
- `peeking` 是浮层组件的**瞬时本地状态**（hover + 定时器驱动），不进 store。

## 组件结构

**`AppLayout`（改）**
- 侧栏 `Panel`：`collapsedSize` 由 `4` → `0`；其余 `collapsible` / `onCollapse` / `onExpand` / 与 store 的双向同步 `useEffect` 全部保留。
- `Panel` 内：`{!collapsed && <Sidebar />}` —— 停靠时渲染完整侧栏；折叠时不渲染（宽度本就为 0），交给浮层。
- 新增同级浮层 `<SidebarPeek />`，绝对定位、覆盖在 `PanelGroup` 之上，仅在 `collapsed` 时激活。
- 侧栏与主区之间的 `PanelResizeHandle` 即「淡线」：折叠态样式化为 1–2px 淡色；拖动可把侧栏拉回 docked（react-resizable-panels 原生行为）。

**`Sidebar`（改）**
- 去掉所有 `collapsed` 分支，永远渲染完整形态：全宽 `NewChatButton` + `SearchBox` + `SessionList` + 完整 `UserMenu`。
- 不再读取/传递 `collapsed`。

**`NewChatButton` / `UserMenu`（改）**
- 移除 `collapsed` prop 及图标-only 变体，只保留完整形态。

**`SidebarPeek`（新）**
- 左缘 hover 热区（约 8–12px 全高）+ 淡线 + hover 浮现的小箭头。
- 浮层：`position:absolute`，`left:0` 顶天立地，固定宽度（≈ 展开默认宽，约 260px），带投影；`transform: translateX(-100% → 0)` 过渡。
- 浮层内容复用 `<Sidebar />`（完整形态）。
- 浮层顶部一个 dock / 图钉按钮 → `setCollapsed(false)` 停靠。
- 开关逻辑可抽一个小 hook `useHoverPeek`（管 mouseenter/mouseleave 与开/关定时器）。

## 交互细节

- **动画**：滑入/滑出约 180ms ease；`prefers-reduced-motion` → 不滑动，直接显隐。
- **防闪烁**：移开后约 250ms 才缩回；期间若鼠标重新进入热区或浮层，取消关闭定时器。
- **显式开关**：头部 `▣`（`ChatHeader` 现有的 `toggleCollapsed`）切换 docked ↔ collapsed，是触屏/键盘的兜底（hover 在触屏上不触发）。
- **拖拽恢复**：折叠态拖左缘 handle → 展开为 docked。
- **左缘共用 hover 与 drag**：hover 显示浮层；按下拖动则进入 resize，拖动期间隐藏/抑制浮层，避免互相干扰。
- **浮出时操作**：点会话 = 正常切换，不强制停靠；只有点图钉或 `▣` 才停靠。

## 边界与风险

- **触屏无 hover**：靠头部 `▣`。
- **`UserMenu` 下拉**：其 `DropdownMenu` 用 portal 渲染到别处。浮层不能因为「鼠标移进了 portal 里的下拉菜单」就误判 `mouseleave` 而关闭 → 下拉打开期间锁定 peek 为开启。
- **焦点**：浮层出现不抢焦点；`▣` 可键盘操作。
- **0 宽 `Panel` 的 handle 是否仍可拖**：collapsible 面板理论上支持，需实测验证。
- **z-index 层级**：浮层高于主内容与产物面板，但全局弹窗 / 下拉的 portal 仍要能盖在浮层之上。

## 验收

- docked → 点 `▣` → 折叠：侧栏消失、内容铺满、左缘可见淡线。
- 折叠态 hover 左缘：浮层约 180ms 滑出、覆盖对话且**不推内容**；移开约 250ms 缩回。
- 浮层点图钉 / `▣`：停靠、推开内容、浮层消失。
- 折叠态拖左缘：恢复 docked。
- 浮层内打开 `UserMenu` 下拉：浮层不误关。
- 开启 `prefers-reduced-motion`：无滑动动画、直接显隐。
- 改变窗口宽度：折叠态稳定，不再有 4% 抖动。

## 受影响文件

- `src/routes/AppLayout.tsx` —— 改
- `src/components/sidebar/Sidebar.tsx` —— 改（去 collapsed 分支）
- `src/components/sidebar/NewChatButton.tsx` —— 改（去 collapsed prop）
- `src/components/sidebar/UserMenu.tsx` —— 改（去 collapsed prop）
- `src/components/sidebar/SidebarPeek.tsx` —— 新增
- （可选）`src/hooks/useHoverPeek.ts` —— 新增
