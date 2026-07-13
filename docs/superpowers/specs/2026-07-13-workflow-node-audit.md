# Workflow node consumer audit (2026-07-13)

Track C **C-audit** inventory plus **C-validate** run-path notes.

**C-audit (original):** inventory of workflow node consumers (protocol / orchestrator / UI).  
**C-validate (done):** reject `tool` \| `human` via `rejectUnsupportedWorkflowNodes` (nested under `parallel` included); wired into `validateWorkflow`, `runWorkflow`, `DurableExecutor.runWorkflow`, and `runWorkflowTurn` (before `workflow:started`). ParallelNode reduce retained. **C-shrink** (hard-delete deprecated types) still backlog.

Related design: multi-track evolution Track C (DAG honesty: retain ParallelNode reduce; fail-closed tool/human; C-validate / later C-shrink).

## Status legend

| Status | Meaning |
|--------|---------|
| **implemented** | Launch path runs the node to a real outcome (success/failure with domain semantics). |
| **reduce-only** | Structural / graph-state only. Merge or flatten in `reduce.ts`; **not** launched by the executor loop. |
| **fail-closed** | Protocol + UI may model the type; launch path does not execute domain logic. If called, `launchResolvedNode` returns `ok: false` with `Unsupported workflow node type: …`. In the **normal** executor/durable-executor loop, non-`agent`/`gate` ready nodes are **skipped** (`continue`) and never reach launch — they remain **`ready` forever** and do **not** fail the run; when `inFlight` drains, final status can still be **`succeeded`** if no node is `failed` (current stranding). |

## Summary table

| Node type | Status | Primary runtime | Notes |
|-----------|--------|-----------------|-------|
| `agent` | **implemented** | `node-runner` → `ports.agentRunner` | Empty text fails the node. Product templates and team pipelines emit only agents. |
| `gate` | **implemented** | `node-runner` → `runGateNode` → registered `VerificationGate` | Unknown `gateKind` throws / fails. |
| `parallel` | **reduce-only** | `reduce.ts` fan-out init + merge | Merge strategies: **`all` / `any` / `vote`**. Structural; not launched. |
| `tool` | **fail-closed** + **pre-run reject** | none at launch | Rejected by C-validate before run; `@deprecated` until C-shrink. |
| `human` | **fail-closed** + **pre-run reject** | none at launch | Rejected by C-validate before run; HITL is ReAct `planPause` / `agent:interrupt`. |

### ParallelNode (structural detail)

- **Init:** `initRunState` recursively registers nested `parallel` children, then the parallel node itself.
- **Merge:** `resolveParallelMerge(strategy, childStatuses)`:
  - `all` — succeeded iff every leaf child succeeded
  - `any` — succeeded iff at least one leaf child succeeded
  - `vote` — succeeded iff `succeeded > total / 2`
  - empty children / unknown strategy → `failed`
- **Propagate:** when all leaf descendants are terminal, parallel node status is set from merge; fail-fast cascade **skips top-level** parallel ids in `def.nodes` (only those entries — nested `parallel` ids inside `ParallelNode.nodes` are not in that set) so top-level merge can still run bottom-up.
- **Launch:** executor/durable-executor do not call `launchResolvedNode` for `type === 'parallel'`.

### Tool / human (fail-closed detail)

- Protocol shapes exist (`ToolNode`, `HumanNode`) as `@deprecated`.
- UI (`DagEditor`) can **render** cards for both.
- **C-validate (wired):** `rejectUnsupportedWorkflowNodes` rejects `tool` \| `human` (`unsupported-node`), including nested under `parallel`. Called from `validateWorkflow` and pre-run gates: `runWorkflowTurn` (before `workflow:started`, client `INVALID_WORKFLOW`), `runWorkflow`, `DurableExecutor.runWorkflow` (throw). Registry-free so dynamic session agentIds are not false-failed by `unknown-agent`.
- `launchResolvedNode` fail-closes any non-`agent`/`gate` type (covers tool, human, parallel if ever called) as a residual safety net.
- **Historical stranding:** without pre-run reject, executor skip left tool/human `ready` forever and run could still finish `succeeded`. Pre-run reject closes that path for product entry points.
- Product path for human interaction: ReAct interrupt, not DAG `HumanNode`.

---

## Protocol definitions

| File | Role |
|------|------|
| `packages/protocol/src/orchestration-types.ts` | `ToolNode`, `ParallelNode` (`MergeStrategy`), `GateNode`, `HumanNode`, `WorkflowNode` union |
| `packages/protocol/src/workflow-protocol.ts` | `AgentNode`, `WorkflowDef`, `RunState`, orchestrator events |
| `packages/protocol/src/orchestration-types.test.ts` | Shape tests for tool / parallel+vote / gate / human |
| `packages/protocol/src/team-types.ts` | Team pipeline → **AgentNode only** when materialised |

---

## Sidecar consumers

### Launch / execute

| File | agent | gate | parallel | tool | human |
|------|-------|------|----------|------|-------|
| `packages/sidecar/src/orchestrator/node-runner.ts` | run | run | fail-closed if called | fail-closed | fail-closed |
| `packages/sidecar/src/orchestrator/gate-runner.ts` | — | **run** | — | — | — |
| `packages/sidecar/src/orchestrator/executor.ts` | launch | launch | skip (`continue`) | skip | skip |
| `packages/sidecar/src/orchestrator/durable-executor.ts` | launch | launch | skip | skip | skip |
| `packages/sidecar/src/orchestrator/reduce.ts` | graph state | graph state | **init + merge all/any/vote** | graph state only | graph state only |
| `packages/sidecar/src/orchestrator/validate.ts` | unknown-agent check | no type-specific reject | no type-specific reject | **not rejected** | **not rejected** |

### Session / product wiring (agent-only defs)

| File | Node types produced / used |
|------|----------------------------|
| `packages/sidecar/src/session/builtin-workflows.ts` | `agent` only (planner → coder) |
| `packages/sidecar/src/session/teams/team-runner.ts` | Builds `agent` nodes from team pipeline |
| `packages/sidecar/src/session/dynamic-agent-registry.ts` | Maps dynamic nodes → static `type: 'agent'` |
| `packages/sidecar/src/session/workflow-runner.ts` | Runs `WorkflowDef` via orchestrator (opaque to node kinds) |
| `packages/sidecar/src/session/session-turn-runner.ts` | `pendingWorkflowDef` only when set explicitly |
| `packages/sidecar/src/session/session.ts` | Holds `pendingWorkflowDef` |

### Sidecar tests (node-type constructions)

| File | Types exercised |
|------|-----------------|
| `packages/sidecar/src/orchestrator/reduce.test.ts` | `agent`, **`parallel` + all/any/vote**, edge/fail-fast |
| `packages/sidecar/src/orchestrator/node-runner.test.ts` | `agent`, `gate`, **`human` → Unsupported** |
| `packages/sidecar/src/orchestrator/gate-runner.test.ts` | `gate` |
| `packages/sidecar/src/orchestrator/executor.test.ts` | `agent`, `gate` |
| `packages/sidecar/src/orchestrator/durable-executor.test.ts` | `agent` |
| `packages/sidecar/src/orchestrator/e2e.integration.test.ts` | `agent` chains |
| `packages/sidecar/src/orchestrator/validate.test.ts` | `agent` graphs |
| `packages/sidecar/src/orchestrator/ports.test.ts` | `agent` |
| `packages/sidecar/src/session/workflow-runner*.test.ts` | `agent` |
| `packages/sidecar/src/session/session-workflow-running.test.ts` | `agent` |
| `packages/sidecar/src/session/session-turn-runner.test.ts` | `agent` |
| `packages/sidecar/src/session/orchestrator-concurrency.integration.test.ts` | `agent` fan-out |
| `packages/sidecar/src/persistence/workflow-store.test.ts` | `agent` |

Non-workflow note: `event-store` / transcript `type: 'human' | 'tool'` are **message** roles, not `WorkflowNode` kinds.

---

## Frontend (`src/`) consumers

Type-aware UI is listed first; opaque projection/store paths hold `WorkflowDef` without branching on node kinds.

| File | Usage |
|------|--------|
| `src/components/workflow/DagEditor.tsx` | Renders **all five** types (cards + meta for agent/tool/gate/parallel/human). Display / projection surface only — does not author or execute (`nodesConnectable={false}`, no def rewrite). |
| `src/components/workflow/DagEditor.test.tsx` | Fixtures for agent, **tool**, gate, **human**, **parallel**. |
| `src/store/workflowStore.ts` | Opaque store: holds active def + run state; applies events by node id (status-agnostic to kind). |
| `src/domain/serverMessageEffects.ts` | Opaque projection: `workflow:started` → `setActiveWorkflow`, event/snapshot/clear (status-agnostic). |
| `src/store/workflowStore.test.ts` | Default `agent`; one test inserts `type: 'tool'` to assert multi-node event state isolation. |
| `src/domain/sessionService.test.ts` | `agent` only in workflow def mocks. |
| `src/components/workflow/RunStateOverlay.tsx` | Overlay on run state (status-agnostic to node kind). |

No production frontend path was found that **authors** tool/human/parallel defs into a live `pendingWorkflowDef` launch; DagEditor is the type-aware visual consumer.

---

## Fixtures / e2e

There is **no** top-level `tests/fixtures` tree. Closest fixture roots:

| Location | Workflow node usage |
|----------|---------------------|
| `e2e/fixtures/sample-project` | Generic project fixture; no DAG node-type JSON. |
| `e2e/fixtures/sample-plugin` | Plugin fixture; no WorkflowNode kinds. |
| `e2e/specs/harness-workflow-projection.spec.ts` | Inline `MOCK_DEF` with **`agent` only**. |

In-repo “fixtures” for node types live **inside unit tests** (especially `DagEditor.test.tsx`, `reduce.test.ts`, protocol shape tests).

---

## Consumer inventory by type

### `agent` — implemented

| Area | References |
|------|------------|
| Protocol | `workflow-protocol.ts` `AgentNode` |
| Launch | `node-runner.ts` (`agentId` + `agentRunner.run`) |
| Execute loop | `executor.ts`, `durable-executor.ts` |
| Validate | `validate.ts` unknown-agent |
| Product defs | `builtin-workflows.ts`, `team-runner.ts`, `dynamic-agent-registry.ts` |
| UI | `DagEditor.tsx` AgentNodeCard |
| Tests / e2e | Widespread agent-only `WorkflowDef`s; e2e harness mock |

### `gate` — implemented

| Area | References |
|------|------------|
| Protocol | `orchestration-types.ts` `GateNode`, `VerificationGateKind` |
| Launch | `node-runner.ts` → `gate-runner.ts` → `gates/*` |
| Execute loop | `executor.ts`, `durable-executor.ts` (explicit allow-list with agent) |
| UI | `DagEditor.tsx` GateNodeCard |
| Tests | `gate-runner.test.ts`, `node-runner.test.ts`, `executor.test.ts` |

### `parallel` — reduce-only (structural)

| Area | References |
|------|------------|
| Protocol | `ParallelNode`, `MergeStrategy = 'all' \| 'any' \| 'vote'` |
| Reduce | `reduce.ts`: `collectChildIds`, `resolveParallelMerge`, `propagate`, fail-fast skip of **top-level** parallel ids in `def.nodes` |
| Launch | **Not launched**; skip in executor; fail-closed if `launchResolvedNode` called |
| UI | `DagEditor.tsx` ParallelNodeCard + layout sizing |
| Tests | `reduce.test.ts` (all / any / vote / empty / single child / unknown strategy) |

### `tool` — fail-closed

| Area | References |
|------|------------|
| Protocol | `ToolNode` + shape test |
| Launch | No implementation; fail-closed / skipped |
| UI | `DagEditor.tsx` ToolNodeCard |
| Tests | `DagEditor.test.tsx`, `workflowStore.test.ts` (store isolation only) |
| Product | None |

### `human` — fail-closed

| Area | References |
|------|------------|
| Protocol | `HumanNode` + shape test |
| Launch | `node-runner.test.ts` asserts Unsupported; no HITL wiring |
| UI | `DagEditor.tsx` HumanNodeCard |
| Product HITL | ReAct `agent:interrupt` / plan pause (not this node type) |

---

## Intentional non-consumers (do not confuse)

| Symbol / path | Why excluded |
|---------------|--------------|
| Message `type: 'human' \| 'ai' \| 'system' \| 'tool'` | Transcript roles (`message-model`, `event-store`, replay) |
| `MemorySource` includes `'tool'` | Memory provenance, not WorkflowNode |
| Hook / guardian `toolName` | Tool-call policy, not DAG ToolNode |
| React Flow `node.type` in hooks UI tests | Different graph model |

---

## Implications for later Track C work

1. **C-validate (done + wired):** registry-free `rejectUnsupportedWorkflowNodes` rejects `type: 'tool' | 'human'`; used by `validateWorkflow` and pre-run entry (`runWorkflowTurn`, `runWorkflow`, `DurableExecutor`). ParallelNode documented as structural + merge strategies; reduce merge tests remain green.
2. **C-shrink (after deprecate window):** MAY hard-delete `tool` + `human` from the protocol union (types already `@deprecated`); **retain** `parallel` and reduce merge.
3. **Do not** remove ParallelNode reduce for “honesty”; parallel is a real structural capability, not a fake leaf runner.
4. **Validate-before-run** closes the stranding path for tool/human on product and executor entry points. Launch-time fail-closed (`Unsupported…`) remains a residual safety net if `launchResolvedNode` is called directly.

---

## Audit method

Grep/read across:

- `packages/protocol`
- `packages/sidecar` (orchestrator + session + persistence tests)
- `src/` (workflow UI + stores)
- `e2e/` (fixtures + harness-workflow-projection)

C-audit phase was inventory-only. C-validate adds validate + run-path reject (this track); reduce merge and node-runner launch semantics for agent/gate/parallel are unchanged.
