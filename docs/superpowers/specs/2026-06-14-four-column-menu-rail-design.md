# 四栏布局：左侧菜单栏 + 设置独立页

**日期**: 2026-06-14
**状态**: 已批准设计，待实现计划

## 目标

把当前的三栏布局调整为四栏，最左侧新增一条常驻的窄图标菜单栏（menu rail）：

1. 现在的对话业务在菜单栏中作为「对话 / Chat」入口。
2. 「设置」与「退出登录」从会话侧栏底部的用户菜单移到最左侧菜单栏。
3. 点击「设置」不再弹出 Modal，而是作为独立页面整片接管菜单栏右侧的区域。

## 当前结构（改造前）

- `src/App.tsx` — hash router：`/login` → `/app`（`AppLayout`，受 `RequireAuth` 保护）。
- `src/routes/AppLayout.tsx` — 三栏可调节 `PanelGroup`：`[Sidebar(会话) | Chat | Artifact(可选)]`，外加 `SidebarPeek` 悬浮触发。
- `src/components/sidebar/Sidebar.tsx` — 会话侧栏：`hip` 品牌字 + 折叠按钮（顶部，含 traffic-light 偏移）、新对话、搜索、会话列表、底部 `UserMenu`。
- `src/components/sidebar/UserMenu.tsx` — 头像下拉菜单：设置（打开 `Modal`）+ 退出登录。
- `src/components/account/SettingsPanel.tsx` — 已是带纵向子标签的页面（通用 / 模型 / 智能体），当前被塞进 `Modal` 里。
- `src/store/uiStore.ts` — 持有 `settingsOpen` / `setSettingsOpen` 控制设置 Modal 开关。

## 目标结构（改造后）

```
┌──────┬─────────────────────────────────────────────┐
│ Menu │  右侧区域（flex-1，相对定位容器）              │
│ Rail │  ┌──────────┬─────────────┬──────────────┐   │
│ 52px │  │ 会话侧栏  │   对话      │  Artifact     │  │  ← activeView === 'chat'
│      │  │          │             │  （可选）     │  │
│ 对话 │  └──────────┴─────────────┴──────────────┘   │
│ ⚙设置│  ── 或 ──                                      │
│  👤  │  ┌──────────────────────────────────────┐    │
│ ⏻退出│  │  设置页（绝对定位 inset-0，整片覆盖）   │   │  ← activeView === 'settings'
└──────┴──┴──────────────────────────────────────┴────┘
```

### 关键决策

- **菜单栏样式**：约 52px 宽的窄图标栏（类 VS Code 活动栏 / ChatGPT），图标 + 小文字标签 + tooltip，**常驻、不可折叠**。
- **设置页范围**：整片接管菜单栏右侧的全部区域（会话侧栏、对话、Artifact 全部隐藏），只剩「菜单栏 + 设置页」。
- **退出登录**：菜单栏底部独立图标，点击弹出二次确认对话框，确认后才登出。
- **路由方式**：用 store 中的 `activeView` 视图状态切换，**不**新增路由。桌面 App 无地址栏，视图状态最简单，且能保留对话区状态。
- **不卸载对话区**：设置页用绝对定位覆盖在常驻的对话 `PanelGroup` 之上（不透明 `bg-surface`），从而在往返设置时保留面板宽度、滚动位置与进行中的流式输出。

## 组件设计

### 新增

- **`src/components/rail/MenuRail.tsx`** — 52px 竖直栏，常驻可见。
  - **顶部**：traffic-light 偏移占位（`var(--traffic-lights-offset)`，drag region）→ `hip` 眼睛标志 → **对话 / Chat** 导航按钮（图标 `MessageSquare` + 小标签；`activeView==='chat'` 时高亮）。
  - **底部簇**：**设置 / Settings** 导航按钮（图标 `Settings`；`activeView==='settings'` 时高亮）→ 用户 **Avatar**（tooltip 显示邮箱）→ **退出 / Logout** 按钮（图标 `LogOut`，`text-danger`），点击打开确认对话框。
- **`src/components/rail/RailButton.tsx`** — 共享的菜单项（图标 + 可选标签 + 激活态 + tooltip），让 对话 / 设置 / 退出 外观一致。可被键盘聚焦（`<button>`），激活态用 `aria-current` 标注。
- **`src/components/account/SettingsPage.tsx`** — 设置页外壳：顶部 header（`h-11`、drag region、标题「设置」）+ 复用现有 `SettingsPanel`（通用/模型/智能体 子标签不变）。

### 修改

- **`src/routes/AppLayout.tsx`** — 改为 flex 行：`[MenuRail 固定 52px] + [右侧 flex-1 相对容器]`。右侧容器始终渲染现有三栏 `PanelGroup` + `SidebarPeek`；当 `activeView==='settings'` 时，叠加渲染 `<SettingsPage>`（`absolute inset-0`，不透明背景）。
- **`src/components/sidebar/Sidebar.tsx`** — 顶部 `hip` 品牌字移到菜单栏；侧栏 header 只保留折叠按钮。**删除**底部 `UserMenu` 区块。会话侧栏的折叠 / `SidebarPeek` 行为保持不变。
- **`src/store/uiStore.ts`** — **移除** `settingsOpen` / `setSettingsOpen`，**新增** `activeView: 'chat' | 'settings'` + `setActiveView`，默认 `'chat'`。
- **`src/components/chat/ChatPane.tsx`** — 第 154 行「前往设置」（未配置 Key 时）改为 `setActiveView('settings')`。

### 删除

- **`src/components/sidebar/UserMenu.tsx`** — 其设置 Modal + 退出下拉菜单职责由菜单栏接管。删除组件及其在 `Sidebar` 中的引用。

### 退出确认对话框

复用现有 **`Modal`** 组件（标题 + 「取消」/「退出登录」按钮），无需新增 dialog 原语。可放在 `MenuRail` 内部，由本地 state 控制开关；确认后调用 `useAuthStore.logout()` 并 `navigate('/login')`。

## 状态与数据流

- `activeView` 单一来源在 `uiStore`。菜单栏的对话/设置按钮 `setActiveView(...)`；`AppLayout` 据此决定是否叠加设置页；`ChatPane` 的「前往设置」也走 `setActiveView('settings')`。
- 退出确认对话框开关用 `MenuRail` 局部 `useState`，不入全局 store。

## i18n（zh-CN / en / zh-TW 三份同步）

- 新增 `nav` 块：`nav.chat: '对话'`、`nav.settings: '设置'`（en: `Chat` / `Settings`；zh-TW: `對話` / `設定`）。
- 复用 `common.logout`。
- 新增退出确认文案：`common.logoutConfirmTitle: '退出登录？'`、`common.logoutConfirmDesc: '退出后需要重新登录才能继续。'`（en/zh-TW 对应翻译）。

## macOS 红绿灯（traffic lights）

菜单栏成为最左列后，由它在顶部预留 `--traffic-lights-offset`（drag region）。会话侧栏 header、设置页 header 仍是 drag region，但不再需要左侧偏移。`ChatHeader` 现有的 `pl-14` 视情况微调（菜单栏常驻后对话区不再贴窗口左缘）。

## 测试

本项目的 vitest 跑在 **node** 环境，`include` 只匹配 `src/**/*.test.ts`（不含 `.tsx`），且未引入 jsdom / @testing-library —— 即**没有 React 组件单元测试**基建。既有 UI 改动一律走「纯逻辑单测 + 手动 GUI 验收 + wdio e2e」。本计划遵循该约定：

- `src/store/uiStore.test.ts` — **新增** `activeView` 的默认值（`'chat'`）与 `setActiveView` setter 单测（node 纯逻辑，契合现有模式）。`uiStore.test.ts` 当前并未测 `settingsOpen`，故移除该状态不影响既有测试。
- **不**新增 jsdom/RTL 组件测试（无基建，且不擅自引入会偏离项目约定）。`MenuRail` / `SettingsPage` / `AppLayout` 的交互通过手动 GUI 验收覆盖；可选地补一条 wdio e2e（`e2e/specs/`，类同 `app-launch.spec.ts`）。
- 全量 `yarn type-check`、`yarn test` 保持绿色且不触发付费真实 LLM 用例。

## 范围之外（YAGNI）

- 不为设置新增路由（用视图状态）。
- 不接入真实鉴权头像（沿用现有 `currentUser` 占位）。
- 菜单栏固定宽度、不可折叠。
- 不动 `SettingsPanel` 内部的子标签结构与各设置页内容。

## 验收

- 全量单元测试绿色、不触发付费用例。
- 人工 GUI 验收：四栏显示正常；对话/设置切换正确；设置为整页非 Modal；退出有二次确认；红绿灯不遮挡内容；中英繁三语标签正确。
