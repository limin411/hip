# hip 公开前打磨包（索引）

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-10 |
| 状态 | **P3/P1 已实现 · P2 待实现** |
| 前提 | Sprint **A/B/C 主干已落地**（见 [`2026-07-10-pre-public-roadmap-index.md`](./2026-07-10-pre-public-roadmap-index.md)） |
| 原则 | 小 diff、可验收、不扩产品面；补测试与去死码优先于新功能 |

---

## 与 A/B/C 的关系

| 阶段 | 状态 | 本包承接 |
|------|------|----------|
| A Harness | 主干已实现 | — |
| B Code/Agents 体验 | 主干已实现；**B3 确认 UI 未验收、B1 完整 e2e 未闭合** | **P1、P2** |
| C 架构收敛 | 主干已实现；**C5 文案/死键未扫净** | **P3** |

执行顺序建议：**P3（最安全）→ P1 → P2**，或 **P1 ∥ P3** 后 P2（P2 可能要加 e2e 注入桥）。

不要求再开「Sprint D」大叙事；本索引 = 公开前 **polish backlog**。

---

## 打磨项总览

| ID | Spec | 一句话 | 建议工期 | 风险 |
|----|------|--------|----------|------|
| **P1** | [`2026-07-10-polish-checkpoint-revert-confirm-design.md`](./2026-07-10-polish-checkpoint-revert-confirm-design.md) | 检查点回退确认：稳健关闭 + 组件测 +（可选）成功反馈 | 0.5–1.5 天 | 低 · **已实现** |
| **P2** | [`2026-07-10-polish-e2e-write-to-changes-design.md`](./2026-07-10-polish-e2e-write-to-changes-design.md) | 完整 e2e：写工具语义 → Changes 自动出现 path | 1–2 天 | 中；或需 e2e 桥 |
| **P3** | [`2026-07-10-polish-dead-code-orchmode-i18n-design.md`](./2026-07-10-polish-dead-code-orchmode-i18n-design.md) | 删 orchMode i18n / 测试化石；协议兼容保留 | 0.5 天 | 低 · **已实现** |

---

## 范围边界（三包共同）

### 做

- B3 体验验收与自动化  
- B1「改 → 看见」e2e 闭合  
- 用户可见 orchMode / 集群文案清零  

### 不做

- 新编排模式、工作流编辑器、DAG tab  
- xlsx 专项  
- 协议删除 `orchMode` 字段  
- 重写 checkpoint / diff 引擎  
- 云同步 / SSO  

---

## 现状快照（写 spec 时）

| 主题 | 现状 | 缺口 |
|------|------|------|
| 检查点确认 | `TimelineView` 已有 Modal、错误、跨分支、i18n | 无组件测；成功关闭靠 `checkpoints.length`；无 e2e；成功反馈弱 |
| 改 → Changes | `tool:finished` 防抖 refresh + 单测；`diff-workspace` 带外编辑需切 tab | 无「不切 tab / 工具写完自动出现」e2e |
| orchMode 文案 | UI 开关已去；三语 `chat.orchMode` 仍在；ModelPicker 测试仍 mock | 死键与误导测试 |

---

## 跟踪方式

1. 每项开始：可从对应 design 拆 `docs/superpowers/plans/YYYY-MM-DD-polish-*.md`（极小组也可直接按 design 任务表做）。  
2. 每项结束：design 状态 → **已实现**；本索引表格更新。  
3. 三项全绿后：更新 [`pre-public-roadmap-index`](./2026-07-10-pre-public-roadmap-index.md) 状态，注明 polish 包完成。  
4. 实现后按 `AGENTS.md`：**分项 commit**，勿与无关重构捆绑。

---

## 建议验收口令（给执行 agent）

```text
P3: rg chat.orchMode src/i18n → empty; ModelPicker 仍无 orch toggle; yarn test 绿
P1: TimelineView.test 覆盖 confirm/cancel/error; 失败不砖 Modal
P2: e2e 不切 tab 时 Changes 出现写入 path; 无付费 LLM
```
