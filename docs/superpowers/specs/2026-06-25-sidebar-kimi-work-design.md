# 侧边栏 Kimi Work 风格改造 — 设计文档

**Date:** 2026-06-25
**Status:** Approved design — pending implementation plan
**Visual Companion:** `.superpowers/brainstorm/58296-1782397351/content/`

## Goal

将 hip 当前的左侧双层导航（MenuRail + Sidebar）改造为参考 Kimi Work 风格的单层侧栏：顶部用 Tab 切换 Chat/Code，主按钮随 Tab 变化，会话列表按时间分组，底部放置账户栏，整体视觉更现代、层次更清晰。

## Context

当前 hip 布局由三部分组成：

1. **TitleBar**：顶部全宽标题栏。
2. **MenuRail**：左侧 72px 窄栏，承载 Chat/Code 切换与头像/设置菜单。
3. **Sidebar**：可折叠面板，承载「新建会话」「搜索」「会话列表」。

用户希望参考 Kimi Work 的侧栏风格，将双层结构合并为单层，并引入更清爽的视觉层次。

## Locked decisions

1. **单层侧栏。** 移除 `MenuRail`，把 Chat/Code 切换、新建按钮、搜索、会话列表、账户入口全部放进一个侧栏。
2. **顶部 Tab 切换 Chat/Code。** 不再使用图标式窄栏按钮，而是用文字 Tab（Chat | Code）放在侧栏最上方。
3. **上下文主按钮。** 主按钮文案随当前 Tab 变化：Chat 下为「新建会话」，Code 下为「新建代码任务」。不采用 Kimi Work 的「新建任务」统一按钮，也不显示插件/定时任务/WebBridge 等占位入口。
4. **固定侧栏宽度 260px。** 替代当前按百分比（14%）伸缩的宽度，让内容区更稳定。在 `react-resizable-panels` 中以百分比实现：按典型桌面视口 1440px 计算，260px ≈ 18%，因此 Sidebar Panel 的 `defaultSize` 调整为 18，`minSize` 12，`maxSize` 22，用户仍可手动调整。
5. **会话列表按时间分组。** 分为「今天 / 昨天 / 更早」三个分组，搜索时取消分组平铺显示。
6. **全部使用现有 Tailwind token。** 不引入新色值，确保暗色主题自动兼容。

## Non-goals

- 不新增全局 store 或修改 WebSocket 协议。
- 不改 sidecar 会话模型。
- 不添加当前 hip 没有的功能入口（如插件市场、定时任务、WebBridge）。

## Layout & Structure

```
AppLayout
├── TitleBar                          # 保持现有
├── Sidebar (260px, collapsible)
│   ├── SurfaceTabs (Chat | Code)     # 新增
│   ├── NewSessionButton              # 改造现有 NewChatButton
│   ├── SessionSearch                 # 改造现有 SearchBox
│   └── SessionList                   # 改造：增加分组
│       └── SessionItem               # 改造：调整视觉
│   └── AccountFooter                 # 新增：头像 + 设置/退出
└── Main Content Area                 # ChatPane / NewConversation
```

- **MenuRail 移除**：其 Chat/Code 切换功能由 `SurfaceTabs` 承担，头像/设置由 `AccountFooter` 承担。
- **折叠行为**：继续沿用 `react-resizable-panels` 的 `collapsible` Panel 和 `SidebarPeek` 浮层。
- **侧栏背景**：`bg-surface`，右边框 `border-r border-border`。

## Components

### SurfaceTabs

- 位置：侧栏顶部，水平居中。
- 两个选项：`Chat`、`Code`。
- 选中态：圆角胶囊背景 `bg-slate-100`（或主题对应 surface-muted）、`font-medium`。
- 未选中态：`text-ink-tertiary`，hover 变亮。
- 点击调用 `sessionService.setSurface('chat' | 'code')`。

### NewSessionButton

- 位置：Tab 下方。
- 样式：浅灰描边按钮 `bg-slate-50 border rounded-lg`，hover `bg-slate-100`；不使用实心主色，以贴近 Kimi Work 的低调主按钮。
- 文案：Chat 下「新建会话」，Code 下「新建代码任务」。
- 点击调用 `sessionService.newConversation()`。若当前实现默认创建 chat surface 的会话，则在 Code Tab 下需要传入 surface 参数（如 `newConversation({ surface: 'code' })`），具体接口在实现计划中确定。

### SessionSearch

- 位置：主按钮下方。
- 样式：带 Search 图标的圆角输入框，聚焦 ring 用 `accent`。
- 行为：复用现有 `SearchBox` 的防抖 FTS 逻辑。

### SessionList

- 在现有过滤逻辑（search + surface）之后，按 `updatedAtMs` 计算分组：
  - 今天
  - 昨天
  - 更早
- 每个分组前面显示 `.label` 风格的分组标题。
- 当 `search.trim()` 非空时，取消分组，直接渲染搜索结果（与当前一致）。

### SessionItem

- 圆角 `rounded-lg`。
- active 态：背景 `bg-accent/10`，文字 `text-accent-strong`。
- hover 态：`hover:bg-surface-muted`。
- 标题与时间同行，时间居右。
- 删除按钮仍保持 hover 出现。
- 编辑、右键菜单逻辑不变。

### AccountFooter

- 位置：侧栏底部，与列表之间用 `flex-1` 撑开。
- 样式：顶部细边框 `border-t`，内边距与列表一致，hover `bg-surface-muted`。
- 内容：左侧 `Avatar`，右侧显示用户名和邮箱（当前为占位数据）。
- 点击弹出 DropdownMenu：设置、退出登录，复用现有退出确认 Modal。

## Behavior & Interactions

| 动作 | 行为 |
|---|---|
| 点击 Chat/Code Tab | 切换 surface，主按钮文案和会话列表同步更新 |
| 点击主按钮 | 创建当前 surface 的新会话 |
| 搜索输入 | 即时过滤本地标题；200ms 防抖触发 sidecar FTS |
| 点击会话项 | 选中会话，主内容区切换到该会话 |
| 右键会话项 | 重命名 / 删除 |
| 点击账户栏 | 弹出设置 / 退出菜单 |
| 折叠侧栏 | 保持现有拖拽和标题栏按钮行为 |
| hover 折叠边缘 | 滑出 `SidebarPeek` 浮层 |

## Data Flow

- `activeView`：`useUiStore.activeView`
- `search`：`useUiStore.search`
- `sessions` / `activeSessionId`：`useSessions()` / `useActiveSessionId()`
- `searchHits`：`useSearchHits()`
- `collapsed`：`useUiStore.collapsed`
- user：当前占位，后续接入真实 auth store

组件层级：

```
AppLayout
└── Sidebar
    ├── SurfaceTabs        ← activeView
    ├── NewSessionButton   ← activeView
    ├── SessionSearch      ← search
    ├── SessionList        ← sessions, activeSessionId, searchHits
    │   └── SessionItem
    └── AccountFooter      ← user (placeholder)
```

## Visual References

本次设计在 Visual Companion 中迭代了以下页面，均保存在 `.superpowers/brainstorm/58296-1782397351/content/`：

- `sidebar-scope.html` — 当前布局 vs Kimi Work 参考，确认改造范围
- `sidebar-nav.html` — Chat/Code 切换方式对比
- `sidebar-actions.html` — 主按钮与快捷入口对比
- `sidebar-approaches.html` — 三种设计方案（最小 / Kimi Work / 紧凑）
- `design-layout.html` — 最终布局结构
- `design-components.html` — 组件拆分与视觉规范
- `design-behavior.html` — 交互与行为
- `design-dataflow.html` — 数据流与状态

## Open Questions

1. Code surface 下新建会话的 UX：是否需要额外引导（如选择仓库/目录），还是与当前行为一致？
2. 头像/用户信息的接入时间：当前用占位数据，何时接入真实 auth store？
3. 是否需要为侧栏添加 keyboard shortcut（如 ⌘B 折叠/展开）？
