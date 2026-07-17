# Spec: Plan Todo Progress Panel

| Field | Value |
|-------|-------|
| **Date** | 2026-07-17 |
| **Status** | P0 implemented |
| **Related** | Plan entry (SPIKE-plan-entry), post-plan settle, `write_todos` / `PlanItem` |

---

## §0 一页纸

用户开启规划（`forcePlan`）或智能体进入 plan 能力（`EnterPlanMode` / `write_todos` / `plan:published`）时，界面应**无需展开 ActivityBar** 即可看到 plan todo 清单与进度。

数据已具备：`write_todos` → turn `toolCalls`；审批边界 → `plan:published` → `activeTurnPlan` + `PlanApprovalCard`。缺口是**会话级常驻可见性**与**阶段（planning / approval / executing）**。

P0：前端派生 `LivePlanView` + Composer 上方 sticky `PlanProgressPanel`。  
P1：`plan:updated` 协议与 complete 后保留策略（本 spec 定义，实现见 plan 文档）。

---

## §1 问题

| 现状 | 用户体验问题 |
|------|----------------|
| `TodoChecklist` 在 `TurnTimeline` 内 | 默认折叠在 ActivityBar，规划进度不可见 |
| `PlanApprovalCard` 仅审批瞬间 | 审批前后/执行期没有连贯清单 |
| `activeTurnPlan` 在 `message:complete` 清空 | 执行结束立刻失去会话级 plan 源 |
| `forcePlan` 仅 chip 高亮 | 开启规划后无「正在制定计划」空态 |

---

## §2 目标与非目标

### 目标

1. **可见性**：规划/执行全程可在消息列表底部、Composer 上方看到清单与进度，无需展开工具时间线。
2. **进度**：展示 `completed/total` 与当前 `in_progress` 项；状态图标与现有 checklist 一致。
3. **阶段**：`planning` | `awaiting_approval` | `executing` | `done`。
4. **审批**：审批操作仍可用（保留 `plan-approve` / `plan-reject` / `plan-amend` test id，兼容 eval）。
5. **无污染**：无 forcePlan、无 live plan、非审批时面板不出现。

### 非目标（本功能）

- 不改 `PlanItem` / `write_todos` schema
- 不展示 subagent 的 `write_todos`（继续仅 supervisor）
- 不把 plan.md 长文渲染进 checklist
- 不做 todo 拖拽编辑（amend 文本足够）
- P0 不新增 sidecar WS 事件（P1 可选 `plan:updated`）

---

## §3 概念模型

### LivePlanView（UI 视图，非协议）

```ts
type PlanPhase = 'planning' | 'awaiting_approval' | 'executing' | 'done'

interface LivePlanView {
  items: PlanItem[]           // 与 @hip/protocol PlanItem 同构
  phase: PlanPhase
  source: 'activeTurnPlan' | 'write_todos' | 'empty'
  progress: {
    done: number
    total: number
    current?: string          // 当前 in_progress 的 content
  }
}
```

`PlanItem` 已有：

```ts
{ content: string; status: 'pending' | 'in_progress' | 'completed' }
```

### 数据优先级（selectLivePlan）

| 优先级 | 条件 | items | phase |
|--------|------|-------|-------|
| 1 | `planApprovalPending && activeTurnPlan.length > 0` | `activeTurnPlan` | `awaiting_approval` |
| 2 | 最新 **当前 turn 语境** 的 assistant 上 supervisor `write_todos` | parse 结果 | `running` → `executing`，否则 `done` |
| 3 | `activeTurnPlan?.length`（审批后执行、complete 前） | `activeTurnPlan` | `running` → `executing`，否则 `done` |
| 4 | `forcePlan && status === 'running'` 且尚无 items | `[]` | `planning` |
| — | 以上皆否 | — | **不展示面板**（返回 `null`） |

**当前 turn 语境（避免旧 plan 粘住）：**

- `messages` 末条为 assistant → 用该条（或末条 assistant）的 `write_todos`。
- 末条为 user 且 `status === 'running'` → 新 turn 已开始：仅用 `activeTurnPlan` 或 `forcePlan` 空态；**不**沿用上一条 assistant 的 todos。
- 末条为 user 且 idle → 不展示（无进行中会话 plan）。

### 可见性

```
visible ⇔ selectLivePlan(...) !== null
```

---

## §4 UI 规格

### 位置

消息列表滚动区底部、与现有 interrupt / `PlanApprovalCard` 同列（`ChatPane` 内 `max-w-3xl` 列），Composer **之上**（随滚动可见；不做 fixed overlay，避免挡输入）。

### PlanProgressPanel

| 元素 | 说明 |
|------|------|
| `data-testid="plan-progress-panel"` | 根节点 |
| 标题行 | 图标 + 「Plan」+ 阶段文案 + `done/total`（有 items 时） |
| 进度摘要 | 可选一行 `current`（in_progress content） |
| 清单 | 复用 `TodoChecklist`（`data-testid="todo-checklist"`） |
| 空态 | `phase === 'planning'`：文案「正在制定计划…」 |
| 审批 | `phase === 'awaiting_approval'`：Approve / Amend / Reject；根或动作区保留 `data-testid="plan-approval-card"`，按钮 id 不变 |

**折叠（P0 可选最小实现）：** 默认展开清单；若 items > 6 可默认折叠为「进度 + 当前项」，点击展开全表。P0 可始终展开。

### 与 PlanApprovalCard 关系

- **单一入口**：审批态也走 `PlanProgressPanel`（内嵌清单 + 动作），`ChatPane` 不再单独渲染 `PlanApprovalCard`（组件文件保留，动作逻辑可抽共享或内联）。
- Eval / harness 依赖的 test id 必须保留：`plan-approval-card`, `plan-approve`, `plan-reject`, `plan-amend`, `plan-amend-submit`。

### 与 ActivityBar / TurnTimeline

- Sticky 面板展示 live plan 时，**当前 streaming 的** assistant 气泡内 `TurnTimeline` **不再**渲染重复 `TodoChecklist`（避免双份）。
- 历史 turn（非当前 live）展开 ActivityBar 时仍可显示该 turn 的 checklist（只读快照）。

### 文案（i18n keys）

| Key | en（示意） |
|-----|------------|
| `chat.planPanel.planning` | Planning… |
| `chat.planPanel.awaitingApproval` | Awaiting approval |
| `chat.planPanel.executing` | Executing |
| `chat.planPanel.done` | Done |
| `chat.planPanel.progress` | {{done}}/{{total}} |
| `chat.planPanel.emptyPlanning` | Investigating and drafting a plan… |

现有 `chat.todos.*`、`chat.planApproval.*` 继续使用。

---

## §5 交互

| 用户/系统动作 | 面板行为 |
|---------------|----------|
| 打开 plan chip 后发消息 | `planning` 空态 |
| Agent `write_todos` | 清单出现/全量替换，进度更新 |
| `ExitPlanMode` + interrupt | `awaiting_approval` + 动作按钮 |
| Approve | 乐观卸审批（现有 `respondPlan`）；phase → `executing`；清单保留 |
| Reject | 卸审批；面板随 store 清理消失或 idle 隐藏 |
| 执行中再次 `write_todos` | 清单与进度刷新 |
| Turn complete 且末条 assistant 仍有 todos | `done`，仍可见直至用户开启无 plan 的新 turn |
| 新 user 消息且非 forcePlan / 无 activeTurnPlan | 面板隐藏 |

---

## §6 协议（P0 / P1）

### P0

无新消息类型。前端从：

- `SessionVM.activeTurnPlan` / `planApprovalPending` / `config.forcePlan` / `status`
- `messages[].toolCalls`（`write_todos`）

派生视图。

### P1（可选增强，本 spec 预留）

```ts
// Server → UI
{ type: 'plan:updated'; sessionId: string; turnId: string; plan: PlanItem[] }
```

在 graph `deriveUpdatedPlan` 后发送；store 写入 `activeTurnPlan`。  
`message:complete` 可改为标记 phase done 而非立即 `activeTurnPlan = null`（与前端派生策略对齐）。

`plan:delta` 不接入 checklist。

---

## §7 可访问性与测试

- 进度区域 `aria-live="polite"`（阶段/进度变化）。
- 状态图标保留 `aria-label`（现有 todos 状态 key）。
- 单元：`selectLivePlan` 全部分支；`PlanProgressPanel` 渲染/审批点击。
- 现有 harness：`harness-plan-approval` 仍能点到 approve；可选断言 `plan-progress-panel` 可见。

---

## §8 验收标准

1. `forcePlan` 开启且 turn running、尚无 todos → 面板空态 planning 可见。  
2. 首次 supervisor `write_todos` 后清单出现，无需展开 ActivityBar。  
3. 执行期 `write_todos` 替换列表，`done/total` 与 in_progress 同步。  
4. 审批态可 Approve/Reject/Amend；eval test id 不破。  
5. 无 plan 的普通对话不出现面板。  
6. 当前 live 消息展开 ActivityBar 时不出现第二份全量 checklist。

---

## §9 Key Decisions

| 决策 | 理由 |
|------|------|
| Sticky 在消息列内而非 fixed | 不挡 Composer；与审批卡同构 |
| P0 纯前端派生 | 数据已在 tool stream / activeTurnPlan；交付快 |
| 仅 supervisor todos | 与 `latestTodos` 既有不变量一致 |
| 审批并入 ProgressPanel | 单一清单源，避免双 UI |
| 新 turn 不粘旧 todos | 末条 user + running 时丢弃上 turn 的 write_todos 展示 |

---

## §10 Open Questions

无阻塞项。P1 `plan:updated` 与 complete 保留策略在 plan 文档中标为后续，不挡 P0。
