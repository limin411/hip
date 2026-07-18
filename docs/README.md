# hip docs

项目文档入口。按 **渐进式披露** 组织：先决策摘要，再路线图，再方案细节。

## 升级规划（vs Orca）

| 读什么 | 何时读 | 路径 |
|--------|--------|------|
| **决策简报（5 分钟）** | 只想拍板方向 / 阶段取舍 | [`upgrade/00-decision-brief.md`](./upgrade/00-decision-brief.md) |
| **升级路线图（15 分钟）** | 要看阶段、里程碑、非目标 | [`upgrade/01-roadmap.md`](./upgrade/01-roadmap.md) |
| **升级方案（深读）** | 选定主题后做设计 / 拆 PR | [`upgrade/02-schemes.md`](./upgrade/02-schemes.md) |
| **对照附录** | 需要 hip ↔ Orca 能力表 | [`upgrade/appendix-capability-matrix.md`](./upgrade/appendix-capability-matrix.md) |

**建议阅读顺序：** `00` → 做选择 → 需要细节时再进 `01` / `02`。

## Chat / Code 体验

| 读什么 | 何时读 | 路径 |
|--------|--------|------|
| **丝滑路线：渐进交付 + 分阶段 e2e** | Chat/Code 对齐对照最佳实践；**P0–P5 分期**；**每阶段 `@smooth-pN` e2e + `yarn test:e2e:gate` 回归** | [`design/2026-07-18-chat-code-smoothness-spec.md`](./design/2026-07-18-chat-code-smoothness-spec.md) |
| **并行 N：智能体决定路数** | Host 按钮 / fan-out：**goal → suggest N → clamp 1–4**；非用户每次选手选 N | [`design/2026-07-18-agent-decided-parallel-count-spec.md`](./design/2026-07-18-agent-decided-parallel-count-spec.md) |

- **终态能力**（§4）：流式、工具、编辑、`apply_patch`、Context、终端、批注、并行、Goal、CLI；以及 **§4.U 界面体验**（对话过程/答案层次 + 右侧 Agents Live + 双向焦点）。  
- **阶段**（§5）：P0 基线 → P1 跟手+对话 UI → P2 编辑+类型化渲染 → P3 终端/批注/**Agents Live** → P4 Context/会话/CLI/密度队列 → P5 并行/Goal。  
- **门禁**（§6）：每阶段 `@smooth-pN` e2e + `yarn test:e2e:gate`；失败或 flaky skip = 未完成。  
- **对照**：`/Users/lijiamin/data/code-repository/github/`（OpenCode、Codex、Pi、Orca、OpenHands、Kimi-code 等）。  
- 远程 / Mobile / Design Mode / Computer Use 仍在 `docs/upgrade/*`，不在本路线内。
## 其他

设计规格放在 `docs/design/`，并在本页挂链接。
