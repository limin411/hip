# Layout Refine: Settings Title-Bar Fix, + Dropdown, and History Placement

**Date:** 2026-07-04  
**Status:** Approved  
**Related:** `2026-07-04-session-tabs-no-sidebar-design.md`, `2026-07-04-layout-refine-prototype.html`

---

## 1. Problem Statement

当前 `dev.1.0` 分支完成「会话标签页 + 无侧边栏」重构后，用户反馈三个问题：

1. **设置页遮挡标题栏**：`AppLayout` 用 `absolute inset-0 z-20` 渲染 `SettingsPage`，覆盖了整个窗口（包括 `TitleBar`），导致无法拖拽窗口、红绿灯区域被遮、`TitleBar` 里的设置标题实际上被盖住。
2. **无法查看全部会话历史**：`SessionTabBar` 只展示已打开的会话标签，没有入口查看所有历史会话。
3. **新对话界面仍有 Chat/Code 切换**：与顶部导航能力重复，需要移除。

---

## 2. Solution Overview

采用**视图切换式**方案：

- `settings` 和新增的 `history` 都是 `activeView` 的一种状态，统一渲染在 `TitleBar` 下方。
- `TitleBar` 根据 `activeView` 切换三种模式：普通模式、设置返回模式、历史返回模式。
- 顶部 `+` 下拉只保留「新建 Chat」和「新建 Code」。
- 历史会话入口移到左下角悬浮头像菜单，与设置、退出登录放在一起。
- `NewConversation` 移除 `SurfaceToggle`，surface 由 `activeView` 直接决定。

---

## 3. Detailed Design

### 3.1 TitleBar 三种模式

| 模式 | 触发条件 | 内容 |
|------|----------|------|
| 普通模式 | `activeView === 'chat'` 或 `'code'` | 红绿灯占位 + `SessionTabBar` + 右侧连接状态/面板切换 |
| 设置返回模式 | `activeView === 'settings'` | 红绿灯占位 + 返回按钮 + 居中「设置」标题 + 右侧平衡占位 |
| 历史返回模式 | `activeView === 'history'` | 红绿灯占位 + 返回按钮 + 居中「历史会话」标题 + 右侧平衡占位 |

返回按钮点击后回到 `previousView`（若存在）或默认 `'chat'`。

### 3.2 SessionTabBar + 下拉菜单

`SessionTabBar` 中的 `+` 按钮由普通按钮改为 `DropdownMenu` 触发器：

- **新建 Chat**：调用 `sessionService.newConversation('chat')`，`activeView` 保持/切到 `'chat'`，清空当前 draft，显示新对话页。
- **新建 Code**：调用 `sessionService.newConversation('code')`，`activeView` 切到 `'code'`，清空当前 draft，显示 code 新对话页。

不再从此处进入历史会话。

### 3.3 FloatingAvatarButton 菜单

左下角悬浮头像按钮的下拉菜单扩展为三项：

1. **历史会话** → `setActiveView('history')`
2. **设置** → `setActiveView('settings')`
3. **退出登录**（与现有逻辑一致）

菜单顺序把「历史会话」放在「设置」上方，因为历史是高频操作。

### 3.4 NewConversation 简化

- 移除 `SurfaceToggle` 组件及其引用。
- `surface` 直接由 `activeView` 推导：
  ```ts
  const surface = activeView === 'code' ? 'code' : 'chat'
  ```
- 其余逻辑（`Composer`、`FolderPill`、`ModelPicker`、`PermissionModePicker`、`AttachmentButton`）保持不变。

### 3.5 历史会话页面

新增 `src/components/history/SessionHistory.tsx`：

- 使用 `useSessions()` 获取全部会话，按 `updatedAtMs` 倒序排列。
- 每行展示：标题、预览文本、surface badge（Chat/Code）、更新时间。
- 点击某条会话：
  - 调用 `sessionService.selectSession(id)` 打开。
  - `activeView` 自动切到该会话所属 surface（`sessionService.selectSession` 内部已处理）。
- 顶部提供搜索框，客户端按标题/预览过滤。
- 空状态显示提示文案。

### 3.6 AppLayout 视图路由

`AppLayout` 不再用绝对覆盖层渲染设置页，改为根据 `activeView` 渲染主内容：

```tsx
<div className="flex h-dvh w-screen flex-col overflow-hidden bg-surface">
  <TitleBar />
  <div className="relative flex min-h-0 flex-1">
    <PanelGroup direction="horizontal" className="flex-1">
      <Panel minSize={34} className="flex min-w-0 flex-col">
        {activeView === 'history' && <SessionHistory />}
        {activeView === 'settings' && <SettingsPage />}
        {(activeView === 'chat' || activeView === 'code') && (
          activeSessionId == null ? <NewConversation /> : <><ChatPane /><InputBar /></>
        )}
      </Panel>
      {/* resize handle + right panel */}
    </PanelGroup>
    <FloatingAvatarButton ... />
  </div>
</div>
```

右侧面板仅在 `activeView === 'chat'` 或 `'code'` 时响应；在 `history` / `settings` 下保持收起/隐藏。

### 3.7 状态变更

`src/store/uiStore.ts`：

- `ActiveView` 扩展为：
  ```ts
  export type ActiveView = 'chat' | 'code' | 'settings' | 'history'
  ```
- `setActiveView` 的 `previousView` 逻辑兼容 `history`：从 `chat`/`code` 切到 `history`/`settings` 时记录 previous；返回时恢复。

### 3.8 i18n 新增 Key

```yaml
nav:
  history: 历史会话

dropdown:
  newChat: 新建 Chat
  newCode: 新建 Code

history:
  title: 历史会话
  empty: 暂无历史会话
  searchPlaceholder: 搜索会话...
```

---

## 4. Files to Change

- `src/store/uiStore.ts` — 扩展 `ActiveView`
- `src/components/layout/TitleBar.tsx` — 三种模式、返回按钮
- `src/components/tabs/SessionTabBar.tsx` — + 下拉菜单
- `src/components/account/FloatingAvatarButton.tsx` — 增加历史会话入口
- `src/components/chat/NewConversation.tsx` — 移除 `SurfaceToggle`
- `src/components/chat/SurfaceToggle.tsx` — 删除（仅 NewConversation 使用）
- `src/components/chat/SurfaceToggle.test.tsx` — 删除
- `e2e/helpers/surface.ts` — 移除或重写基于 `SurfaceToggle` 的 helper，改为通过顶部 + 下拉或 activeView 切换 surface
- `src/components/history/SessionHistory.tsx` — 新增历史页面
- `src/routes/AppLayout.tsx` — 按 `activeView` 渲染内容，移除绝对覆盖层
- `src/i18n/` 中文/英文资源文件 — 新增 key
- 相关 test 文件更新

---

## 5. Verification

实施完成后需运行：

```bash
yarn type-check
yarn test
yarn test:e2e
```

重点关注：
- `TitleBar.test.tsx` 新增设置/历史模式断言
- `SessionTabBar.test.tsx` 验证下拉项存在、点击行为正确
- `FloatingAvatarButton.test.tsx` 验证历史入口存在
- `AppLayout.test.tsx` 验证设置/历史不再使用绝对覆盖层
- `NewConversation.test.tsx` 验证 `SurfaceToggle` 已移除
- `e2e/helpers/surface.ts` 更新 surface 切换方式
- e2e 中新建会话、切换 surface、打开历史/设置流程

---

## 6. HTML Prototype

高保真原型见同目录文件：`2026-07-04-layout-refine-prototype.html`（可直接浏览器打开）。
