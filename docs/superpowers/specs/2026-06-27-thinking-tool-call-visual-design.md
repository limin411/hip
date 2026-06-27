# 对话中思考过程与工具调用的视觉优化 — 设计文档

**Date:** 2026-06-27
**Status:** Approved design — pending implementation plan
**Visual Companion:** `.superpowers/brainstorm/72478-1782531600/content/`

## Goal

优化 hip 在 AI 回复过程中以及回复完成后，对“思考过程”和“工具调用”的视觉呈现，使其更紧凑、更清晰、更具进度感，同时与现有 UI 风格保持一致。

## Context

当前相关组件：

1. **`ThinkingBubble`**：仅在 AI 思考/等待时显示，内容为“思考中...” + 三个跳动点，信息量极少，用户无法判断当前具体在做什么。
2. **`TurnTimeline`**：嵌套在助手消息气泡内部，默认展开显示每一步推理（`ThinkingDisclosure`）和工具调用（`ToolCallRow`）。步骤多时垂直空间占用大，容易淹没正文。
3. **`ToolCallRow`**：单个工具调用的可展开卡片，包含工具名、目标文件/路径、参数、输出/错误。默认即展开参数区，视觉上较重。
4. **`ToolTrace`** / **`ArtifactCard`**：在消息底部或 Artifact 面板中再次聚合展示工具调用，存在信息重复或层级不清的问题。

用户核心诉求按优先级排序：

1. **信息密度**：默认只保留最关键摘要，减少垂直占用。
2. **进度感知**：运行中、已完成、失败状态一目了然。
3. **视觉统一**：思考、工具、子 Agent 使用一致的图标、颜色、间距语言。

## Locked decisions

1. **采用“活动条 + 抽屉”方案。** 在助手消息中引入独立的 Activity Bar，默认单行展示当前角色、步骤/工具、计数和状态；点击后展开抽屉，显示完整推理与工具详情。
2. **ThinkingBubble 与 Activity Bar 视觉一致。** 等待状态不再使用跳动点，而是显示当前正在执行的 Agent 角色和具体步骤描述，让用户知道“现在谁在做什么”。
3. **默认折叠，点击展开。** 与当前默认展开不同，新设计默认只显示 Activity Bar；展开后保留现有 `TurnTimeline` 的推理折叠和 `ToolCallRow` 的工具详情结构，但间距更紧凑。
4. **统一状态语言。**
   - 运行中：脉冲圆点 / 旋转图标 + `text-accent-strong`
   - 成功：`CheckCircle2` + `text-success`
   - 失败：`XCircle` + `text-danger`
   - 等待/闲置：灰色圆点 + `text-ink-tertiary`
5. **保留现有角色色点。** 继续使用 `AgentBadge` 的圆点颜色区分 `supervisor / planner / coder / reviewer`，维持可识别性。
6. **不新增 WebSocket 协议字段。** 仅基于现有 `Message.timeline`、`Message.toolCalls`、`Message.agentRuns` 渲染，不改动 sidecar 输出结构。
7. **全部使用现有 Tailwind token。** 不引入新色值，确保暗色主题自动兼容。

## Non-goals

- 不改 sidecar 的推理或工具调用输出格式。
- 不新增全局 store 或持久化状态（Activity Bar 的展开/折叠为局部 UI 状态）。
- 不重新设计 Artifact 面板的深层工具追踪（`ToolTrace` 保持现状，仅在消息气泡层优化）。
- 不引入动画库或复杂动效，仅使用现有 CSS 动画（`animate-spin`、`animate-pulse` 等）。

## Layout & Structure

```
MessageBubble
├── Avatar / AI badge
├── Header（hip + 时间 + 停止标记）
├── Assistant content（Markdown 正文）
├── ActivityBar          ← 新增：默认单行摘要
│   └── Expanded Drawer  ← 点击展开：完整时间线
│       ├── ThinkingDisclosure（推理）
│       ├── DelegationRow（子 Agent）
│       └── ToolCallRow（工具调用）
├── ArtifactCard         ← 保持现有
└── MessageActions
```

`ThinkingBubble` 结构改造为：

```
ThinkingBubble
├── Avatar / AI badge
├── Header（hip）
└── ActivityBar（运行中状态，无展开）
```

## Components

### ActivityBar

- **位置**：助手消息正文与 `ArtifactCard` 之间；`ThinkingBubble` 中替代原有“思考中...”文本。
- **默认状态**：单行卡片，包含：
  - 左侧：当前活跃 Agent 的 `AgentBadge` 色点
  - 角色名（如 Planner / Coder）
  - 当前步骤描述（如“正在读取项目文件...” / “已完成 · 5 个工具 · 1 个子 Agent”）
  - 右侧：状态图标（运行中/成功/失败）+ 展开箭头
- **展开状态**：点击后下方滑出抽屉，内部复用 `TurnTimeline` 的渲染逻辑。
- **样式**：
  - 容器：`rounded-lg border border-border bg-surface-muted/40 px-2.5 py-1.5`
  - 文字：`text-meta`
  - hover：`hover:border-accent/30 hover:bg-surface-muted/60`
  - 运行中：左侧色点使用 `animate-pulse`

### ThinkingBubble

- 移除三个跳动点动画。
- 保留 AI 头像和“hip”标题。
- 主体替换为 `ActivityBar`，显示当前执行中的 Agent 和步骤。
- 由于处于运行中，不显示展开箭头（抽屉内容尚未生成）。

### TurnTimeline（改造）

- 不再默认直接渲染在消息气泡内，而是作为 `ActivityBar` 抽屉的内容。
- 保持现有功能：
  - `TodoChecklist` 展示计划
  - `ThinkingDisclosure` 折叠展示推理内容
  - `DelegationRow` 展示子 Agent 委派
  - 工具步骤展示 `ToolCallRow`
- 调整：减少默认垂直间距，使用更紧凑的 `gap-1` / `py-1`。

### ToolCallRow（改造）

- 默认折叠为单行摘要，点击后展开参数/输出。
- 单行显示：
  - 工具名（`font-mono text-meta`）
  - 目标路径/文件 hint（`truncate text-caption text-ink-tertiary`）
  - 状态图标
- 展开后保留现有的 `Field` 参数/输出展示，但容器使用更紧凑的内边距。
- 成功/失败图标从当前的 `Check` / `X` 升级为 `CheckCircle2` / `XCircle`，与统一状态语言一致。

### SubAgentCard

- 保持现有渲染位置（`nested.map((a) => <SubAgentCard ... />)`）。
- 外观微调：与 Activity Bar 的圆角、边框风格统一，使用 `rounded-lg border border-border`。

## Behavior & Interactions

| 动作 | 行为 |
|---|---|
| AI 开始思考 | 显示 `ThinkingBubble`，`ActivityBar` 显示当前 Agent + 步骤，左侧色点脉冲 |
| 步骤推进 | `ActivityBar` 文本平滑更新为最新步骤描述 |
| 工具调用开始 | `ActivityBar` 显示当前工具名 + “running” 状态，抽屉中对应行显示旋转图标 |
| 工具调用完成 | 状态图标变为成功；ActivityBar 计数增加 |
| 工具调用失败 | 状态图标变为失败；ActivityBar 文案提示错误；错误详情在抽屉中展开 |
| 点击 ActivityBar | 切换抽屉展开/折叠；仅在非运行中或已有历史步骤时显示展开箭头 |
| 点击抽屉内推理行 | 展开/折叠该条推理内容（现有行为） |
| 点击抽屉内工具行 | 展开/折叠该工具参数与输出（现有行为） |
| 切换暗色主题 | 全部使用现有 token，自动适配 |

## State Management

- `ActivityBar` 的展开/折叠状态为局部状态（`useState`），不进入全局 store。
- 运行中的 `ThinkingBubble` 不需要展开状态。
- 已完成消息的 `ActivityBar` 默认折叠；若用户希望某条消息进入时即展开，可在后续迭代中通过本地存储记忆，本次不实现。

## Data Flow

组件层级与数据依赖：

```
MessageBubble
├── message: Message
│   ├── timeline: TimelineStep[]
│   ├── toolCalls: ToolCall[]
│   ├── agentRuns: AgentRun[]
│   └── content: string
├── ActivityBar
│   ├── steps: TimelineStep[]        ← 来自 message.timeline
│   ├── toolCalls: ToolCall[]        ← 来自 message.toolCalls
│   ├── agentRuns: AgentRun[]        ← 来自 message.agentRuns
│   └── streaming?: boolean          ← 是否处于运行中
├── TurnTimeline（抽屉内）
│   └── 复用 ActivityBar 接收的 steps / toolCalls / agentRuns
└── ThinkingBubble
    └── 仅接收当前活跃步骤描述和角色
```

渲染规则：

1. 计算当前活跃 Agent：取 `timeline` 中最后一条步骤的 `agentId` 和 `role`。
2. 计算步骤/工具计数：
   - 总工具数 = `toolCalls?.length`
   - 已完成工具数 = `toolCalls.filter(t => t.status === 'finished').length`
3. 计算当前步骤文本：
   - 若 `streaming` 为 true：显示最后一条 `timeline` 的工具名或推理摘要
   - 若已完成：显示“已完成 · {finished}/{total} 个工具 · {agentCount} 个子 Agent”
4. 计算子 Agent 数量：`agentCount` 取 `agentRuns` 中 `role !== 'supervisor'` 的唯一 `agentId` 数量。
5. 过滤 suppressed tool steps：继续使用 `isSuppressedToolStep` 与 `write_todos` 过滤逻辑。

## Accessibility

- `ActivityBar` 使用 `<button>` 实现，支持键盘聚焦与回车/空格切换展开。
- `aria-expanded` 反映抽屉状态。
- 运行中状态使用 `aria-live="polite"` 通知屏幕阅读器步骤更新。
- 色点仅作视觉辅助，关键状态同时通过图标和文本传达。

## Visual References

本次设计在 Visual Companion 中迭代了以下页面，保存在 `.superpowers/brainstorm/72478-1782531600/content/`：

- `design-proposal.html` — 方案 B 的视觉方向稿，包含折叠态、展开抽屉、实时 ThinkingBubble 样式

## Open Questions (Resolved)

1. **ActivityBar 在运行中是否允许展开？**
   - **决定**：允许。运行中默认折叠，用户可点击展开查看实时推进的时间线；展开箭头在运行中仍然显示。
2. **当某条消息没有任何工具调用或推理步骤时，是否隐藏 ActivityBar？**
   - **决定**：隐藏。避免无意义占位，保持信息密度。
3. **是否需要为 ActivityBar 添加“复制全部工具调用”或“复制思考过程”的快捷操作？**
   - **决定**：本次不实现。保持最小改动，若后续有明确需求再添加。
4. **子 Agent 活动（`SubAgentCard`）是否也纳入 ActivityBar 抽屉统一展示，还是保持独立卡片？**
   - **决定**：保持独立卡片。`SubAgentCard` 继续显示在消息正文下方；ActivityBar 抽屉仅展示当前消息时间线的推理与工具步骤。卡片外观与 ActivityBar 统一圆角/边框风格。
