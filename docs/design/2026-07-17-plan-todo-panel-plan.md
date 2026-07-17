# Plan: Plan Todo Progress Panel

| Field | Value |
|-------|-------|
| **Date** | 2026-07-17 |
| **Status** | P0 implemented |
| **Spec** | [2026-07-17-plan-todo-panel-spec.md](./2026-07-17-plan-todo-panel-spec.md) |

---

## §0 范围

本 plan 以 **P0（纯前端）** 为必交付；P1 协议增强列为 follow-up，不阻塞合并。

---

## §1 实施步骤

### P0-1 — 视图模型 `selectLivePlan`

**文件：**

- `src/lib/todos.ts` — 增加 `PlanPhase`, `LivePlanView`, `selectLivePlan`, `planProgress`
- `src/lib/todos.test.ts` — 分支覆盖

**行为：** 严格按 spec §3 优先级与「当前 turn 语境」规则。

**验收：** `yarn vitest run src/lib/todos.test.ts`

### P0-2 — 抽出 `TodoChecklist`

**文件：**

- `src/components/chat/TodoChecklist.tsx`（从 `TurnTimeline.tsx` 抽出）
- `TurnTimeline.tsx` — import 复用；支持 `hidePlan?: boolean`

**验收：** 现有 `TurnTimeline.test.tsx` 仍过。

### P0-3 — `PlanProgressPanel`

**文件：**

- `src/components/chat/PlanProgressPanel.tsx`
- `src/components/chat/PlanProgressPanel.test.tsx`
- i18n：`en.ts` / `zh-CN.ts` / `zh-TW.ts` 增加 `chat.planPanel.*`

**行为：**

- 展示 phase、progress、checklist、planning 空态
- `awaiting_approval`：审批按钮 + 保留 plan-approval test ids
- 调用 `sessionService.respondPlan`（由 ChatPane 注入 callbacks）

**验收：** 组件单测 + test id 断言。

### P0-4 — 接入 `ChatPane` + 去重

**文件：**

- `src/components/chat/ChatPane.tsx` — 用 `selectLivePlan`；渲染 `PlanProgressPanel`；移除独立 `PlanApprovalCard` 挂载（逻辑并入 panel）
- `src/components/chat/MessageBubble.tsx` — 对「当前 live 且 panel 可见」传 `hidePlan` 给 `ActivityBar` → `TurnTimeline`
- `src/components/chat/ActivityBar.tsx` — 透传 `hidePlan`

**验收：** 手动/单测：有 live plan 时 timeline 无第二份 checklist；审批路径 test id 仍在。

### P0-5 — 回归

```bash
yarn vitest run src/lib/todos.test.ts \
  src/components/chat/TurnTimeline.test.tsx \
  src/components/chat/PlanProgressPanel.test.tsx \
  src/components/chat/PlanApprovalCard.test.tsx \
  src/components/chat/PlanModeChip.test.tsx
```

可选：`e2e` harness-plan-approval（若本地环境可用）。

---

## §2 P1（follow-up，不在本 PR 必做）

1. Sidecar：`write_todos` 后 `plan:updated`。  
2. Store：持续更新 `activeTurnPlan`；complete 时保留至下一 user turn。  
3. ActivityBar 摘要行：`Plan 2/5`。  
4. Eval 断言 `plan-progress-panel`。

---

## §3 风险

| 风险 | 缓解 |
|------|------|
| 双清单 | live 消息 `hidePlan` |
| 破坏 eval 审批 id | panel 内保留相同 test id |
| 旧 plan 粘连 | 新 turn（末条 user + running）不读上条 todos |
| activeTurnPlan 被 complete 清空 | P0 用 last assistant `write_todos` 作 done 态源 |

---

## §4 文件清单（P0）

| 路径 | 动作 |
|------|------|
| `docs/design/2026-07-17-plan-todo-panel-spec.md` | 新增 |
| `docs/design/2026-07-17-plan-todo-panel-plan.md` | 新增 |
| `docs/design/README.md` | 索引 |
| `src/lib/todos.ts` | 扩展 |
| `src/lib/todos.test.ts` | 扩展 |
| `src/components/chat/TodoChecklist.tsx` | 新增 |
| `src/components/chat/PlanProgressPanel.tsx` | 新增 |
| `src/components/chat/PlanProgressPanel.test.tsx` | 新增 |
| `src/components/chat/TurnTimeline.tsx` | 抽 checklist + hidePlan |
| `src/components/chat/ActivityBar.tsx` | hidePlan 透传 |
| `src/components/chat/MessageBubble.tsx` | hidePlan |
| `src/components/chat/ChatPane.tsx` | 挂载 panel |
| `src/i18n/en.ts` / `zh-CN.ts` / `zh-TW.ts` | 文案 |

---

## §5 完成定义（DoD）

- [x] Spec + plan 已写入 `docs/design/`
- [x] P0 代码：单测绿、spec §8 验收项满足
- [x] 不扩大 sidecar / protocol 面（P0）
