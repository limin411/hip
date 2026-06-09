# Agent Delegation Trace + Pipeline Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render each subagent's delegation instruction (`taskInput`), parent link, and text output; derive per-agent status from `finishedAt`; show "Thought for Ns" from the run's `elapsedMs`; and consolidate the two trace pipelines onto `Message` as the single per-turn source (deleting `SessionVM.agents`/`AgentVM`).

**Architecture:** The turn↔run link is already persisted (`agent_runs.message_id`); we stop discarding it. `AgentRun` gains `messageId`, `Message` gains `agentRuns?`. The sidecar attaches each turn's runs to its message (at `message:complete` and `session:loaded`). The client reducer folds live `agent:started`/`token:stream`/`agent:finished` into the trailing message's `agentRuns` (mirroring the proven `toolCalls` lifecycle) and `message:complete` overwrites with the server-authoritative copy. One shared `groupByAgent(message)` merges `timeline` (reasoning/tools) + `agentRuns` (taskInput/output/timing) for both the inline timeline and the right-panel card. `SessionVM.agents`/`AgentVM`/`useAgents` are removed.

**Tech Stack:** TypeScript, React, Zustand, vitest; Node `node:sqlite` sidecar; yarn workspaces monorepo (`@hip/protocol`, `@hip/sidecar`, frontend `src/`).

**No DB migration.** Schema stays at v5; `agent_runs.message_id` (added in v4) already links runs to turns.

**Green-increment ordering.** Protocol field additions are additive first; the removal of the top-level `session:loaded.agentRuns` happens LAST (Task 13) so every commit type-checks.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `packages/protocol/src/index.ts` | Modify | `AgentRun.messageId?`, `Message.agentRuns?`; later drop top-level `session:loaded.agentRuns` |
| `packages/sidecar/src/persistence/store.ts` | Modify | `loadAgentRuns` returns `messageId`; new `loadMessagesWithRuns` |
| `packages/sidecar/src/session/session.ts` | Modify | `finalizeAndPersist` stamps `messageId` on runs + includes `agentRuns` on the completed message |
| `packages/sidecar/src/session/session-manager.ts` | Modify | `session:load` ships messages-with-runs; drop top-level `agentRuns` |
| `src/lib/roleColor.ts` | Modify | Add shared `ROLE_TITLE` (currently duplicated) |
| `src/lib/turnAgents.ts` | Create | `TurnAgent` type + enriched `groupByAgent(message, live)` (timeline ∪ agentRuns) |
| `src/lib/turnAgents.test.ts` | Create | Pure unit tests for `groupByAgent` |
| `src/domain/sessionStore.ts` | Modify | Fold runs into the message; delete `AgentVM`/`agents`/`agentVMfromRun`/`upsertAgent`/`coerceRunningTools` |
| `src/domain/sessionStore.test.ts` | Modify | Drop `agents` from fixtures; replace AgentVM tests with run-folding tests |
| `src/domain/hooks.ts`, `src/domain/index.ts` | Modify | Delete `useAgents` + `EMPTY_AGENTS` |
| `src/components/artifact/AgentDashboard.tsx` | Modify | Import `groupByAgent`/`TurnAgent` from `lib/turnAgents` |
| `src/components/artifact/AgentCard.tsx` | Modify | Render `taskInput`/delegated-by/`output`; "Thought for Ns" from `elapsedMs` |
| `src/components/chat/TurnTimeline.tsx` | Modify | Accept `agentRuns`; inline "Delegated to {role}" summary row |
| `src/components/chat/MessageBubble.tsx` | Modify | Pass `agentRuns={message.agentRuns}` |
| `src/i18n/{en,zh-CN,zh-TW}.ts` | Modify | Add `chat.delegatedTo` (reuse existing `artifact.delegatedBy`/`artifact.output`) |

---

## Task 1: Protocol — additive fields

**Files:**
- Modify: `packages/protocol/src/index.ts:24-34` (`AgentRun`), `:13-22` (`Message`)

- [ ] **Step 1: Add `messageId` to `AgentRun`**

In `packages/protocol/src/index.ts`, change the `AgentRun` interface (currently lines 24-34) to add one optional field. `messageId` maps the existing `agent_runs.message_id` column, which is NULL for a turn that produced no assistant message — hence optional:

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
  toolCalls?: ToolCall[]     // ordered by seq; hydrated from the tool_calls table
  messageId?: string         // turn this run belongs to (maps agent_runs.message_id; NULL → no assistant message)
}
```

- [ ] **Step 2: Add `agentRuns` to `Message`**

Change the `Message` interface (currently lines 13-22) to add:

```ts
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentId?: string
  timestamp: number
  stopped?: boolean
  timeline?: TimelineStep[]
  toolCalls?: ToolCall[]
  agentRuns?: AgentRun[]     // per-agent run metadata for THIS turn (taskInput/output/timing/parent)
}
```

- [ ] **Step 3: Verify type-check (additive, nothing breaks yet)**

Run: `yarn type-check && yarn workspace @hip/sidecar type-check`
Expected: both PASS (fields are optional; no consumer changed).

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): AgentRun.messageId + Message.agentRuns (additive)"
```

---

## Task 2: Sidecar store — surface `messageId` + `loadMessagesWithRuns`

**Files:**
- Modify: `packages/sidecar/src/persistence/store.ts:104-113` (`loadAgentRuns`), add `loadMessagesWithRuns`
- Test: `packages/sidecar/src/persistence/store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/sidecar/src/persistence/store.test.ts` (match the existing setup style in that file — it constructs a `SessionStore` over an in-memory DB and uses `insertTurn`). Add:

```ts
it('loadMessagesWithRuns attaches each turn\'s agent runs to its message by message_id', () => {
  const { store } = freshStore() // existing helper in this test file: opens schema, returns { store }
  store.insertSession({ id: 's1', title: 'T', config: '{}', createdAt: 1, updatedAt: 1 })
  store.insertTurn(
    { id: 'turn1', sessionId: 's1', agentId: 'supervisor', content: 'final answer', timestamp: 10 },
    's1',
    [
      { agentId: 'supervisor', role: 'supervisor', output: 'final answer', startedAt: 10, finishedAt: 20, seq: 0 },
      { agentId: 'planner-1', role: 'planner', output: 'the plan', startedAt: 11, finishedAt: 15, seq: 1, taskInput: 'make a plan', parentAgentId: 'supervisor' },
    ],
  )
  const msgs = store.loadMessagesWithRuns('s1')
  expect(msgs).toHaveLength(1)
  const runs = msgs[0].agentRuns!
  expect(runs.map((r) => r.agentId)).toEqual(['supervisor', 'planner-1'])
  expect(runs[1]).toMatchObject({ taskInput: 'make a plan', parentAgentId: 'supervisor', output: 'the plan', messageId: 'turn1' })
})
```

If `freshStore()` does not exist in the file, reuse whatever the existing tests use to obtain a `store` (e.g. an `openDb`/`new SessionStore(...)` helper at the top of the file) — do not invent a new harness.

- [ ] **Step 2: Run it to confirm it fails**

Run: `yarn vitest run packages/sidecar/src/persistence/store.test.ts -t "loadMessagesWithRuns"`
Expected: FAIL — `store.loadMessagesWithRuns is not a function`.

- [ ] **Step 3: Add `messageId` to `loadAgentRuns` and add `loadMessagesWithRuns`**

In `store.ts`, change `loadAgentRuns` (lines 104-113) to select and return `message_id`:

```ts
loadAgentRuns(sessionId: string): AgentRun[] {
  const rows = this.db.prepare(`SELECT id,message_id,agent_id,role,output,started_at,finished_at,seq,task_input,parent_agent_id FROM agent_runs WHERE session_id=? ORDER BY seq`).all(sessionId) as
    { id: number; message_id: string | null; agent_id: string; role: AgentRole; output: string; started_at: number; finished_at: number | null; seq: number; task_input: string | null; parent_agent_id: string | null }[]
  const toolStmt = this.db.prepare(`SELECT call_id,agent_id,name,input,output,status,error,seq,truncated FROM tool_calls WHERE agent_run_id=? ORDER BY seq`)
  return rows.map((r) => {
    const tools = (toolStmt.all(r.id) as { call_id: string; agent_id: string; name: string; input: string; output: string | null; status: ToolStatus; error: string | null; seq: number; truncated: number }[])
      .map((t): ToolCall => ({ callId: t.call_id, agentId: t.agent_id, name: t.name, input: t.input, status: t.status, seq: t.seq, ...(t.output != null ? { output: t.output } : {}), ...(t.error != null ? { error: t.error } : {}), ...(t.truncated ? { truncated: true } : {}) }))
    return { agentId: r.agent_id, role: r.role, output: r.output, startedAt: r.started_at, finishedAt: r.finished_at, seq: r.seq, ...(r.message_id != null ? { messageId: r.message_id } : {}), ...(r.task_input != null ? { taskInput: r.task_input } : {}), ...(r.parent_agent_id != null ? { parentAgentId: r.parent_agent_id } : {}), toolCalls: tools }
  })
}

/** Load messages with each turn's agent runs attached by message_id. Runs with a NULL
 *  message_id (a turn that produced no assistant message) have no message to attach to and are dropped. */
loadMessagesWithRuns(sessionId: string): Message[] {
  const messages = this.loadMessages(sessionId)
  const byMessage = new Map<string, AgentRun[]>()
  for (const r of this.loadAgentRuns(sessionId)) {
    if (r.messageId == null) continue
    const arr = byMessage.get(r.messageId) ?? []
    arr.push(r)
    byMessage.set(r.messageId, arr)
  }
  return messages.map((m) => {
    const runs = byMessage.get(m.id)
    return runs && runs.length ? { ...m, agentRuns: runs } : m
  })
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `yarn vitest run packages/sidecar/src/persistence/store.test.ts`
Expected: PASS (all store tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/persistence/store.ts packages/sidecar/src/persistence/store.test.ts
git commit -m "feat(sidecar/store): loadAgentRuns exposes messageId; add loadMessagesWithRuns"
```

---

## Task 3: Sidecar session — stamp `messageId` + emit `agentRuns` on completion

**Files:**
- Modify: `packages/sidecar/src/session/session.ts:434-456` (`finalizeAndPersist`)
- Test: `packages/sidecar/src/session/session-unit.test.ts` (or the existing finalize/persist unit test file)

- [ ] **Step 1: Write the failing test**

In `packages/sidecar/src/session/session-unit.test.ts`, add a test asserting `message:complete` carries `agentRuns` with `messageId === turnId`. Mirror the existing pattern there for driving a turn and capturing `send` messages. Skeleton:

```ts
it('message:complete carries per-turn agentRuns stamped with messageId', async () => {
  const sent: ServerMessage[] = []
  // ...drive one delegating turn through a Session built with a fake model that delegates once...
  const complete = sent.find((m) => m.type === 'message:complete') as Extract<ServerMessage, { type: 'message:complete' }>
  expect(complete.message.agentRuns?.length).toBeGreaterThan(0)
  for (const r of complete.message.agentRuns!) expect(r.messageId).toBe(complete.message.id)
})
```

If the existing suite already has a delegating-turn harness, reuse it and just add the `agentRuns`/`messageId` assertions rather than re-building the harness.

- [ ] **Step 2: Run it to confirm it fails**

Run: `yarn vitest run packages/sidecar/src/session/session-unit.test.ts -t "agentRuns stamped"`
Expected: FAIL — `complete.message.agentRuns` is `undefined`.

- [ ] **Step 3: Stamp `messageId` and attach `agentRuns`**

In `finalizeAndPersist` (session.ts:434-456), after `const runs: AgentRun[] = trajectoryToRuns(trajectory)` (line 439), stamp the turn id, and include the runs on the emitted message:

```ts
const runs: AgentRun[] = trajectoryToRuns(trajectory).map((r) => ({ ...r, messageId: turnId }))
const timeline = trajectoryToTimeline(trajectory)
const toolCalls = runs.flatMap((r) => r.toolCalls ?? []).sort((a, b) => a.seq - b.seq)
if (this.store) {
  this.store.insertTurn(
    finalText ? { id: turnId, sessionId: this.id, agentId: 'supervisor', content: finalText, timestamp: ts, stopped, timeline } : null,
    this.id,
    runs,
  )
  this.store.touchSession(this.id, ts)
}
send({
  type: 'message:complete',
  sessionId: this.id,
  message: { id: turnId, role: 'assistant', content: finalText, agentId: 'supervisor', timestamp: ts, timeline, toolCalls, agentRuns: runs, ...(stopped ? { stopped: true } : {}) },
})
```

(`insertTurn` already writes `agent_runs.message_id = assistant?.id`, so persisted `message_id` and the in-message `messageId` agree.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `yarn vitest run packages/sidecar/src/session/session-unit.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-unit.test.ts
git commit -m "feat(sidecar/session): emit per-turn agentRuns (messageId-stamped) on message:complete"
```

---

## Task 4: Sidecar manager — ship messages-with-runs on load

**Files:**
- Modify: `packages/sidecar/src/session/session-manager.ts:57-61` (`session:load`)
- Test: `packages/sidecar/src/session/session-manager-persist.test.ts`

> NOTE: the top-level `agentRuns` field stays on the wire for now (additive transition); it is removed in Task 13 after the client stops reading it.

- [ ] **Step 1: Write the failing test**

In `packages/sidecar/src/session/session-manager-persist.test.ts`, add a test that after persisting a delegating turn and issuing `session:load`, the loaded messages carry `agentRuns`:

```ts
it('session:load attaches agentRuns to each message', async () => {
  // ...persist one delegating turn via a Session+store, then new manager over the same store...
  const sent: ServerMessage[] = []
  manager.handle({ type: 'session:load', sessionId }, (m) => sent.push(m))
  await Promise.resolve()
  const loaded = sent.find((m) => m.type === 'session:loaded') as Extract<ServerMessage, { type: 'session:loaded' }>
  const assistant = loaded.messages.find((m) => m.role === 'assistant')!
  expect(assistant.agentRuns?.some((r) => r.taskInput != null)).toBe(true)
})
```

Reuse the file's existing persist harness for setup.

- [ ] **Step 2: Run it to confirm it fails**

Run: `yarn vitest run packages/sidecar/src/session/session-manager-persist.test.ts -t "attaches agentRuns"`
Expected: FAIL — `assistant.agentRuns` is `undefined`.

- [ ] **Step 3: Use `loadMessagesWithRuns`**

In `session-manager.ts`, change the `session:load` case (lines 57-61) to:

```ts
case 'session:load':
  send({ type: 'session:loaded', sessionId: msg.sessionId,
    messages: this.store?.loadMessagesWithRuns(msg.sessionId) ?? [],
    agentRuns: this.store?.loadAgentRuns(msg.sessionId) ?? [] })
  break
```

(Top-level `agentRuns` retained transitionally; removed in Task 13.)

- [ ] **Step 4: Run the test to confirm it passes**

Run: `yarn vitest run packages/sidecar/src/session/session-manager-persist.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/session-manager-persist.test.ts
git commit -m "feat(sidecar/manager): session:load ships messages with per-turn agentRuns"
```

---

## Task 5: Shared `ROLE_TITLE`

**Files:**
- Modify: `src/lib/roleColor.ts`, `src/components/artifact/AgentCard.tsx:18`

> `ROLE_TITLE` is currently duplicated in `AgentCard.tsx:18` and `sessionStore.ts:41`; the new `TurnTimeline` delegation row needs it too. Extract once.

- [ ] **Step 1: Add `ROLE_TITLE` to `roleColor.ts`**

Append to `src/lib/roleColor.ts`:

```ts
/** Role → display title, shared by the agent panel and the inline timeline. */
export const ROLE_TITLE: Record<AgentRole, string> = {
  supervisor: 'Supervisor',
  planner: 'Planner',
  coder: 'Coder',
  reviewer: 'Reviewer',
}
```

- [ ] **Step 2: Use it in `AgentCard.tsx`**

In `AgentCard.tsx`, delete the local `const ROLE_TITLE` (line 18) and import it: change line 6 from `import { ROLE_COLOR } from '@/lib/roleColor'` to `import { ROLE_COLOR, ROLE_TITLE } from '@/lib/roleColor'`.

- [ ] **Step 3: Verify type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/roleColor.ts src/components/artifact/AgentCard.tsx
git commit -m "refactor(ui): share ROLE_TITLE from roleColor"
```

---

## Task 6: New `lib/turnAgents.ts` — enriched `groupByAgent`

**Files:**
- Create: `src/lib/turnAgents.ts`, `src/lib/turnAgents.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/turnAgents.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Message } from '@hip/protocol'
import { groupByAgent } from './turnAgents'

function msg(over: Partial<Message>): Message {
  return { id: 't1', role: 'assistant', content: '', timestamp: 0, ...over }
}

describe('groupByAgent', () => {
  it('merges timeline reasoning/tools with run taskInput/output/timing', () => {
    const m = msg({
      timeline: [
        { kind: 'reasoning', stepSeq: 0, agentId: 'planner-1', role: 'planner', content: 'thinking' },
        { kind: 'tool', stepSeq: 1, agentId: 'planner-1', role: 'planner', callId: 'c1' },
      ],
      toolCalls: [{ callId: 'c1', agentId: 'planner-1', name: 'read_file', input: '{}', status: 'finished', seq: 1 }],
      agentRuns: [{ agentId: 'planner-1', role: 'planner', output: 'the plan', startedAt: 1000, finishedAt: 3500, seq: 0, taskInput: 'plan it', parentAgentId: 'supervisor', messageId: 't1' }],
    })
    const [a] = groupByAgent(m, false)
    expect(a).toMatchObject({ agentId: 'planner-1', role: 'planner', reasoning: 'thinking', taskInput: 'plan it', parentAgentId: 'supervisor', output: 'the plan', status: 'done', elapsedMs: 2500 })
    expect(a.tools).toHaveLength(1)
  })

  it('includes an output-only agent that has a run but no timeline steps', () => {
    const m = msg({
      timeline: [{ kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'plan' }],
      agentRuns: [
        { agentId: 'supervisor', role: 'supervisor', output: 'answer', startedAt: 0, finishedAt: 9, seq: 0, messageId: 't1' },
        { agentId: 'reviewer-1', role: 'reviewer', output: 'looks good', startedAt: 5, finishedAt: 8, seq: 1, taskInput: 'review', parentAgentId: 'supervisor', messageId: 't1' },
      ],
    })
    const ids = groupByAgent(m, false).map((a) => a.agentId)
    expect(ids).toContain('reviewer-1')
    expect(groupByAgent(m, false).find((a) => a.agentId === 'reviewer-1')!.output).toBe('looks good')
  })

  it('status is running only while live and the run is unfinished', () => {
    const m = msg({
      timeline: [{ kind: 'reasoning', stepSeq: 0, agentId: 'coder-1', role: 'coder', content: 'x' }],
      agentRuns: [{ agentId: 'coder-1', role: 'coder', output: '', startedAt: 1000, finishedAt: null, seq: 0, messageId: 't1' }],
    })
    expect(groupByAgent(m, true)[0].status).toBe('running')
    expect(groupByAgent(m, false)[0].status).toBe('done') // not live → done even if unfinished
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `yarn vitest run src/lib/turnAgents.test.ts`
Expected: FAIL — cannot resolve `./turnAgents`.

- [ ] **Step 3: Implement `turnAgents.ts`**

Create `src/lib/turnAgents.ts`:

```ts
import type { AgentRole, Message, TimelineStep, ToolCall } from '@hip/protocol'

/** Per-turn, per-agent activity bucket derived from a Message's timeline + toolCalls + agentRuns. */
export interface TurnAgent {
  agentId: string
  role: AgentRole
  reasoning: string
  tools: ToolCall[]
  status: 'running' | 'done'
  output: string
  elapsedMs: number
  taskInput?: string
  parentAgentId?: string
}

/**
 * Group a turn's flat timeline + toolCalls + agentRuns into per-agent buckets.
 * Unions agents from the timeline (in appearance order) with agents that only have a run
 * (e.g. an output-only subagent), so none are dropped. reasoning/tools come from the timeline;
 * status/timing/taskInput/parentAgentId/output come from the matching run. Derived OUTSIDE any
 * Zustand selector (returns a fresh array).
 */
export function groupByAgent(message: Message | null, live: boolean): TurnAgent[] {
  if (!message) return []
  const steps: TimelineStep[] = message.timeline ?? []
  const runs = message.agentRuns ?? []
  const runByAgent = new Map(runs.map((r) => [r.agentId, r]))
  const toolByCallId = new Map((message.toolCalls ?? []).map((tc) => [tc.callId, tc]))
  const order: string[] = []
  const buckets = new Map<string, { role: AgentRole; reasoning: string[]; tools: ToolCall[] }>()
  const ensure = (agentId: string, role: AgentRole) => {
    let b = buckets.get(agentId)
    if (!b) { b = { role, reasoning: [], tools: [] }; buckets.set(agentId, b); order.push(agentId) }
    return b
  }
  for (const step of [...steps].sort((a, b) => a.stepSeq - b.stepSeq)) {
    const b = ensure(step.agentId, step.role)
    if (step.kind === 'reasoning') b.reasoning.push(step.content)
    else { const tc = toolByCallId.get(step.callId); if (tc) b.tools.push(tc) }
  }
  for (const r of runs) ensure(r.agentId, r.role) // output-only agents
  return order.map((agentId) => {
    const b = buckets.get(agentId)!
    const run = runByAgent.get(agentId)
    const status: 'running' | 'done' = live && run != null && run.finishedAt == null ? 'running' : 'done'
    const elapsedMs = run && run.finishedAt != null ? run.finishedAt - run.startedAt : 0
    return {
      agentId,
      role: b.role,
      reasoning: b.reasoning.join('\n\n'),
      tools: b.tools,
      status,
      output: run?.output ?? '',
      elapsedMs,
      ...(run?.taskInput ? { taskInput: run.taskInput } : {}),
      ...(run?.parentAgentId ? { parentAgentId: run.parentAgentId } : {}),
    }
  })
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `yarn vitest run src/lib/turnAgents.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/turnAgents.ts src/lib/turnAgents.test.ts
git commit -m "feat(ui): turnAgents.groupByAgent merges timeline + agentRuns"
```

---

## Task 7: Reducer — fold runs into the message (alongside existing s.agents)

**Files:**
- Modify: `src/domain/sessionStore.ts` (add helpers + extend `agent:started`/`token:stream`/`agent:finished`)
- Test: `src/domain/sessionStore.test.ts`

> Add folding ALONGSIDE the existing `s.agents` maintenance so existing tests stay green; the deletion happens in Task 8.

- [ ] **Step 1: Write the failing tests**

Add to `src/domain/sessionStore.test.ts`:

```ts
it('agent:started folds a run onto the turn message (supervisor creates the message)', () => {
  const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }] })] }
  const next = applyServerMessage(s0, { type: 'agent:started', sessionId: 's1', agentId: 'supervisor', role: 'supervisor', turnId: 't1' }, 100)
  const m = next.sessions[0].messages.at(-1)!
  expect(m.id).toBe('t1')
  expect(m.agentRuns).toMatchObject([{ agentId: 'supervisor', role: 'supervisor', messageId: 't1', finishedAt: null }])
})

it('subagent agent:started folds a run with taskInput onto the existing turn message', () => {
  const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, { id: 't1', role: 'assistant', content: '', timestamp: 100, agentRuns: [{ agentId: 'supervisor', role: 'supervisor', output: '', startedAt: 100, finishedAt: null, seq: 0, messageId: 't1' }] }] })] }
  const next = applyServerMessage(s0, { type: 'agent:started', sessionId: 's1', agentId: 'planner-1', role: 'planner', turnId: 't1', parentAgentId: 'supervisor', taskInput: 'make a plan' }, 110)
  const runs = next.sessions[0].messages.at(-1)!.agentRuns!
  expect(runs.map((r) => r.agentId)).toEqual(['supervisor', 'planner-1'])
  expect(runs[1]).toMatchObject({ taskInput: 'make a plan', parentAgentId: 'supervisor', messageId: 't1' })
})

it('subagent token:stream appends to that run\'s output, not the answer body', () => {
  const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, { id: 't1', role: 'assistant', content: '', timestamp: 100, agentRuns: [{ agentId: 'planner-1', role: 'planner', output: '', startedAt: 100, finishedAt: null, seq: 1, messageId: 't1' }] }] })] }
  const next = applyServerMessage(s0, { type: 'token:stream', sessionId: 's1', agentId: 'planner-1', delta: 'a plan', turnId: 't1' }, 120)
  const m = next.sessions[0].messages.at(-1)!
  expect(m.content).toBe('') // answer body untouched
  expect(m.agentRuns![0].output).toBe('a plan')
})

it('agent:finished sets finishedAt on the run', () => {
  const s0 = { sessions: [baseSession({ messages: [{ id: 't1', role: 'assistant', content: '', timestamp: 100, agentRuns: [{ agentId: 'planner-1', role: 'planner', output: '', startedAt: 100, finishedAt: null, seq: 1, messageId: 't1' }] }] })] }
  const next = applyServerMessage(s0, { type: 'agent:finished', sessionId: 's1', agentId: 'planner-1', turnId: 't1' }, 2600)
  expect(next.sessions[0].messages.at(-1)!.agentRuns![0].finishedAt).toBe(2600)
})
```

- [ ] **Step 2: Run them to confirm they fail**

Run: `yarn vitest run src/domain/sessionStore.test.ts -t "folds a run"`
Expected: FAIL — `agentRuns` undefined / output not appended.

- [ ] **Step 3: Add fold helpers**

In `sessionStore.ts`, after `appendAssistantDelta` (around line 128), add:

```ts
/** Upsert an AgentRun onto the turn's trailing assistant message (keyed by turnId). No-op if the turn is unknown. */
function upsertRun(messages: Message[], turnId: string, run: AgentRun): Message[] {
  if (!messages.some((m) => m.id === turnId)) return messages
  return messages.map((m) => {
    if (m.id !== turnId) return m
    const runs = m.agentRuns ?? []
    return runs.some((r) => r.agentId === run.agentId)
      ? { ...m, agentRuns: runs.map((r) => (r.agentId === run.agentId ? run : r)) }
      : { ...m, agentRuns: [...runs, run] }
  })
}

/** Append a delta to a subagent run's output on the trailing assistant message. */
function appendRunOutput(messages: Message[], agentId: string, delta: string): Message[] {
  const idx = messages.length - 1
  const last = messages[idx]
  if (!last || last.role !== 'assistant' || !last.agentRuns) return messages
  return messages.map((m, k) => (k !== idx ? m : { ...m, agentRuns: m.agentRuns!.map((r) => (r.agentId === agentId ? { ...r, output: r.output + delta } : r)) }))
}

/** Set finishedAt on the run for the given turn + agent. */
function setRunFinished(messages: Message[], turnId: string, agentId: string, now: number): Message[] {
  return messages.map((m) => (m.id !== turnId || !m.agentRuns ? m : { ...m, agentRuns: m.agentRuns.map((r) => (r.agentId === agentId ? { ...r, finishedAt: now } : r)) }))
}
```

Ensure `AgentRun` is imported (it already is, line 3).

- [ ] **Step 4: Fold in the three handlers (keep s.agents lines for now)**

In the `agent:started` case (lines 176-195), after building the `messages` (the `ensureAssistantMessage` ternary) but inside the returned object, fold the run. Replace the `messages:` line with a local + fold:

```ts
case 'agent:started': {
  const run: AgentRun = {
    agentId: msg.agentId, role: msg.role, output: '', startedAt: now, finishedAt: null, seq: 0, messageId: msg.turnId,
    ...(msg.taskInput ? { taskInput: msg.taskInput } : {}),
    ...(msg.parentAgentId ? { parentAgentId: msg.parentAgentId } : {}),
  }
  return update(msg.sessionId, (s) => {
    const base = msg.role === 'supervisor' ? ensureAssistantMessage(s.messages, msg.turnId, msg.agentId, now) : s.messages
    return {
      ...s,
      status: 'running',
      error: null,
      messages: upsertRun(base, msg.turnId, run),
      agents: upsertAgent(s.agents, { /* UNCHANGED existing AgentVM object, lines 183-194 */ }),
    }
  })
}
```

(Keep the existing `upsertAgent(...)` block verbatim — it is removed in Task 8.)

In the `token:stream` case (lines 197-206), add subagent-output folding while preserving the supervisor→content path. The supervisor/subagent decision now resolves from the folded run (token:stream carries no role), falling back to the literal agentId:

```ts
case 'token:stream':
  return update(msg.sessionId, (s) => {
    const agent = s.agents.find((a) => a.id === msg.agentId)            // UNCHANGED (s.agents removed in Task 8)
    const agents = s.agents.map((a) => (a.id === msg.agentId ? { ...a, tokens: a.tokens + msg.delta, tokenCount: a.tokens.length + msg.delta.length } : a)) // UNCHANGED
    const trailing = s.messages[s.messages.length - 1]
    const run = trailing?.role === 'assistant' ? trailing.agentRuns?.find((r) => r.agentId === msg.agentId) : undefined
    const isSupervisor = run ? run.role === 'supervisor' : msg.agentId === 'supervisor'
    const messages = isSupervisor
      ? appendAssistantDelta(s.messages, msg.delta, msg.agentId, now)
      : appendRunOutput(s.messages, msg.agentId, msg.delta)
    return { ...s, agents, messages }
  })
```

In the `agent:finished` case (lines 214-218), add the message fold alongside the existing `agents:` map:

```ts
case 'agent:finished':
  return update(msg.sessionId, (s) => ({
    ...s,
    messages: setRunFinished(s.messages, msg.turnId, msg.agentId, now),
    agents: s.agents.map((a) => (a.id === msg.agentId ? { ...a, status: 'done', elapsedMs: now - a.startedAt } : a)), // UNCHANGED
  }))
```

- [ ] **Step 5: Run the tests**

Run: `yarn vitest run src/domain/sessionStore.test.ts`
Expected: PASS — new fold tests AND all existing tests (s.agents still maintained).

- [ ] **Step 6: Commit**

```bash
git add src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "feat(store): fold per-agent runs onto the turn message"
```

---

## Task 8: Reducer — delete the `s.agents`/`AgentVM` pipeline

**Files:**
- Modify: `src/domain/sessionStore.ts`, `src/domain/sessionStore.test.ts`

- [ ] **Step 1: Update the test fixture and remove AgentVM tests**

In `sessionStore.test.ts`: remove `agents: []` from `baseSession` (lines 5-20). Delete the three AgentVM-only tests: `'agent:started adds a running agent...'`, `'token:stream accumulates agent tokens and tokenCount'`, `'agent:finished marks done and materializes elapsedMs'` (the originals at lines 22-39, 56-60). Update the two supervisor `token:stream` tests (lines 41-54) to drop the `agents:` setup and instead seed the trailing assistant message with a supervisor run:

```ts
it('token:stream from a supervisor streams into the answer body via its run', () => {
  const s0 = { sessions: [baseSession({ messages: [
    { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
    { id: 't1', role: 'assistant', content: '', timestamp: 5, agentRuns: [{ agentId: 'supervisor', role: 'supervisor', output: '', startedAt: 5, finishedAt: null, seq: 0, messageId: 't1' }] },
  ] })] }
  const next = applyServerMessage(s0, { type: 'token:stream', sessionId: 's1', agentId: 'supervisor', delta: 'Hel', turnId: 't1' }, 6)
  expect(next.sessions[0].messages.at(-1)!.content).toBe('Hel')
})
```

(Update the second supervisor test similarly — append to existing content.)

- [ ] **Step 2: Run to confirm the suite fails to compile / type-check fails**

Run: `yarn type-check`
Expected: FAIL — `SessionVM.agents` still referenced by deleted-fixture sites and dead helpers (this drives the deletions below).

- [ ] **Step 3: Delete the AgentVM pipeline in `sessionStore.ts`**

Make these deletions/edits:
- Remove the `AgentVM` interface (lines 7-19) and the `AgentStatus` type (line 5).
- Remove `agents: AgentVM[]` from `SessionVM` (line 36).
- Remove the `ROLE_TITLE` const (lines 41-46) — no longer used here.
- Remove `upsertAgent` (lines 48-52), `coerceRunningTools` (lines 56-62), `agentVMfromRun` (lines 147-158).
- In `summaryToVM` (line 144) and `emptySession` (line 307): remove `agents: []`.
- In `agent:started`: remove the `agents: upsertAgent(...)` property added in Task 7 (keep the `upsertRun` line).
- In `token:stream`: remove the `const agent = ...`, `const agents = ...`, and the `agents` key in the return (keep the run-resolution + `messages`).
- In `agent:finished`: remove the `agents:` map (keep `setRunFinished`).
- In `tool:started` (lines 220-239) and `tool:finished` (lines 241-260): remove the `agents: s.agents.map(...)` property (keep the `messages:` map).
- In `message:complete` (lines 262-265): remove `agents: coerceRunningTools(s.agents)` (keep `messages: finalizeAssistant(...)` and `status: 'idle'`).
- In `error` CANCELLED (line 273): remove `agents: coerceRunningTools(s.agents)`.
- In `session:loaded` (lines 287-288): change to `return update(msg.sessionId, (s) => ({ ...s, loaded: true, messages: msg.messages }))`.
- In `regenerateLastTurn` (lines 374-382): remove `agents: []` from the returned object.
- Remove now-unused imports: `AgentRole` is still used by `upsertReasoning`; `AgentRun` is used by the fold helpers. Remove nothing that's still referenced — let `yarn type-check` guide.

- [ ] **Step 4: Run type-check + tests**

Run: `yarn type-check && yarn vitest run src/domain/sessionStore.test.ts`
Expected: PASS. (If `useAgents` in `hooks.ts` still references `AgentVM`, that's fixed in Task 9 — type-check may still flag `hooks.ts`; proceed to Task 9 before the full green gate, or do Tasks 8-9 back to back.)

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "refactor(store): delete the dead AgentVM/s.agents pipeline (Message is the single source)"
```

---

## Task 9: Remove `useAgents`

**Files:**
- Modify: `src/domain/hooks.ts:24-26` (+ imports line 3, `EMPTY_AGENTS` line 6), `src/domain/index.ts:3`

- [ ] **Step 1: Delete `useAgents` + `EMPTY_AGENTS`**

In `hooks.ts`: remove the `useAgents` function (lines 24-26), the `EMPTY_AGENTS` const (line 6), and `AgentVM` from the import on line 3 (`import { useDomainStore, type SessionError, type SessionVM } from './sessionStore'`).

In `index.ts` (line 3): remove `useAgents` from the re-export list.

- [ ] **Step 2: Verify no consumers remain**

Run: `grep -rn "useAgents" src` → expect no matches.

- [ ] **Step 3: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/domain/hooks.ts src/domain/index.ts
git commit -m "refactor(domain): drop useAgents (no consumer after consolidation)"
```

---

## Task 10: AgentDashboard + AgentCard render the new data

**Files:**
- Modify: `src/components/artifact/AgentDashboard.tsx`, `src/components/artifact/AgentCard.tsx`

- [ ] **Step 1: Point AgentDashboard at `lib/turnAgents`**

In `AgentDashboard.tsx`: delete the local `groupByAgent` (lines 6-24) and the `TurnAgent` import from `./AgentCard`. Replace the imports so it uses the shared helper:

```ts
import { useTranslation } from 'react-i18next'
import { useActiveMessages, useActiveSessionStatus } from '@/domain'
import { groupByAgent } from '@/lib/turnAgents'
import { AgentCard } from './AgentCard'
import type { Message } from '@hip/protocol'
```

The body (latest assistant message → `groupByAgent(latest, live)` → supervisor/children split) stays unchanged.

- [ ] **Step 2: Move `TurnAgent` to the shared module in AgentCard**

In `AgentCard.tsx`: delete the local `TurnAgent` interface (lines 9-16) and import it: `import type { TurnAgent } from '@/lib/turnAgents'`.

- [ ] **Step 3: Render delegation + output + elapsed in AgentCard**

Replace the expanded-body block (lines 45-50) and the status `<span>` (line 42):

```tsx
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusDot status={agent.status} color={color} />
          <span className="text-[11px] capitalize text-ink-tertiary">
            {agent.status === 'done' && agent.elapsedMs > 0
              ? t('chat.thoughtFor', { seconds: Math.round(agent.elapsedMs / 1000) })
              : agent.status}
          </span>
        </div>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-3 pt-2.5">
          {agent.taskInput && (
            <div className="rounded-md bg-surface-muted px-2.5 py-1.5 text-[12px] leading-snug text-ink-secondary">
              <span className="text-ink-tertiary">{t('artifact.delegatedBy')} {ROLE_TITLE.supervisor} · </span>
              {agent.taskInput}
            </div>
          )}
          {agent.reasoning && <pre className="whitespace-pre-wrap break-words rounded-md bg-surface-muted px-2.5 py-1.5 font-sans text-[12px] leading-snug text-ink-secondary">{agent.reasoning}</pre>}
          <ToolTrace tools={agent.tools} />
          {agent.role !== 'supervisor' && agent.output && (
            <div>
              <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t('artifact.output')}</div>
              <pre className="whitespace-pre-wrap break-words rounded-md bg-surface-muted px-2.5 py-1.5 font-sans text-[12px] leading-snug text-ink-secondary">{agent.output}</pre>
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 4: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/artifact/AgentDashboard.tsx src/components/artifact/AgentCard.tsx
git commit -m "feat(ui): AgentCard shows delegation instruction, subagent output, and elapsed time"
```

---

## Task 11: Inline delegation summary row in TurnTimeline

**Files:**
- Modify: `src/components/chat/TurnTimeline.tsx`, `src/components/chat/MessageBubble.tsx:49`

- [ ] **Step 1: Accept `agentRuns` and render a delegation row**

In `TurnTimeline.tsx`: add `AgentRun` to the type import (line 4), import the shared `ROLE_TITLE`, take `useTranslation`, extend the props, and emit a "Delegated to {role}: {taskInput}" row at each non-supervisor agent's first appearance.

Change the imports + props + body:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Brain } from 'lucide-react'
import type { AgentRole, AgentRun, TimelineStep, ToolCall } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { ToolCallRow } from '@/components/artifact/ToolCallRow'
import { ROLE_COLOR, ROLE_TITLE } from '@/lib/roleColor'

// ...AgentBadge + ThinkingDisclosure unchanged...

interface TurnTimelineProps {
  steps?: TimelineStep[]
  toolCalls?: ToolCall[]
  agentRuns?: AgentRun[]
}

export function TurnTimeline({ steps, toolCalls, agentRuns }: TurnTimelineProps) {
  const { t } = useTranslation()
  if (!steps || steps.length === 0) return null
  const ordered = [...steps].sort((a, b) => a.stepSeq - b.stepSeq)
  const byCallId = new Map((toolCalls ?? []).map((tc) => [tc.callId, tc]))
  const taskByAgent = new Map((agentRuns ?? []).filter((r) => r.taskInput).map((r) => [r.agentId, r.taskInput!]))
  const seen = new Set<string>()
  return (
    <div className="mb-2 flex flex-col gap-1.5" data-testid="turn-timeline">
      {ordered.flatMap((step) => {
        const nodes: React.ReactNode[] = []
        if (!seen.has(step.agentId)) {
          seen.add(step.agentId)
          const task = taskByAgent.get(step.agentId)
          if (task && step.role !== 'supervisor') {
            nodes.push(
              <div key={`d-${step.agentId}`} className="flex items-center gap-2 text-[12px] text-ink-tertiary" data-testid="delegation-row">
                <AgentBadge role={step.role} />
                <span className="truncate">
                  <span className="font-medium text-ink-secondary">{t('chat.delegatedTo', { role: ROLE_TITLE[step.role] })}</span>: {task}
                </span>
              </div>,
            )
          }
        }
        if (step.kind === 'reasoning') {
          nodes.push(<ThinkingDisclosure key={`r-${step.stepSeq}`} role={step.role} content={step.content} />)
        } else {
          const tool = byCallId.get(step.callId)
          if (tool) nodes.push(
            <div key={`t-${step.stepSeq}`} className="flex gap-2">
              <AgentBadge role={step.role} />
              <div className="min-w-0 flex-1"><ToolCallRow tool={tool} /></div>
            </div>,
          )
        }
        return nodes
      })}
    </div>
  )
}
```

(`ThinkingDisclosure`'s `seconds` prop is left unused inline — per-burst timing is out of scope; "Thought for Ns" is shown on the AgentCard from `elapsedMs`.)

- [ ] **Step 2: Pass `agentRuns` from MessageBubble**

In `MessageBubble.tsx:49`, change:

```tsx
            <TurnTimeline steps={message.timeline} toolCalls={message.toolCalls} agentRuns={message.agentRuns} />
```

- [ ] **Step 3: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/TurnTimeline.tsx src/components/chat/MessageBubble.tsx
git commit -m "feat(ui): inline delegation summary row in TurnTimeline"
```

---

## Task 12: i18n — `chat.delegatedTo`

**Files:**
- Modify: `src/i18n/en.ts:35`, `src/i18n/zh-CN.ts:35`, `src/i18n/zh-TW.ts:35`

> `artifact.delegatedBy` and `artifact.output` already exist in all three locales — only `chat.delegatedTo` is new.

- [ ] **Step 1: Add the key after `thoughtFor` in each locale**

`en.ts` (after line 35 `thoughtFor: 'Thought for {{seconds}}s',`):

```ts
      delegatedTo: 'Delegated to {{role}}',
```

`zh-CN.ts` (after `thoughtFor: '已思考 {{seconds}} 秒',`):

```ts
      delegatedTo: '委派给 {{role}}',
```

`zh-TW.ts` (after `thoughtFor: '已思考 {{seconds}} 秒',`):

```ts
      delegatedTo: '委派給 {{role}}',
```

- [ ] **Step 2: Type-check (types derive from zh-CN)**

Run: `yarn type-check`
Expected: PASS (all three locales carry the key, so the derived translation type is satisfied).

- [ ] **Step 3: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat(i18n): chat.delegatedTo (en, zh-CN, zh-TW)"
```

---

## Task 13: Drop the top-level `session:loaded.agentRuns`

**Files:**
- Modify: `packages/protocol/src/index.ts:114`, `packages/sidecar/src/session/session-manager.ts:57-61`, any sidecar test asserting the top-level array

> Now that the client reads `Message.agentRuns` and no longer maps the top-level array, remove it (the single-source cleanup).

- [ ] **Step 1: Remove from the protocol**

In `index.ts:114`, change `session:loaded` to:

```ts
  | { type: 'session:loaded'; sessionId: string; messages: Message[] }
```

- [ ] **Step 2: Remove from the manager send**

In `session-manager.ts`, the `session:load` case becomes:

```ts
case 'session:load':
  send({ type: 'session:loaded', sessionId: msg.sessionId, messages: this.store?.loadMessagesWithRuns(msg.sessionId) ?? [] })
  break
```

- [ ] **Step 3: Fix any test referencing the removed field**

Run: `grep -rn "agentRuns" packages/sidecar/src --include=*.test.ts` and update any test that reads `session:loaded`'s top-level `agentRuns` to read `messages[i].agentRuns` instead. (The client `applyServerMessage` `session:loaded` case was already updated in Task 8 to read only `msg.messages`.)

- [ ] **Step 4: Full type-check + test gate**

Run: `yarn type-check && yarn workspace @hip/sidecar type-check && yarn test`
Expected: ALL PASS. (Live-DeepSeek suites are `skipIf` without a key — they skip in CI, run locally with the key.)

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/index.ts packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session
git commit -m "refactor(protocol): drop top-level session:loaded.agentRuns (per-message single source)"
```

---

## Task 14: Final verification gate

- [ ] **Step 1: Whole-suite + type-check**

Run: `yarn type-check && yarn workspace @hip/sidecar type-check && yarn test && yarn build`
Expected: type-check PASS (both); vitest all green (live-LLM skipped without key); `vite build` succeeds.

- [ ] **Step 2: Confirm no dead references remain**

Run: `grep -rn "AgentVM\|useAgents\|agentVMfromRun\|s\.agents\|\.agents" src --include=*.ts --include=*.tsx | grep -v "\.test\." | grep -v "artifact.agents"`
Expected: no matches (other than the `'agents'` tab label string in `ArtifactPanel`/i18n).

- [ ] **Step 3: Manual GUI acceptance (user, per project convention)**

Run a delegating prompt (e.g. "build a small HTML page" with a project folder set) against the live DeepSeek key and confirm:
- Inline timeline shows a "Delegated to Planner: …" row under the turn.
- Right-panel agent cards show the full `taskInput` ("delegated by Supervisor · …") and the subagent's full output (the plan / the review).
- Per-agent status flips correctly (a subagent with no tool but streaming text shows `running`, not premature `done`; a finished zero-tool agent shows `done`).
- A finished agent's status reads "Thought for Ns" with a real number.
- Reload the session (restart or re-select) and confirm all of the above reproduces from persistence.
- Cancel mid-turn: the partial turn keeps its partial agentRuns; regenerate drops them cleanly.

---

## Self-Review

**Spec coverage:**
- Render `taskInput` + parent → Task 10 (AgentCard) + Task 11 (inline row). ✅
- Subagent text output → Task 7 (fold), Task 10 (AgentCard output block). ✅
- Status from `finishedAt` → Task 6 (`groupByAgent`). ✅
- "Thought for Ns" from `elapsedMs` → Task 10 (AgentCard status). **Deviation from spec wording:** spec mentioned wiring the inline `ThinkingDisclosure` `seconds`; per-burst timing isn't captured, so this slice shows elapsed on the AgentCard only (matches the user's "use elapsedMs" choice) and leaves the inline disclosure label as-is. Flagged at handoff.
- Pipeline consolidation (delete `SessionVM.agents`/`AgentVM`/`useAgents`) → Tasks 8-9. ✅
- `AgentRun.messageId` + `Message.agentRuns`, server attaches runs, no DB migration → Tasks 1-4. ✅
- `session:loaded` single source → Task 13. ✅
- Live fold mirrors `toolCalls`; `message:complete` overwrites → Task 7 + existing finalize path. ✅
- Union timeline ∪ agentRuns so output-only agents appear → Task 6 (+ test). ✅
- `token:stream` role resolved from folded run (no protocol change) → Task 7. ✅

**Placeholder scan:** No TBD/TODO; each code step shows real code; test steps show real assertions. Where a step says "reuse the existing harness," that is an instruction to follow an established in-file pattern, not a missing implementation.

**Type consistency:** `groupByAgent(message, live)` signature consistent across Tasks 6/10. `TurnAgent` defined once (Task 6), imported in Tasks 10. `upsertRun`/`appendRunOutput`/`setRunFinished` names consistent across Tasks 7/8. `AgentRun.messageId` optional everywhere (Tasks 1/2/3/7). `loadMessagesWithRuns` name consistent across Tasks 2/4/13.
