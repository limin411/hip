# Agent Execution Trace — Design

> Slice 2 of the **multi-agent visibility** theme (see `memory/conversation-business-roadmap.md`).
> Builds on the merged message-actions slice. Next theme-sibling slices (structured plan tree, Diff-tab wiring) are explicitly out of scope here but this slice produces the data they need.

**Goal:** Make the Supervisor→Planner→Coder→Reviewer work *visible* by capturing each agent's tool calls and delegation reasons — today dropped at the first stream hop — and streaming them live into an expandable per-agent execution trace, persisted so replayed sessions match live.

**Why now:** Every layer (sidecar pump, protocol, reducer, persistence, UI) currently streams *text only*. The agent dashboard shows four near-identical prose blobs; the richer signals (tool calls, args, results, delegation instructions) exist on the deepagents stream but are discarded at `session.ts` `pumpSupervisor`/`pumpSubagents`. This slice turns the dashboard from prose into an auditable trace, and is the foundation the Diff tab depends on.

---

## Locked decisions

- **D1 — Centerpiece is the execution trace**, not a structured plan tree. The planner's plan stays as its streamed text (already shown in the planner card); we do **not** change the planner's `responseFormat`. Structured plan = a later slice.
- **D2 — Persisted (schema v4).** The trace survives `session:load`; replayed sessions render identically to live. Consistent with the message-actions slice persisting `stopped`.
- **D3 — Live granular events (Approach A).** New `tool:started`/`tool:finished` `ServerMessage`s emitted as calls begin/resolve, ordered by a monotonic per-turn `seq`. Tool result Promises resolved **off the critical path** to avoid stalling the iterator.
- **D4 — Delegation is modeled on the sub-agent, not as a tool call.** `task(...)` calls are filtered out of the trace; the supervisor→sub-agent delegation is carried by extending `agent:started` with `parentAgentId` + `taskInput`, rendered as an instruction header on each sub-agent card. (Confirmed over the alternative of showing literal `task(...)` rows in the supervisor trace.)
- **D5 — Truncation cap ~4 KB** on tool `input`/`output`, with a `truncated` flag, mirroring the existing `fs:read:result.truncated` convention. (Confirmed over full untruncated capture.)
- **D6 — No new `ClientMessage`.** Trace capture is entirely server-driven; the client only receives.
- **D7 — Cancellation composes with the existing partial-persist path.** `await Promise.allSettled(pending)` before finalize so a cancelled turn never hangs on a rejected tool promise; dangling non-terminal tools are written as `status:'error'` (interrupted).

---

## Architecture & data flow

```
deepagents stream (run.toolCalls / sub.toolCalls / sub.taskInput)
  └─ session.ts runTurn:
       pumpSupervisor()  ──┐
       pumpSubagents()   ──┼─ Promise.all   ── send(tool:started / tool:finished / agent:started+taskInput)
       consumeToolCalls()──┘                   record into trajectory Run.toolCalls
  └─ finalizeAndPersist: insertTurn → agent_runs (+ task_input/parent_agent_id) + tool_calls rows
        │
        ▼  WebSocket (ServerMessage)
  applyServerMessage reducer (sessionStore.ts):
       tool:started → append running ToolCall to AgentVM
       tool:finished → update by callId
       agent:started → seed taskInput/parentAgentId/toolCalls:[]
       session:loaded → agentVMfromRun hydrates toolCalls
        │
        ▼
  AgentDashboard → AgentCard (expandable) → ToolTrace → ToolCallRow
```

**Anchor files** (verified 2026-06-08, post message-actions merge): sidecar pump `packages/sidecar/src/session/session.ts:193-295` (`runTurn`/`finalizeAndPersist`); sub-agent config `agents.ts:3-33`; protocol `packages/protocol/src/index.ts:1-86`; persistence `schema.ts:8-21,44-81` + `store.ts:45-85`; reducer `src/domain/sessionStore.ts:7-16,81-165`; selectors `src/domain/hooks.ts:24-26`; UI `src/components/artifact/AgentDashboard.tsx:24-74`, `ArtifactPanel.tsx:15-21`; i18n `src/i18n/{en,zh-CN,zh-TW}.ts` `artifact` namespace.

---

## 1. Protocol (`packages/protocol/src/index.ts`)

New type:

```ts
export type ToolStatus = 'running' | 'finished' | 'error'

export interface ToolCall {
  callId: string
  agentId: string          // who called it: supervisor | planner | coder | reviewer
  name: string             // 'read_file' | 'write_file' | 'edit_file' | … (never 'task')
  input: string            // JSON-stringified args; clipped to ~4 KB if huge
  output?: string          // JSON-stringified result; absent while running
  status: ToolStatus
  error?: string
  seq: number              // monotonic per turn → deterministic ordering
  truncated?: boolean      // input and/or output was clipped; sticky-OR (once true, stays true)
}
```

`ServerMessage` additions (extend the existing `agent:started`, add two variants):

```ts
| { type: 'agent:started'; sessionId: string; agentId: string; role: AgentRole
    ; parentAgentId?: string; taskInput?: string }
| { type: 'tool:started'; sessionId: string; agentId: string; callId: string
    ; name: string; input: string; seq: number; truncated?: boolean }
| { type: 'tool:finished'; sessionId: string; agentId: string; callId: string
    ; status: 'finished' | 'error'; output?: string; error?: string; truncated?: boolean }
```

`AgentRun` gains delegation + trace fields (so persisted/replayed runs carry the trace; `session:loaded` already ships `agentRuns: AgentRun[]`):

```ts
export interface AgentRun {
  agentId: string
  role: AgentRole
  output: string
  startedAt: number
  finishedAt: number | null
  seq: number
  taskInput?: string        // instruction this sub-agent received
  parentAgentId?: string    // who delegated (always 'supervisor' for our 2-level tree)
  toolCalls?: ToolCall[]     // hydrated from the tool_calls table, ordered by seq
}
```

No `ClientMessage` change (D6).

---

## 2. Sidecar pump (`packages/sidecar/src/session/session.ts`)

A turn-scoped `let toolSeq = 0` and a `pending: Promise<void>[]` for off-critical-path completions.

**Extract a testable helper** (so the protocol-emitting logic is unit-testable with a fake async iterable, no live LLM):

```ts
// Consumes a ToolCallStream async-iterable for one agent.
// `record*` mutate the turn trajectory; `send` emits protocol events.
async function consumeToolCalls(
  agentId: string,
  toolCalls: AsyncIterable<ToolCallStreamLike>,
  ctx: { sessionId: string; nextSeq: () => number; send: SendFn
       ; pending: Promise<void>[]; record: TraceRecorder },
): Promise<void> {
  for await (const tc of toolCalls) {
    if (tc.name === 'task') continue            // D4: delegation modeled on the sub-agent
    const seq = ctx.nextSeq()
    const { text: input, truncated: inTrunc } = clip(stringify(tc.input))
    ctx.record.start(agentId, tc.callId, tc.name, input, seq, inTrunc)
    ctx.send({ type: 'tool:started', sessionId: ctx.sessionId, agentId,
               callId: tc.callId, name: tc.name, input, seq,
               ...(inTrunc ? { truncated: true } : {}) })
    // resolve completion OFF the critical path (D3) — never await inside the for-await
    ctx.pending.push((async () => {
      try {
        const status = await tc.status
        if (status === 'error') {
          const error = await tc.error
          ctx.record.finish(agentId, tc.callId, 'error', undefined, error, false)
          ctx.send({ type: 'tool:finished', sessionId: ctx.sessionId, agentId,
                     callId: tc.callId, status: 'error', error })
        } else {
          const { text: output, truncated } = clip(stringify(await tc.output))
          ctx.record.finish(agentId, tc.callId, 'finished', output, undefined, truncated)
          ctx.send({ type: 'tool:finished', sessionId: ctx.sessionId, agentId,
                     callId: tc.callId, status: 'finished', output,
                     ...(truncated ? { truncated: true } : {}) })
        }
      } catch { /* aborted / stream torn down — finalize coerces dangling tools */ }
    })())
  }
}
```

Helpers: `stringify(v)` = `JSON.stringify` with a `String(v)` fallback; `clip(s)` caps at `TOOL_BLOB_CAP = 4096` chars and reports `truncated`. `ToolCallStreamLike` is a structural subset (`name`, `callId`, `input`, `output: Promise`, `status: Promise`, `error: Promise`) so tests can hand-roll it.

**Wiring in `runTurn`:**
- Supervisor: add `consumeToolCalls('supervisor', run.toolCalls, ctx)` to the existing `Promise.all`.
- Sub-agents (`pumpSubagents`): per `sub`, `const taskInput = await safeTaskInput(sub)` (defensive — already resolved by yield time; `safeTaskInput` swallows rejection → `undefined`), then `ensureStarted(sub.name, roleForName(sub.name), 'supervisor', taskInput)`; then run the existing `sub.messages` token loop **and** `consumeToolCalls(sub.name, sub.toolCalls, ctx)` concurrently (`Promise.all`). `run.subagents` is serial, so `toolSeq` orders everything across agents.
- `ensureStarted` gains `parentAgentId?`/`taskInput?` params, threads them into the `agent:started` emit and the trajectory `Run`.
- **Before finalize:** `await Promise.allSettled(ctx.pending)` (D7). Then in finalize, any trajectory tool still non-terminal is coerced to `status:'error'` (interrupted) so the DB has no dangling `running` rows.

**Trajectory `Run`** (module-level type) gains `toolCalls: Map<string, ToolCallRecord>`, `taskInput?`, `parentAgentId?`. `finalizeAndPersist` maps `trajectory` entries → `AgentRun[]` including `toolCalls` (sorted by seq), `taskInput`, `parentAgentId`.

**Cancellation:** unchanged control flow from the message-actions slice — abort still persists the partial assistant message with `stopped:true`; now it also persists whatever tool records exist (terminal-coerced). `allSettled` guarantees no hang.

---

## 3. Persistence (schema **v4**, `packages/sidecar/src/persistence/`)

`schema.ts` — new `if (version < 4)` block, same BEGIN/COMMIT/ROLLBACK pattern as v2/v3:

```sql
CREATE TABLE IF NOT EXISTS tool_calls (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions(id)   ON DELETE CASCADE,
  agent_run_id  INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  call_id       TEXT NOT NULL,
  agent_id      TEXT NOT NULL,
  name          TEXT NOT NULL,
  input         TEXT NOT NULL,
  output        TEXT,
  status        TEXT NOT NULL,
  error         TEXT,
  seq           INTEGER NOT NULL,
  truncated     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON tool_calls(agent_run_id);
ALTER TABLE agent_runs ADD COLUMN task_input TEXT;
ALTER TABLE agent_runs ADD COLUMN parent_agent_id TEXT;
-- PRAGMA user_version = 4;
```

`store.ts`:
- **`insertTurn`** — switch the agent_runs insert from bulk to per-run so each run's `lastInsertRowid` is captured; write the new `task_input`/`parent_agent_id` columns; then insert that run's `tool_calls` rows (all inside the existing single transaction). Order tool rows by their `seq`.
- **`loadAgentRuns`** — select the new `task_input`/`parent_agent_id` columns; for each run, sub-select its `tool_calls` (`WHERE agent_run_id=? ORDER BY seq`) into `AgentRun.toolCalls`; convert `truncated` INTEGER→boolean, omit when 0.
- Cascade: `tool_calls.agent_run_id … ON DELETE CASCADE` + the existing `deleteLastAssistantMessage` (deletes the message → cascades agent_runs → cascades tool_calls) and `deleteSession` evict tool rows automatically. No FTS interaction (tool_calls is not indexed for search).

---

## 4. Reducer & view-model (`src/domain/sessionStore.ts`)

`AgentVM` gains:

```ts
toolCalls: ToolCall[]      // ordered by seq
taskInput?: string
parentAgentId?: string
```

Reducer branches in `applyServerMessage`:
- **`agent:started`** — seed `toolCalls: []`, `taskInput`, `parentAgentId` on the upserted AgentVM.
- **`tool:started`** — find the agent by `agentId`; append a `running` ToolCall built from the event (insert keeping `seq` order — append suffices since events arrive seq-increasing, but insert-by-seq defensively).
- **`tool:finished`** — find the agent; `.map` its `toolCalls`, update the one matching `callId` → `status`, `output`, `error`. `truncated` is **sticky-OR**: `next.truncated = prev.truncated || event.truncated` (an un-truncated output must not clear an input-truncation flag). The sidecar trace recorder OR-s identically before persisting.
- **`session:loaded`** — `agentVMfromRun` maps `run.toolCalls → AgentVM.toolCalls` and copies `taskInput`/`parentAgentId`.
- **`regenerateLastTurn`** — already resets `agents: []`; no change needed.

**Zustand v5 rule (AGENTS.md):** no new selector returns a fresh array/object. `useAgents()` keeps returning the stable state reference; `AgentDashboard`'s `find`/`filter` stay in the component body, not in a `useStore` selector. `tokenCount` mislabel (it is `tokens.length`) is left as-is — out of scope.

---

## 5. UI (`src/components/artifact/`)

Transform the dead-end `AgentCard` into an expandable execution trace. Extract focused files: **`AgentCard.tsx`** (now stateful/expandable, lifted out of `AgentDashboard.tsx`), **`ToolTrace.tsx`** (ordered tool-call list for one agent), **`ToolCallRow.tsx`** (one expandable tool row).

- **Card header** (always visible; click toggles expand): role dot · title · status badge · tool-count badge (`t('artifact.toolsCount', { count })`, hidden when 0) · elapsed.
- **Expanded body:**
  - Sub-agent only: a muted instruction header — `↳ {t('artifact.delegatedBy')} Supervisor` + `taskInput` text.
  - **`ToolTrace`** — ordered `ToolCallRow`s. Each row: tool icon · `name` · a target hint parsed from `input` (e.g. a file path for `read_file`/`write_file`/`edit_file`; best-effort, falls back to nothing) · status indicator (`running` ⟳ spinner / `finished` ✓ / `error` ✗). Row click expands to show `arguments` (`input`) and `output`/`error`, each with a `truncated` hint when flagged. Empty trace → `t('artifact.noTools')`.
  - The agent's streamed text (`tokens`) stays, rendered below the trace.
- **Live behavior:** a card auto-expands while its agent is `running`, collapses when `done`; tool rows start collapsed.
- **Fix the mislabel:** the "Sub-agents" label currently uses `t('artifact.parallelAgents')` — replace with a new `artifact.subAgents` key (these agents are serial, not parallel). Leave the old key unused/removed.

**i18n** — new keys in `en.ts`, `zh-CN.ts`, `zh-TW.ts` under `artifact`: `subAgents`, `toolsCount` (pluralized count), `delegatedBy`, `arguments`, `output`, `failed`, `truncated`, `noTools`.

---

## 6. Testing

Mirror the project's posture: fakes for logic, `skipIf(!apiKey)` for the live LLM, type-check + GUI for presentational React (no RTL/DOM infra).

**Sidecar (Vitest, `environment: 'node'`):**
- `schema.test.ts` — migrate reaches `user_version 4`; `tool_calls` table + `agent_runs.task_input`/`parent_agent_id` exist; idempotent re-run; upgrades a v3 DB in place.
- `store.test.ts` — `insertTurn` with `toolCalls` round-trips through `loadAgentRuns` (toolCalls ordered by seq, `taskInput`/`parentAgentId` preserved, `truncated` boolean); `deleteLastAssistantMessage` and `deleteSession` cascade-evict `tool_calls`.
- **`consumeToolCalls` unit test** — feed a hand-rolled `AsyncIterable<ToolCallStreamLike>` with pre-resolved `status`/`output`/`error` Promises; assert: `tool:started` then `tool:finished` per call, monotonic `seq`, `name:'task'` filtered out, `error` path, `truncated` flag on an oversized blob, and that the trajectory recorder captured matching records. No deepagents/live model.
- Existing live DeepSeek multi-agent + cancel tests continue to cover the real stream wiring (`skipIf(!apiKey)`).

**Frontend (Vitest, `environment: 'node'`):**
- `sessionStore` reducer (pure) — `tool:started` appends a running tool to the right agent; `tool:finished` updates by `callId`; ordering by `seq`; `session:loaded` hydrates `toolCalls`/`taskInput`; `agent:started` seeds fields; `regenerateLastTurn` clears.
- `AgentCard`/`ToolTrace`/`ToolCallRow` — type-check + manual GUI acceptance.

**Verification gate:** sidecar + frontend type-check, `yarn build`, full Vitest suite green (incl. live DeepSeek when key present), then GUI acceptance of a real multi-agent turn showing the live trace and a reload showing the identical persisted trace.

---

## 7. Scope boundaries (YAGNI — explicitly OUT)

- **Structured plan tree** — planner `responseFormat` unchanged; plan stays as streamed text.
- **Diff-tab wiring** — separate slice. *But this slice captures the coder's `write_file`/`edit_file` calls*, which is exactly the data that slice consumes.
- **Reasoning / token-usage display** (`msg.reasoning`, `msg.usage`) — available but not surfaced here.
- **Nested sub-agents** — `AgentRole` stays the closed 4-role enum; `parentAgentId` is always `'supervisor'`.
- **Rendering `task()` as tool rows** — delegation is shown via the agent tree + instruction header (D4).
- **Run-history across turns / `tokenCount` mislabel fix** — not in this slice.

---

## File-by-file change list

| File | Change |
|---|---|
| `packages/protocol/src/index.ts` | `ToolStatus`, `ToolCall`; extend `agent:started`; add `tool:started`/`tool:finished`; extend `AgentRun` |
| `packages/sidecar/src/session/session.ts` | `consumeToolCalls` helper + `clip`/`stringify`/`safeTaskInput`; wire supervisor + per-sub tool pumps; extend `ensureStarted`; `Run` gains tool/delegation fields; `allSettled` before finalize; finalize maps tool records → `AgentRun` |
| `packages/sidecar/src/persistence/schema.ts` | v4 migration: `tool_calls` table + index + `agent_runs` columns |
| `packages/sidecar/src/persistence/store.ts` | `insertTurn` per-run insert + tool rows; `loadAgentRuns` hydrates tool calls + delegation |
| `src/domain/sessionStore.ts` | `AgentVM` fields; `tool:started`/`tool:finished` branches; `agent:started`/`agentVMfromRun` seed/hydrate |
| `src/components/artifact/AgentDashboard.tsx` | use extracted `AgentCard`; `parallelAgents`→`subAgents` |
| `src/components/artifact/AgentCard.tsx` (new) | expandable card |
| `src/components/artifact/ToolTrace.tsx` (new) | ordered tool list |
| `src/components/artifact/ToolCallRow.tsx` (new) | expandable tool row |
| `src/i18n/{en,zh-CN,zh-TW}.ts` | new `artifact.*` keys |
| `packages/sidecar/src/persistence/{schema,store}.test.ts` | v4 + tool round-trip/cascade tests |
| `packages/sidecar/src/session/*.test.ts` | `consumeToolCalls` unit test |
| `src/domain/sessionStore.test.ts` | reducer branch tests |

---

## Open risks / notes

1. **Promise-stall (handled by D3).** `tc.output`/`tc.status` are Promises; resolving them inside the `for await` would block the next call. The `pending[]` fire-and-forward pattern is the fix and is the main thing to get right in implementation.
2. **Ordering (handled by D3).** Tool and token events arrive from independent queues; the per-turn `seq` is the only ordering authority — the reducer must trust `seq`, not arrival order.
3. **`insertTurn` rowid coupling.** Linking `tool_calls.agent_run_id` requires per-run `lastInsertRowid`; the switch from bulk insert must stay inside one transaction to preserve atomicity.
4. **Volume.** Coder whole-file writes can be large; the 4 KB `clip` cap (D5) bounds protocol/state/DB size. Tool-call count per turn is small (handful), so immutable `.map` rebuilds in the reducer stay cheap.
5. **`safeTaskInput` timing.** `sub.taskInput` should be resolved by the time `sub` is yielded; the defensive `await` + rejection-swallow guards against the edge case without blocking the token stream (the token loop runs concurrently).
