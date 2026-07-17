# hip design docs

## App shell（界面壳）

| 文档 | 一层一句话 |
|------|------------|
| [app-shell-sidebar-spec](./2026-07-16-app-shell-sidebar-spec.md) | 左侧边栏 + 无顶栏 + 右侧贴边抽屉；含 Interaction contracts 与 PR-1…5 |
| [layout-sidebar-proposal.html](./layout-sidebar-proposal.html) | 用户认可的视觉/IA 交互原型 |
| [windows-visual-polish-spec](./2026-07-17-windows-visual-polish-spec.md) | Win/Linux 视觉一等公民：字体、vibrancy 模式、侧栏顶、Win 自绘 caption |

**状态：** shell PR-1…PR-5 已落地。**Windows visual polish** spec 就绪（PR-W1…W3：字体/实色回退 · vibrancy 模式 · 自绘标题按钮）。

## Plan todo panel（规划清单与进度）

| 文档 | 一层一句话 |
|------|------------|
| [plan-todo-panel-spec](./2026-07-17-plan-todo-panel-spec.md) | forcePlan / write_todos / 审批全程 sticky 清单；LivePlanView 派生规则 |
| [plan-todo-panel-plan](./2026-07-17-plan-todo-panel-plan.md) | P0 纯前端 PlanProgressPanel；P1 plan:updated |

**状态：** P0 + P1 已落地（sticky panel + `plan:updated` + ActivityBar 进度）。

## Capability evaluation（能力评测）

按**渐进式披露**阅读：

| 顺序 | 文档 | 一层一句话 |
|------|------|------------|
| 1 | [eval-loop](./2026-07-16-hip-capability-eval-loop.md) | UI-first 闭环：桌面做题 → 打分 → 标签 |
| 2 | [matrix-spec](./2026-07-16-hip-capability-matrix-spec.md) | 复杂任务规格：轴、L0–L5、T1–T8、schema |
| 3 | [matrix-plan](./2026-07-16-hip-capability-matrix-plan.md) | 实现计划：P0–P4、PR-M0–M4、验收命令 |

**状态：** loop 已落地 pilot；matrix **仅 spec/plan，待确认后按 PR-M0 起实现**。
