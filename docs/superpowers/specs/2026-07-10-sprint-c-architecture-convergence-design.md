# Sprint C — 架构收敛（持久化 · 命名 · 死路径）

| 字段 | 值 |
|------|-----|
| 日期 | 2026-07-10 |
| 状态 | **主干已落地**（真删会话、数据模型文档、orchMode/workflow 产品路径收敛、命名注释；C5 i18n 死键扫尾 → [`pre-public-polish-index`](./2026-07-10-pre-public-polish-index.md) P3） |
| 路线图 | [`2026-07-10-pre-public-roadmap-index.md`](./2026-07-10-pre-public-roadmap-index.md) |
| 前置 | 主路径 harness 与 Code 体验稳定；有回归集再做破坏性删除 |
| 相关 | `schema.ts`、`event-store`、`session_message`、`orchMode` 协议、`workflowStore`、fixed agents / `agent-profile` |

---

## 1. 问题陈述

A/B 让产品能用。C 降低 **公开后改不动** 的债务：

1. **多套持久化**（`messages` / `session_message` / `event`）读路径不清，删除语义不一致  
2. **多套命名**（UI Fixed Agents vs profile id vs DAG 节点 id vs worker）  
3. **死产品路径**仍占协议与测试（`orchMode`、`workflow:run` UI 残留、builtin cluster 默认）  
4. 不收敛会再次出现「用户模式开关」类功能漂移  

C **偏工程**，用户几乎无新功能；价值是可维护性与正确删除。

---

## 2. Goals / Non-Goals

### Goals

| ID | 目标 |
|----|------|
| C1 | **读路径白皮书 + 代码对齐**：UI 恢复会话只依赖一条权威投影；event 仅恢复/审计 |
| C2 | **删除语义明确**：用户删会话 = 哪些表清掉；文档与实现一致 |
| C3 | **命名统一表**：Fixed Agents `coder|explore|plan` ↔ `BUILTIN_PROFILES`；弃用默认 `worker` 委派 |
| C4 | **协议 deprecate**：`orchMode` / `session:setOrchMode` / 产品侧 `workflow:*` 标记废弃；无 UI 消费 |
| C5 | **死代码清理清单**：可删则删，不可删则 `// deprecated` + 测试迁走 |
| C6 | **DB 增长说明**：tool-output 外置策略、可选 vacuum/运维笔记（README 或 docs） |

### Non-Goals

- N1 换掉 LangGraph  
- N2 新功能（记忆/RAG/云）  
- N3 大爆炸迁移用户数据格式（若需 migration，必须可逆、分版本）  
- N4 删除 DurableExecutor 源码（可保留库内；仅断产品入口）— 若删，需单独 ADR  

---

## 3. 设计

### 3.1 持久化读路径（C1）

**目标架构（逻辑）：**

```
写入（turn 进行中）:
  event append (可选高保真)
  trajectory → finalize → messages + agent_runs + tool_calls

读取（session:load / UI）:
  权威：messages (+ runs/tools 关联)
  event：仅 crash rebuild / 高级调试（不进默认 UI）

session_message:
  若与 messages 重复 → 标记 legacy；新写入停写或双写一期后停
```

**实现步骤建议：**

1. 写 `docs/` 短文：表职责矩阵（sessions, messages, agent_runs, tool_calls, event, session_message, workflow_*）  
2. 代码审计 `session:loaded` / store.listMessages  
3. 若 `session_message` 仍被 projector 使用：画依赖图再决定停写时间表  

**验收：** 文档 + 至少一处注释/测试锁定「load 不读 event 重建整会话」（除非 flag）。

### 3.2 删除语义（C2）

| 用户操作 | 目标行为 |
|----------|----------|
| 删除单个会话 | 删 `sessions` 行并 **级联** messages/runs/tools/checkpoints；**同步删** 该 aggregate 的 event / session_message / workflow_runs（若有） |
| 清空全部 | 同上批量 |

**与现状差异：** 设计注释曾写 event 无 FK、删会话后 event 残留。C 要 **产品选择**：

- **选项 P（推荐公开前）：** 删会话 = 尽量真删（隐私）  
- **选项 A：** 残留 event 作审计（需设置页说明）  

**拍板默认：P（真删）。** 实现：`DELETE` 时显式清理 event by aggregate_id。

### 3.3 命名统一（C3）

| 层 | 规范 id |
|----|---------|
| UI Fixed Agents | `coder`, `explore`, `plan` |
| BUILTIN_PROFILES | 同上 + `supervisor`；`worker` 标 legacy |
| dispatch_agent / task | 文档与 prompt 只推荐上表；`worker` 兼容一版 |
| AgentRole 协议 | 若缺 explore/plan，评估扩展或映射到 worker+标签 |

**验收：** 设置页三个固定 agent 与 sidecar profile id 字符串相等的单测；委派默认不再创建 `worker` profile（除非显式）。

### 3.4 协议与死路径（C4/C5）

| 符号 | 动作 |
|------|------|
| `SessionConfig.orchMode` | 保留字段读兼容；`normalizeSessionConfig` 可强制忽略对 runTurn 的影响（已忽略） |
| `session:setOrchMode` | handler no-op + debug log；或仍写 config 但不影响执行 |
| `workflow:run` / UI workflowStore | 无产品入口；前端可停止 `workflow:getActive` on load（若仅服务已删 DAG） |
| `buildClusterDefaultWorkflow` | 保留给测试；加注释「非产品默认」 |
| `ArtifactTab 'dag'` | 应已删；C 扫残留 i18n `orchMode` 文案可删或标 unused |
| ModelPicker orch 测试 | 应已删 |

**清理 PR 策略：** 先「停写/停读」再「删代码」，每步可回滚。

### 3.5 DB / 运维（C6）

- README：`~/.hip/db/hip.db` 用途；工具大输出在 `~/.hip/data/tool-output`  
- 可选：设置里显示 db 体积（非必须）  
- 开发：`sqlite3` vacuum 说明  

---

## 4. 任务拆分

| # | 任务 | 风险 |
|---|------|------|
| C.1 | 表职责文档 | 低 |
| C.2 | session:load 读路径审计 + 测试锁定 | 中 |
| C.3 | 删会话级联 event | 中（测删除） |
| C.4 | profile 命名统一 + worker legacy | 中 |
| C.5 | orchMode/workflow 前端残留清理 | 低 |
| C.6 | setOrchMode no-op 行为 | 低 |
| C.7 | README 数据目录说明 | 低 |

---

## 5. 成功标准（Sprint C Done）

1. 新人读一篇文档能说清「会话数据存在哪、删了会怎样」  
2. 删会话后 DB 中无该 session 的 event 残留（选项 P）  
3. Fixed agent id 与 profile id 一致的自动测试  
4. 产品路径无 orchMode 行为；协议仅兼容  
5. A/B 回归集仍全绿  

---

## 6. 风险

| 风险 | 缓解 |
|------|------|
| 删 event 破坏未完成的 rebuild 功能 | 先 grep rebuild 调用链；flag 开关 |
| session_message 停写导致旧功能挂 | 依赖图 + 分两 PR |
| 范围蔓延成持久化重写 | 严格 Non-Goals；超出另开 ADR |

---

## 7. 与公开的关系

- **可不阻塞公开 Beta**：若 A/B 已稳，C 可在 Beta 并行  
- **应阻塞「宣传为生产级」的**：删除隐私语义（C2）、读路径混乱导致丢会话  

建议：公开 Beta 前至少完成 **C.1 文档 + C.3 真删（或明确隐私说明）**；其余可 Beta 后迭代。
