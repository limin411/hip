# 多智能体编排地基 — 设计 (Agent Orchestration Foundation)

> Date: 2026-06-15 · Status: 设计已通过,待写实现计划 (writing-plans)
> Branch: `feat/agent-orchestration-foundation`(叠在 `feat/opencode-acp-integration` 之上,依赖其 `AgentProvider`/`registry`/`'acp'` 接缝)

## 目标 (Goal)

为「将来接入非常多智能体、在本系统里构建工作流与自动化、让它们组网协作」打地基。本轮**只**交付纯逻辑的编排内核 + 接缝,**不**接真实 agent、不做 UI、不端到端。

## 背景与定位

- hip 现状:Tauri 壳 + Node sidecar(SQLite/Session/WS 总线)+ React 前端。外部 agent 经 `AgentProvider` 接缝(`runTurn(text, emit, signal, hooks?)`)接入;OpenCode 走 ACP(`AcpAgentProvider` + 常驻 `AcpConnectionManager`)。
- 现有的"多 agent"(`session/subagent.ts` 的 `runSubagent`)是**同一个内置 LLM loop 的 depth-1 子任务**,在单个 agent 内部,**不是**异构 agent 组网。本设计在 `AgentProvider` 接缝**之上**新建一层:每个外部 agent 的一整个回合 = 编排图里的一个节点;hip 中枢按 DAG 串联节点、在节点间中转产物。

## 已锁定决策 (Locked Decisions)

| 维度 | 选择 |
|---|---|
| 编排模型 | **中枢编排(hip 为中心)**:hip 持有所有连接、分发任务、在节点间中转;agent 间不直连。 |
| 工作流 | **确定性图引擎(DAG)**:顺序 / 并行 / 条件 / 扇出 / join;代码或配置定义。 |
| Agent 形态 | **本地 CLI 为主(ACP)**:传输地基只服务 ACP;不为 A2A/远程预先抽象,但接缝不堵死。 |
| 范围 | **纯抽象层 + 接缝**:接口 / 数据模型 / 引擎逻辑 + 单元测试;不接真实 agent、不做 UI、不端到端。 |
| 落地方案 | **方案 A — 自建纯内核 + 端口**:不依赖外部库的纯逻辑;三个端口只出 Fake/InMemory 实现。(否决了 B=LangGraph 基座、C=只出接口。) |

「纯抽象层 + 接缝」的正确读法:把最容易设计错的那块——调度 / 状态机——用 **Fake agent** 跑通 + 测透(纯函数、零付费调用),而真实 agent / 持久化 / UI 全部留待后续切片。抽象只有被引擎自己用过,才知道对不对。

## 非目标 (Non-Goals,留待后续切片)

- 真实 `AgentRunner`(包 `AgentProvider`/Session/`AcpConnectionManager`)。
- SQLite `WorkflowStore` + 迁移;WS `EventSink` + 编排 ServerMessage/ClientMessage。
- 任何 UI(工作流编排器 / 可视化 / 运行监视)。
- 非 agent 节点(transform / 纯条件节点 / LLM-supervisor 动态调度)。
- A2A / 远程 runner;自动化触发(手动 / 定时 / 事件)。
- 每节点 reasoning / tool 细粒度透传(端口留了位,地基只输出粗粒度 `NodeOutput`)。

## 架构分层

```
① WorkflowDef (DAG)         ← 节点=一个 agent 回合,边=依赖/条件,支持扇出/并行/join
        │
② 纯编排内核 (本次构建·已测)   ← 注册表+能力 / 校验器 / Reducer·调度器 / 执行器
        │   (只对着端口跑)
③ 端口 / 接缝 (本次构建·Fake)  ← AgentRunner / WorkflowStore / EventSink
        ┆   (虚线 = 后续切片)
④ 真实实现 (留待后续)         ← AgentProvider·Session / SQLite / WS总线→UI → opencode acp
```

- 共享类型放 `@hip/protocol`(前端日后编排/可视化要用);引擎放 `packages/sidecar/src/orchestrator/`(中枢=sidecar)。沿用既有「protocol=共享类型,sidecar=逻辑」分层。

## 数据模型 (`@hip/protocol`)

```ts
// ---- 身份 + 能力 ----
export type AgentId = string
export interface AgentCapabilities {
  streamsReasoning: boolean
  toolCalls: boolean
  hitl: boolean        // 支持交互式权限往返(ExternalAgentHooks.requestPermission)
  modelSwitch: boolean // 支持 setConfigOption 实时换模型
}
export interface AgentDescriptor {
  id: AgentId
  name: string
  kind: AgentConfig['kind']          // 'custom' | 'acp' | 'opencode'
  capabilities: AgentCapabilities
}

// ---- 工作流定义(DAG)----
export type NodeId = string
export interface AgentNode {
  id: NodeId
  type: 'agent'
  agentId: AgentId
  inputTemplate: string              // 含 {{nodeId}} / {{input}} 占位,引用上游产物或运行输入
}
export type WorkflowNode = AgentNode // 节点 union 留开口,本轮仅 'agent'
export interface EdgeCondition { kind: 'always' | 'contains' | 'equals'; value?: string }
export interface WorkflowEdge { from: NodeId; to: NodeId; when?: EdgeCondition } // when 省略 = always
export interface WorkflowDef {
  id: string
  name: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
  entry: NodeId[]                    // 无入边的起始节点(显式声明)
}

// ---- 运行态(执行)----
export type NodeStatus = 'pending' | 'ready' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled'
export interface NodeOutput { text: string; data?: unknown }
export interface NodeRunState { status: NodeStatus; output?: NodeOutput; error?: string }
export type RunStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export interface RunState {
  runId: string
  workflowId: string
  status: RunStatus
  nodes: Record<NodeId, NodeRunState>
}

// ---- 编排事件(驱动 reducer;日后驱动 WS 总线)----
export type OrchestratorEvent =
  | { type: 'run:started' }
  | { type: 'node:started'; nodeId: NodeId }
  | { type: 'node:succeeded'; nodeId: NodeId; output: NodeOutput }
  | { type: 'node:failed'; nodeId: NodeId; error: string }
  | { type: 'node:skipped'; nodeId: NodeId }
  | { type: 'run:cancelled' }
  | { type: 'run:finished'; status: RunStatus }
```

## 引擎 (`packages/sidecar/src/orchestrator/`)

### `registry.ts` — 注册表 + 能力
- `capabilitiesFor(kind: AgentConfig['kind']): AgentCapabilities`
  - `custom`(内置 LLM loop): `{ streamsReasoning:true, toolCalls:true, hitl:false, modelSwitch:false }`
  - `acp` / `opencode`: `{ streamsReasoning:true, toolCalls:true, hitl:true, modelSwitch:true }`
  - 注:本轮按 `kind` 粗粒度定;日后可按 `transport`/`quirks` 细化。
- `buildRegistry(configs: AgentConfig[]): AgentRegistry`,其中 `AgentRegistry = { get(id): AgentDescriptor | undefined; has(id): boolean; all(): AgentDescriptor[]; withCapability(pred: (c: AgentCapabilities) => boolean): AgentDescriptor[] }`。纯映射,数据源是现有 `readAgentsConfig()`。

### `validate.ts` — 校验器(纯,TDD 重点)
- `validateWorkflow(def: WorkflowDef, registry: AgentRegistry): ValidationError[]`,空数组 = 通过。规则:
  1. 无环:对 `edges` 做 DFS,发现回边即报 `cycle`。
  2. 引用解析:每个 `node.agentId` 能在 `registry` 找到,否则 `unknown-agent`。
  3. 边端点:每条边的 `from`/`to` 都是已声明节点,否则 `dangling-edge`。
  4. 入口合法:`entry` 非空、均为已声明节点、且无入边;非 `entry` 节点必须可从某 `entry` 经边到达(否则 `unreachable`)。
  5. 模板引用:`inputTemplate` 的 `{{x}}` 中,`x` 要么是 `input`(或 `input.*`),要么是该节点的**上游**节点 id(经边可达且在其之前),否则 `bad-template-ref`。
- `ValidationError = { code: 'cycle'|'unknown-agent'|'dangling-edge'|'unreachable'|'bad-template-ref'; detail: string }`。

### `reduce.ts` — 运行态 reducer + 调度器(纯,TDD 重点)
- `initRunState(def, runId): RunState` — 所有节点 `pending`;`entry` 节点置 `ready`;run `running`。
- `reduce(state, def, event): RunState` — 纯状态转移。各事件:`run:started`→run `running`;`node:started`→该节点 `running`;`node:succeeded`→该节点 `succeeded`+`output`,随后按「边的取舍 / join 语义」把新满足的下游置 `ready`、把全 dead 入边的下游置 `skipped`;`node:failed`→该节点 `failed`+`error`、run `failed`(fail-fast);`node:skipped`→该节点 `skipped`(并向下游传播);`run:cancelled`→run `cancelled`、`running` 节点置 `cancelled`;`run:finished`→run 置事件携带的终态。
- `resolveInput(node, state, runInputs): NodeOutput` — 用上游 `output.text` 与 `runInputs` 渲染 `inputTemplate`。
- `readyNodes(state, def): NodeId[]` — 见下「join 语义」。
- **边的取舍**:边 `e` 为
  - *active*:`e.from` 为 `succeeded` 且 `e.when` 对 `from.output` 成立;
  - *dead*:`e.from` 处于终态(`succeeded` 但条件不成立,或 `failed`/`skipped`/`cancelled`);
  - 否则 *unresolved*。
- **join 语义(v1)**:非入口节点 `n`
  - 当其**所有**入边已 resolved 且 **≥1 条 active** → `ready`;
  - 当其所有入边已 resolved 且 **0 条 active** → `skipped`;
  - 否则保持 `pending`。
  - 入口节点(无入边)init 即 `ready`。
- **失败策略(v1)**:`node:failed` → run 立即 `failed`(fail-fast);执行器停止派发;未完成节点保持现状(后续切片再做 continue-on-error)。
- **取消**:`run:cancelled` → run `cancelled`;`running` 节点交由执行器经 signal 中止。

### `executor.ts` — 执行器(只碰端口)
- `runWorkflow(def, ports, opts: { runId: string; runInputs?: NodeOutput; signal: AbortSignal }): Promise<RunState>`
- 循环:`emit(run:started)` → while 非终态:
  1. `nodes = readyNodes(state, def)`,对每个未在飞的 ready 节点:`emit(node:started)`、`reduce`、并发 `ports.agentRunner.run({runId, nodeId, agentId, input: resolveInput(...)}, signal)`;
  2. 任一结算:成功 `emit(node:succeeded, output)`;抛错 `emit(node:failed, error)`;`reduce` 后重算 ready;
  3. signal 触发:`emit(run:cancelled)`,停止派发,等在飞结算;
  4. 无 ready 且无在飞:`emit(run:finished, 终态)` 收尾(全 succeeded/skipped→`succeeded`;有 failed→`failed`)。
- 每个 `emit` 同时喂给 `ports.eventSink.emit(e)`(供日后 WS 透传)。
- **只依赖端口**,无真实 I/O;用 `FakeAgentRunner` 测透(并行扇出、条件跳过、join、失败传播、取消)。

### `ports.ts` — 端口(接缝)+ Fake 实现
```ts
export interface AgentRunner {
  run(req: { runId: string; nodeId: NodeId; agentId: AgentId; input: NodeOutput }, signal: AbortSignal): Promise<NodeOutput>
}
export interface WorkflowStore {
  saveDef(def: WorkflowDef): Promise<void>;  loadDef(id: string): Promise<WorkflowDef | null>
  saveRun(run: RunState): Promise<void>;      loadRun(runId: string): Promise<RunState | null>
}
export interface OrchestratorEventSink { emit(e: OrchestratorEvent): void }
```
- 本轮实现:`FakeAgentRunner`(按 `agentId`/`nodeId` 脚本化产物、可注入延迟与抛错、尊重 signal)、`InMemoryWorkflowStore`、`CollectingEventSink`(把事件存数组供断言)。真实实现(图中④)全部留待后续切片。

> 真实 `AgentRunner`(后续)桥接:`NodeRunRequest` → 解析 `AgentConfig` → `createAgentProvider()` → `runTurn(input.text, emit, signal)` → 把 emit 的 token 汇成 `NodeOutput.text`。地基只定义端口 + Fake。

## 文件结构

```
packages/protocol/src/index.ts        ← 追加上述类型(AgentId/AgentCapabilities/AgentDescriptor/WorkflowDef/RunState/OrchestratorEvent/...)
packages/sidecar/src/orchestrator/
  registry.ts        registry.test.ts
  validate.ts        validate.test.ts
  reduce.ts          reduce.test.ts
  executor.ts        executor.test.ts
  ports.ts           (Fake/InMemory/Collecting + 类型)
  index.ts           (barrel)
```

## 测试策略

- 全纯函数 + `FakeAgentRunner`;**无真实 agent、无 LLM、无网络** → 天然付费-free。
- Vitest 从**仓库根**用**显式文件路径**跑(如 `yarn vitest run packages/sidecar/src/orchestrator/reduce.test.ts`);**绝不** `vitest run src`(会命中付费真 LLM 套件)。
- 类型检查:`yarn workspace @hip/sidecar exec tsc --noEmit` + 根 `yarn type-check`(`@hip/protocol` 随之被传递校验,无独立 build)。
- TDD 重点覆盖:校验器五类错误;reducer 的边取舍 / join(扇出、条件分支、合流)/ 失败 fail-fast / 取消;执行器的并发派发与终态收敛。

## 开放问题 / 后续切片

1. 真实 `AgentRunner` 切片:把 `AgentProvider`/Session/`AcpConnectionManager` 接进端口,跑通首个端到端「A 产出→B 接力」。
2. 持久化:SQLite `WorkflowStore` + 迁移;运行可重启恢复。
3. 透传与 UI:编排 ServerMessage/ClientMessage + 运行监视 / 编排器界面。
4. join/失败策略增强:OR-join、continue-on-error、重试、超时。
5. 节点类型扩展:transform、纯条件、LLM-supervisor 动态调度节点。
6. 自动化触发:手动 / 定时 / 事件。
7. 远程:A2A `AgentRunner`(见 `a2a-only-feasibility-rejected` —— A2A 作增量远程 rail,不替换 ACP)。
