# Orch Mode + DAG Panel Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the product loop so Cluster Mode (`orchMode: 'dag'`) runs a real builtin DAG on `message:send`, persists runs per session, streams orchestrator events to the frontend, and drives the right-panel DAG visualization.

**Architecture:** Keep the existing DurableExecutor / `runWorkflow` engine. On `orchMode === 'dag'`, resolve `pendingWorkflowDef ?? buildClusterDefaultWorkflow()`, inject the user text as `runInputs`, emit `workflow:started|event|snapshot` over WS, bind `workflow_runs.session_id`, and project into a per-session `workflowStore` for `DagEditor`. Fast mode is unchanged.

**Tech Stack:** TypeScript, Vitest, `@hip/protocol`, sidecar SQLite (`node:sqlite`), React + Zustand, React Flow (`DagEditor`).

**Spec:** `docs/superpowers/specs/2026-07-10-orch-mode-dag-panel-closure-design.md`

**Product defaults (locked for this plan):**
- Default template: linear `planner → coder`, **no gate**
- Auto-open DAG tab on `workflow:started` (code surface only)
- Chat surface: no DAG tab (unchanged)
- No feature flag

---

## File map

| Path | Role |
|------|------|
| `packages/protocol/src/messages.ts` | Client/Server message variants |
| `packages/protocol/src/message-guard.ts` | `CLIENT_MESSAGE_TYPES` + parse |
| `packages/protocol/src/index.contract.test.ts` | Type pins for new messages |
| `packages/protocol/src/message-guard.test.ts` | Guard accepts `workflow:getActive` |
| `packages/sidecar/src/session/builtin-workflows.ts` | Default `WorkflowDef` factory |
| `packages/sidecar/src/session/builtin-workflows.test.ts` | Template shape tests |
| `packages/sidecar/src/session/session-turn-runner.ts` | Always-enter DAG when `orchMode==='dag'` + user text |
| `packages/sidecar/src/session/workflow-runner.ts` | `runInputs` + emit workflow UI events |
| `packages/sidecar/src/session/session.ts` | Optional `setPendingWorkflowDef` for tests/API |
| `packages/sidecar/src/session/session.test.ts` | Replace fallthrough tests |
| `packages/sidecar/src/session/handlers/session.ts` | `workflow:getActive`; busy check on `workflow:run` |
| `packages/sidecar/src/persistence/schema.ts` | `session_id` on runs |
| `packages/sidecar/src/persistence/workflow-store.ts` | Bind session + load latest |
| `packages/sidecar/src/main.ts` | Ensure column migration |
| `src/store/workflowStore.ts` | Per-session projection |
| `src/store/workflowStore.test.ts` | Per-session + event tests |
| `src/domain/serverMessageEffects.ts` | Apply workflow:* + auto-open DAG |
| `src/domain/sessionService.ts` | `workflow:getActive` on load |
| `src/components/artifact/ArtifactPanel.tsx` | i18n empty state + per-session read |
| `src/components/chat/ModelPicker.tsx` | Disable orch toggle while running |
| `src/i18n/{en,zh-CN,zh-TW}.ts` | Empty state + tooltips |

---

### Task 1: Protocol — ServerMessage / ClientMessage for workflow UI

**Files:**
- Modify: `packages/protocol/src/messages.ts`
- Modify: `packages/protocol/src/message-guard.ts`
- Modify: `packages/protocol/src/message-guard.test.ts`
- Modify: `packages/protocol/src/index.contract.test.ts`

- [ ] **Step 1: Write contract pins (fail tsc / tests until types exist)**

Add to `packages/protocol/src/index.contract.test.ts`:

```ts
import type { WorkflowDef, RunState, OrchestratorEvent } from './index.js'

const _workflowGetActive: Extract<ClientMessage, { type: 'workflow:getActive' }> = {
  type: 'workflow:getActive',
  sessionId: 's',
}
void _workflowGetActive

const _workflowRunWithInputs: Extract<ClientMessage, { type: 'workflow:run' }> = {
  type: 'workflow:run',
  sessionId: 's',
  def: { id: 'w', name: 'W', nodes: [], edges: [], entry: [] },
  runInputs: { text: 'hello' },
}
void _workflowRunWithInputs

const _workflowStarted: Extract<ServerMessage, { type: 'workflow:started' }> = {
  type: 'workflow:started',
  sessionId: 's',
  runId: 'r1',
  def: { id: 'w', name: 'W', nodes: [], edges: [], entry: [] },
}
void _workflowStarted

const _workflowEvent: Extract<ServerMessage, { type: 'workflow:event' }> = {
  type: 'workflow:event',
  sessionId: 's',
  runId: 'r1',
  event: { type: 'run:started' },
}
void _workflowEvent

const _workflowSnapshot: Extract<ServerMessage, { type: 'workflow:snapshot' }> = {
  type: 'workflow:snapshot',
  sessionId: 's',
  runId: 'r1',
  def: { id: 'w', name: 'W', nodes: [], edges: [], entry: [] },
  state: { runId: 'r1', workflowId: 'w', status: 'succeeded', nodes: {} },
}
void _workflowSnapshot

const _workflowCleared: Extract<ServerMessage, { type: 'workflow:cleared' }> = {
  type: 'workflow:cleared',
  sessionId: 's',
}
void _workflowCleared
```

Add guard test in `message-guard.test.ts`:

```ts
it('accepts workflow:getActive', () => {
  const msg = parseClientMessage({ type: 'workflow:getActive', sessionId: 's1' })
  expect(msg?.type).toBe('workflow:getActive')
})
```

- [ ] **Step 2: Run tests to verify they fail / tsc errors**

```bash
cd packages/protocol && yarn test message-guard.test.ts index.contract.test.ts 2>&1 | tail -40
```

Expected: contract file fails typecheck or compile until messages updated.

- [ ] **Step 3: Implement message types**

In `packages/protocol/src/messages.ts`:

**ClientMessage** — extend `workflow:run` and add getActive:

```ts
| { type: 'workflow:run'; sessionId: string; def: WorkflowDef; runInputs?: { text: string; data?: unknown } }
| { type: 'workflow:getActive'; sessionId: string }
```

**ServerMessage** — append:

```ts
| { type: 'workflow:started'; sessionId: string; runId: string; def: WorkflowDef }
| { type: 'workflow:event'; sessionId: string; runId: string; event: OrchestratorEvent }
| { type: 'workflow:snapshot'; sessionId: string; runId: string; def: WorkflowDef; state: RunState }
| { type: 'workflow:cleared'; sessionId: string }
```

Import `OrchestratorEvent` / `RunState` from `./workflow-protocol.js` (or existing re-exports). Ensure `WorkflowDef` already imported.

In `message-guard.ts` add to `CLIENT_MESSAGE_TYPES`:

```ts
'workflow:getActive',
```

(keep `'workflow:run'` as-is)

- [ ] **Step 4: Run protocol tests**

```bash
cd packages/protocol && yarn test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/messages.ts packages/protocol/src/message-guard.ts packages/protocol/src/message-guard.test.ts packages/protocol/src/index.contract.test.ts
git commit -m "$(cat <<'EOF'
feat(protocol): add workflow started/event/snapshot UI messages

Close the orch-mode DAG panel protocol surface: client can request
active run; server can stream orchestrator events and terminal snapshots.
EOF
)"
```

---

### Task 2: Builtin cluster default workflow

**Files:**
- Create: `packages/sidecar/src/session/builtin-workflows.ts`
- Create: `packages/sidecar/src/session/builtin-workflows.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/sidecar/src/session/builtin-workflows.test.ts
import { describe, it, expect } from 'vitest'
import { buildClusterDefaultWorkflow } from './builtin-workflows.js'

describe('buildClusterDefaultWorkflow', () => {
  it('returns planner → coder linear graph with stable id', () => {
    const def = buildClusterDefaultWorkflow()
    expect(def.id).toBe('builtin:cluster-default')
    expect(def.entry).toEqual(['planner'])
    expect(def.nodes.map((n) => n.id)).toEqual(['planner', 'coder'])
    expect(def.nodes.every((n) => n.type === 'agent')).toBe(true)
    expect(def.edges).toEqual([{ from: 'planner', to: 'coder' }])
  })

  it('planner inputTemplate references {{input}}', () => {
    const def = buildClusterDefaultWorkflow()
    const planner = def.nodes.find((n) => n.id === 'planner')
    expect(planner && 'inputTemplate' in planner && planner.inputTemplate).toMatch(/\{\{\s*input\s*\}\}/)
  })

  it('coder inputTemplate references {{planner}} and {{input}}', () => {
    const def = buildClusterDefaultWorkflow()
    const coder = def.nodes.find((n) => n.id === 'coder')
    expect(coder && 'inputTemplate' in coder && coder.inputTemplate).toMatch(/\{\{\s*planner\s*\}\}/)
    expect(coder && 'inputTemplate' in coder && coder.inputTemplate).toMatch(/\{\{\s*input\s*\}\}/)
  })

  it('uses worker agentId for both nodes', () => {
    const def = buildClusterDefaultWorkflow()
    for (const n of def.nodes) {
      if (n.type === 'agent') expect(n.agentId).toBe('worker')
    }
  })
})
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd packages/sidecar && yarn test src/session/builtin-workflows.test.ts
```

Expected: cannot find module / FAIL.

- [ ] **Step 3: Implement factory**

```ts
// packages/sidecar/src/session/builtin-workflows.ts
import type { WorkflowDef } from '@hip/protocol'

/** v1 default cluster template: linear planner → coder, no gates. */
export function buildClusterDefaultWorkflow(): WorkflowDef {
  return {
    id: 'builtin:cluster-default',
    name: 'Cluster Default',
    entry: ['planner'],
    nodes: [
      {
        type: 'agent',
        id: 'planner',
        agentId: 'worker',
        inputTemplate:
          'You are the planner. Break down the user request into concrete steps and acceptance criteria. Be concise.\n\nUser request:\n{{input}}',
      },
      {
        type: 'agent',
        id: 'coder',
        agentId: 'worker',
        inputTemplate:
          'You are the implementer. Execute the plan with minimal correct changes.\n\nPlan:\n{{planner}}\n\nOriginal request:\n{{input}}',
      },
    ],
    edges: [{ from: 'planner', to: 'coder' }],
  }
}
```

- [ ] **Step 4: Run tests — PASS**

```bash
cd packages/sidecar && yarn test src/session/builtin-workflows.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/builtin-workflows.ts packages/sidecar/src/session/builtin-workflows.test.ts
git commit -m "$(cat <<'EOF'
feat(sidecar): add builtin cluster-default workflow template

Linear planner→coder graph used when orchMode is dag and no pending def.
EOF
)"
```

---

### Task 3: `runWorkflowTurn` accepts `runInputs` and always receives user text

**Files:**
- Modify: `packages/sidecar/src/session/workflow-runner.ts`
- Modify: `packages/sidecar/src/session/workflow-runner.test.ts` (and/or activity test)
- Modify: `packages/sidecar/src/session/session.ts` (signature passthrough if needed)

- [ ] **Step 1: Extend opts + failing assertion**

In `workflow-runner.ts`, change signature:

```ts
export async function runWorkflowTurn(
  deps: WorkflowRunDeps,
  def: WorkflowDef,
  send: SendFn,
  finalize: (send: SendFn, turnId: string, supervisorText: string, trajectory: Map<string, TraceRun>, stopped: boolean) => string,
  opts?: { runInputs?: { text: string; data?: unknown } },
): Promise<string> {
```

Pass `runInputs: opts?.runInputs` into both `DurableExecutor.runWorkflow` and `runWorkflow` (they already accept `runInputs` on opts — verify `RunWorkflowOpts` / `DurableRunOpts`).

Add/adjust a unit test that stubs ports and asserts the launched agent input includes the user text when template is `{{input}}` (reuse existing FakeAgentRunner patterns from orchestrator tests if easier to test via a thin integration in workflow-runner.test).

Minimal test approach in `workflow-runner.test.ts`:

```ts
it('forwards runInputs into the executor', async () => {
  // mock DurableExecutor or inject orchestratorRunner that captures req.input
  // assert req.input.text === 'USER_PROMPT'
})
```

If full mock is heavy: unit-test only that `opts` is plumbed by exporting a test hook or spying `runWorkflow` via `vi.mock('../orchestrator/executor.js')`.

Example mock pattern:

```ts
const runWorkflow = vi.fn(async (_def, _ports, opts) => {
  expect(opts.runInputs?.text).toBe('hello world')
  return { runId: opts.runId, workflowId: 'w', status: 'succeeded' as const, nodes: {} }
})
vi.mock('../orchestrator/executor.js', () => ({ runWorkflow: (...a: unknown[]) => runWorkflow(...a) }))
```

- [ ] **Step 2: Implement plumbing**

In both executor call sites inside `runWorkflowTurn`:

```ts
{ runId: turnId, signal: abortController.signal, cwd, sessionId: deps.id, runInputs: opts?.runInputs }
```

- [ ] **Step 3: Update `Session.runWorkflowTurn` wrapper**

```ts
async runWorkflowTurn(
  def: WorkflowDef,
  send: SendFn,
  opts?: { runInputs?: { text: string; data?: unknown } },
): Promise<string> {
  return runWorkflowTurnFn(
    this.workflowDeps,
    def,
    send,
    (s, turnId, text, traj, stopped) => this.finalizeAndPersist(s, turnId, text, traj, stopped),
    opts,
  )
}
```

- [ ] **Step 4: Tests pass**

```bash
cd packages/sidecar && yarn test src/session/workflow-runner.test.ts src/session/workflow-runner-activity.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/workflow-runner.ts packages/sidecar/src/session/workflow-runner.test.ts packages/sidecar/src/session/session.ts
git commit -m "$(cat <<'EOF'
feat(sidecar): pass runInputs through runWorkflowTurn

Allows cluster-mode user messages to fill {{input}} templates.
EOF
)"
```

---

### Task 4: Main loop — `orchMode === 'dag'` always runs a workflow

**Files:**
- Modify: `packages/sidecar/src/session/session-turn-runner.ts`
- Modify: `packages/sidecar/src/session/session.test.ts`
- Modify: `packages/sidecar/src/session/session.ts` (optional `setPendingWorkflowDef`)

- [ ] **Step 1: Rewrite orchMode tests (old fallthrough becomes wrong)**

Replace `falls through to graph loop when orchMode is "dag" but no pendingWorkflowDef` with:

```ts
it('runs workflow path when orchMode is dag without pendingWorkflowDef', async () => {
  const fakeModel = new FakeListChatModel({ responses: ['plan ok', 'code ok'] })
  // worker subagent uses modelRunner — FakeList may need enough responses for both nodes
  const events: Array<{ type: string }> = []
  const session = new Session('test-om-dag-default', { ...testConfig, orchMode: 'dag' }, fakeModel)
  await session.sendMessage('implement hello', (msg) => events.push(msg))
  // After Task 5 we assert workflow:started; for Task 4 assert no crash + complete OR spy runWorkflowTurn
  expect(events.some((e) => e.type === 'error' && (e as { code?: string }).code === 'AGENT_ERROR')).toBe(false)
})
```

Better: spy via injecting / checking that StateGraph path was not used is hard. Prefer asserting `workflow:started` once Task 5 lands; for this task, unit-test `runTurn` with a mock host:

```ts
// session-turn-runner dag branch unit test (new file or extend existing)
it('resolves default workflow when orchMode is dag and pending is null', async () => {
  const runWorkflowTurnFn = vi.fn(async () => 'done')
  // if not injectable, test via Session + mock store without model by stubbing workflowDeps
})
```

**Practical approach:** In `session-turn-runner.ts`, extract helper:

```ts
export function resolveWorkflowDefForTurn(host: Pick<SessionTurnHost, 'pendingWorkflowDef' | 'orchMode'>): WorkflowDef | null {
  if (host.orchMode !== 'dag') return null
  const def = host.pendingWorkflowDef ?? buildClusterDefaultWorkflow()
  return def
}
```

Test pure helper:

```ts
it('returns builtin when dag and no pending', () => {
  expect(resolveWorkflowDefForTurn({ orchMode: 'dag', pendingWorkflowDef: null })?.id).toBe('builtin:cluster-default')
})
it('returns pending when set', () => {
  const pending = { id: 'custom', name: 'C', nodes: [], edges: [], entry: [] }
  expect(resolveWorkflowDefForTurn({ orchMode: 'dag', pendingWorkflowDef: pending })?.id).toBe('custom')
})
it('returns null when fast', () => {
  expect(resolveWorkflowDefForTurn({ orchMode: 'fast', pendingWorkflowDef: null })).toBeNull()
})
```

- [ ] **Step 2: Implement `runTurn` branch**

Replace the fallthrough block with:

```ts
import { buildClusterDefaultWorkflow } from './builtin-workflows.js'

// helper can live in same file or builtin-workflows.ts
export function resolveWorkflowDefForTurn(host: {
  orchMode: import('@hip/protocol').OrchestrationMode
  pendingWorkflowDef: WorkflowDef | null
}): WorkflowDef | null {
  if (host.orchMode !== 'dag') return null
  return host.pendingWorkflowDef ?? buildClusterDefaultWorkflow()
}

export function extractLastUserText(messages: BaseMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m._getType?.() === 'human' || m.constructor?.name === 'HumanMessage') {
      const c = m.content
      if (typeof c === 'string') return c
      if (Array.isArray(c)) {
        return c
          .map((p) => (typeof p === 'object' && p && 'text' in p ? String((p as { text: string }).text) : ''))
          .filter(Boolean)
          .join('\n')
      }
    }
  }
  return ''
}

// inside runTurn:
const dagDef = resolveWorkflowDefForTurn(host)
if (dagDef) {
  host.pendingWorkflowDef = null
  const userText = extractLastUserText(host.messages)
  return runWorkflowTurnFn(
    host.workflowDeps,
    dagDef,
    rawSend,
    (s, turnId, text, traj, stopped) => host.finalizeAndPersist(s, turnId, text, traj, stopped),
    { runInputs: { text: userText } },
  )
}
```

Note: `processInput` already `host.messages.push(HumanMessage(...))` **before** `runTurn`, so last human message is available.

Also update `SessionTurnHost.workflowDeps` typing if `runWorkflowTurn` signature changed.

- [ ] **Step 3: Optional `setPendingWorkflowDef` on Session for tests**

```ts
setPendingWorkflowDef(def: WorkflowDef | null): void {
  this.pendingWorkflowDef = def
}
```

- [ ] **Step 4: Run tests**

```bash
cd packages/sidecar && yarn test src/session/session.test.ts src/session/builtin-workflows.test.ts
# plus any new resolveWorkflowDefForTurn tests
```

Fix FakeList response counts if integration test runs full planner+coder.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/session-turn-runner.ts packages/sidecar/src/session/session.ts packages/sidecar/src/session/session.test.ts
git commit -m "$(cat <<'EOF'
feat(sidecar): enter DAG path whenever orchMode is dag

Use pendingWorkflowDef or builtin cluster-default; inject last user text.
EOF
)"
```

---

### Task 5: Emit `workflow:started` / `workflow:event` / `workflow:snapshot`

**Files:**
- Modify: `packages/sidecar/src/session/workflow-runner.ts`
- Modify: `packages/sidecar/src/session/workflow-runner-activity.test.ts` or new `workflow-runner-ui-events.test.ts`

- [ ] **Step 1: Write failing test**

```ts
describe('runWorkflowTurn UI events', () => {
  it('emits started, events, and snapshot', async () => {
    const sent: ServerMessage[] = []
    // setup deps with store undefined so runWorkflow mock/fake completes quickly
    // use Fake path: mock runWorkflow to emit via real eventSink by calling ports...
    // Easier: use real runWorkflow + FakeAgentRunner via createSessionAgentRunner override
    await runWorkflowTurn(deps, buildClusterDefaultWorkflow(), (m) => sent.push(m), finalize, {
      runInputs: { text: 'hi' },
    })
    expect(sent.some((m) => m.type === 'workflow:started')).toBe(true)
    expect(sent.some((m) => m.type === 'workflow:event')).toBe(true)
    expect(sent.some((m) => m.type === 'workflow:snapshot')).toBe(true)
    const started = sent.find((m) => m.type === 'workflow:started') as Extract<ServerMessage, { type: 'workflow:started' }>
    expect(started.def.id).toBe('builtin:cluster-default')
  })
})
```

Wire deps similarly to `workflow-runner-activity.test.ts` (`makeDeps`).

- [ ] **Step 2: Implement emission in `runWorkflowTurn`**

```ts
const turnId = `asst-supervisor-${Date.now()}`
// ...
send({ type: 'workflow:started', sessionId: deps.id, runId: turnId, def })

const eventSink: OrchestratorEventSink = {
  emit(e: OrchestratorEvent) {
    send({ type: 'workflow:event', sessionId: deps.id, runId: turnId, event: e })
    // existing agent ensureStarted / ensureFinished mapping unchanged
    switch (e.type) {
      case 'node:started':
        ensureStarted(e.nodeId, 'worker', 'supervisor')
        break
      // ...
    }
  },
}

// after runState returned:
send({
  type: 'workflow:snapshot',
  sessionId: deps.id,
  runId: turnId,
  def,
  state: runState,
})
```

On error/abort paths: still try to emit snapshot if partial state exists; otherwise skip (document). Minimum: emit `workflow:event` `{ type: 'run:cancelled' }` only if executor did; optional `workflow:cleared` not required on cancel.

- [ ] **Step 3: Tests pass**

```bash
cd packages/sidecar && yarn test src/session/workflow-runner
```

- [ ] **Step 4: Commit**

```bash
git add packages/sidecar/src/session/workflow-runner.ts packages/sidecar/src/session/workflow-runner*.test.ts
git commit -m "$(cat <<'EOF'
feat(sidecar): stream workflow UI events during DAG turns

Emit workflow:started, per-reduce workflow:event, and terminal snapshot.
EOF
)"
```

---

### Task 6: Persist `session_id` on workflow runs + load latest

**Files:**
- Modify: `packages/sidecar/src/persistence/schema.ts`
- Modify: `packages/sidecar/src/persistence/workflow-store.ts`
- Modify: `packages/sidecar/src/persistence/workflow-store.test.ts`
- Modify: `packages/sidecar/src/main.ts`
- Modify: `packages/sidecar/src/orchestrator/ports.ts` (if WorkflowStore interface needs sessionId)
- Modify: `packages/sidecar/src/session/workflow-runner.ts` (pass sessionId into store)
- Modify: `packages/sidecar/src/orchestrator/durable-executor.ts` (optional sessionId on save)

- [ ] **Step 1: Schema + store tests**

```ts
it('binds session_id and loads latest run for session', async () => {
  const store = new SqliteWorkflowStore(db)
  await store.saveDef(def)
  await store.saveRun(
    { runId: 'r1', workflowId: def.id, status: 'succeeded', nodes: {} },
    { sessionId: 'sess-a' },
  )
  await store.saveRun(
    { runId: 'r2', workflowId: def.id, status: 'failed', nodes: {} },
    { sessionId: 'sess-a' },
  )
  const latest = store.loadLatestRunForSession('sess-a')
  expect(latest?.state.runId).toBe('r2')
  expect(latest?.def.id).toBe(def.id)
})
```

- [ ] **Step 2: DDL / migration**

In `schema.ts` update `WORKFLOW_RUNS_DDL` for fresh DBs:

```sql
CREATE TABLE IF NOT EXISTS workflow_runs (
  run_id TEXT PRIMARY KEY,
  workflow_id TEXT NOT NULL REFERENCES workflow_defs(id),
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'running',
  state_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
)
```

In `main.ts` after WORKFLOW_DDL loop, migrate existing DBs:

```ts
try {
  db.exec(`ALTER TABLE workflow_runs ADD COLUMN session_id TEXT`)
} catch {
  // column exists
}
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_workflow_runs_session ON workflow_runs(session_id, updated_at DESC)`)
} catch { /* ignore */ }
```

- [ ] **Step 3: Update SqliteWorkflowStore**

```ts
async saveRun(run: RunState, meta?: { sessionId?: string }): Promise<void> {
  this.upsertRun.run(
    run.runId,
    run.workflowId,
    meta?.sessionId ?? null,
    run.status,
    JSON.stringify(run),
  )
}

loadLatestRunForSession(sessionId: string): { def: WorkflowDef; state: RunState } | null {
  const row = this.selectLatestBySession.get(sessionId) as
    | { state_json: string; workflow_id: string }
    | undefined
  if (!row) return null
  const state = JSON.parse(row.state_json) as RunState
  const def = /* loadDef sync path */ 
  // prepare: SELECT state_json, workflow_id FROM workflow_runs WHERE session_id=? ORDER BY updated_at DESC LIMIT 1
  ...
}
```

Update upsert SQL to include `session_id`.

**Interface conflict:** `WorkflowStore.saveRun(run)` in ports has one arg. Options:
1. Extend interface: `saveRun(run, meta?: { sessionId?: string })`
2. Or store sessionId on a wrapper field outside RunState via side map

Prefer (1) — update `ports.ts`, `InMemoryWorkflowStore`, DurableExecutor/executor `ports.store?.saveRun(state)` call sites to pass sessionId when available.

Pass `sessionId` through DurableExecutor opts (already has `sessionId?: string`) into `saveRun`.

- [ ] **Step 4: Handler `workflow:getActive`**

In `handlers/session.ts` HANDLED set + case:

```ts
case 'workflow:getActive': {
  const s = ctx.ensureSession(msg.sessionId, send)
  const wfStore = ctx.store ? new SqliteWorkflowStore(ctx.store.getDb()) : undefined
  const latest = wfStore?.loadLatestRunForSession(msg.sessionId) ?? null
  if (latest) {
    send({
      type: 'workflow:snapshot',
      sessionId: msg.sessionId,
      runId: latest.state.runId,
      def: latest.def,
      state: latest.state,
    })
  } else {
    send({ type: 'workflow:cleared', sessionId: msg.sessionId })
  }
  return
}
```

Also: when handling `workflow:run`, if session `running`, send error and return:

```ts
case 'workflow:run': {
  const s = ctx.ensureSession(msg.sessionId, send)
  if (s.running) {
    send({ type: 'error', sessionId: msg.sessionId, code: 'BUSY', message: 'Session is busy' })
    return
  }
  return s.runWorkflowTurn(msg.def, send, { runInputs: msg.runInputs })
}
```

- [ ] **Step 5: Tests + commit**

```bash
cd packages/sidecar && yarn test src/persistence/workflow-store.test.ts src/orchestrator/durable-executor.test.ts
```

```bash
git add packages/sidecar/src/persistence packages/sidecar/src/orchestrator packages/sidecar/src/session/handlers/session.ts packages/sidecar/src/main.ts packages/sidecar/src/session/workflow-runner.ts
git commit -m "$(cat <<'EOF'
feat(sidecar): bind workflow runs to sessions and support getActive

Persist session_id on workflow_runs; load latest for UI rehydrate.
EOF
)"
```

---

### Task 7: Frontend — per-session `workflowStore`

**Files:**
- Modify: `src/store/workflowStore.ts`
- Modify: `src/store/workflowStore.test.ts`

- [ ] **Step 1: Rewrite store API (breaking — only consumers are ArtifactPanel + tests)**

```ts
import { create } from 'zustand'
import type { WorkflowDef, RunState, OrchestratorEvent } from '@hip/protocol'

export interface SessionWorkflowSlice {
  activeWorkflow: WorkflowDef | null
  runState: RunState | null
  runId: string | null
}

interface WorkflowStoreState {
  bySession: Record<string, SessionWorkflowSlice>
  setActiveWorkflow: (sessionId: string, def: WorkflowDef | null, runId?: string) => void
  applyEvent: (sessionId: string, runId: string, evt: OrchestratorEvent) => void
  setSnapshot: (sessionId: string, def: WorkflowDef, state: RunState) => void
  clearSession: (sessionId: string) => void
  getSession: (sessionId: string) => SessionWorkflowSlice
}

const empty: SessionWorkflowSlice = { activeWorkflow: null, runState: null, runId: null }

function applyOrchestratorEvent(rs: RunState, evt: OrchestratorEvent): RunState {
  const next = { ...rs, nodes: { ...rs.nodes } }
  switch (evt.type) {
    case 'run:started':
      next.status = 'running'
      break
    case 'run:finished':
      next.status = evt.status
      break
    case 'run:cancelled':
      next.status = 'cancelled'
      break
    case 'node:started':
      next.nodes[evt.nodeId] = { ...next.nodes[evt.nodeId], status: 'running' }
      break
    case 'node:succeeded':
      next.nodes[evt.nodeId] = { status: 'succeeded', output: evt.output }
      break
    case 'node:failed':
      next.nodes[evt.nodeId] = { status: 'failed', error: evt.error }
      break
    case 'node:skipped':
      next.nodes[evt.nodeId] = { status: 'skipped' }
      break
  }
  return next
}

export const useWorkflowStore = create<WorkflowStoreState>()((set, get) => ({
  bySession: {},
  getSession: (sessionId) => get().bySession[sessionId] ?? empty,
  setActiveWorkflow: (sessionId, def, runId = '') =>
    set((s) => ({
      bySession: {
        ...s.bySession,
        [sessionId]: def
          ? {
              activeWorkflow: def,
              runId,
              runState: { runId, workflowId: def.id, status: 'pending', nodes: {} },
            }
          : empty,
      },
    })),
  applyEvent: (sessionId, runId, evt) =>
    set((s) => {
      const cur = s.bySession[sessionId]
      if (!cur?.runState) return s
      if (cur.runId && runId && cur.runId !== runId) return s // ignore stale
      return {
        bySession: {
          ...s.bySession,
          [sessionId]: {
            ...cur,
            runId: cur.runId || runId,
            runState: applyOrchestratorEvent(cur.runState, evt),
          },
        },
      }
    }),
  setSnapshot: (sessionId, def, state) =>
    set((s) => ({
      bySession: {
        ...s.bySession,
        [sessionId]: { activeWorkflow: def, runState: state, runId: state.runId },
      },
    })),
  clearSession: (sessionId) =>
    set((s) => {
      const { [sessionId]: _, ...rest } = s.bySession
      return { bySession: rest }
    }),
}))
```

- [ ] **Step 2: Update tests completely** (per-session isolation cases)

```ts
it('isolates two sessions', () => {
  useWorkflowStore.getState().setActiveWorkflow('a', mockWorkflow, 'r-a')
  useWorkflowStore.getState().setActiveWorkflow('b', mockWorkflow, 'r-b')
  useWorkflowStore.getState().applyEvent('a', 'r-a', { type: 'run:started' })
  expect(useWorkflowStore.getState().getSession('a').runState?.status).toBe('running')
  expect(useWorkflowStore.getState().getSession('b').runState?.status).toBe('pending')
})
```

- [ ] **Step 3: Run**

```bash
yarn vitest run src/store/workflowStore.test.ts
```

- [ ] **Step 4: Commit**

```bash
git add src/store/workflowStore.ts src/store/workflowStore.test.ts
git commit -m "$(cat <<'EOF'
feat(ui): make workflowStore per-session

Prevent multi-session DAG state from clobbering each other.
EOF
)"
```

---

### Task 8: Wire ServerMessage → store + auto-open DAG

**Files:**
- Modify: `src/domain/serverMessageEffects.ts`
- Create or modify: `src/domain/serverMessageEffects.test.ts` (if exists; else add)
- Modify: `src/domain/sessionService.ts` (load / activate → getActive)
- Modify: `src/components/artifact/ArtifactPanel.tsx` (+ test)
- Modify: `src/components/artifact/ArtifactPanel.test.tsx`

- [ ] **Step 1: Effects for workflow messages**

In `applyServerMessageEffects`:

```ts
case 'workflow:started': {
  useWorkflowStore.getState().setActiveWorkflow(msg.sessionId, msg.def, msg.runId)
  const domain = useDomainStore.getState()
  if (domain.activeSessionId === msg.sessionId) {
    const session = domain.sessions.find((s) => s.id === msg.sessionId)
    // code surface: open panel + dag tab
    if (session?.config.surface !== 'chat') {
      domain.setSessionCodePanelOpen?.(msg.sessionId, true)
      useUiStore.getState().setTab('dag')
    }
  }
  return
}
case 'workflow:event': {
  useWorkflowStore.getState().applyEvent(msg.sessionId, msg.runId, msg.event)
  return
}
case 'workflow:snapshot': {
  useWorkflowStore.getState().setSnapshot(msg.sessionId, msg.def, msg.state)
  return
}
case 'workflow:cleared': {
  useWorkflowStore.getState().clearSession(msg.sessionId)
  return
}
```

Check real API names: `setSessionCodePanelOpen` on domain store — grep and match existing patterns in effects.

If `setSessionCodePanelOpen` is not on domain store, use:

```ts
useDomainStore.getState().setSessionCodePanelOpen(msg.sessionId, true)
```

(already used in ArtifactPanel).

- [ ] **Step 2: session load rehydrate**

Where session becomes active / after `session:loaded` handling, send:

```ts
deps.send({ type: 'workflow:getActive', sessionId })
```

Good place: in `serverMessageEffects` for `session:loaded`, or `SessionService` after apply. Prefer effects:

```ts
case 'session:loaded':
  deps.send({ type: 'workflow:getActive', sessionId: msg.sessionId })
  // keep any existing loaded side effects
  return
```

Also on `session:deleted`:

```ts
useWorkflowStore.getState().clearSession(msg.sessionId)
```

- [ ] **Step 3: ArtifactPanel reads per-session**

```ts
const sid = useDomainStore((s) => s.activeSessionId)
const slice = useWorkflowStore((s) => (sid ? s.getSession(sid) : empty))
const activeWorkflow = slice.activeWorkflow
const runState = slice.runState
```

Replace hardcoded English empty state with `t('artifact.dagEmpty')`.

- [ ] **Step 4: i18n**

`en.ts` / `zh-CN.ts` / `zh-TW.ts`:

```ts
// artifact
dagEmpty: 'No active workflow. Switch to Cluster Mode and send a message to visualize the DAG.',
// zh-CN
dagEmpty: '当前无活跃工作流。切换到集群模式并发送消息后，将在此显示 DAG。',
```

Update orchMode tooltips if needed:

```ts
dagDesc: 'DAG workflow; the next message runs the default planner→coder graph',
// zh-CN
dagDesc: 'DAG 工作流；下一条消息将执行默认 planner→coder 图',
```

- [ ] **Step 5: Tests**

- Effects: mock stores, dispatch `workflow:started`, assert setTab + setActiveWorkflow
- ArtifactPanel: mock per-session slice

```bash
yarn vitest run src/store/workflowStore.test.ts src/components/artifact/ArtifactPanel.test.tsx src/domain/serverMessageEffects.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/domain src/store/workflowStore.ts src/components/artifact src/i18n
git commit -m "$(cat <<'EOF'
feat(ui): project workflow events into the DAG panel

Wire started/event/snapshot, rehydrate on session load, auto-open DAG tab.
EOF
)"
```

---

### Task 9: ModelPicker — disable orch toggle while running

**Files:**
- Modify: `src/components/chat/ModelPicker.tsx`
- Modify: `src/components/chat/ModelPicker.test.tsx`

- [ ] **Step 1: Test**

```ts
it('disables orch mode buttons while session is running', () => {
  // mock session status running
  render(...)
  expect(screen.getByRole('button', { name: /cluster|集群|dag/i })).toBeDisabled()
})
```

Adapt to actual accessible names (Chinese/English via i18n mock).

- [ ] **Step 2: Implement**

```ts
const status = useDomainStore((s) => {
  const id = s.activeSessionId
  return id ? s.sessions.find((x) => x.id === id)?.status : undefined
})
const orchDisabled = status === 'running'

// on both buttons:
disabled={orchDisabled}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ModelPicker.tsx src/components/chat/ModelPicker.test.tsx
git commit -m "$(cat <<'EOF'
fix(ui): disable orchestration mode toggle while a turn is running

Matches sidecar setOrchMode no-op when Session.running.
EOF
)"
```

---

### Task 10: Regression, docs, fallthrough test cleanup

**Files:**
- Modify: `packages/sidecar/src/session/session.test.ts` (ensure fallthrough test removed/updated)
- Modify: `docs/agent-orchestration-plan.md` (short status note under Phase 1)
- Modify: `docs/superpowers/specs/2026-07-10-orch-mode-dag-panel-closure-design.md` status → 实现中/已落地
- Modify: `src/components/artifact/ArtifactPanel.test.tsx` if still mocks global workflow store

- [ ] **Step 1: Full targeted test suite**

```bash
# protocol
cd packages/protocol && yarn test

# sidecar critical
cd packages/sidecar && yarn test \
  src/session/builtin-workflows.test.ts \
  src/session/session.test.ts \
  src/session/workflow-runner.test.ts \
  src/session/workflow-runner-activity.test.ts \
  src/persistence/workflow-store.test.ts \
  src/orchestrator/durable-executor.test.ts \
  src/orchestrator/executor.test.ts

# frontend
cd ../.. && yarn vitest run \
  src/store/workflowStore.test.ts \
  src/components/artifact/ArtifactPanel.test.tsx \
  src/components/chat/ModelPicker.test.tsx \
  src/domain/sessionStore.test.ts
```

- [ ] **Step 2: Manual checklist (document in commit body)**

1. New code session → Cluster Mode → send message → DAG tab opens with planner/coder nodes coloring.
2. Agents tab still shows worker agents.
3. Switch session → DAG state isolated.
4. Reload session → `workflow:getActive` rehydrates last snapshot.
5. Fast mode → no workflow:started; graph loop works.

- [ ] **Step 3: Doc status update**

In design spec header: `状态 | **实现完成**` (when all green).

In `docs/agent-orchestration-plan.md` Phase 1 note: main-loop cluster mode + read-only DAG UI closed (link to this plan).

- [ ] **Step 4: Final commit**

```bash
git add docs/
git commit -m "$(cat <<'EOF'
docs: mark orch-mode DAG panel closure complete

Link implementation plan and update orchestration plan status.
EOF
)"
```

---

## Dependency graph

```
Task1 (protocol)
  ├─► Task5 (emit events) ──┐
  │                         ├─► Task8 (frontend wire)
  └─► Task6 (getActive) ────┘         ▲
                                      │
Task2 (builtin) ─► Task4 (runTurn) ───┤
Task3 (runInputs) ─► Task4            │
Task7 (per-session store) ────────────┘
Task9 (ModelPicker) — independent after Task8 ideally
Task10 — last
```

Suggested PR grouping (maps to design PR plan):

| PR | Tasks |
|----|--------|
| PR-1 | Task 1 |
| PR-2 | Tasks 2–4 |
| PR-3 | Tasks 5–6 |
| PR-4 | Tasks 7–9 |
| PR-5 | Task 10 |

---

## Self-review

### Spec coverage

| Spec goal | Task |
|-----------|------|
| G1 mode semantic | Task 4 |
| G2 default template | Task 2, 4 |
| G3 visualization | Tasks 5, 7, 8 |
| G4 durable/rehydrate | Task 6, 8 |
| G5 Agents + DAG | Task 5 keeps agent:* |
| G6 tests | every task |
| No gate in v1 template | Task 2 |
| Auto-open DAG | Task 8 |
| Code-only DAG tab | Task 8 (surface check) |
| Disable toggle running | Task 9 |

### Placeholder scan

No TBD/TODO left in task steps; open product questions locked in plan header.

### Type consistency

- Message types: `workflow:started|event|snapshot|cleared|getActive`
- Store methods: `setActiveWorkflow(sessionId, def, runId?)`, `applyEvent(sessionId, runId, evt)`, `setSnapshot`, `clearSession`, `getSession`
- `runWorkflowTurn(..., opts?: { runInputs? })`
- `saveRun(run, meta?: { sessionId? })`

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-10-orch-mode-dag-panel-closure.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — same session with executing-plans checkpoints  

**Which approach?**
