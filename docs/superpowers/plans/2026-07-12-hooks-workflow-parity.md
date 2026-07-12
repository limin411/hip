# Hooks Workflow Parity — Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax. Prefer surgical diffs; do not redesign the orchestrator DAG or permission modes.

**Goal:** Make plugin `HookRegistry` effective on every hip-managed tool loop (main turn, `task` subagents, managed agents, workflow agent nodes), and fire workflow turn lifecycle hooks without double-firing `UserPromptSubmit`.

**Architecture:** Session owns one `HookRegistry`. Pass the same reference into `GraphCtx` via `runSubagent` / `runManagedAgent` / workflow runner. Keep `ToolRunner` as the only tool chokepoint. Extend `HookContext` with optional frame fields. Workflow HITL stays disabled (policy A: `ask` without transport → deny).

**Tech Stack:** TypeScript monorepo (`@hip/protocol`, sidecar), Vitest, existing Session/graph/ToolRunner stack.

**Spec:** [`docs/superpowers/specs/2026-07-12-hooks-workflow-parity-spec.md`](../specs/2026-07-12-hooks-workflow-parity-spec.md)

**Locked defaults (spec §6–7):**

| Decision | Value |
|----------|--------|
| Workflow HITL | Policy A — no HITL; Pre/Post always; ask without transport → deny |
| `workflow:run` + text | Fire `UserPromptSubmit` once |
| `message:send` + dag | `skipUserPromptSubmit: true` (already fired) |
| Workflow `Stop` continue | Log only; **do not** start another DAG |
| SubagentStart/Stop events | Deferred (P2) |
| Gate nodes | No tool hooks this phase |

**Out of scope:** Shell/HTTP hook types, external ACP plugin load, gate hooks, settings write UI.

---

## Dependency graph

```text
T1 protocol HookContext fields + export tests
     │
     ├─► T2 runSubagent + runManagedAgent + invoker extras plumb hooks
     │         │
     │         ├─► T3 main session spawnSubagent / dispatch pass host.hooks
     │         │
     │         └─► T4 workflow-runner + orchestrator-adapter plumb hooks
     │                   │
     │                   └─► T5 workflow lifecycle (TurnStart/Complete/UPS + skip flag)
     │
     └─► T6 docs/i18n honesty + hooks README
              (can start after T4; ideally after T5)

PR batches:
  PR1 = T1
  PR2 = T2 + T3
  PR3 = T4
  PR4 = T5
  PR5 = T6
```

---

## File map

### Modify (primary)

```
packages/protocol/src/hooks.ts
packages/protocol/src/index.ts                          # if re-exports needed
packages/sidecar/src/session/subagent.ts
packages/sidecar/src/session/internal-runner.ts
packages/sidecar/src/session/agents/invoker.ts
packages/sidecar/src/session/orchestrator-adapter.ts
packages/sidecar/src/session/workflow-runner.ts
packages/sidecar/src/session/session-turn-runner.ts
packages/sidecar/src/session/session.ts
packages/sidecar/src/session/hooks/README.md
src/i18n/en.ts
src/i18n/zh-CN.ts
src/i18n/zh-TW.ts
src/components/account/HookConfig.tsx                   # optional one-line intro only if keys already used
```

### Create / extend tests

```
packages/sidecar/src/session/subagent.hooks.test.ts          # or extend existing subagent tests
packages/sidecar/src/session/workflow-runner.hooks.test.ts
packages/sidecar/src/session/hooks/hooks-workflow.integration.test.ts
packages/protocol/src/hooks.ts related contract if any
# update:
packages/sidecar/src/session/workflow-runner.test.ts
packages/sidecar/src/session/orchestrator-adapter.test.ts
packages/sidecar/src/session/session-workflow-running.test.ts
```

### Do not touch (unless required)

```
packages/sidecar/src/orchestrator/executor.ts reduce graph semantics
packages/sidecar/src/session/tool-runner/tool-runner.ts core pipeline (only if ToolRunner ask-without-transport messaging needs align)
src/components/account/hookFishbone.ts visual layout
```

---

## T1 — Protocol: extend `HookContext`

**Files:** `packages/protocol/src/hooks.ts` (+ index if needed).

- [ ] **T1.1** Add optional fields: `runId?`, `nodeId?`, `agentId?`, `parentAgentId?` with JSDoc.
- [ ] **T1.2** Ensure package builds / types export; no breaking changes (all optional).
- [ ] **T1.3** Commit: `feat(protocol): extend HookContext with run and agent frame fields`

```bash
yarn workspace @hip/protocol exec tsc --noEmit
# or monorepo equivalent
```

---

## T2 — Plumb hooks into `runSubagent` + `runManagedAgent` + invoker

**Files:** `subagent.ts`, `internal-runner.ts`, `agents/invoker.ts` (+ tests).

- [ ] **T2.1** `RunSubagentArgs.hooks?: HookRegistry`; set `GraphCtx.hooks`.
- [ ] **T2.2** Recursive child spawn copies `hooks`.
- [ ] **T2.3** `RunManagedAgentArgs.hooks?: HookRegistry`; set `GraphCtx.hooks`.
- [ ] **T2.4** `InvokerExtras.hooks?: HookRegistry` → `runManagedAgent`.
- [ ] **T2.5** Comment: distinguish `ExternalAgentHooks` vs plugin `HookRegistry`.
- [ ] **T2.6** Unit/integration: invoke path with registry that denies a tool by name → error content, no side effect.
- [ ] **T2.7** Commit: `feat(hooks): plumb HookRegistry into subagent and managed agent loops`

```bash
yarn vitest run packages/sidecar/src/session/subagent*.ts packages/sidecar/src/session/agents/invoker*.ts packages/sidecar/src/session/internal-runner*.ts
# adjust globs to actual new test files
```

---

## T3 — Main session passes `host.hooks` into subagents / dispatch

**Files:** `session-turn-runner.ts` (spawnSubagent, dispatchAgent extras), related tests.

- [ ] **T3.1** `runSubagent({ ..., hooks: host.hooks, sessionId: host.id })` on task spawn.
- [ ] **T3.2** When building invoker extras for dispatch/internal agents, pass `hooks: host.hooks`.
- [ ] **T3.3** Background subagent path if it uses `runSubagent` — same plumb.
- [ ] **T3.4** Integration or focused test: Session registerHook PreToolUse deny → task tool denied.
- [ ] **T3.5** Commit: `feat(hooks): pass session HookRegistry into task and dispatch agents`

```bash
yarn vitest run packages/sidecar/src/session/hooks/hooks.integration.test.ts
# + new tests
```

---

## T4 — Workflow agent nodes use plugin hooks

**Files:** `workflow-runner.ts`, `orchestrator-adapter.ts`, `session.ts` (`workflowDeps` getter), tests.

- [ ] **T4.1** `WorkflowRunDeps.hooks: HookRegistry` (required).
- [ ] **T4.2** Session constructs `workflowDeps` with `this.hooks` (or public getter used by deps object).
- [ ] **T4.3** Worker `runSubagent` receives `hooks: deps.hooks`, `sessionId: deps.id`.
- [ ] **T4.4** `createSessionAgentRunner` opts include plugin hooks for internal agents; keep ExternalAgentHooks for ACP cancel.
- [ ] **T4.5** Pass frame context into fires if ToolRunner/context builders can accept agentId/nodeId (best-effort: set on GraphCtx if already supports sessionId only — at minimum sessionId + hooks).
- [ ] **T4.6** Test: workflow def with worker that would call denied tool → node fails or tool error with hook reason.
- [ ] **T4.7** Update `workflow-runner.test.ts` deps fixtures with `hooks: new HookRegistry()`.
- [ ] **T4.8** Commit: `feat(hooks): wire HookRegistry into workflow agent nodes`

```bash
yarn vitest run packages/sidecar/src/session/workflow-runner.test.ts packages/sidecar/src/session/workflow-runner.hooks.test.ts packages/sidecar/src/session/orchestrator-adapter.test.ts
```

---

## T5 — Workflow turn lifecycle events

**Files:** `workflow-runner.ts`, `session-turn-runner.ts`, `session.ts`, `handlers/session.ts` if needed, tests.

- [ ] **T5.1** Add `opts.skipUserPromptSubmit?: boolean` to `runWorkflowTurn`.
- [ ] **T5.2** On entry (unless skip): if `runInputs?.text?.trim()`, fire `UserPromptSubmit`; non-allow → error + return.
- [ ] **T5.3** Fire `TurnStart` with `{ sessionId, turnId/runId }`; non-allow → abort before DAG.
- [ ] **T5.4** On success path before/around finalize: fire `Stop` (ignore continue); fire `TurnComplete`.
- [ ] **T5.5** `runTurn` dag branch: `skipUserPromptSubmit: true`.
- [ ] **T5.6** Direct `runWorkflowTurn` / `workflow:run`: skip flag false.
- [ ] **T5.7** Populate HookContext `runId` (= turnId), and node/agent fields where easy on tool path.
- [ ] **T5.8** Tests: double-fire guard; workflow:run UPS deny; TurnStart deny; TurnComplete called on success.
- [ ] **T5.9** Commit: `feat(hooks): fire workflow turn lifecycle hooks`

```bash
yarn vitest run packages/sidecar/src/session/hooks/hooks-workflow.integration.test.ts packages/sidecar/src/session/workflow-runner*.ts packages/sidecar/src/session/session-workflow-running.test.ts
```

---

## T6 — Docs and settings honesty

**Files:** `session/hooks/README.md`, i18n `en`/`zh-CN`/`zh-TW`, optional `HookConfig` intro key, translation-keys test.

- [ ] **T6.1** README: event table + path matrix (main / subagent / workflow / gate / external).
- [ ] **T6.2** i18n: short path-coverage string on hooks settings page.
- [ ] **T6.3** translation-keys test still passes.
- [ ] **T6.4** Commit: `docs(hooks): document runtime paths and update settings copy`

```bash
yarn vitest run src/i18n/translation-keys.test.ts src/components/account/HookConfig.test.tsx
```

---

## Verification (full batch)

After PR2–PR4:

```bash
yarn vitest run packages/sidecar/src/session/hooks packages/sidecar/src/session/tool-runner packages/sidecar/src/session/workflow-runner.test.ts packages/sidecar/src/session/workflow-runner-activity.test.ts packages/sidecar/src/session/orchestrator-adapter.test.ts packages/sidecar/src/session/session-workflow-running.test.ts
```

Manual smoke (optional):

1. Enable a plugin with `PreToolUse` deny on `run_script`.
2. Chat task subagent tries shell → blocked.
3. Run a simple workflow with worker tools → blocked.
4. Settings hooks page shows path note.

---

## Implementation notes

### Naming

Prefer parameter name `hooks: HookRegistry` on Graph/session tooling. In orchestrator-adapter, avoid shadowing:

```ts
const externalHooks: ExternalAgentHooks = { requestPermission: ..., configOptions: ... }
// pass plugin hooks separately via extras.hooks
```

### ToolRunner ask without approval

If classification or PreToolUse returns `ask` and `requestApproval` is missing, existing ToolRunner returns error. Ensure message is clear for workflow (`approval required but no approval transport available` is acceptable; optional align to `HOOK` wording in T4).

### Filling HookContext on tool fire

ToolRunner currently fires:

```ts
hooks.fire('PreToolUse', { sessionId, toolName, toolInput })
```

Extend call sites to pass through optional ctx fields if `ToolRunnerDeps` gains `agentId` / `turnId` / `runId`. Minimal approach for P0: only `sessionId` + hooks plumb; P1 adds `turnId`/`runId` on ToolRunnerDeps from GraphCtx.

Recommended `GraphCtx` optional fields (if not present):

```ts
agentId?: string
runId?: string
nodeId?: string
parentAgentId?: string
turnId?: string
```

`getOrCreateToolRunner` copies them into fire payloads.

### Session.hooks visibility

`hooks` is private on `Session`. Options:

1. Add `get hooks(): HookRegistry` or `getHookRegistry()` for deps.
2. Or build `workflowDeps` inside Session with direct private access (already pattern for other deps).

Prefer (2) if `workflowDeps` is already a getter on Session — inject there without widening API.

---

## Suggested commit / PR checklist

| PR | Tasks | Merge criteria |
|----|-------|----------------|
| PR1 | T1 | protocol types only |
| PR2 | T2, T3 | subagent deny test green; main hooks.integration green |
| PR3 | T4 | workflow deps fixtures updated; worker deny test green |
| PR4 | T5 | lifecycle tests; no double UPS |
| PR5 | T6 | i18n + README |

---

## Rollback

Each PR is independently revertable. Behavior without hooks remains default-allow (empty registry). Feature is not gated by a flag; empty registry = no-op.
