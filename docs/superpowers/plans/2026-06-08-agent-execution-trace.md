# Agent Execution Trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture each agent's tool calls + delegation reasons (today dropped at the deepagents stream hop), stream them live as `tool:started`/`tool:finished`, persist them (schema v4), and render an expandable per-agent execution trace — so the Supervisor→Planner→Coder→Reviewer work becomes visible and replayed sessions match live.

**Architecture:** A turn-scoped tool pump (`consumeToolCalls`) consumes `run.toolCalls` (supervisor) and `sub.toolCalls` (each sub-agent) concurrently with the existing token pumps. Tool-result Promises resolve **off the critical path** (`pending[]` + `Promise.allSettled` before finalize) so the iterator never stalls. Records flow: sidecar trajectory → `AgentRun.toolCalls` → SQLite `tool_calls` table → `session:loaded` hydration → Zustand `AgentVM.toolCalls` → UI. A monotonic per-turn `seq` is the only ordering authority.

**Tech Stack:** TypeScript; deepagents/LangGraph streaming; `node:sqlite` (versioned migrations via `PRAGMA user_version`); Zustand v5; React + react-i18next; Vitest (`environment: 'node'`, no DOM/RTL — presentational React verified by type-check + GUI).

**Spec:** `docs/superpowers/specs/2026-06-08-agent-execution-trace-design.md` (decisions D1–D7).

---

## Conventions for every task

- **Branch:** already on `feat/agent-execution-trace`. Do NOT switch branches.
- **Run one test file:** `yarn test <path>` (e.g. `yarn test packages/sidecar/src/persistence/schema.test.ts`). One test by name: append `-t "substring"`.
- **Full suite:** `yarn test`  ·  **Frontend type-check:** `yarn type-check`  ·  **Sidecar type-check:** `yarn workspace @hip/sidecar type-check`  ·  **Build:** `yarn build`.
- **A real `DEEPSEEK_API_KEY` is loaded from `.env`** by `vitest.config.ts`, so the `skipIf(!apiKey)` live suites run. Never print the key.
- **Commit message footer (required):** end every commit body with
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Zustand v5 rule (AGENTS.md):** never write a `useStore` selector that returns a fresh object/array. This plan adds no selectors; `find`/`filter`/`sort` stay in component bodies.

---

## File Structure

| File | Responsibility | New? |
|---|---|---|
| `packages/protocol/src/index.ts` | `ToolStatus`, `ToolCall`; extend `agent:started`; add `tool:started`/`tool:finished`; extend `AgentRun` | modify |
| `packages/sidecar/src/session/tool-trace.ts` | Pure trace logic: `clip`, `stringify`, `consumeToolCalls`, `trajectoryToRuns`, `TraceRun`/`TraceRecorder`/`ToolCallStreamLike` | **new** |
| `packages/sidecar/src/session/tool-trace.test.ts` | Unit tests for the above (fake async-iterable) | **new** |
| `packages/sidecar/src/session/session.ts` | Wire tool pumps into `runTurn`; extend `Run`/`ensureStarted`; `allSettled` before finalize; map via `trajectoryToRuns` | modify |
| `packages/sidecar/src/persistence/schema.ts` | v4 migration: `tool_calls` table + index + `agent_runs` columns | modify |
| `packages/sidecar/src/persistence/store.ts` | `insertTurn` writes tool rows + delegation cols; `loadAgentRuns` hydrates | modify |
| `packages/sidecar/src/persistence/{schema,open,store}.test.ts` | v4 + tool round-trip/cascade | modify |
| `src/domain/sessionStore.ts` | `AgentVM` fields; `tool:started`/`tool:finished` branches; seed/hydrate | modify |
| `src/domain/sessionStore.test.ts` | reducer branch tests + update existing AgentVM literals | modify |
| `src/i18n/{en,zh-CN,zh-TW}.ts` | new `artifact.*` keys; rename `parallelAgents`→`subAgents` | modify |
| `src/components/artifact/ToolCallRow.tsx` | One expandable tool row | **new** |
| `src/components/artifact/ToolTrace.tsx` | Ordered tool-call list | **new** |
| `src/components/artifact/AgentCard.tsx` | Expandable agent card (lifted out of AgentDashboard) | **new** |
| `src/components/artifact/AgentDashboard.tsx` | Use `AgentCard`; thin orchestrator | modify |

---

## Task 1: Protocol types

**Files:**
- Modify: `packages/protocol/src/index.ts`

Type-only additions; verification is the downstream type-check (no runtime test in this package).

- [ ] **Step 1: Add `ToolStatus` + `ToolCall` after the `AgentRun` block**

Insert immediately after the `AgentRun` interface (currently ends at line 27):

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
  truncated?: boolean      // input and/or output was clipped; sticky-OR
}
```

- [ ] **Step 2: Extend `AgentRun`** to carry delegation + trace (so persisted/replayed runs include them). Replace the `AgentRun` interface body (lines 20-27) with:

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
}
```

- [ ] **Step 3: Extend `agent:started` + add tool events** in the `ServerMessage` union. Replace the `agent:started` line (line 70) with the extended version, and add the two tool variants right after the `agent:finished` line (line 72):

```ts
  | { type: 'agent:started'; sessionId: string; agentId: string; role: AgentRole; parentAgentId?: string; taskInput?: string }
  | { type: 'token:stream'; sessionId: string; agentId: string; delta: string }
  | { type: 'agent:finished'; sessionId: string; agentId: string }
  | { type: 'tool:started'; sessionId: string; agentId: string; callId: string; name: string; input: string; seq: number; truncated?: boolean }
  | { type: 'tool:finished'; sessionId: string; agentId: string; callId: string; status: 'finished' | 'error'; output?: string; error?: string; truncated?: boolean }
```

- [ ] **Step 4: Type-check**

Run: `yarn type-check && yarn workspace @hip/sidecar type-check`
Expected: PASS (pure additions; no consumers reference the new fields yet).

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "$(cat <<'EOF'
feat(protocol): ToolCall + tool:started/finished events; AgentRun trace fields

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Persistence — schema v4

**Files:**
- Modify: `packages/sidecar/src/persistence/schema.ts`
- Test: `packages/sidecar/src/persistence/schema.test.ts`, `packages/sidecar/src/persistence/open.test.ts`

- [ ] **Step 1: Update the existing migrate test to v4 and assert the new objects**

In `schema.test.ts`, replace the first test (`'adds title_custom, a stopped column, and reaches user_version 3'`, lines 10-19) with:

```ts
  it('adds tool_calls + agent_runs delegation columns and reaches user_version 4', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(columns(db, 'sessions')).toContain('title_custom')
    expect(columns(db, 'messages')).toContain('stopped')
    expect(columns(db, 'agent_runs')).toEqual(expect.arrayContaining(['task_input', 'parent_agent_id']))
    expect(columns(db, 'tool_calls')).toEqual(
      expect.arrayContaining(['agent_run_id', 'call_id', 'agent_id', 'name', 'input', 'output', 'status', 'error', 'seq', 'truncated']),
    )
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(4)
  })
```

Also update the idempotency test (lines 21-27) to additionally assert no duplicate `tool_calls` columns — replace its body's final two `expect` lines region with:

```ts
    expect(columns(db, 'sessions').filter((c) => c === 'title_custom')).toHaveLength(1)
    expect(columns(db, 'messages').filter((c) => c === 'stopped')).toHaveLength(1)
    expect(columns(db, 'agent_runs').filter((c) => c === 'task_input')).toHaveLength(1)
```

- [ ] **Step 2: Update `open.test.ts` user_version assertion**

In `open.test.ts`, change the test title `'creates core tables and sets user_version = 3'` → `'… = 4'` and the assertion `.toBe(3)` → `.toBe(4)` (lines 6 and 11).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `yarn test packages/sidecar/src/persistence/schema.test.ts packages/sidecar/src/persistence/open.test.ts`
Expected: FAIL — `user_version` is 3, `tool_calls` table does not exist.

- [ ] **Step 4: Add the v4 migration block**

In `schema.ts`, insert this block immediately after the `if (version < 3) { … }` block (after line 80, before the closing brace of `migrate`):

```ts
  if (version < 4) {
    db.exec('BEGIN')
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tool_calls (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
          agent_run_id INTEGER NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
          call_id TEXT NOT NULL, agent_id TEXT NOT NULL, name TEXT NOT NULL,
          input TEXT NOT NULL, output TEXT, status TEXT NOT NULL, error TEXT,
          seq INTEGER NOT NULL, truncated INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON tool_calls(agent_run_id);
      `)
      db.exec(`ALTER TABLE agent_runs ADD COLUMN task_input TEXT`)
      db.exec(`ALTER TABLE agent_runs ADD COLUMN parent_agent_id TEXT`)
      db.exec('PRAGMA user_version = 4')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn test packages/sidecar/src/persistence/schema.test.ts packages/sidecar/src/persistence/open.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/persistence/schema.ts packages/sidecar/src/persistence/schema.test.ts packages/sidecar/src/persistence/open.test.ts
git commit -m "$(cat <<'EOF'
feat(persistence): schema v4 — tool_calls table + agent_runs delegation cols

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Persistence — store insertTurn + loadAgentRuns

**Files:**
- Modify: `packages/sidecar/src/persistence/store.ts`
- Test: `packages/sidecar/src/persistence/store.test.ts`

- [ ] **Step 1: Write failing tests**

Append these tests inside the `describe('SessionStore', …)` block in `store.test.ts` (before its closing `})`):

```ts
  it('round-trips tool calls + delegation through insertTurn/loadAgentRuns', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      { id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 3 },
      's1',
      [
        { agentId: 'supervisor', role: 'supervisor', output: 'done', startedAt: 1, finishedAt: 3, seq: 0, toolCalls: [] },
        {
          agentId: 'coder', role: 'coder', output: 'wrote it', startedAt: 1, finishedAt: 2, seq: 1,
          parentAgentId: 'supervisor', taskInput: 'implement the plan',
          toolCalls: [
            { callId: 'c1', agentId: 'coder', name: 'write_file', input: '{"path":"/a.ts"}', output: 'ok', status: 'finished', seq: 2 },
            { callId: 'c2', agentId: 'coder', name: 'read_file', input: '{"path":"/b.ts"}', status: 'error', error: 'ENOENT', seq: 3, truncated: true },
          ],
        },
      ],
    )
    const runs = store.loadAgentRuns('s1')
    const coder = runs.find((r) => r.agentId === 'coder')!
    expect(coder).toMatchObject({ taskInput: 'implement the plan', parentAgentId: 'supervisor' })
    expect(coder.toolCalls!.map((t) => [t.callId, t.name, t.status])).toEqual([
      ['c1', 'write_file', 'finished'],
      ['c2', 'read_file', 'error'],
    ])
    expect(coder.toolCalls![0]).toMatchObject({ output: 'ok' })
    expect(coder.toolCalls![1]).toMatchObject({ error: 'ENOENT', truncated: true })
    expect(runs.find((r) => r.agentId === 'supervisor')!.toolCalls).toEqual([])
  })

  it('deleteLastAssistantMessage cascades tool_calls', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      { id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 3 },
      's1',
      [{ agentId: 'coder', role: 'coder', output: 'x', startedAt: 1, finishedAt: 2, seq: 0, toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'finished', seq: 0 }] }],
    )
    expect(store.deleteLastAssistantMessage('s1')).toBe(true)
    expect(store.loadAgentRuns('s1')).toHaveLength(0)
    expect(store.countToolCalls('s1')).toBe(0)
  })

  it('deleteSession cascades tool_calls', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      { id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 3 },
      's1',
      [{ agentId: 'coder', role: 'coder', output: 'x', startedAt: 1, finishedAt: 2, seq: 0, toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'finished', seq: 0 }] }],
    )
    store.deleteSession('s1')
    expect(store.countToolCalls('s1')).toBe(0)
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `yarn test packages/sidecar/src/persistence/store.test.ts -t "tool"`
Expected: FAIL — `insertTurn` ignores `toolCalls`; `countToolCalls` undefined; `loadAgentRuns` lacks `taskInput`.

- [ ] **Step 3: Update imports + `insertTurn` + `loadAgentRuns` + add `countToolCalls`**

In `store.ts`, extend the protocol import (line 2) to include the new types:

```ts
import type { AgentRole, AgentRun, Message, SessionSummary, SearchHit, ToolCall, ToolStatus } from '@hip/protocol'
```

Replace `insertTurn` (lines 52-73) with:

```ts
  insertTurn(
    assistant: { id: string; sessionId: string; agentId: string; content: string; timestamp: number; stopped?: boolean } | null,
    sessionId: string,
    runs: AgentRun[],
  ): void {
    this.db.exec('BEGIN')
    try {
      if (assistant) {
        this.insertMessage({ id: assistant.id, sessionId, role: 'assistant', agentId: assistant.agentId, content: assistant.content, timestamp: assistant.timestamp, stopped: assistant.stopped })
      }
      const runStmt = this.db.prepare(
        `INSERT INTO agent_runs(session_id,message_id,seq,agent_id,role,output,started_at,finished_at,task_input,parent_agent_id) VALUES(?,?,?,?,?,?,?,?,?,?)`,
      )
      const toolStmt = this.db.prepare(
        `INSERT INTO tool_calls(session_id,agent_run_id,call_id,agent_id,name,input,output,status,error,seq,truncated) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      )
      for (const run of runs) {
        const info = runStmt.run(sessionId, assistant?.id ?? null, run.seq, run.agentId, run.role, run.output, run.startedAt, run.finishedAt, run.taskInput ?? null, run.parentAgentId ?? null)
        const runId = info.lastInsertRowid
        for (const tc of run.toolCalls ?? []) {
          toolStmt.run(sessionId, runId, tc.callId, tc.agentId, tc.name, tc.input, tc.output ?? null, tc.status, tc.error ?? null, tc.seq, tc.truncated ? 1 : 0)
        }
      }
      this.db.exec('COMMIT')
    } catch (e) {
      this.db.exec('ROLLBACK')
      throw e
    }
  }
```

Replace `loadAgentRuns` (lines 81-85) with:

```ts
  loadAgentRuns(sessionId: string): AgentRun[] {
    const rows = this.db.prepare(`SELECT id,agent_id,role,output,started_at,finished_at,seq,task_input,parent_agent_id FROM agent_runs WHERE session_id=? ORDER BY seq`).all(sessionId) as
      { id: number; agent_id: string; role: AgentRole; output: string; started_at: number; finished_at: number | null; seq: number; task_input: string | null; parent_agent_id: string | null }[]
    const toolStmt = this.db.prepare(`SELECT call_id,agent_id,name,input,output,status,error,seq,truncated FROM tool_calls WHERE agent_run_id=? ORDER BY seq`)
    return rows.map((r) => {
      const tools = (toolStmt.all(r.id) as { call_id: string; agent_id: string; name: string; input: string; output: string | null; status: ToolStatus; error: string | null; seq: number; truncated: number }[])
        .map((t): ToolCall => ({ callId: t.call_id, agentId: t.agent_id, name: t.name, input: t.input, status: t.status, seq: t.seq, ...(t.output != null ? { output: t.output } : {}), ...(t.error != null ? { error: t.error } : {}), ...(t.truncated ? { truncated: true } : {}) }))
      return { agentId: r.agent_id, role: r.role, output: r.output, startedAt: r.started_at, finishedAt: r.finished_at, seq: r.seq, ...(r.task_input != null ? { taskInput: r.task_input } : {}), ...(r.parent_agent_id != null ? { parentAgentId: r.parent_agent_id } : {}), toolCalls: tools }
    })
  }

  /** Test/diagnostic helper: total tool_calls rows for a session. */
  countToolCalls(sessionId: string): number {
    return (this.db.prepare(`SELECT COUNT(*) AS n FROM tool_calls WHERE session_id=?`).get(sessionId) as { n: number }).n
  }
```

- [ ] **Step 4: Run to verify they pass + no regressions in the store suite**

Run: `yarn test packages/sidecar/src/persistence/store.test.ts`
Expected: PASS (all cases, including the pre-existing ones).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/persistence/store.ts packages/sidecar/src/persistence/store.test.ts
git commit -m "$(cat <<'EOF'
feat(persistence): persist + hydrate tool calls and delegation per agent run

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Sidecar — `tool-trace.ts` pure logic

**Files:**
- Create: `packages/sidecar/src/session/tool-trace.ts`
- Test: `packages/sidecar/src/session/tool-trace.test.ts`

This module holds ALL the new sidecar logic in a pure, deterministically-testable form. `session.ts` (Task 5) only wires it.

- [ ] **Step 1: Write the failing tests**

Create `packages/sidecar/src/session/tool-trace.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { ServerMessage, ToolCall } from '@hip/protocol'
import { clip, stringify, consumeToolCalls, trajectoryToRuns, type ToolCallStreamLike, type TraceRun, type TraceRecorder } from './tool-trace.js'

// A fake ToolCallStream whose Promises are already resolved.
function fakeTool(over: Partial<ToolCallStreamLike> & { name: string; callId: string }): ToolCallStreamLike {
  return { input: {}, output: Promise.resolve('ok'), status: Promise.resolve('finished'), error: Promise.resolve(undefined), ...over }
}
async function* iter(...tools: ToolCallStreamLike[]): AsyncIterable<ToolCallStreamLike> { for (const t of tools) yield t }

function recorderInto(runs: Map<string, TraceRun>): TraceRecorder {
  return {
    start(agentId, callId, name, input, seq, truncated) {
      runs.get(agentId)!.toolCalls.set(callId, { callId, agentId, name, input, status: 'running', seq, ...(truncated ? { truncated: true } : {}) })
    },
    finish(agentId, callId, status, output, error, truncated) {
      const tc = runs.get(agentId)!.toolCalls.get(callId)!
      tc.status = status
      if (output !== undefined) tc.output = output
      if (error !== undefined) tc.error = error
      if (truncated || tc.truncated) tc.truncated = true
    },
  }
}
function freshRun(): TraceRun { return { role: 'coder', output: '', startedAt: 0, finishedAt: null, seq: 0, toolCalls: new Map() } }

describe('clip', () => {
  it('passes short strings through untouched', () => {
    expect(clip('hello', 10)).toEqual({ text: 'hello', truncated: false })
  })
  it('clips overlong strings and flags truncated', () => {
    expect(clip('abcdef', 3)).toEqual({ text: 'abc', truncated: true })
  })
})

describe('stringify', () => {
  it('returns strings as-is and JSON-encodes objects', () => {
    expect(stringify('x')).toBe('x')
    expect(stringify({ a: 1 })).toBe('{"a":1}')
  })
})

describe('consumeToolCalls', () => {
  it('emits tool:started then tool:finished, assigns seq, and skips task()', async () => {
    const runs = new Map<string, TraceRun>([['coder', freshRun()]])
    const sent: ServerMessage[] = []
    let seq = 0
    const pending: Promise<void>[] = []
    await consumeToolCalls('coder', iter(
      fakeTool({ name: 'task', callId: 't0' }),                              // filtered out
      fakeTool({ name: 'read_file', callId: 'c1', input: { path: '/a.ts' }, output: Promise.resolve('contents') }),
    ), { sessionId: 's1', send: (m) => sent.push(m), nextSeq: () => seq++, pending, record: recorderInto(runs) })
    await Promise.all(pending)

    const started = sent.filter((m) => m.type === 'tool:started')
    const finished = sent.filter((m) => m.type === 'tool:finished')
    expect(started).toHaveLength(1)
    expect(finished).toHaveLength(1)
    expect(started[0]).toMatchObject({ type: 'tool:started', agentId: 'coder', callId: 'c1', name: 'read_file', input: '{"path":"/a.ts"}', seq: 0 })
    expect(finished[0]).toMatchObject({ type: 'tool:finished', callId: 'c1', status: 'finished', output: 'contents' })
    expect(runs.get('coder')!.toolCalls.get('c1')).toMatchObject({ status: 'finished', output: 'contents', seq: 0 })
  })

  it('reports the error path', async () => {
    const runs = new Map<string, TraceRun>([['coder', freshRun()]])
    const sent: ServerMessage[] = []
    let seq = 5
    const pending: Promise<void>[] = []
    await consumeToolCalls('coder', iter(
      fakeTool({ name: 'write_file', callId: 'c9', status: Promise.resolve('error'), error: Promise.resolve('EACCES') }),
    ), { sessionId: 's1', send: (m) => sent.push(m), nextSeq: () => seq++, pending, record: recorderInto(runs) })
    await Promise.all(pending)
    expect(sent.find((m) => m.type === 'tool:finished')).toMatchObject({ status: 'error', error: 'EACCES' })
    expect(sent.find((m) => m.type === 'tool:started')).toMatchObject({ seq: 5 })
  })

  it('clips an oversized output and flags truncated on the event + record', async () => {
    const runs = new Map<string, TraceRun>([['coder', freshRun()]])
    const sent: ServerMessage[] = []
    const pending: Promise<void>[] = []
    const big = 'x'.repeat(5000)
    await consumeToolCalls('coder', iter(
      fakeTool({ name: 'read_file', callId: 'c1', output: Promise.resolve(big) }),
    ), { sessionId: 's1', send: (m) => sent.push(m), nextSeq: () => 0, pending, record: recorderInto(runs) })
    await Promise.all(pending)
    const fin = sent.find((m) => m.type === 'tool:finished') as Extract<ServerMessage, { type: 'tool:finished' }>
    expect(fin.truncated).toBe(true)
    expect(fin.output!.length).toBe(4096)
    expect(runs.get('coder')!.toolCalls.get('c1')!.truncated).toBe(true)
  })
})

describe('trajectoryToRuns', () => {
  it('sorts tool calls by seq and coerces a dangling running tool to error', () => {
    const runs = new Map<string, TraceRun>([
      ['supervisor', { role: 'supervisor', output: 'final', startedAt: 0, finishedAt: 9, seq: 0, toolCalls: new Map() }],
      ['coder', {
        role: 'coder', output: 'c', startedAt: 1, finishedAt: 8, seq: 1, parentAgentId: 'supervisor', taskInput: 'do it',
        toolCalls: new Map<string, ToolCall>([
          ['c2', { callId: 'c2', agentId: 'coder', name: 'read_file', input: '{}', status: 'finished', output: 'r', seq: 3 }],
          ['c1', { callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'running', seq: 2 }],
        ]),
      }],
    ])
    const out = trajectoryToRuns(runs)
    const coder = out.find((r) => r.agentId === 'coder')!
    expect(coder).toMatchObject({ taskInput: 'do it', parentAgentId: 'supervisor' })
    expect(coder.toolCalls!.map((t) => t.callId)).toEqual(['c1', 'c2'])       // sorted by seq
    expect(coder.toolCalls![0]).toMatchObject({ status: 'error', error: 'interrupted' })  // dangling running coerced
    expect(out.find((r) => r.agentId === 'supervisor')!.toolCalls).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn test packages/sidecar/src/session/tool-trace.test.ts`
Expected: FAIL — `./tool-trace.js` does not exist.

- [ ] **Step 3: Implement `tool-trace.ts`**

Create `packages/sidecar/src/session/tool-trace.ts`:

```ts
import type { AgentRole, AgentRun, ServerMessage, ToolCall, ToolStatus } from '@hip/protocol'

export const TOOL_BLOB_CAP = 4096

/** Clip a blob to the cap and report whether it was shortened. */
export function clip(s: string, cap = TOOL_BLOB_CAP): { text: string; truncated: boolean } {
  return s.length > cap ? { text: s.slice(0, cap), truncated: true } : { text: s, truncated: false }
}

/** Stringify a tool arg/result for transport + storage. Strings pass through. */
export function stringify(v: unknown): string {
  if (typeof v === 'string') return v
  try {
    return JSON.stringify(v) ?? String(v)
  } catch {
    return String(v)
  }
}

/** Structural subset of deepagents/langgraph ToolCallStream we depend on (so tests can fake it). */
export interface ToolCallStreamLike {
  name: string
  callId: string
  input: unknown
  output: Promise<unknown>
  status: Promise<'running' | 'finished' | 'error'>
  error: Promise<string | undefined>
}

/** Sidecar-side mutable record of one agent's run, including its tool calls keyed by callId. */
export interface TraceRun {
  role: AgentRole
  output: string
  startedAt: number
  finishedAt: number | null
  seq: number
  toolCalls: Map<string, ToolCall>
  taskInput?: string
  parentAgentId?: string
}

/** Callbacks the pump uses to mutate the owning session's trajectory. */
export interface TraceRecorder {
  start(agentId: string, callId: string, name: string, input: string, seq: number, truncated: boolean): void
  finish(agentId: string, callId: string, status: 'finished' | 'error', output: string | undefined, error: string | undefined, truncated: boolean): void
}

export interface ConsumeCtx {
  sessionId: string
  send: (msg: ServerMessage) => void
  nextSeq: () => number
  pending: Promise<void>[]
  record: TraceRecorder
}

/**
 * Consume one agent's ToolCallStream iterable. Emits tool:started synchronously
 * (input is available immediately), then resolves the result Promises OFF the
 * critical path (pushed to ctx.pending) so the iterator never stalls. `task`
 * delegations are filtered — they are represented via agent:started instead.
 */
export async function consumeToolCalls(agentId: string, toolCalls: AsyncIterable<ToolCallStreamLike>, ctx: ConsumeCtx): Promise<void> {
  for await (const tc of toolCalls) {
    if (tc.name === 'task') continue
    const seq = ctx.nextSeq()
    const inClip = clip(stringify(tc.input))
    ctx.record.start(agentId, tc.callId, tc.name, inClip.text, seq, inClip.truncated)
    ctx.send({ type: 'tool:started', sessionId: ctx.sessionId, agentId, callId: tc.callId, name: tc.name, input: inClip.text, seq, ...(inClip.truncated ? { truncated: true } : {}) })
    ctx.pending.push((async () => {
      try {
        const status = await tc.status
        if (status === 'error') {
          const error = await tc.error
          ctx.record.finish(agentId, tc.callId, 'error', undefined, error, false)
          ctx.send({ type: 'tool:finished', sessionId: ctx.sessionId, agentId, callId: tc.callId, status: 'error', ...(error ? { error } : {}) })
        } else {
          const outClip = clip(stringify(await tc.output))
          ctx.record.finish(agentId, tc.callId, 'finished', outClip.text, undefined, outClip.truncated)
          ctx.send({ type: 'tool:finished', sessionId: ctx.sessionId, agentId, callId: tc.callId, status: 'finished', output: outClip.text, ...(outClip.truncated ? { truncated: true } : {}) })
        }
      } catch {
        // aborted / stream torn down — leave the record non-terminal; trajectoryToRuns coerces it.
      }
    })())
  }
}

/** Convert the live trajectory into persistable AgentRun[]. Sorts tool calls by seq and
 *  coerces any tool still 'running' (interrupted) to 'error' so the DB has no dangling state. */
export function trajectoryToRuns(trajectory: Map<string, TraceRun>): AgentRun[] {
  return [...trajectory.entries()].map(([agentId, r]) => ({
    agentId,
    role: r.role,
    output: r.output,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    seq: r.seq,
    ...(r.taskInput ? { taskInput: r.taskInput } : {}),
    ...(r.parentAgentId ? { parentAgentId: r.parentAgentId } : {}),
    toolCalls: [...r.toolCalls.values()]
      .sort((a, b) => a.seq - b.seq)
      .map((tc): ToolCall => (tc.status === 'running' ? { ...tc, status: 'error' as ToolStatus, error: tc.error ?? 'interrupted' } : tc)),
  }))
}
```

- [ ] **Step 4: Run to verify pass**

Run: `yarn test packages/sidecar/src/session/tool-trace.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/tool-trace.ts packages/sidecar/src/session/tool-trace.test.ts
git commit -m "$(cat <<'EOF'
feat(sidecar): tool-trace — consumeToolCalls pump + trajectoryToRuns (pure, tested)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Sidecar — wire tool pumps into `session.ts`

**Files:**
- Modify: `packages/sidecar/src/session/session.ts`

Integration wiring. Deterministic coverage lives in Task 4 (`tool-trace.test.ts`); this task is verified by type-check + the full suite staying green (incl. the live multi-agent + cancel suites when a key is present).

- [ ] **Step 1: Import the trace helpers and drop the local `Run` type**

Add to the imports (after line 8):

```ts
import { consumeToolCalls, trajectoryToRuns, type TraceRun, type TraceRecorder } from './tool-trace.js'
```

Delete the local `type Run = …` (line 34) and replace every other use of `Run` in this file with `TraceRun` (the `trajectory` map type at lines 197 and 275, and the `Map<string, Run>` param of `finalizeAndPersist`).

- [ ] **Step 2: Extend the turn setup — seq, pending, recorder, and `ensureStarted`**

In `runTurn`, replace the block from `const trajectory = …` through the end of `ensureStarted` (lines 197-205) with:

```ts
    const trajectory = new Map<string, TraceRun>()
    let agentSeq = 0
    let toolSeq = 0
    const pending: Promise<void>[] = []
    const started = new Set<string>()
    const recorder: TraceRecorder = {
      start: (agentId, callId, name, input, seq, truncated) => {
        const r = trajectory.get(agentId)
        if (r) r.toolCalls.set(callId, { callId, agentId, name, input, status: 'running', seq, ...(truncated ? { truncated: true } : {}) })
      },
      finish: (agentId, callId, status, output, error, truncated) => {
        const tc = trajectory.get(agentId)?.toolCalls.get(callId)
        if (!tc) return
        tc.status = status
        if (output !== undefined) tc.output = output
        if (error !== undefined) tc.error = error
        if (truncated || tc.truncated) tc.truncated = true   // sticky-OR
      },
    }
    const traceCtx = { sessionId: this.id, send, nextSeq: () => toolSeq++, pending, record: recorder }
    const ensureStarted = (agentId: string, role: AgentRole, parentAgentId?: string, taskInput?: string) => {
      if (started.has(agentId)) return
      started.add(agentId)
      trajectory.set(agentId, { role, output: '', startedAt: Date.now(), finishedAt: null, seq: agentSeq++, toolCalls: new Map(), ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}) })
      send({ type: 'agent:started', sessionId: this.id, agentId, role, ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}) })
    }
```

- [ ] **Step 3: Add a `safeTaskInput` helper** at module scope (near `roleForName`'s import, e.g. right after the `buildModel` function, before the `Session` class):

```ts
/** Resolve a sub-agent's delegation instruction defensively (it is known at delegation time). */
async function safeTaskInput(sub: { taskInput: Promise<string> }): Promise<string | undefined> {
  try {
    return await sub.taskInput
  } catch {
    return undefined
  }
}
```

- [ ] **Step 4: Wire the tool pumps + delegation + allSettled**

Replace `pumpSubagents` and the `await Promise.all([...])` / `finishRemaining()` region (lines 231-249) with:

```ts
      const pumpSubagents = async () => {
        for await (const sub of run.subagents) {
          const agentId = sub.name
          const taskInput = await safeTaskInput(sub)
          ensureStarted(agentId, roleForName(sub.name), 'supervisor', taskInput)
          await Promise.all([
            (async () => {
              for await (const msg of sub.messages) {
                for await (const delta of msg.text) {
                  if (!delta) continue
                  const r = trajectory.get(agentId); if (r) r.output += delta
                  send({ type: 'token:stream', sessionId: this.id, agentId, delta })
                }
              }
            })(),
            consumeToolCalls(agentId, sub.toolCalls, traceCtx),
          ])
          if (started.delete(agentId)) {
            const r = trajectory.get(agentId); if (r) r.finishedAt = Date.now()
            send({ type: 'agent:finished', sessionId: this.id, agentId })
          }
        }
      }
      await Promise.all([pumpSupervisor(), pumpSubagents(), consumeToolCalls('supervisor', run.toolCalls, traceCtx)])
      await Promise.allSettled(pending)
      finishRemaining()
```

Then, in the `catch (err)` block, add `await Promise.allSettled(pending)` immediately after `finishRemaining()` (so a cancelled turn settles its in-flight tool Promises before finalize). The branch becomes:

```ts
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      finishRemaining()
      await Promise.allSettled(pending)
      if (isAbort && supervisorText) {
        this.finalizeAndPersist(send, supervisorText, trajectory, true)
      } else {
```

- [ ] **Step 5: Build `runs` via `trajectoryToRuns` in `finalizeAndPersist`**

Replace the `const runs: AgentRun[] = [...trajectory.entries()].map(…)` block (lines 279-281) with:

```ts
    const runs: AgentRun[] = trajectoryToRuns(trajectory)
```

(Adjust the `finalizeAndPersist` signature's trajectory param type to `Map<string, TraceRun>`.) The unused `AgentRole` import may remain (still used by `ensureStarted`); leave imports that are still referenced.

- [ ] **Step 6: Type-check**

Run: `yarn workspace @hip/sidecar type-check`
Expected: PASS. If `run.toolCalls` / `sub.toolCalls` produce a type error, assert the structural shape at the call site: `consumeToolCalls(agentId, sub.toolCalls as unknown as AsyncIterable<ToolCallStreamLike>, traceCtx)` (import `ToolCallStreamLike` from `./tool-trace.js`) — the deepagents `ToolCallStream` is structurally compatible.

- [ ] **Step 7: Run the full sidecar suite (incl. live, if key present)**

Run: `yarn test packages/sidecar`
Expected: PASS. The live `multiagent.integration.test.ts` and `session.test.ts` still pass (tool events are additive — existing assertions are unaffected). Non-live tests pass unchanged.

- [ ] **Step 8: Commit**

```bash
git add packages/sidecar/src/session/session.ts
git commit -m "$(cat <<'EOF'
feat(sidecar): capture per-agent tool calls + delegation in runTurn

Adds a third (tool) pump for supervisor + each sub-agent, resolves tool
result Promises off the critical path, threads delegation (parentAgentId +
taskInput) through agent:started, and persists the trace via trajectoryToRuns.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Frontend — reducer, `AgentVM`, hydration

**Files:**
- Modify: `src/domain/sessionStore.ts`
- Test: `src/domain/sessionStore.test.ts`

- [ ] **Step 1: Write failing reducer tests**

In `sessionStore.test.ts`, first update EVERY existing inline `AgentVM` literal to include `toolCalls: []` (they appear at lines ~35, 42, 50, 57, and 236 — search the file for `startedAt:` inside an agent object and add `toolCalls: []`). Then add these tests inside the `describe('applyServerMessage', …)` block:

```ts
  it('agent:started seeds toolCalls/taskInput/parentAgentId', () => {
    const next = applyServerMessage(
      { sessions: [baseSession()] },
      { type: 'agent:started', sessionId: 's1', agentId: 'coder', role: 'coder', parentAgentId: 'supervisor', taskInput: 'do it' },
      1000,
    )
    expect(next.sessions[0].agents[0]).toMatchObject({ id: 'coder', toolCalls: [], parentAgentId: 'supervisor', taskInput: 'do it' })
  })

  it('tool:started appends a running tool to the matching agent', () => {
    const s0 = { sessions: [baseSession({ agents: [{ id: 'coder', role: 'coder', title: 'Coder', status: 'running', tokens: '', tokenCount: 0, elapsedMs: 0, startedAt: 0, toolCalls: [] }] })] }
    const next = applyServerMessage(s0, { type: 'tool:started', sessionId: 's1', agentId: 'coder', callId: 'c1', name: 'write_file', input: '{"path":"/a.ts"}', seq: 0 }, 0)
    expect(next.sessions[0].agents[0].toolCalls).toEqual([
      { callId: 'c1', agentId: 'coder', name: 'write_file', input: '{"path":"/a.ts"}', status: 'running', seq: 0 },
    ])
  })

  it('tool:finished updates the matching call by callId (sticky-OR truncated)', () => {
    const s0 = { sessions: [baseSession({ agents: [{ id: 'coder', role: 'coder', title: 'Coder', status: 'running', tokens: '', tokenCount: 0, elapsedMs: 0, startedAt: 0, toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'read_file', input: '{}', status: 'running', seq: 0, truncated: true }] }] })] }
    const next = applyServerMessage(s0, { type: 'tool:finished', sessionId: 's1', agentId: 'coder', callId: 'c1', status: 'finished', output: 'data' }, 0)
    expect(next.sessions[0].agents[0].toolCalls[0]).toMatchObject({ status: 'finished', output: 'data', truncated: true })
  })

  it('tool:finished is a no-op for an unknown callId', () => {
    const s0 = { sessions: [baseSession({ agents: [{ id: 'coder', role: 'coder', title: 'Coder', status: 'running', tokens: '', tokenCount: 0, elapsedMs: 0, startedAt: 0, toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'read_file', input: '{}', status: 'running', seq: 0 }] }] })] }
    const next = applyServerMessage(s0, { type: 'tool:finished', sessionId: 's1', agentId: 'coder', callId: 'zzz', status: 'finished', output: 'x' }, 0)
    expect(next.sessions[0].agents[0].toolCalls[0].status).toBe('running')
  })

  it('session:loaded hydrates toolCalls + delegation from agentRuns', () => {
    const base = { sessions: [{ ...emptySession('s1'), loaded: false }] }
    const next = applyServerMessage(base, {
      type: 'session:loaded', sessionId: 's1',
      messages: [],
      agentRuns: [{ agentId: 'coder', role: 'coder', output: 'c', startedAt: 1, finishedAt: 2, seq: 1, parentAgentId: 'supervisor', taskInput: 'do it', toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'finished', seq: 2 }] }],
    }, 0)
    const a = next.sessions[0].agents[0]
    expect(a).toMatchObject({ id: 'coder', parentAgentId: 'supervisor', taskInput: 'do it' })
    expect(a.toolCalls).toEqual([{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'finished', seq: 2 }])
  })
```

- [ ] **Step 2: Run to verify failure**

Run: `yarn test src/domain/sessionStore.test.ts`
Expected: FAIL — `AgentVM` has no `toolCalls`; no `tool:started`/`tool:finished` branches.

- [ ] **Step 3: Extend `AgentVM` + import `ToolCall`**

In `sessionStore.ts`, extend the protocol import (line 3) with `ToolCall`:

```ts
import type { AgentRole, AgentRun, Message, SearchHit, ServerMessage, SessionConfig, SessionSummary, ToolCall } from '@hip/protocol'
```

Add three fields to `AgentVM` (after `startedAt`, line 15):

```ts
  startedAt: number    // 内部：agent:started 时的 now（不渲染）
  toolCalls: ToolCall[]      // 执行轨迹，按 seq 排序
  taskInput?: string         // 子代理收到的委派指令
  parentAgentId?: string     // 委派者（子代理恒为 'supervisor'）
```

- [ ] **Step 4: Seed in `agent:started` and `agentVMfromRun`**

In the `agent:started` case (the `upsertAgent` literal, lines 101-110), add the three fields:

```ts
        agents: upsertAgent(s.agents, {
          id: msg.agentId,
          role: msg.role,
          title: ROLE_TITLE[msg.role],
          status: 'running',
          tokens: '',
          tokenCount: 0,
          elapsedMs: 0,
          startedAt: now,
          toolCalls: [],
          ...(msg.taskInput ? { taskInput: msg.taskInput } : {}),
          ...(msg.parentAgentId ? { parentAgentId: msg.parentAgentId } : {}),
        }),
```

Replace `agentVMfromRun` (lines 76-78) with:

```ts
function agentVMfromRun(r: AgentRun): AgentVM {
  return {
    id: r.agentId, role: r.role, title: ROLE_TITLE[r.role],
    status: r.finishedAt ? 'done' : 'running',
    tokens: r.output, tokenCount: r.output.length,
    elapsedMs: r.finishedAt ? r.finishedAt - r.startedAt : 0,
    startedAt: r.startedAt,
    toolCalls: r.toolCalls ?? [],
    ...(r.taskInput ? { taskInput: r.taskInput } : {}),
    ...(r.parentAgentId ? { parentAgentId: r.parentAgentId } : {}),
  }
}
```

- [ ] **Step 5: Add the `tool:started` / `tool:finished` reducer branches**

Insert these two cases right after the `agent:finished` case (after line 128):

```ts
    case 'tool:started':
      return update(msg.sessionId, (s) => ({
        ...s,
        agents: s.agents.map((a) =>
          a.id === msg.agentId
            ? { ...a, toolCalls: [...a.toolCalls, { callId: msg.callId, agentId: msg.agentId, name: msg.name, input: msg.input, status: 'running' as const, seq: msg.seq, ...(msg.truncated ? { truncated: true } : {}) }] }
            : a,
        ),
      }))

    case 'tool:finished':
      return update(msg.sessionId, (s) => ({
        ...s,
        agents: s.agents.map((a) =>
          a.id === msg.agentId
            ? {
                ...a,
                toolCalls: a.toolCalls.map((tc) =>
                  tc.callId === msg.callId
                    ? { ...tc, status: msg.status, ...(msg.output !== undefined ? { output: msg.output } : {}), ...(msg.error !== undefined ? { error: msg.error } : {}), ...(tc.truncated || msg.truncated ? { truncated: true } : {}) }
                    : tc,
                ),
              }
            : a,
        ),
      }))
```

- [ ] **Step 6: Run to verify pass + no regressions**

Run: `yarn test src/domain/sessionStore.test.ts`
Expected: PASS (new + pre-existing).

- [ ] **Step 7: Commit**

```bash
git add src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "$(cat <<'EOF'
feat(domain): reduce tool:started/finished into AgentVM.toolCalls; hydrate on load

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: i18n keys

**Files:**
- Modify: `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`

Add the new `artifact.*` keys to all three locales (the type source is `zh-CN`, so the keys MUST exist there). Keep `parallelAgents` for now — Task 11 switches the reference and removes it.

- [ ] **Step 1: Add keys to `en.ts`**

In the `artifact` block, alongside `parallelAgents: 'Sub-agents',` add:

```ts
      subAgents: 'Sub-agents',
      toolsCount: '{{count}} tools',
      delegatedBy: 'delegated by',
      arguments: 'Arguments',
      output: 'Output',
      failed: 'Failed',
      truncated: 'truncated',
      noTools: 'No tool calls',
```

- [ ] **Step 2: Add keys to `zh-CN.ts`** (alongside `parallelAgents: '协作子智能体',`):

```ts
      subAgents: '子智能体',
      toolsCount: '{{count}} 次工具调用',
      delegatedBy: '委派自',
      arguments: '参数',
      output: '输出',
      failed: '失败',
      truncated: '已截断',
      noTools: '暂无工具调用',
```

- [ ] **Step 3: Add keys to `zh-TW.ts`** (alongside `parallelAgents: '協作子智能體',`):

```ts
      subAgents: '子智能體',
      toolsCount: '{{count}} 次工具調用',
      delegatedBy: '委派自',
      arguments: '參數',
      output: '輸出',
      failed: '失敗',
      truncated: '已截斷',
      noTools: '暫無工具調用',
```

- [ ] **Step 4: Type-check**

Run: `yarn type-check`
Expected: PASS (additions only; the `t()` key type derives from `zh-CN`).

- [ ] **Step 5: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "$(cat <<'EOF'
feat(i18n): tool-trace + subAgents keys (en, zh-CN, zh-TW)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: UI — `ToolCallRow`

**Files:**
- Create: `src/components/artifact/ToolCallRow.tsx`

Presentational leaf — verified by type-check (no DOM test infra). Renders one expandable tool call.

- [ ] **Step 1: Create the component**

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2, Check, X } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { ToolCall } from '@hip/protocol'
import { cn } from '@/lib/utils'

/** Best-effort: pull a file path (or first stringy arg) out of a JSON-stringified tool input. */
function targetHint(input: string): string {
  try {
    const o = JSON.parse(input) as Record<string, unknown>
    const v = o.path ?? o.file_path ?? o.filename ?? o.file
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

function Field({ label, value, danger, t }: { label: string; value: string; danger?: boolean; t: TFunction }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-ink-tertiary">{label}</div>
      <pre className={cn('mt-0.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-surface px-2 py-1 font-mono text-[11px]', danger ? 'text-danger' : 'text-ink-secondary')}>{value}</pre>
    </div>
  )
}

export function ToolCallRow({ tool }: { tool: ToolCall }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const hint = targetHint(tool.input)
  return (
    <div className="rounded-md border border-border bg-surface-muted/40">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-2 py-1.5 text-left" data-testid="tool-row">
        <ChevronRight size={12} className={cn('shrink-0 text-ink-tertiary transition-transform', open && 'rotate-90')} />
        <span className="shrink-0 font-mono text-[12px] text-ink">{tool.name}</span>
        {hint && <span className="truncate font-mono text-[11px] text-ink-tertiary">{hint}</span>}
        <span className="ml-auto shrink-0">
          {tool.status === 'running' && <Loader2 size={12} className="animate-spin text-accent" />}
          {tool.status === 'finished' && <Check size={12} className="text-emerald-500" />}
          {tool.status === 'error' && <X size={12} className="text-danger" />}
        </span>
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border px-2 py-1.5">
          <Field label={tool.truncated ? `${t('artifact.arguments')} · ${t('artifact.truncated')}` : t('artifact.arguments')} value={tool.input} t={t} />
          {tool.status === 'error'
            ? <Field label={t('artifact.failed')} value={tool.error ?? ''} danger t={t} />
            : tool.output !== undefined && (
                <Field label={tool.truncated ? `${t('artifact.output')} · ${t('artifact.truncated')}` : t('artifact.output')} value={tool.output} t={t} />
              )}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/artifact/ToolCallRow.tsx
git commit -m "$(cat <<'EOF'
feat(ui): ToolCallRow — expandable tool call with args/result + status

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: UI — `ToolTrace`

**Files:**
- Create: `src/components/artifact/ToolTrace.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useTranslation } from 'react-i18next'
import type { ToolCall } from '@hip/protocol'
import { ToolCallRow } from './ToolCallRow'

/** Ordered list of an agent's tool calls (seq is the ordering authority). */
export function ToolTrace({ tools }: { tools: ToolCall[] }) {
  const { t } = useTranslation()
  if (tools.length === 0) {
    return <div className="text-[11px] text-ink-tertiary">{t('artifact.noTools')}</div>
  }
  const ordered = [...tools].sort((a, b) => a.seq - b.seq)
  return (
    <div className="flex flex-col gap-1" data-testid="tool-trace">
      {ordered.map((tc) => (
        <ToolCallRow key={tc.callId} tool={tc} />
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/artifact/ToolTrace.tsx
git commit -m "$(cat <<'EOF'
feat(ui): ToolTrace — ordered tool-call list per agent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: UI — `AgentCard` (expandable)

**Files:**
- Create: `src/components/artifact/AgentCard.tsx`

Lifts the card out of `AgentDashboard` and makes it expandable, with a delegation header + tool trace + token output. Auto-expands while running (until the user toggles).

- [ ] **Step 1: Create the component**

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import type { AgentRole } from '@hip/protocol'
import type { AgentVM } from '@/domain'
import { cn } from '@/lib/utils'
import { ToolTrace } from './ToolTrace'

const ROLE_COLOR: Record<AgentRole, string> = {
  supervisor: 'var(--role-supervisor)',
  planner: 'var(--role-planner)',
  coder: 'var(--role-coder)',
  reviewer: 'var(--role-reviewer)',
}

function StatusDot({ status, color }: { status: AgentVM['status']; color: string }) {
  if (status === 'running') return <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: color }} />
  if (status === 'done') return <span className="h-2 w-2 rounded-full bg-ink-tertiary" />
  return <span className="h-2 w-2 rounded-full border border-border" />
}

export function AgentCard({ agent }: { agent: AgentVM }) {
  const { t } = useTranslation()
  const color = ROLE_COLOR[agent.role]
  // Follow run-status by default (open while running, collapsed when done); respect a manual toggle once set.
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? agent.status === 'running'
  return (
    <div className={cn('flex flex-col rounded-lg border bg-surface transition-colors', agent.status === 'running' ? 'border-accent/40' : 'border-border')}>
      <button onClick={() => setManual(!open)} className="flex items-center justify-between gap-2 p-3 text-left" data-testid="agent-card-header">
        <div className="flex min-w-0 items-center gap-2">
          <ChevronRight size={12} className={cn('shrink-0 text-ink-tertiary transition-transform', open && 'rotate-90')} />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate text-[13px] font-semibold text-ink">{agent.title}</span>
          {agent.toolCalls.length > 0 && (
            <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] text-ink-tertiary">{t('artifact.toolsCount', { count: agent.toolCalls.length })}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusDot status={agent.status} color={color} />
          <span className="text-[11px] capitalize text-ink-tertiary">{agent.status}</span>
        </div>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-3 pt-2.5">
          {agent.parentAgentId && agent.taskInput && (
            <div className="rounded-md bg-surface-muted px-2.5 py-1.5 text-[11px] leading-snug text-ink-secondary">
              <span className="text-ink-tertiary">↳ {t('artifact.delegatedBy')} Supervisor: </span>
              {agent.taskInput}
            </div>
          )}
          <ToolTrace tools={agent.toolCalls} />
          <div className="min-h-[28px] rounded-md bg-surface-muted px-2.5 py-1.5 text-[12px] leading-snug text-ink-secondary">
            {agent.tokens || <span className="text-ink-tertiary">{t('artifact.waiting')}</span>}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-ink-tertiary">
            <span>{agent.tokenCount} tokens</span>
            <span>{(agent.elapsedMs / 1000).toFixed(1)}s</span>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/artifact/AgentCard.tsx
git commit -m "$(cat <<'EOF'
feat(ui): AgentCard — expandable card with delegation header + tool trace

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: UI — `AgentDashboard` integration + label cleanup

**Files:**
- Modify: `src/components/artifact/AgentDashboard.tsx`
- Modify: `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts` (remove the now-unused `parallelAgents`)

- [ ] **Step 1: Replace `AgentDashboard.tsx` with the thin version** (the old inline `AgentCard`/`StatusDot`/`ROLE_COLOR` now live in `AgentCard.tsx`):

```tsx
import { useTranslation } from 'react-i18next'
import { useAgents } from '@/domain'
import { AgentCard } from './AgentCard'

export function AgentDashboard() {
  const { t } = useTranslation()
  const agents = useAgents()
  const supervisor = agents.find((a) => a.role === 'supervisor')
  const children = agents.filter((a) => a.role !== 'supervisor')

  return (
    <div className="flex flex-col gap-3">
      {supervisor && <AgentCard agent={supervisor} />}
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t('artifact.subAgents')}</div>
      <div className="flex flex-col gap-2.5">
        {children.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Remove the now-unused `parallelAgents` key** from all three i18n files (`en.ts`, `zh-CN.ts`, `zh-TW.ts`) — delete the `parallelAgents: …` line in each `artifact` block (nothing references it after Step 1).

- [ ] **Step 3: Type-check (catches any stale `parallelAgents` reference)**

Run: `yarn type-check`
Expected: PASS — no remaining reference to `artifact.parallelAgents`.

- [ ] **Step 4: Commit**

```bash
git add src/components/artifact/AgentDashboard.tsx src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "$(cat <<'EOF'
feat(ui): AgentDashboard renders expandable AgentCards; drop parallelAgents key

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Final verification + whole-branch review

**Files:** none (verification only)

- [ ] **Step 1: Full type-check (both projects)**

Run: `yarn type-check && yarn workspace @hip/sidecar type-check`
Expected: PASS.

- [ ] **Step 2: Full test suite**

Run: `yarn test`
Expected: PASS — all files, including the live DeepSeek suites (`session.test.ts`, `multiagent.integration.test.ts`) when `DEEPSEEK_API_KEY` is set. If no key, those `skipIf`-skip; everything else passes.

- [ ] **Step 3: Production build**

Run: `yarn build`
Expected: PASS (tsc + vite build clean).

- [ ] **Step 4: Whole-branch review**

Dispatch a final code reviewer over the whole diff (`git diff main...feat/agent-execution-trace`) against the spec. Focus areas: the off-critical-path Promise handling in `consumeToolCalls` (no stall/no unhandled rejection), the `allSettled` placement on both success and abort paths, the `seq` ordering authority end-to-end, the cascade-delete of `tool_calls`, and the Zustand v5 selector rule (no fresh array/object from any `useStore` selector). Address any Important/Critical findings, then re-verify Steps 1-3.

- [ ] **Step 5: GUI acceptance (manual, user-run per project convention)**

Hand off to the user for live acceptance: send a real multi-agent turn and confirm (a) the Supervisor/Planner/Coder/Reviewer cards show live tool calls with running→✓ transitions and a delegation header, then (b) reload the session and confirm the persisted trace renders identically.

---

## Self-Review (author checklist — completed)

**1. Spec coverage:**
- D1 execution trace, plan stays text → Tasks 4/5 capture tool calls only; planner text untouched. ✓
- D2 persisted (v4) → Tasks 2/3. ✓
- D3 live granular events + off-critical-path Promises + seq → Tasks 1/4/5. ✓
- D4 delegation on sub-agent, `task` filtered → Task 4 (`if (tc.name === 'task') continue`) + Task 5 (`ensureStarted(..., 'supervisor', taskInput)`) + Task 10 header. ✓
- D5 ~4 KB clip + truncated flag → Task 4 `clip`/`TOOL_BLOB_CAP`. ✓
- D6 no new ClientMessage → confirmed (session-manager untouched). ✓
- D7 cancel: `allSettled` + dangling-running coerced to error → Task 5 (both paths) + Task 4 `trajectoryToRuns`. ✓
- Sticky-OR truncated → Task 4 recorder, Task 5 recorder, Task 6 reducer. ✓
- UI expandable card + ToolTrace + ToolCallRow + label fix → Tasks 8-11. ✓
- Tests: schema/store/tool-trace/reducer → Tasks 2/3/4/6. ✓

**2. Placeholder scan:** none — every code step has complete code; every run step has an exact command + expected result.

**3. Type consistency:** `ToolCall`/`ToolStatus` (Task 1) used identically in store (Task 3), tool-trace (Task 4), reducer (Task 6), UI (Tasks 8-10). `TraceRun`/`TraceRecorder`/`ToolCallStreamLike`/`consumeToolCalls`/`trajectoryToRuns` defined in Task 4 and consumed in Task 5 with matching signatures. `AgentVM.toolCalls` (Task 6) consumed by `AgentCard`/`ToolTrace` (Tasks 9-10). i18n keys added (Task 7) before first use (Tasks 8-11); `subAgents` switched + `parallelAgents` removed together (Task 11).
