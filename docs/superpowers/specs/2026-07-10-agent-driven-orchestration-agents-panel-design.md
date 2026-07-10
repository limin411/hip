# Agent 自驱动编排 + 智能体面板统一 — 修复与演进方案

| 字段 | 值 |
|------|-----|
| 作者 | Grok |
| 日期 | 2026-07-10 |
| 状态 | **已决议（产品点已拍板）** |
| 相关 | `docs/superpowers/specs/2026-07-10-orch-mode-dag-panel-closure-design.md`（将部分 supersede）、`docs/agent-orchestration-plan.md`、实测会话 `2-htLtzQUV4lWh5bopLKR` |
| 代码锚点 | `session-turn-runner.ts`、`workflow-runner.ts`、`builtin-workflows.ts`、`orchestrator-adapter.ts`、`ModelPicker.tsx`、`ArtifactPanel.tsx`、`AgentDashboard.tsx`、`workflowStore.ts` |

### 已拍板决策（2026-07-10）

| # | 决策 | 含义 |
|---|------|------|
| D1 | **不保留任何显式工作流入口** | 无 UI 开关、无 slash `/workflow`、无 supervisor `run_workflow_template` 工具、不向用户暴露 `workflow:run`。DurableExecutor / 模板代码可内部保留或后续删除，但 **不作为产品能力面**。 |
| D2 | **协作结构展示规则** | **有子代理时展开**结构条；**仅 supervisor 时隐藏**（不占位、不空态）。 |
| D3 | **xlsx 解析不是重点** | 不把办公文件格式当交付目标。重点是 **harness agent 能力**：主循环统一、委派与 profile 闸门、工具面正确、熔断、cancel/投影、权限一致、Agents 观察面。 |

---

## 1. 问题陈述

### 1.1 产品方向（本次新增需求）

1. **不要让用户选择 fast / dag**。编排策略应由 agent 根据任务自行判断。
2. **右侧独立 DAG 面板多余**。结构与运行状态应并入 **智能体（Agents）面板** 统一展示，而不是第二个拓扑视图。
3. **Harness 优先**：修 agent 运行时与观察面，而不是堆领域解析器。

### 1.2 实测 Code 会话暴露的系统问题

样本：`surface=code`、`orchMode=dag`，用户「这个目录…」→「这个 xlsx」。

| # | 问题 | 用户可感症状 |
|---|------|--------------|
| A | 用户模式开关 + 固定 `planner→coder` 模板 | 简单读文件被抬成双 Agent 流水线，~2min 后 cancel，无答案 |
| B | DAG 节点 `agentId: worker`，与 fixed `plan/coder/explore` 未接线 | 规划/实现同质，工具闸门失效 |
| C | Planner `text=""` 仍 `succeeded` | Coder 无计划可执行，自由空转 |
| D | `bash` 不存在、worker 无 `run_script` | 写 `check-git.sh`、手挖 `.git/objects` |
| E | （次要）缺二进制友好降级 | 模型乱试工具；**本方案不专项做 xlsx**，靠 harness 熔断与诚实失败 |
| F | 无有效熔断 / 重复工具检测 | 单节点 66 次工具调用 |
| G | cancel 返回空串、不投影 trajectory | 聊天区无 assistant 气泡 |
| H | event 对 DAG 轮几乎空白 | 恢复/审计失真 |
| I | DAG 节点 `permissionMode: 'full'` | 绕过会话 edit/HITL |
| J | Agents 面板与 DAG 面板双源、双 tab | 信息割裂；DAG 常空或与 Agents 不同步 |

**结论：** 07-10 的「模式开关 + 默认集群模板 + 独立 DAG tab」闭环解决了「集群模式能不能跑」；没有解决「该不该跑、跑对不对、怎么给人看」。本次方案把产品语义从 **用户选执行引擎** 改为 **主 Agent 自驱动协作，右侧统一观察协作图**；交付重心是 **harness**，不是领域文件解析。

---

## 2. 目标与非目标

### 2.1 Goals

| ID | 目标 |
|----|------|
| G1 | 移除用户可见的 fast/dag 开关；单条用户消息默认走 **统一主循环**（现 StateGraph / supervisor） |
| G2 | 复杂任务由 **supervisor 决策** 是否委派子 agent（`task` / `dispatch_agent` + plan/explore/coder）；简单任务零额外编排税 |
| G3 | 删除独立 `dag` ArtifactTab；Agents 面板成为 **唯一** 协作观察面（卡片列表 + 有子代理时的结构条） |
| G4 | 修好 harness 缺陷：空输出、工具别名/闸门、权限继承、cancel 投影、LoopGuard、event 一致性 → 「不再空回复 + 无意义深挖 .git」 |
| G5 | 右侧展示与执行同源：同一 turn 的 agentRuns / 委派边（`parentAgentId`） |
| G6 | 兼容迁移：旧会话 `orchMode` 字段忽略；不破坏 history 读取 |

### 2.2 Non-Goals（本方案不包含）

- N1 可视化拖拽编辑 DAG 并写回 `WorkflowDef`
- N2 完整替换 LangGraph 主循环为通用 workflow 引擎
- N3 跨会话记忆 / RAG
- N4 自定义模板市场
- N5 强制每轮都跑 multi-agent（那是当前 dag 默认的反面）
- N6 **任何显式工作流入口**（UI / slash / supervisor 工具 / 对外 `workflow:run`）——见 D1
- N7 **xlsx/办公格式专项解析**——见 D3；通用二进制可读错误提示可附带，非里程碑

---

## 3. 产品语义（用户心智）

### 3.1 之前

```
用户选「单实例 / 集群」
  → 集群：固定 planner→coder（无论问什么）
  → 右侧：Agents 看轨迹 + DAG 看图（两套 UI）
```

### 3.2 之后

```
用户只发消息（+ 权限/模型等与编排无关的设置）
  → Supervisor 始终入场
  → 自行判断：直接答 / 委派 explore|plan|coder（仅工具委派，无工作流入口）
  → 右侧「智能体」：本轮谁在跑、工具轨迹；有子代理时展开协作结构，仅 supervisor 时隐藏结构
```

**文案建议：** 不再出现「单实例/集群/orchMode/工作流」。Agents 面板状态条：`直接回答` | `已委派 N 个子代理` | `运行中…`。

---

## 4. 架构方案

### 4.1 执行路径：单一入口 + Agent 自驱动

```
message:send
    │
    ▼
runTurn()  ── 永远走主循环（现 StateGraph / supervisor）
    │
    ├─ supervisor 模型 + tools
    │     ├─ 只读工具 / 直接文本  → 结束（简单路径）
    │     └─ task / dispatch_agent → 子 agent（explore | plan | coder | …）
    │
    ▼
finalizeAndPersist（含 partial / cancelled）
```

**关键变更：**

| 组件 | 现状 | 目标 |
|------|------|------|
| `resolveWorkflowDefForTurn` | `orchMode==='dag'` 则强制 cluster-default | **恒不走**（删除强制分支；无用户/agent 入口触发） |
| `session:setOrchMode` / UI toggle | 用户可切 | **废弃 UI**；协议字段 deprecate，默认忽略 |
| `builtin:cluster-default` / `runWorkflowTurn` | 用户开 dag 就跑 | **产品路径下线**（D1）；代码可先死代码/后删，不接线 |
| 委派 | 常落 `worker` | 默认 **plan / explore / coder** 真实 profile |

### 4.2 Supervisor 如何「判断该怎么做」（分层，避免再造模式开关）

**不推荐：** 再做一个隐藏的 fast/dag 分类器模型前置（延迟 + 双份成本 + 仍会误判）。

**推荐：工具驱动的隐式路由（与现有 deepagents `task`/`dispatch_agent` 一致）——仅 L0+L1，无 L2 工作流**

1. **L0 — 系统提示 + 工具描述（本方案主路径）**  
   强化 supervisor system prompt：
   - 简单问答、列目录、读单文件、解释概念 → **直接用工具并回答，禁止无意义委派**
   - 大范围探索 → `dispatch_agent(explore)` 或 `task` + explore profile  
   - 需要设计方案 → `plan` profile  
   - 需要改代码/落地 → `coder` profile  

2. **L1 — 硬规则护栏（确定性，不靠模型）——harness 核心**  
   - 子 agent 输出为空 → 委派记 **failed**，不得标 succeeded  
   - 未知工具名别名表：`bash|shell|sh` → `run_script`  
   - 连续 N 次相同 tool+args、或连续读 `.git/objects/**` → circuit breaker 注入「停止探测，汇总已有结果」  
   - 明显二进制魔数读失败时返回 **清晰错误**（非专项解析器）；禁止用垃圾字节当成功内容继续空转

### 4.3 Profile 与工具面纠偏（对齐 Fixed Internal Agents）

| Profile | 用途 | 工具要点 |
|---------|------|----------|
| `supervisor` | 主循环、路由、汇总 | 全量；强约束「何时委派」 |
| `plan` | 规划 | 只读 + todos；**无** write/run_script |
| `explore` | 探索 | 只读 |
| `coder` | 实现 | 读写 + **`run_script`**；无 write_todos |
| `worker` | 遗留兼容 | 逐步弃用；新模板/默认委派不用 worker |

**workflow / subagent 接线：**

- `builtin-workflows`：`planner.agentId = 'plan'`，`coder.agentId = 'coder'`  
- `orchestrator-adapter`：按 `req.agentId` 走 **对应 profile 的 invoker**，删除「凡 worker 就 shortcut 且 full 权限」的特例；或 shortcut 仅作内部实现但 **注入正确 allowedTools + session permissionMode**  
- `runSubagent` 默认 `permissionMode` **继承会话**，禁止写死 `'full'`

### 4.4 取消 / 失败 / 投影（P0 正确性）

```
on Abort / timeout / node fail:
  1. 收集 trajectory 已有 output / toolCalls / reasoning
  2. finalizeAndPersist(text = 最佳 partial 摘要, stopped=true)
  3. message:complete 必须有 assistant 行（哪怕是「已取消，以下为已完成工作」）
  4. event 写入 step/tool 摘要（与 fast 路径同构或明确 workflow 事件类型）
  5. 禁止 return '' 且无 finalize
```

Planner/子节点：`output.text.trim()===''` 且无成功交付物 → `node:failed` 或自动补一句合成摘要后再 succeed（二选一，推荐 **fail + supervisor 重试/改路径**）。

### 4.5 熔断与空转（P0/P1）

在 graph tools 节点 + workflow node-runner 共用一层 `LoopGuard`：

| 信号 | 动作 |
|------|------|
| 相同 `(name, canonicalInput)` ≥ 3 | 返回错误并 hint 换策略 |
| path 匹配 `.git/objects/**` 累计 ≥ 2 | 阻断，提示用 `run_script`/`git` 工具 |
| 单 child 工具错误率高 / 步数近 `CHILD_MAX_STEPS` | 强制 text-only 收束（已有 MAX_STEPS_NOTE，确保 workflow 路径也生效） |
| 无 xlsx 解析仍反复 read 同 xlsx | 阻断并提示能力缺失 |

### 4.6 二进制/未知格式（附带 harness 行为，非交付重点）

不做 `read_spreadsheet` 里程碑。Harness 仅保证：

1. 明显非文本内容不伪装成成功长文本，避免模型继续空转  
2. LoopGuard 在重复无效 `read_file` 后强制收束  
3. supervisor 可如实说明限制——这是 **诚实失败**，不是格式产品

---

## 5. UI 方案：Agents 面板吸收 DAG

### 5.1 Tab 变更

| 现状 `ArtifactTab` | 目标 |
|--------------------|------|
| `files \| agents \| timeline \| changes \| dag \| terminal` | **去掉 `dag`** |
| `PanelToggle` 含 DAG | 删除入口 |
| `workflow:started` 自动 `setTab('dag')` | 删除该副作用；若仍有内部事件，最多 `setTab('agents')` |

### 5.2 Agents 面板信息架构（D2 锁定）

**仅 supervisor（无子代理）——不展示协作结构：**

```
┌─ 智能体 ─────────────────────────────────────────┐
│ 本轮 · 直接回答 · 运行中…                         │
│ Turn 1 · 18:21                                     │
│ ┌ Supervisor ………… done · 4s ──────┐               │
│ │ tools · reasoning · …             │               │
│ └───────────────────────────────────┘               │
└────────────────────────────────────────────────────┘
```

**有子代理——展开协作结构：**

```
┌─ 智能体 ─────────────────────────────────────────┐
│ 本轮协作 · 进行中 · 2 子代理                      │
│                                                    │
│ 协作结构（默认展开，不可整页空态）                 │
│   supervisor ──┬── plan (done)                     │
│                └── coder (running)                 │
│   （数据：agentRuns.parentAgentId + taskInput）    │
│                                                    │
│ Turn 3 · 20:28                                     │
│ ┌ Supervisor … ┐  ┌ Plan … ┐  ┌ Coder … ┐         │
│ └──────────────┘  └────────┘  └─────────┘         │
└────────────────────────────────────────────────────┘
```

**原则（D2）：**

- **主视图 = 现有 AgentCard 列表**（tool trace / output / live）——保留并增强。  
- **协作结构条**：`children.length > 0` 时 **默认展开**；仅 supervisor 时 **完全隐藏**（不占位、不「暂无结构」空文案）。  
- 结构数据 **只来自委派关系**（`parentAgentId`），不依赖 WorkflowDef / workflowStore。  
- 可从 `DagEditor` 提炼轻量树/小图组件，但 **无 workflow 产品语义**。  
- 删除独立 DAG 整页与「No workflow active」空态。

### 5.3 数据源统一

| 数据 | 来源 |
|------|------|
| 谁在跑 | `agent:started` / `agent:finished` → message.agentRuns |
| 工具 | `tool:*` → message.toolCalls + timeline |
| 委派边 | `parentAgentId` + `taskInput`（已有） |

**不再**以 `workflowStore` / `WorkflowDef` 作为 Agents 面板主数据源。`workflowStore` 与 `workflow:run` 可随 D1 后续清理，不进本方案 UI。

### 5.4 前端删除/迁移清单

- `PanelToggle`：去 dag  
- `ArtifactPanel`：去 `effectiveTab === 'dag'` 分支  
- `uiStore.ArtifactTab`：类型去 `'dag'`；测试与 i18n `artifact.dagEmpty` 删除  
- `ModelPicker`：去掉 orchMode 双按钮与相关 i18n  
- `serverMessageEffects`：去掉切到 dag；无工作流自动跳转需求  
- Chat 侧 orchMode 展示一并移除  
- 不新增任何 workflow slash / 设置项  

---

## 6. 协议与配置迁移

### 6.1 Deprecate / 下线

```ts
// SessionConfig
orchMode?: 'fast' | 'dag'  // deprecated: ignored by runTurn; keep for old JSON

// ClientMessage
session:setOrchMode  // no-op + log once
// workflow:run       // 产品不使用；handler 可保留兼容或后续删除（D1）

// ServerMessage  
session:orchMode     // 停止广播
// workflow:* 事件   // UI 不再消费；可随清理删除
```

### 6.2 不新增

- 不新增 `run_workflow_template` 工具  
- 不新增 `/workflow` slash  
- 不新增模板选择 UI  

### 6.3 会话加载

- 忽略历史 `config.orchMode`  
- Agents 面板只从 **消息内 agentRuns** 恢复协作结构（D2）

---

## 7. 分阶段实施计划（PR 切分）

### Phase 0 — 止血（不改产品概念，修正确性）**【优先合并】**

> 即使还没拆 orchMode，先保证 dag/cancel 不再害用户。

| 任务 | 说明 |
|------|------|
| 0.1 | `workflow-runner` abort/timeout：**finalize partial**，`stopped=true`，禁止空 `message:complete` |
| 0.2 | 节点/子 agent **空 text 不得 succeeded** |
| 0.3 | 工具别名 `bash→run_script`；worker/coder 工具集对齐 |
| 0.4 | DAG/subagent **继承 session permissionMode** |
| 0.5 | LoopGuard 最小版（重复 tool、.git/objects） |
| 0.6 | event 投影：workflow 轮写入与 fast 同构的 step/tool 或明确类型 |

**验收：** 任意路径 cancel 后历史有 assistant partial；子 agent 空输出不假成功；权限与会话一致；重复无效工具被熔断。

### Phase 1 — 去掉用户模式选择，统一主循环（harness 主路径）

| 任务 | 说明 |
|------|------|
| 1.1 | UI 移除 orchMode 开关；协议 deprecate |
| 1.2 | `resolveWorkflowDefForTurn` / dag 强制分支 **不再进入**产品路径 |
| 1.3 | 默认 **永远** StateGraph supervisor 路径 |
| 1.4 | 强化 supervisor 委派 prompt + 单测（简单任务不调用 task） |
| 1.5 | 默认委派目标改为 `plan`/`explore`/`coder` profile，而非裸 worker |
| 1.6 | （D1）不接线任何 workflow 入口；`workflow:run` UI/文档下线 |

**验收：** 新会话无模式按钮；简单任务单 agent 快速完成；复杂实现任务出现正确 profile 子代理。

### Phase 2 — Agents 面板统一观察面（D2）

| 任务 | 说明 |
|------|------|
| 2.1 | 删除 `dag` tab 与整页 DagEditor 挂载 |
| 2.2 | `AgentDashboard`：`children.length > 0` 时 **展开** parent 树；仅 supervisor **隐藏**结构 |
| 2.3 | 轻量协作结构组件（可从 DagEditor 提炼），高度有限、只读 |
| 2.4 | 去掉 workflow→dag 自动切 tab |
| 2.5 | i18n / 测试 / PanelToggle 更新 |

**验收：** 右侧无 DAG tab；有子代理见结构+卡片；仅 supervisor 不见结构条、无空态占位。

### Phase 3 — Harness 加深（非 xlsx）

| 任务 | 说明 |
|------|------|
| 3.1 | 上下文 / token 瘦身（工具列表分层、系统提示分层） |
| 3.2 | 委派质量：评测集（简单不委派 / 实现类会 coder / plan 只读） |
| 3.3 | 清理死代码路径：`orchMode` 分支、未消费 workflow UI 绑定（按需） |
| 3.4 | 文档：废弃 orch-mode-dag-panel 与「用户选集群」叙事，指向本文 |

**验收：** harness 行为可测、可回归；无新领域解析器 KPI。

---

## 8. 风险与决策

| 风险 | 缓解 |
|------|------|
| 去掉 dag 开关后「多 agent 演示」变弱 | Agents 面板 + 真实 `task`/`dispatch_agent` 委派即演示（D1：不做 workflow 后门） |
| Supervisor 不委派、能力变「单线程」 | Prompt + harness 评测集；soft-nudge 仅作内部策略 |
| 旧客户端仍发 setOrchMode | no-op 兼容 |
| DagEditor 代码浪费 | 提炼为有子代理时的结构条；无 workflow 语义 |
| 与 07-10 closure 设计冲突 | **产品决策变更**：无用户模式、无显式工作流；观察面合并进 Agents |

### 产品点（已拍板，见文首 D1–D3）

1. ~~是否保留显式工作流入口？~~ → **否（D1）**  
2. ~~协作结构展开规则？~~ → **有子代理展开，仅 supervisor 隐藏（D2）**  
3. ~~xlsx 是否优先？~~ → **否；重点 harness（D3）**  

---

## 9. 成功标准（可验证）

1. UI 无 fast/dag；`session` 行为不依赖 orchMode。  
2. 无任何用户/agent 产品入口触发 Durable workflow。  
3. 简单任务：无强制 multi-agent；时延与工具轮次合理。  
4. 复杂任务：正确 profile 委派；Agents 面板 **展开** parent 结构。  
5. 仅 supervisor 轮次：Agents **不显示**协作结构条。  
6. 无独立 DAG tab；相关测试迁移通过。  
7. cancel 有 partial；LoopGuard 阻止 `.git/objects` 类空转；权限继承会话配置。  
8. **不**以 xlsx 解析成功率作为本方案验收项。

---

## 10. 建议落地顺序（一句话）

**Phase 0 止血 harness 正确性 → Phase 1 统一 supervisor 主路径并拆掉模式/工作流入口 → Phase 2 Agents 观察面合并（D2）→ Phase 3 加深 harness 质量与死代码清理。**

每阶段可独立发布；交付物是 **更强的 agent harness**，不是工作流产品或办公解析器。
