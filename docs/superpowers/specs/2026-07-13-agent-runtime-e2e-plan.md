# Agent Runtime Multi-Track — E2E 测试规划

| 字段 | 值 |
|------|-----|
| **日期** | 2026-07-13 |
| **状态** | Implemented（E2E-0…4 + P2 orchMode；2026-07-13） |
| **范围** | 合并进 `dev` 的 execute-plan `b0015841` 多轨改动 + 相关 UI 投影 |
| **前置** | [agent-runtime multi-track design](./2026-07-13-agent-runtime-multi-track-evolution.md)、[e2e coverage audit](./2026-07-13-e2e-business-coverage-audit.md)、[e2e run results](./2026-07-13-e2e-run-results.md) |
| **基建** | WDIO + Tauri debug + DEV `window.__hipE2E`；命令见 [`e2e/README.md`](../../../e2e/README.md) |

---

## 1. 目标与原则

### 1.1 目标

为近期 **核心 Agent 运行时多轨演进** 建立可执行、可 gate 的 E2E 覆盖：

| Track | 产品可见性 | E2E 侧重点 |
|-------|------------|------------|
| **A** Loop Hardening | 中（pause / interrupt / plan 相关 UI） | inject 模拟 doom/replan **投影**；非测 LLM 决策质量 |
| **B** SubAgent Parity | 高（delegation 行、Agents 卡、pause 文案） | 委派 UI + pause marker 投影 + kill 后台通知 |
| **C** DAG Honesty | 中（workflow store、Agents 焦点、DagEditor 若可达） | workflow inject + palette 契约；拒 tool/human 错误投影 |
| **D** Narrative / orchMode | 低–中（文档为主；API 诚实） | 无 orchMode UI；session 仍可发 deprecated 消息不炸 |
| **E** Observability | 低（默认无 WS loop:event） | 不测内部 JSONL；可选 debug bundle 不回归 |

### 1.2 原则（与现有 e2e 策略对齐）

1. **无默认 paid LLM** — 主路径全部用 `injectServerMessage` / `simulate*` / `seed*`。
2. **无主机破坏** — 写盘仅限 `HIP_DATA_DIR` / `e2e/fixtures` / mkdtemp。
3. **测投影不测脑** — 不断言模型是否会调用 `task`；断言 **sidecar 若发出某类消息，UI/store 行为正确**。
4. **分层** — Unit（sidecar Vitest）负责 loop 决策表 / validate / marker；E2E 负责跨进程 UI + store 投影。
5. **Gate 纪律** — 新用例默认带 `@harness` 和/或 `@core`，进入 `yarn test:e2e:gate`；`@live` 仅 opt-in。

### 1.3 非目标

| ID | 非目标 |
|----|--------|
| NG1 | 用 E2E 验证 `decideReplan` 阈值、`doomLoopStrategy` 数值语义（属 sidecar unit） |
| NG2 | 真实 `workflow:run` 跑 typecheck gate / 外部 ACP |
| NG3 | `loop:event` WS（OQ#4 已决：前端暂不消费，E4 backlog） |
| NG4 | B4 subagent escalate 完整 interrupt 状态机（仍 backlog） |
| NG5 | 把 `DagEditor` 做成完整产品编辑器再测 |

---

## 2. 近期改动 → 可观测契约

从 multi-track 设计与合并 diff 抽出 **E2E 能咬住的契约**：

| # | 契约 | 消息 / UI | 现有 E2E | Gap |
|---|------|-----------|----------|-----|
| C1 | 多 agent 委派树投影 | `agent:started` parent/child、`delegation-row`、`agent-card` | `harness-delegation`、`harness-complex`、`harness-agents` | 弱：无 **subagent pause 文案** |
| C2 | 工具行在 ActivityBar 展开后可见 | `tool:started/finished` + expand | complex loop 已修 expand | ok |
| C3 | Permission HITL 模态 | `permission:request` | `harness-permission` | ok |
| C4 | Cancel 保留 partial / Changes | simulate cancel + disk write | cancel / write-to-changes | ok |
| C5 | Workflow store 投影 | `workflow:started/event/snapshot/cleared` | `harness-workflow-projection` | 扩：失败 run、INVALID 错误、parallel 节点状态 |
| C6 | Code 面 workflow 打开 Agents 页 | effect | workflow-projection | ok |
| C7 | Chat 面不强制 panel | effect | workflow-projection 有 chat 断言 | 保持回归 |
| C8 | Subagent pause **非 Error 前缀** | tool 结果文本 / 气泡含 `[hip:subagent_paused]` | **无** | **P0 新 seed** |
| C9 | 后台 task kill 通知 | `agent:notification` status `killed` | **无** | **P1** |
| C10 | Plan 审批卡 | `plan` 相关消息 + `plan-approval-card` | ChatPage getters only | **P1 seed** |
| C11 | agent:interrupt（supervisor） | `agent:interrupt` + resume UI | **无完整流** | **P1** |
| C12 | INVALID_WORKFLOW / tool\|human 拒图 | `error` code `INVALID_WORKFLOW` | **无** | **P1 inject** |
| C13 | 无 orchMode UI | ModelPicker 无开关 | unit/ModelPicker.test | E2E 可选 smoke 断言 |
| C14 | DagEditor palette 无 tool/human | 组件 export + 若 UI 挂载 | unit `DagEditor.test` | E2E：**仅当**设置/调试入口可达；否则 unit 足够 |
| C15 | Debug bundle 不因新轨迹字段崩溃 | copy-debug | `harness-copy-debug` | 扩：含 subagent trajectory 的 bundle |

**分层提醒：**

- A-core replan / doom 决策表 → **sidecar `graph.test.ts`**（已有 66+ 测）不重复 E2E。
- C-validate run-path reject → **sidecar workflow-runner/executor unit** + E2E 只测 **error 消息投影**。
- agentLoop TOML / Rust round-trip → **unit + cargo**；E2E 不测写 hip.toml。

---

## 3. 现状盘点（2026-07-13）

### 3.1 命令与标签

| 命令 | 用途 |
|------|------|
| `yarn test:e2e:gate` | `@smoke\|@core\|@harness` — 合并前门槛 |
| `yarn test:e2e` | 全量未付费（`@live` 自跳） |
| `yarn test:e2e:live` | 可选真实模型 |

上次 gate：**26 passed / 0 failed**（见 e2e-run-results 修复后）。

### 3.2 已覆盖（与 runtime 相关）

| Spec | 标签 | 覆盖点 |
|------|------|--------|
| `harness-cancel.spec.ts` | harness smoke | 运行中 turn + Stop |
| `harness-cancel-keeps-diff.spec.ts` | harness core | cancel 保留 Changes |
| `harness-permission.spec.ts` | harness smoke | HITL 模态 |
| `harness-copy-debug.spec.ts` | harness smoke | 错误 + debug 导出 |
| `harness-agents.spec.ts` | harness panel | 协作 Agents 面板 |
| `harness-delegation.spec.ts` | harness panel | delegation-row + jump-to-turn |
| `harness-complex-agent-loop.spec.ts` | harness core | 多步链：tool → collab → perm → cancel |
| `harness-workflow-projection.spec.ts` | harness core | workflow inject + store + Agents 焦点 |
| `write-to-changes.spec.ts` | core harness | 写文件 → Changes |

### 3.3 缺口相对 multi-track

| Gap ID | 描述 | 优先级 |
|--------|------|--------|
| G1 | Subagent **pause marker** 投影（tool 结果 / 气泡 / 非 Error） | P0 |
| G2 | Workflow **failed / cancelled** run + 多节点状态 | P0 |
| G3 | `error` + `INVALID_WORKFLOW` 错误条可见 | P1 |
| G4 | `agent:interrupt` + resume 输入路径 | P1 |
| G5 | Plan approval card inject | P1 |
| G6 | Background **killed** 通知（Agents / activity） | P1 |
| G7 | 父–子 agentFrame 在 permission 请求上的展示（若 UI 已支持） | P2 |
| G8 | orchMode deprecated 消息不破坏会话 | P2 |
| G9 | `@live` 委派 smoke（可选，非 gate） | P3 |

---

## 4. 目标架构：Harness 扩展

### 4.1 新增 / 扩展 `__hipE2E` API（DEV only）

在 `sessionService.ts` + `e2e/helpers/e2e-hooks.ts` 增加：

```ts
// 建议签名（实现时对齐协议真实字段）
seedSubagentPause(sessionId: string): {
  turnId: string
  callId: string
  marker: '[hip:subagent_paused]'
}

seedAgentInterrupt(sessionId: string, question?: string): {
  turnId: string
  question: string
}

seedPlanApproval(sessionId: string): {
  turnId: string
  planItems: { content: string; status: string }[]
}

seedBackgroundTaskKilled(sessionId: string): {
  turnId: string
  agentId: string
  taskId: string
}

/** Optional: inject INVALID_WORKFLOW error as if sidecar rejected def */
simulateInvalidWorkflowError(sessionId: string, reason?: string): void
```

实现约束：

- 只走现有 `injectServerMessage` 管道（与真实 WS 同 effects）。
- `seedSubagentPause` 至少注入：
  1. `agent:started` supervisor + subagent（`parentAgentId`）
  2. `tool:started` name=`task`（或 `dispatch_agent`）
  3. `tool:finished` output 首行 `[hip:subagent_paused] …`
  4. 可选 `message:complete` / partial assistant 文本
- **禁止** 使用 `Error: sub-agent paused:` 前缀（回归 Issue 16 契约）。

### 4.2 可选只读探针

| 探针 | 用途 |
|------|------|
| `getWorkflowSession` | **已有** — 保持 |
| `getLastAssistantText(sessionId)` | 断言 pause marker 出现在可见文本 |
| `getPendingInterrupt(sessionId)` | interrupt 态 |

先实现 seed；探针可后续加，断言优先用 DOM `data-testid`。

---

## 5. 新增 / 扩展 Spec 清单

### 5.1 P0 — Gate 必进（`@harness` `@core`）

#### Spec A — `e2e/specs/harness-subagent-pause.spec.ts`（新）

| Case | 步骤 | 期望 |
|------|------|------|
| A1 pause marker 可见 | `seedSubagentPause` | ActivityBar 展开后 tool-row / 消息文本含 `[hip:subagent_paused]`；**不含** `Error: sub-agent paused` |
| A2 委派结构 | 同上 | `agent-card` ≥ 2；delegation-row 任务描述可见 |
| A3 非成功误导 | 同上 | UI 不展示「任务成功」类假成功（若有 success badge，pause 工具应为 error/neutral） |

**标签：** `@harness @core`  
**预估：** 1 文件 / 2–3 it / ~45s

#### Spec B — 扩展 `harness-workflow-projection.spec.ts`

| Case | 步骤 | 期望 |
|------|------|------|
| B1 多节点失败 | inject started + n1 success + n2 failed + run finished failed | `runStatus === 'failed'`；`nodeStatuses.n2 === 'failed'` |
| B2 cancelled | inject run:cancelled | store `cancelled` |
| B3 stale runId 忽略 | 错误 runId 的 event | 当前 run 状态不变（对齐 workflowStore 测试） |
| B4 chat 面 | chat session + workflow:started | store 有数据；**不**强制 `panel-view-agents`（已有则 harden） |

**标签：** 保持 `@harness @core`

#### Spec C — 扩展 `harness-complex-agent-loop.spec.ts`（可选 harden）

| Case | 说明 |
|------|------|
| C1 | 在现有链末尾增加 **subagent pause seed** 一步（或拆独立 A），避免 suite 过长 flake |

建议 **拆 A 独立文件**，complex 保持现有长度。

### 5.2 P1 — Gate 建议进（`@harness`，可 `@core`）

#### Spec D — `e2e/specs/harness-agent-interrupt.spec.ts`（新）

| Case | 步骤 | 期望 |
|------|------|------|
| D1 interrupt UI | `seedAgentInterrupt` | 出现 interrupt / 提问 UI（对齐 `agent:interrupt` 产品组件 testid） |
| D2 resume | 用户输入或 `message:resume` inject | turn 继续或 stopped 清除 |

若产品 DOM testid 缺失：**先补 testid** 再写 E2E（列入 bridge PR）。

#### Spec E — `e2e/specs/harness-plan-approval.spec.ts`（新）

| Case | 步骤 | 期望 |
|------|------|------|
| E1 卡片出现 | `seedPlanApproval` | `[data-testid="plan-approval-card"]` |
| E2 approve 点击 | click `plan-approve` | 发出客户端消息或 store 状态变化（可用 inject 模拟完成） |

ChatPage 已有 getters。

#### Spec F — `e2e/specs/harness-invalid-workflow.spec.ts`（新）

| Case | 步骤 | 期望 |
|------|------|------|
| F1 error 条 | `simulateInvalidWorkflowError` | 错误 UI 含 `INVALID_WORKFLOW` 或可读 reason |
| F2 store 干净 | 之后 `getWorkflowSession` | 无脏 running 节点（或 cleared） |

#### Spec G — `e2e/specs/harness-background-killed.spec.ts`（新）

| Case | 步骤 | 期望 |
|------|------|------|
| G1 killed 通知 | `seedBackgroundTaskKilled` | Agents/activity 显示 killed 或等价文案 |

### 5.3 P2 — Optional / nightly

| Spec | 内容 |
|------|------|
| `harness-orchmode-compat.spec.ts` | inject `session:orchMode` + `ignoredForTurnRouting`；会话仍可用 |
| Settings smoke 扩展 | 打开 Agents 设置页不崩溃（无 orchMode 开关） |
| `harness-debug-bundle-subagent.spec.ts` | 有 subagent 轨迹时 copy-debug 仍可复制 |

### 5.4 P3 — `@live`（非 gate）

| Spec | 前置 | 内容 |
|------|------|------|
| `live-delegation-smoke.spec.ts` | `E2E_LIVE_LLM=1` + auth | 简单「用 task 列目录」类 prompt；软断言有 tool/agent 活动（允许 flake 标记） |

**不**把 live 委派放进 gate。

---

## 6. 与 Unit / Integration 的分工

```
┌─────────────────────────────────────────────────────────────┐
│ E2E (WDIO / Tauri)                                          │
│  UI 投影 · store 投影 · 跨表面 · testid 交互                 │
└───────────────────────────▲─────────────────────────────────┘
                            │ inject / simulate only
┌───────────────────────────┴─────────────────────────────────┐
│ Sidecar Vitest (已有 / 继续加强)                              │
│  decideReplan 决策表 · doom 策略 · pause marker · validate    │
│  run path INVALID_WORKFLOW · background getOutput/kill        │
└─────────────────────────────────────────────────────────────┘
┌─────────────────────────────────────────────────────────────┐
│ Frontend Vitest                                               │
│  workflowStore · serverMessageEffects · DagEditor palette     │
│  ModelPicker no orchMode · sessionService inject 契约         │
└─────────────────────────────────────────────────────────────┘
```

E2E **不重复** graph 决策表；**必须**覆盖「消息到达前端后」的用户可见结果。

---

## 7. 实施 PR 切片（可并行）

| PR | 内容 | 依赖 | 进 gate? |
|----|------|------|----------|
| **E2E-0** | Bridge：`seedSubagentPause` + hooks 类型 + unit on sessionService | 无 | 否（测桥） |
| **E2E-1** | `harness-subagent-pause.spec.ts` | E2E-0 | **是** |
| **E2E-2** | 扩展 `harness-workflow-projection`（failed/cancel/stale） | 无 | **是** |
| **E2E-3** | Bridge interrupt/plan + specs D/E | 可能需 testid | **是** |
| **E2E-4** | INVALID_WORKFLOW + background killed | E2E-0 风格 | **是** |
| **E2E-5** | P2 orchMode / debug bundle | 无 | 可选 |
| **E2E-6** | 文档：更新 e2e README + coverage audit 矩阵 | E2E-1..4 | — |

建议 merge 顺序：`E2E-0 → (E2E-1 ∥ E2E-2) → E2E-3 → E2E-4 → E2E-6`。

---

## 8. 验收标准

### 8.1 每条新 harness 用例

- [ ] 不依赖 `E2E_LIVE_LLM`
- [ ] 不写用户 home；仅 fixture / temp
- [ ] `before`：`waitForAppReady` + `skipLoginIfPresent` + `waitForHipE2E`
- [ ] 断言优先 `data-testid`；避免脆弱 CSS 全文匹配（marker 字符串除外）
- [ ] 失败时 WDIO 截图路径可用
- [ ] `describe` 标题含 `@harness`（及 gate 需要的 `@core`/`@smoke`）

### 8.2 Gate 回归

```bash
# 本地合并前
yarn test:e2e:gate
# 期望：0 failed；新 P0 用例计入 passed
```

全量：

```bash
yarn test:e2e   # @live 自跳
```

### 8.3 契约冻结（防回归）

| 冻结项 | 断言位置 |
|--------|----------|
| Pause marker 常量 | E2E 字符串 `\[hip:subagent_paused\]` 与 `subagent-result.ts` 一致 |
| 禁止 `Error: sub-agent paused` | Spec A |
| workflow:getActive 不再发送 | 已有 unit；E2E 不强制 |
| loop:event 无 UI | 无 E2E 依赖该消息 |

---

## 9. 风险与缓解

| 风险 | Sev | 缓解 |
|------|-----|------|
| Interrupt / plan DOM 无稳定 testid | Med | E2E-3 先加 testid 再测 |
| Complex suite 过长 flake | Med | pause 独立文件；gate 控制超时 |
| Background kill UI 未暴露 | Med | 先测 inject 后 store/agents 列表；无 UI 则降为 unit |
| 协议字段漂移 | Low | seed 与 `@hip/protocol` 类型共用字面量 |
| Gate 时间膨胀 | Low | P2 不进 gate；live 永不进 gate |

---

## 10. 建议用例矩阵（一页纸）

| ID | 场景 | 机制 | 标签 | Pri |
|----|------|------|------|-----|
| A1 | Subagent pause marker 可见 | seedSubagentPause | harness core | P0 |
| A2 | 委派树 + parentAgentId | 同上 | harness core | P0 |
| B1 | Workflow failed 多节点 | inject events | harness core | P0 |
| B2 | Workflow cancelled | inject | harness core | P0 |
| B3 | Stale runId 忽略 | inject | harness core | P0 |
| D1 | agent:interrupt UI | seedAgentInterrupt | harness core | P1 |
| E1 | Plan approval card | seedPlanApproval | harness core | P1 |
| F1 | INVALID_WORKFLOW 错误条 | simulateInvalidWorkflow | harness core | P1 |
| G1 | Background killed | seedBackgroundTaskKilled | harness panel | P1 |
| H1 | orchMode 消息兼容 | inject session:orchMode | harness | P2 |
| L1 | Live 委派 soft smoke | real LLM | live | P3 |

**已有保持回归：** cancel、permission、delegation jump、complex loop、workflow started、write-to-changes、copy-debug。

---

## 11. 执行清单（给实施者）

1. **盘点 testid**  
   - `rg data-testid.*interrupt|plan-approval|agent-notification` in `src/`  
   - 缺失则在 E2E-3 补。

2. **实现 E2E-0 seeds** + `sessionService.test.ts` 契约测。

3. **写 Spec A + 扩 Spec B** → 跑  
   `yarn test:e2e --spec e2e/specs/harness-subagent-pause.spec.ts`  
   `yarn test:e2e --spec e2e/specs/harness-workflow-projection.spec.ts`

4. **跑 gate** 确认 0 failed。

5. **P1 specs** 按 testid 就绪度推进。

6. **更新**  
   - `e2e/README.md` harness 列表  
   - `2026-07-13-e2e-business-coverage-audit.md` 矩阵行  
   - 可选：本文件 Status → Implemented

---

## 12. 与 multi-track Backlog 的关系

| Backlog 项 | E2E 态度 |
|------------|----------|
| B4 escalate | **不测**完整 escalate；仅测今日 `inline_partial` + marker |
| E4 loop:event WS | **不测** |
| C-shrink hard-delete types | validate/unit；E2E 用 INVALID_WORKFLOW 即可 |
| CB-remove | unit only |

---

## 13. Key Decisions（本规划）

| # | 决策 | 理由 |
|---|------|------|
| K1 | E2E 只测消息投影，不测 LLM 是否委派 | 稳定、无 paid、与现有 harness 一致 |
| K2 | Pause marker 独立 spec，不塞进 complex | 降 flake、清晰回归点 |
| K3 | Workflow 失败/取消扩现有文件 | 复用 getWorkflowSession |
| K4 | DagEditor palette 以 unit 为主 | 产品壳未主路径暴露 |
| K5 | Live 委派永不进 gate | 成本与 flake |
| K6 | Bridge seeds 集中在 sessionService + e2e-hooks | 单一 chokepoint，便于契约测 |

---

## 14. Open Questions

1. **Interrupt / plan 的 DOM testid 是否已齐？** → 实施 E2E-3 前 15 分钟 inventory。  
2. **Background killed 是否有稳定 UI？** 若无，G1 降级为「inject 后 debug bundle / store 字段」或仅 unit。  
3. **是否把 P1 全部纳入 gate？** 建议是；若 gate 超时，仅 A+B 强制，D–G 标 `@harness` 进 nightly。

---

## 15. References

- Design: `docs/superpowers/specs/2026-07-13-agent-runtime-multi-track-evolution.md`
- Audit: `docs/superpowers/specs/2026-07-13-e2e-business-coverage-audit.md`
- Results: `docs/superpowers/specs/2026-07-13-e2e-run-results.md`
- Harness: `e2e/helpers/e2e-hooks.ts`, `src/domain/sessionService.ts` (`__hipE2E`)
- Existing specs: `e2e/specs/harness-*.spec.ts`
