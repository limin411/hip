# SessionHistory 删除与会话清空设计

日期：2026-07-08
状态：已确认，待实现

## 背景

`src/components/history/SessionHistory.tsx` 当前仅支持搜索、筛选和打开会话，没有删除能力。用户希望在「历史会话」页面：

1. 对单条会话进行删除。
2. 提供一键清空全部历史会话的能力。

后端 `sessionService.deleteSession(id)` 与 sidecar 的 `session:delete` 协议已经成熟，本次主要在前端补齐 UI 与交互。

## 目标

- 在 `SessionHistory` 每行增加删除按钮，点击后二次确认并删除该会话。
- 在页面标题旁增加「清空全部」按钮，点击后二次确认并删除所有历史会话。
- 复用现有删除逻辑，不改动后端协议与 sidecar。
- 保持三端 i18n（zh-CN / zh-TW / en）同步。

## 非目标

- 回收站 / 撤销删除。
- 批量选择部分会话删除。
- 服务端批量删除协议（如后续会话量极大，可再升级为 `session:deleteAll`）。
- 删除失败后的显式重试或 toast 提示（保持与现有 `sessionService.deleteSession` 一致的行为）。

## UI/UX

采用方案 A：

1. 页面标题「历史会话」右侧放置「清空全部」按钮（danger 风格）。
2. 每条会话卡片右侧、表面标签旁边放置常驻 `Trash2` 图标按钮（`variant="ghost"`、`size="icon"`，来自 `lucide-react`）。
3. 点击任一删除操作后弹出确认对话框，用户确认后才执行。
4. 删除当前正在活跃的会话后，由 `sessionService.deleteSession` 自动切换到同 surface 的最新会话；若已无同类型会话，则回到新建对话状态。

## 数据流与状态

### 单条删除

1. 用户点击行内垃圾桶图标。
2. `SessionHistory` 设置 `deletingSessionId` 为当前会话 id，打开 `DeleteSessionDialog`。
3. 用户点击确认 → 调用 `sessionService.deleteSession(id)`。
4. `sessionService.deleteSession` 完成本地 store 清理并发送 `session:delete` 到 sidecar。
5. 关闭对话框。

### 清空全部

1. 用户点击「清空全部」。
2. `SessionHistory` 设置 `clearAllOpen: true`，打开 `ClearAllSessionsDialog`。
3. 用户点击确认 → 遍历当前 `sessions` 数组，对每个 `session.id` 调用 `sessionService.deleteSession(id)`。
4. 关闭对话框。

### 本地状态

在 `SessionHistory` 内新增：

- `deletingSessionId: string | null`
- `clearAllOpen: boolean`

## 组件结构

- `src/components/history/SessionHistory.tsx`：增加删除按钮、两个确认弹窗的状态管理。
- `src/components/history/DeleteSessionDialog.tsx`（新增）：单条会话删除确认弹窗。
- `src/components/history/ClearAllSessionsDialog.tsx`（新增）：清空全部确认弹窗。
- `src/components/ui/Modal.tsx`、`src/components/ui/Button.tsx`：复用现有组件。

## 确认弹窗文案

单条删除：

- 标题：`删除会话「{{title}}」？`
- 正文：`此操作无法撤销。`
- 按钮：取消 / 删除

清空全部：

- 标题：`清空全部历史会话？`
- 正文：`这将永久删除所有历史会话，此操作无法撤销。`
- 按钮：取消 / 清空

## 国际化

在 `history` 命名空间下新增 key：

```ts
history: {
  title: '历史会话',
  searchPlaceholder: '搜索会话…',
  empty: '暂无历史会话',
  filterAll: '全部',
  filterChat: '办公',
  filterCode: '编码',
  previous: '上一页',
  next: '下一页',
  pageInfo: '第 {{page}} 页 / 共 {{total}} 页',
  delete: '删除',
  deleteSession: '删除会话',
  deleteSessionConfirmTitle: '删除会话「{{title}}」？',
  deleteSessionConfirmBody: '此操作无法撤销。',
  clearAll: '清空全部',
  clearAllConfirmTitle: '清空全部历史会话？',
  clearAllConfirmBody: '这将永久删除所有历史会话，此操作无法撤销。',
  clearAllConfirmAction: '清空',
}
```

同步更新 `zh-CN.ts`、`zh-TW.ts`、`en.ts`。

## 边界处理

- 当 `sessions.length === 0`（没有任何历史会话）时隐藏「清空全部」按钮。
- 单条删除确认弹窗打开后，点击取消或关闭图标可安全取消，不执行删除。
- 清空全部时不区分当前筛选/搜索条件，始终删除全部会话。
- 删除当前打开中的会话：复用 `sessionService.deleteSession` 的既有行为，自动处理 active session 切换。

## 测试计划

更新 `src/components/history/SessionHistory.test.tsx`，覆盖：

1. 每条会话渲染删除按钮。
2. 点击删除按钮打开确认弹窗。
3. 确认删除后调用 `sessionService.deleteSession(id)`。
4. 取消删除后不调用 `sessionService.deleteSession`。
5. 存在会话时渲染「清空全部」按钮。
6. 点击「清空全部」打开确认弹窗。
7. 确认清空后对所有会话调用 `sessionService.deleteSession`。
8. 空状态时隐藏「清空全部」按钮。

## 待修改文件

- `src/components/history/SessionHistory.tsx`
- `src/components/history/SessionHistory.test.tsx`
- `src/components/history/DeleteSessionDialog.tsx`（新增）
- `src/components/history/ClearAllSessionsDialog.tsx`（新增）
- `src/i18n/zh-CN.ts`
- `src/i18n/zh-TW.ts`
- `src/i18n/en.ts`

## 后续可扩展

- 若未来会话数显著增长，可将「清空全部」升级为 `session:deleteAll` 协议指令，减少一次清空的网络往返。
- 若需要防误触升级，可将清空全部确认弹窗改为要求输入确认文字。
- 若需要回收站能力，需在 sidecar / store 层增加软删除与恢复机制。
