# hip 公开前优化路线图（索引）

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-10 |
| 状态 | **A/B/C 主干已实现**（后续可继续打磨与 e2e） |
| 前提 | 产品尚未面向公众；编排已切到 agent-driven（见 `2026-07-10-agent-driven-orchestration-agents-panel-design.md`） |
| 原则 | Harness > 功能面；少开关；Code 主路径优先；本地可诊断 |

---

## 阶段总览

| 阶段 | Spec | 目标一句话 | 建议工期 |
|------|------|------------|----------|
| **Sprint A** | [`2026-07-10-sprint-a-harness-quality-design.md`](./2026-07-10-sprint-a-harness-quality-design.md) | 主循环可靠、可取消、可测、可导出调试信息 | 1–2 周 · **主干已实现** |
| **Sprint B** | [`2026-07-10-sprint-b-code-agents-experience-design.md`](./2026-07-10-sprint-b-code-agents-experience-design.md) | Code 闭环可感、Agents 可懂、上下文更省、安装失败可读 | ~2 周 · **主干已实现** |
| **Sprint C** | [`2026-07-10-sprint-c-architecture-convergence-design.md`](./2026-07-10-sprint-c-architecture-convergence-design.md) | 持久化/命名/死路径收敛，降低长期债务 | 按需 1–3 周 · **主干已实现** |

**执行顺序：A → B → C。** 未完成 A 的验收标准前，不启动 B 的大功能；B 未完成前不做 C 的破坏性删除。

---

## 与「优先 5 件事」的映射

| 优先事项 | 落在 |
|----------|------|
| 1. 主路径 harness 回归集 | **A** |
| 2. Code：改 → 看见 → 回退 | **B**（改/看见 + e2e；回退依赖既有 checkpoint，B 做体验补齐） |
| 3. Agents 面板协作真相 | **B**（v2）+ A 投影正确性 |
| 4. 上下文/成本 | **B** |
| 5. 本地可诊断 | **A**（复制调试信息） |

---

## 明确不做（三阶段共同 Non-Goals）

- 用户可见编排模式 / 工作流入口（D1 已拍板）
- xlsx/办公格式专项解析
- 云同步、团队协作、企业 SSO（可另开轨）
- 为演示复活独立 DAG 产品面
- 无证据下更换主图引擎

---

## 依赖与已完成基础

| 已完成 | 文档 / 提交 |
|--------|-------------|
| Agent 自驱动 + Agents 结构条 | `2026-07-10-agent-driven-orchestration-agents-panel-design.md`；`a0ee3c7` / `70a7940` |
| cancel→partial（workflow 路径） | workflow-runner finalize |
| 工具别名、.git/objects 熔断 | tool-runner |
| Project AGENTS.md 注入（基础） | architecture-remediation；`project-agents-md` — **B 做体验与缺口补齐，不重复造** |

---

## 跟踪方式

1. 每阶段开始时：从对应 design 拆 `docs/superpowers/plans/YYYY-MM-DD-sprint-*.md`
2. 每阶段结束时：把 design 状态改为 **已实现** 或列出偏差
3. 本索引「状态」在三阶段全完成后改为 **公开前质量门槛达成**
