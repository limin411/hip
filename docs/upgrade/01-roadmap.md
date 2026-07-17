# Hip 升级路线图

| Field | Value |
|-------|-------|
| **Title** | hip 产品升级路线图（对照 Orca） |
| **Date** | 2026-07-17 |
| **Status** | Roadmap — 依赖 [00 决策简报](./00-decision-brief.md) 拍板后锁定范围 |
| **Audience** | 产品 / 架构 / 实现 |
| **Reading guide** | **渐进式披露**：§0 总览 → §1 定位 → §2 阶段 → §3 里程碑 → §4 非目标 → §5 依赖与风险 → §6 度量 |

---

## §0 一页纸

```text
问题：Orca 证明了「并行 worktree + 终端 IDE + 远程/集成」是 Agent 桌面产品的主战场；
      hip 已有内生 agent、plan、memory、eval，但工作流面偏「会话 + 工具」，产品叙事偏弱。

目标：在不换壳、不放弃内生 runtime 的前提下，分 P0/P1/P2 补齐工作流面，
      形成「Parallel Studio + Smart Loop」双轮：并行编排 × 智能闭环。

原则：
  1. 工作流学 Orca；智能面继续领先 Orca。
  2. 最小可验收增量；每阶段有 hard 成功标准。
  3. 能力矩阵 / UI-first eval 不降级为「有空再测」。
  4. 外部 CLI 是 worker，不是唯一大脑。
```

| 阶段 | 主题 | 用户一句话感知 |
|------|------|----------------|
| **P0** | Parallel Surface | 「我能并行开三个隔离 agent 比方案」 |
| **P1** | Reach & Integrate | 「远程大仓能跑；点网页/Issue 就能开工」 |
| **P2** | Always-on Product | 「离开电脑也知道进度；安装更新像正式产品」 |

详案见 [02-schemes](./02-schemes.md)。能力对照见 [附录](./appendix-capability-matrix.md)。

---

## §1 定位与战略

### 1.1 对照结论

| | hip | Orca |
|--|-----|------|
| 大脑 | **内生** LangGraph ReAct + tools | **外挂** 终端 CLI agent |
| 壳 | Tauri + sidecar WS | Electron + main + relay |
| 最强轴 | plan / HITL / memory / knowledge / eval | 并行 worktree / 终端 / SSH / mobile / 集成 |
| 体量 | 0.1.x 可演进 | 1.4.x 全功能 |

### 1.2 战略公式

```text
hip 目标态 ≈ Orca.工作流面（精选） + hip.智能面（加深）
           ≠ Orca 的 Electron 体量与 vendor 适配矩阵
```

### 1.3 与现有 hip 资产的关系

| 已有资产 | 在路线图中的角色 |
|----------|------------------|
| `git:worktree:*`、background-worktree | P0 并行 Studio 的后端底座 |
| TerminalView / terminalStore | P0 终端工作面升级起点 |
| `@hip/cli`（run/doctor/harness） | P0 扩展为产品脚本面 |
| ChangesView / diffStore | P0 Diff 批注 |
| ACP agents | P1 外部 worker 体验 |
| orchestrator / DAG / teams | 可与并行 Studio 状态机对齐（勿重复造第二套） |
| memory / knowledge | 持续加深，不进 P0 关键范围但保留排期带宽 |
| e2e capability matrix | 全程门禁；P0 增 `parallel_worktree` 等轴 |

---

## §2 阶段路线图

### 2.1 时间盒（参考，拍板后可改）

```text
Now ── P0 (~12w) ── P1 (~+12w) ── P2 (~+24w) ── …
         │              │              │
         │              │              └─ Companion / Automations / 分发 / Computer Use?
         │              └─ Design Mode / SSH / GitHub / ACP 体验
         └─ Worktree 并行 / 终端 / CLI / Diff 批注
```

单人团队：P0 拉长到 16–20 周，P1 只做 Design Mode + GitHub 只读入口，SSH 延后。

### 2.2 P0 — Parallel Surface（约 12 周）

| ID | 主题 | 一句话 | 详案 |
|----|------|--------|------|
| **P0-A** | Worktree Studio | 扇出、状态、对比、合并 | [02 §A](./02-schemes.md#scheme-a-worktree-studio) |
| **P0-B** | 终端工作面 | 多 PTY、绑定 session、路径点开、失败回灌 | [02 §B](./02-schemes.md#scheme-b-terminal-surface) |
| **P0-C** | 产品 CLI | session/worktree/diff/permission 可脚本 | [02 §C](./02-schemes.md#scheme-c-product-cli) |
| **P0-D** | Diff 批注 | 行级 comment → 下一轮 agent context | [02 §D](./02-schemes.md#scheme-d-diff-annotate) |

**P0 成功标准（全部满足才算阶段完成）：**

1. UI：从 Composer 一键「并行 ×N worktree」创建 N 个隔离 session，侧栏可见状态（running / need_input / done / failed）。
2. 对比：至少支持文件级 diff 摘要对比；合并路径有明确 UX（checkout / apply / 人工）。
3. 终端：同一 session 可开 ≥1 持久 PTY；cwd 与 session 一致；路径/失败输出可送回 Composer。
4. CLI：`hip session create|send|status`、`hip worktree create|list` 在无 UI 下可用（同 sidecar）。
5. Diff：ChangesView 可批注 → 出现在下一 turn 的结构化 context。
6. 质量：新增或扩展 eval 覆盖并行/worktree 安全（不污染 primary tree）；既有 pilot 不回退。

**P0 不做：** SSH、mobile、内嵌浏览器、Computer Use、宽 vendor 适配、自动更新商店分发。

### 2.3 P1 — Reach & Integrate（+约 1 季度）

| ID | 主题 | 一句话 | 详案 |
|----|------|--------|------|
| **P1-A** | Design Mode | 预览页点选 → HTML/CSS/截图进 prompt | [02 §E](./02-schemes.md#scheme-e-design-mode) |
| **P1-B** | 远程运行时 | SSH 上第二 sidecar 或等价 remote root | [02 §F](./02-schemes.md#scheme-f-remote-runtime) |
| **P1-C** | 任务源集成 | GitHub Issue/PR → 开 session/worktree | [02 §G](./02-schemes.md#scheme-g-task-integrations) |
| **P1-D** | ACP 体验层 | resume / 并排 / 状态点 / 有限 preset | [02 §H](./02-schemes.md#scheme-h-acp-workers) |

**P1 成功标准：**

1. Design Mode：真实页面上选元素，Composer 收到结构化附件并可驱动修复。
2. 远程：至少一个「远程 cwd + 工具 jail 生效」的 dogfood 路径；断线可恢复或明确失败。
3. GitHub：列表 Issue/PR，一键创建绑定 worktree 的 session。
4. ACP：至少 1–2 个外部 agent 作为并行 worker 稳定可用，不要求 Orca 级全覆盖。

### 2.4 P2 — Always-on Product（+约半年）

| ID | 主题 | 一句话 | 详案 |
|----|------|--------|------|
| **P2-A** | Companion / 通知 | 完成与 HITL 推送；可选 mobile pair | [02 §I](./02-schemes.md#scheme-i-companion) |
| **P2-B** | Automations | 定时 / headless / CI 触发 | [02 §J](./02-schemes.md#scheme-j-automations) |
| **P2-C** | 产品化分发 | 签名、updater、安装体验 | [02 §K](./02-schemes.md#scheme-k-distribution) |
| **P2-D** | Computer Use | 桌面操控（可选） | [02 §L](./02-schemes.md#scheme-l-computer-use) |

**P2 成功标准（按启用子集）：** 长任务可离桌感知；无 UI 可跑批；安装更新路径可对外；Computer Use 仅在明确需求下启用。

### 2.5 贯穿始终（非阶段独占）

| 主题 | 动作 |
|------|------|
| **能力矩阵 eval** | 每阶段至少 1 个新轴或 harden；周报 pass rate |
| **Memory / Knowledge** | 小步加深；与 session/project 绑定，避免大爆炸重构 |
| **Plan / Todo 面板** | 与并行 worker 状态统一可视化（勿两套进度 UI） |
| **安全** | path jail、permission mode、worktree 删除 preflight、不污染主仓 |
| **可靠性工程** | 逐步引入：关键路径测试、终端切换延迟预算、配置契约测试 |

---

## §3 里程碑与依赖

### 3.1 依赖图（逻辑）

```text
P0-A Worktree Studio ─────────┬──► P1-C Issue→worktree
       │                      │
P0-C 产品 CLI ────────────────┤
       │                      ├──► P1-B 远程（CLI/状态复用）
P0-B 终端 ────────────────────┤
       │                      └──► P1-D ACP worker 并排
P0-D Diff 批注 ───────────────► 贯穿 review 闭环

P0 事件流稳定 ──► P2-A 通知/companion
P0-C + cron ──► P2-B automations
P1-A Design Mode ──(可选)──► P2-D Computer Use
```

### 3.2 建议实施顺序（P0 内）

```text
Week 1–3   P0-A MVP：create N worktrees + N sessions + 状态点
Week 2–4   P0-C：CLI 对齐同一协议（与 A 并行）
Week 4–7   P0-B：终端绑定与回灌
Week 5–8   P0-D：Diff 批注
Week 8–10  P0-A compare/merge UX
Week 10–12 加固 + eval 轴 + dogfood
```

并行人力允许时：`A+C` 一条线，`B+D` 一条线。

### 3.3 PR / 交付切片原则

- 每一切片：**可 demo + 有测试 + 不破坏既有 session 路径**。
- 协议变更进 `@hip/protocol`，前后兼容或显式 version。
- UI-first eval 任务优先于「仅 unit 绿」。
- 大功能先 design 短文（`docs/design/YYYY-MM-DD-*.md`），再实现。

---

## §4 非目标（Non-Goals）

### 4.1 全局非目标

| 非目标 | 原因 |
|--------|------|
| 迁 Electron / 重写壳 | 成本高，收益不匹配；Tauri 足够 |
| 成为「纯 CLI agent 宿主」 | 放弃内生 runtime 差异化 |
| Orca 级全 vendor 适配矩阵 | 维护税爆炸；用 ACP + preset |
| 内置完整 VS Code | 外开编辑器 + 轻量编辑即可 |
| 默认付费 live eval 进 CI gate | 成本与稳定性；保持 opt-in |
| P0 做 mobile / Computer Use | 分散火力 |

### 4.2 阶段非目标（摘要）

| 阶段 | 明确不做 |
|------|----------|
| P0 | SSH、浏览器、GitHub 原生、auto-update 商店、i18n 全量审计 |
| P1 | 原生双端 App Store 级 companion、全平台 Computer Use |
| P2 | 无强制；按资源裁剪 |

---

## §5 风险与缓解

| 风险 | 影响 | 缓解 |
|------|------|------|
| 并行叙事与 Orca 同质化 | 用户「为何不用 Orca」 | 强调内生 loop + memory + eval；并行只是入口 |
| Worktree 污染主仓 / 磁盘爆炸 | 数据事故 | preflight 删除、磁盘预算、eval `primary_tree_mutated` |
| 终端/PTY 复杂度吞噬工期 | P0 失败 | P0-B MVP 不做 WebGL/无限分屏；先单 PTY 稳 |
| 远程安全与密钥 | 泄露 | 远程配置隔离；不把 auth.json 明文同步到不可信盘 |
| 范围蔓延（「顺便 IDE」） | 无交付 | 决策简报锁定；新需求进 defer 表 |
| 单人带宽 | 阶段滑点 | 单人模式：P0 只做 A+C，B/D 降级 |

### Defer 登记（模板）

新增延后项时追加到本节或独立 `docs/upgrade/defer.md`：

| ID | 项 | 原因 | 复审条件 |
|----|-----|------|----------|
| D1 | Computer Use | 成本高 | Design Mode 上线且仍有桌面操控需求 |
| D2 | 原生 mobile | 工程大 | P0 事件流 + 通知协议稳定 |
| D3 | Linear/Jira 原生 | GitHub 优先 | GitHub 入口 dogfood 成功 |

---

## §6 度量（如何知道升级有效）

| 指标 | 定义 | 阶段 |
|------|------|------|
| **并行采用** | 使用 worktree 扇出的 session 占比 | P0+ |
| **并行完成率** | 扇出后至少 1 路 verify/用户接受的比例 | P0+ |
| **主仓污染率** | `primary_tree_mutated` / 危险路径事件 ≈ 0 | 全程 |
| **Eval pass rate** | 能力矩阵轴 k≥3 周报 | 全程 |
| **CLI 脚本成功率** | harness/产品 CLI 非交互路径 | P0+ |
| **HITL 恢复率** | interrupt 后完成 turn 的比例 | 全程 |
| **远程会话成功率** | 创建并完成至少 1 turn | P1+ |
| **Design Mode 使用** | 带 DOM/截图附件的 turn 数 | P1+ |

定性：每月 dogfood「真实仓库上的一次并行修 bug / 加小功能」。

---

## §7 决策锁定区（拍板后填写）

| 项 | 决议 | 日期 |
|----|------|------|
| 主叙事 | _待填_ | |
| P0 范围 | _待填_ | |
| 外部 agent 策略 | _待填_ | |
| 远程形态 | _待填_ | |
| Mobile | _待填_ | |
| 人力模型 | _待填_ | |

锁定后，从 [02-schemes](./02-schemes.md) 按 ID 开 design / 实现。
