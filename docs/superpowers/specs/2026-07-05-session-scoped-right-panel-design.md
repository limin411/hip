# 右侧面板状态按会话隔离设计

## 目标

将当前全局的右侧面板展开/收起状态改为与会话绑定：

- Code 视图的 `ArtifactPanel`（文件 / 智能体 / 时间线 / 变更）展开状态跟随当前 `codeSessionId`。
- Chat 视图的 `PreviewPanel`（文件 / 智能体）展开状态跟随当前 `chatSessionId`。
- 切换会话时，各会话保留自己最后一次的手动面板状态。

## 上下文

- 当前状态存放在 `src/store/uiStore.ts`：
  - `panelOpen`：控制 Code 视图右侧面板。
  - `chatPanelOpen`：控制 Chat 视图右侧面板。
- `src/routes/AppLayout.tsx` 读取这两个布尔值，决定 `react-resizable-panels` 的展开/收起。
- `src/components/layout/PanelToggle.tsx` 在全局标题栏提供切换按钮。
- `src/components/artifact/ArtifactPanel.tsx` 与 `src/components/artifact/PreviewPanel.tsx` 通过 `togglePanel` / `toggleChatPanel` 关闭自己。
- `src/components/artifact/ArtifactCard.tsx` 在点击产物时调用 `setPanelOpen(true)` / `setChatPanelOpen(true)` 自动展开面板。
- 会话模型位于 `src/domain/sessionStore.ts` 的 `SessionVM`。

## 设计

采用方案 A：把面板状态写入 `SessionVM`，使其真正成为会话记录的一部分。

### 数据模型变更

在 `src/domain/sessionStore.ts` 的 `SessionVM` 接口中新增两个可选字段：

```ts
export interface SessionVM {
  // ... 现有字段
  codePanelOpen?: boolean
  chatPanelOpen?: boolean
}
```

默认值规则：

- 新建会话：默认 `codePanelOpen = false`，`chatPanelOpen = false`。
- `session:loaded`：保留该会话已有的面板状态；若是首次加载，默认 `false`。

### 状态读写路径

| 原读写位置 | 变更 |
|---|---|
| `src/store/uiStore.ts` 的 `panelOpen` / `chatPanelOpen` 及相关 action | 删除这些全局字段与 action。 |
| `src/routes/AppLayout.tsx` | 从 `useActiveSessionId()` 获取当前会话，读取其 `codePanelOpen` / `chatPanelOpen`。 |
| `src/components/layout/PanelToggle.tsx` | 调用当前会话的切换逻辑；`activeSessionId == null` 时禁用/隐藏按钮。 |
| `src/components/artifact/ArtifactPanel.tsx` | 关闭时写入当前会话的 `codePanelOpen = false`。 |
| `src/components/artifact/PreviewPanel.tsx` | 关闭时写入当前会话的 `chatPanelOpen = false`。 |
| `src/components/artifact/ArtifactCard.tsx` | 自动展开时写入当前会话的对应字段为 `true`。 |

### 切换按钮行为

- `PanelToggle` 继续保留在标题栏，但状态绑定当前会话。
- 没有激活会话时（例如显示 `NewConversation`）：按钮置灰或隐藏，避免无意义的全局切换。
- 标题栏文案/提示保持 `chat.togglePanel`，无需新增 key。

### 会话摘要合并保护

`src/domain/sessionStore.ts` 中 `session:list:result` 的处理已经会保留已加载会话：

```ts
const prev = byId.get(vm.id)
byId.set(vm.id, prev?.loaded ? { ...prev, title: vm.title, preview: vm.preview, updatedAtMs: vm.updatedAtMs } : vm)
```

需要确保合并时保留 `codePanelOpen` / `chatPanelOpen`，不要覆盖。`session:loaded` 的处理需要改为：

```ts
return {
  ...s,
  loaded: true,
  config: msg.config ? { ...msg.config, surface: msg.config.surface ?? s.config.surface } : s.config,
  messages: msg.messages,
  status: interrupted ? 'error' : 'idle',
  // ... 其他字段
  // 保留已有面板状态，不重置
}
```

### 默认展开策略（可选增强）

本次设计先保持手动状态优先。后续可考虑：当用户点击产物/文件时自动展开当前会话面板（已在 `ArtifactCard` 中实现，只需改为写入当前会话）。

### 持久化策略

- 面板状态优先作为**内存级**会话状态管理，切换会话时即时恢复。
- `chatSessionId` 本身就是内存级（冷启动不恢复聊天会话），因此 `chatPanelOpen` 也按内存级处理。
- `codeSessionId` 会持久化到 `localStorage`，但 `SessionVM` 在应用重启后需重新从服务端加载。本次设计**不**把 `codePanelOpen` 持久化到服务端，也不额外写入 `localStorage`；重启后重新进入 Code 视图时面板默认收起，与聊天视图保持一致。若后续需要跨会话记住 Code 面板状态，可再引入按 `sessionId` 索引的本地缓存。

## 文件变更清单

- `src/domain/sessionStore.ts`：
  - `SessionVM` 增加 `codePanelOpen?` / `chatPanelOpen?`。
  - `emptySession` 初始化默认值。
  - `session:loaded` 处理保留已有面板状态。
  - 新增或复用 helper：
    - `setSessionCodePanelOpen(sessionId, open)`
    - `setSessionChatPanelOpen(sessionId, open)`
    - `toggleSessionCodePanel(sessionId)`
    - `toggleSessionChatPanel(sessionId)`
- `src/store/uiStore.ts`：删除 `panelOpen` / `chatPanelOpen` / `togglePanel` / `toggleChatPanel` / `setPanelOpen` / `setChatPanelOpen`。
- `src/routes/AppLayout.tsx`：从当前会话读取面板状态；`handleCollapse` / `handleExpand` 写入当前会话。
- `src/components/layout/PanelToggle.tsx`：基于 `activeSessionId` 与当前视图调用会话级切换。
- `src/components/artifact/ArtifactPanel.tsx`：关闭按钮写入当前会话 `codePanelOpen = false`。
- `src/components/artifact/PreviewPanel.tsx`：关闭按钮写入当前会话 `chatPanelOpen = false`。
- `src/components/artifact/ArtifactCard.tsx`：展开面板时写入当前会话对应字段为 `true`。
- `src/store/uiStore.test.ts`、`src/store/panelLifecycle.test.ts`、`src/components/layout/PanelToggle.test.tsx`：更新断言对象，改为基于会话状态测试。

## 测试与验证

1. 类型检查：`yarn type-check` 通过。
2. 单元测试：`yarn test` 通过，重点检查：
   - `PanelToggle.test.tsx`：无会话时禁用；有会话时切换当前会话状态。
   - `panelLifecycle.test.tsx`：面板展开/收起影响当前会话，不影响其他会话。
   - `uiStore.test.tsx`：移除对面板全局字段的断言。
3. 手动验证：
   - 在 Chat 会话 A 打开右侧面板，切换到 Chat 会话 B，面板应恢复为 B 的状态。
   - 切换回会话 A，面板恢复为打开。
   - Code 视图同理。
   - 删除会话后，该会话的面板状态不再占用内存。

## 成功标准

- `uiStore` 不再包含 `panelOpen` / `chatPanelOpen`。
- 每个 `SessionVM` 实例拥有自己的 `codePanelOpen` / `chatPanelOpen`。
- 切换当前会话时，右侧面板按目标会话的最后一次手动状态恢复。
- 无激活会话时，`PanelToggle` 不可用。
- 所有相关单元测试通过。
