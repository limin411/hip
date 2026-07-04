# TitleBar 标签页与红绿灯对齐重设计

## 背景与问题

当前 `TitleBar` 高 44px，左侧为 macOS 红绿灯预留 90px 占位，会话标签页使用“贴底生长”样式（`items-end` + `rounded-t-md` + `border-b-0`），右侧放置连接状态与面板切换按钮。

用户反馈：
- 标签页看起来偏低，和左上角红绿灯不在同一居中位置。
- 整体不协调，希望改成更现代的胶囊/按钮风格并整体居中。

## 目标

让标题栏内三要素——macOS 红绿灯、会话标签页、右侧控件——的视觉中心线处于同一水平面；把标签页从“贴底标签”改为“小圆角胶囊按钮”。

## 设计决策

通过澄清问题确认以下方向：

- 标签页风格：小圆角胶囊（约 6px 圆角），整体在标题栏内垂直居中。
- 选中态：填充背景色（类似 Safari/Chrome 当前标签）。
- tab 内容：保留 surface 图标、标题、hover 出现的关闭按钮。
- 新建会话“+”按钮：放在标签行内，与胶囊 tab 同高、同对齐。
- 右侧控件（连接状态、面板切换）：保持现有内容与交互，仅调整垂直对齐。
- 红绿灯占位：保持 90px，避免窗口按钮重叠。

## 方案对比

| 方案 | 描述 | 推荐度 |
|---|---|---|
| A | 胶囊 tab 居中 + 右侧控件对齐，最小改动 | 推荐 |
| B | 标签条与工具条分区，左右两区背景微区分 | 改动较大 |
| C | tab 顶满标题栏高度的圆角 tab 条 | 风格变化最大，可能与毛玻璃标题栏冲突 |

选定方案 **A**。

## 具体改动

### 1. `src/components/tabs/SessionTab.tsx`

- 高度：`h-[33px]` → `h-[28px]`，让胶囊在 44px 标题栏内垂直居中。
- 圆角：`rounded-t-md` → `rounded-md`。
- 边框：移除 `border` 与 `border-b-0`，改为无框胶囊。
- 选中态背景：`bg-app border-border text-ink` → `bg-state-active text-ink`。
- 非选中态：`text-ink-secondary`，hover 时 `bg-state-hover hover:text-ink`。
- 内部图标颜色逻辑保持：选中 `text-accent-strong`，未选中 `text-ink-tertiary`。
- 关闭按钮保持 hover 显示。

### 2. `src/components/tabs/SessionTabBar.tsx`

- 垂直对齐：`items-end` → `items-center`。
- 移除新建按钮的 `mb-[3px]`，改为与 tab 同高居中。
- 保持横向滚动与红绿灯让位。

### 3. `src/components/layout/TitleBar.tsx`

- 保持 `h-11`、毛玻璃背景、红绿灯占位。
- 右侧控件容器 `flex shrink-0 items-center gap-2 pr-3`，确保与标签行中心线一致。

### 4. `src/components/layout/ConnectionStatus.tsx` / `PanelToggle.tsx`

- 仅检查/确保内部元素 `items-center`。
- 不改交互逻辑。

## 视觉结果

- 标题栏 44px 高。
- 红绿灯中心约 22px。
- 胶囊 tab 28px 高，中心约 22px。
- 右侧连接状态/面板切换中心约 22px。
- 三者在同一水平面，视觉协调。

## 测试策略

- 更新相关组件测试中断言的 class 名称（若测试直接依赖具体 class）。
- 运行 `npm run test` 覆盖 `TitleBar`、`SessionTabBar`、`SessionTab`。
- 运行 `npm run typecheck`。
- 运行 lint。
- 在 macOS 上实际查看红绿灯与 tab 的垂直对齐效果。

## 排除项

- 不改 tab 的交互逻辑（选择、关闭、中键关闭、新建下拉）。
- 不改右侧控件的显示/隐藏规则。
- 不改红绿灯占位宽度。
- 不改标题栏高度。
