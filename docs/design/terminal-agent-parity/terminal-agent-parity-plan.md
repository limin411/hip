# 运维助手视觉对齐修复计划（terminal-agent-parity）

> 目标：让「运维助手」（TerminalAgentPanel）的对话输入框、权限审批、规划审批
> 与「对话/项目」场景（Composer card / PermissionModal / ComposerPlanPanel）
> 视觉与行为一致。单 PR 一次交付，按 P0 → P1 → P2 顺序执行。

## 背景：现状差异（检查结论）

| 场景 | 对话/项目 | 运维助手 | 差异 |
|------|----------|---------|------|
| 输入框 | `Composer`（`variant="card"`） | `CompactComposer` | 见 §2 |
| 权限审批 | `PermissionModal`（输入框上方内联卡） | `PermissionCard`（内联卡） | 见 §3 |
| 规划审批 | `ComposerPlanPanel` → `PlanProgressPanel` | **无任何 UI** | 见 §4 |

终端会话与主会话共用同一 session store / reducer（`reducers/plan.ts` 对任意
session 置 `planApprovalPending`）、同一 sidecar ReAct/planPause 机制 ——
规划审批在运维助手里一旦触发，用户看不到、无法响应，属于功能缺口。

## 改动清单

### P0 — 输入框 IME 守卫（功能 bug）

`CompactComposer` 的 textarea `onKeyDown` 无 `isComposing` / `Process` 判断；
中文/日文输入法回车确认组词时会误发送。与 `Composer.tsx` 同款守卫：

```ts
if (e.nativeEvent.isComposing || e.key === 'Process') return
```

### P1 — 规划审批面板（功能缺口）
- `TerminalAgentPanel` 用 `selectLivePlan`（`@/lib/todos`）计算当前会话的
  `LivePlanView`，非空时在权限卡上方渲染 `<PlanProgressPanel>`（复用 chat 组件，
  自带 awaiting 审批的 approve / amend / reject 按钮与进度条）。
- `planApprovalPending` 期间禁用 `CompactComposer`（`disabled` 并入该条件），
  对齐 chat 的 `sessionActionBlocked` 门禁（chat 是替换为提示框，窄面板用禁用态，
  视觉更轻）。
- 与 chat 一致：`onApprove → respondPlan('approve')`、
  `onReject → respondPlan('reject')`、`onAmend → respondPlan('amend', content)`。

#### 1b — 普通 interrupt 卡（chat-interrupt 同款）

- 终端消息列表尾部渲染 chat 同款 interrupt 卡（`⏸ question` + hint + Continue），
  独立 testid `terminal-interrupt`（避免与主对话的 `chat-interrupt` 在 e2e
  全局 querySelector 中歧义）。
- Continue 用会话级 `sendMessageToSession(active.id, chat.interruptContinueMessage)`
  （终端会话非全局 active，不能像 chat 那样调 `sendMessage`）。
- 与 chat 同规则隐藏：`shouldHideInterruptForPlanApproval` ——
  planApprovalPending 或 plan_approval context 时由规划面板接管 CTA。

### P2 — 视觉对齐

#### 2.1 CompactComposer → Composer card 同款类

| 项 | 现值 | 改为（= chat） |
|----|------|---------------|
| 壳层 | `transition-colors duration-chrome` + `focus-within:border-accent/40` | 去掉（`focusFieldWithin` 令牌明确 composer 卡壳无焦点 chrome） |
| textarea | `px-0.5 py-1 min-h-10 leading-relaxed outline-none disabled:opacity-50` | `px-2 py-1`、去掉 `min-h-10` / `leading-relaxed`、`focus-visible:outline-none focus-visible:ring-0`、`disabled:cursor-not-allowed disabled:opacity-60` |
| 工具栏 | `mt-1 … gap-2 border-t border-border/60 pt-1.5` | `flex items-center justify-between pt-1.5 px-0.5`（去 hairline / mt / gap） |
| 左槽 | `gap-1.5` | `gap-0.5` |

保留：danger 动画类、发送/停止按钮、Slash 面板、`/compact`、usage chip。

#### 2.2 PermissionCard → PermissionModal 同款视觉

| 项 | 现值 | 改为（= chat） |
|----|------|---------------|
| 容器 | `px-3 py-2.5` | `px-4 py-3` + `animate-view-enter` + `flex flex-col gap-3` |
| 标题 | `text-caption font-medium` | `text-body font-medium`（保留 ShieldCheck 图标） |
| 内容块 | `bg-surface/80` 无边框、`font-mono text-caption` | `border border-border bg-surface px-3 py-2 font-mono text-meta` |
| 按钮 | allow=primary / 其余 ghost，原始顺序 | allow=primary / 其余 **outline**，**allow 前置排序**（镜像 chat `orderOptions`），`gap-2` |

保留：`execHint` 提示行（终端特有语义，chat 是 intro 文案，不强行替换）。

## 测试

1. **IME**：`fireEvent.keyDown(input, { key: 'Enter', isComposing: true })` 不发送；
   普通 Enter 照常发送。
2. **规划面板**：会话置 `planApprovalPending` + `activeTurnPlan` → 出现
   `plan-progress-panel`；点 approve 调 `respondPlan('approve')`；pending 时
   textarea `disabled`。
3. 既有测试全部保持通过（类名断言只涉及 border-border / danger，不受影响）。

## 验收

- `yarn test`（终端面板相关 + 全量前端）
- `yarn tsc`
- `yarn check:store-deps`
