# Inline Agent Activity + Thinking + File-Honesty — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render agent thinking + tool activity inline in the chat transcript as a flat per-turn timeline, add a thinking-mode toggle (default on → `deepseek-reasoner`), and stop the model from claiming files it never wrote.

**Architecture:** Each assistant `Message` owns an ordered `timeline[]` of reasoning + tool steps, stamped with one turn-global `stepSeq` by the sidecar so live and reloaded order match. Reasoning is captured from `msg.reasoning`, transported on a new `reasoning:delta` event, and persisted as a JSON blob (`messages.timeline`, schema v5). A pure `verifyWrites` appends an honest correction when the model claims a write with no `write_file`/`edit_file` tool call. The existing agents panel is repurposed to a per-turn detail view.

**Tech Stack:** TypeScript monorepo — `@hip/protocol`, `@hip/sidecar` (deepagents/LangGraph/LangChain, DeepSeek, node:sqlite), React+Vite+Tailwind frontend, Zustand v5, Vitest (node env), i18n via react-i18next.

**Spec:** `docs/superpowers/specs/2026-06-09-inline-trace-thinking-design.md`

---

## Execution order & cross-task contract

Tasks are ordered bottom-up; **execute in order**. Data layer (1–3) → pure sidecar (4–6) → sidecar wiring (7–8) → store (9) → UI/i18n (10–13) → verification (14). UI tasks 10–13 will not type-check until 1–9 land.

Canonical contract (every task matches these exactly):

- `TimelineStep` is defined **once**, in Task 1: `{ kind:'reasoning'; stepSeq; agentId; role; content; truncated? } | { kind:'tool'; stepSeq; agentId; role; callId }`.
- `Message` gains `timeline?: TimelineStep[]` and `toolCalls?: ToolCall[]` (Task 1).
- One **turn-global `stepSeq`** per turn (Task 7). `tool:started.seq` IS the `stepSeq`.
- `turnId` === the assistant message id, computed at the top of `runTurn` (Task 7). `message:complete`'s message `id === turnId`.
- Persistence: `messages.timeline` JSON blob (Task 2–3 only). Reasoning lives in that blob; tool steps reference `tool_calls` rows by `callId`.
- `message:complete` carries both `timeline` AND `toolCalls` (Task 7), which Task 9 finalizes onto the in-flight message.
- Branch `feat/agent-execution-trace`. Do NOT push. Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Task 1 — Protocol types: timeline, thinking/language, turnId/role, reasoning:delta, session:thinking

**Files:**
- Modify: `packages/protocol/src/index.ts`
- Test: _none_ (types-only; gated by `type-check` / `build`)

- [ ] **Step 1: Extend `SessionConfig` with `thinking` and `language`.**

  Replace the current `SessionConfig` interface (lines 3–9) with:

  ```typescript
  export interface SessionConfig {
    llmProvider: 'deepseek'
    model: string
    tools: string[]
    systemPrompt?: string
    cwd?: string                 // absolute project root; undefined → virtual FS (no real file tools)
    thinking?: boolean           // surface reasoning steps; undefined ⇒ treated as true
    language?: 'en' | 'zh-CN' | 'zh-TW'  // UI / assistant output language
  }
  ```

- [ ] **Step 2: Add `timeline` + `toolCalls` to `Message`.**

  Replace the current `Message` interface (lines 11–18) with:

  ```typescript
  export interface Message {
    id: string
    role: 'user' | 'assistant'
    content: string
    agentId?: string
    timestamp: number
    stopped?: boolean // assistant turn was cancelled mid-stream; partial content kept
    timeline?: TimelineStep[]  // ordered reasoning+tool steps for this turn (assistant only)
    toolCalls?: ToolCall[]     // flat tool calls for this turn, referenced by timeline tool steps via callId
  }
  ```

- [ ] **Step 3: Add the `TimelineStep` union immediately after `ToolCall`** (after line 44, before `export interface SessionSummary`):

  ```typescript
  /**
   * One step in an assistant turn's execution trace. `stepSeq` is a single
   * turn-global monotonic counter shared across reasoning and tool steps, so a
   * timeline interleaves them in true wall-clock order. A 'tool' step carries no
   * payload — it references a ToolCall (on Message.toolCalls) by callId.
   */
  export type TimelineStep =
    | { kind: 'reasoning'; stepSeq: number; agentId: string; role: AgentRole; content: string; truncated?: boolean }
    | { kind: 'tool'; stepSeq: number; agentId: string; role: AgentRole; callId: string }
  ```

- [ ] **Step 4: Add `session:setThinking` to `ClientMessage`.** After the `session:setCwd` line:

  ```typescript
    | { type: 'session:setCwd'; sessionId: string; cwd: string }
    | { type: 'session:setThinking'; sessionId: string; thinking: boolean }
    | { type: 'fs:ls'; sessionId: string; path: string }
  ```

- [ ] **Step 5: Add `turnId`/`role` to streaming variants + the `reasoning:delta` and `session:thinking` variants.** Replace the streaming/tool/`message:complete` portion of `ServerMessage` (lines 87–92) with:

  ```typescript
    | { type: 'agent:started'; sessionId: string; turnId: string; agentId: string; role: AgentRole; parentAgentId?: string; taskInput?: string }
    | { type: 'token:stream'; sessionId: string; turnId: string; agentId: string; delta: string }
    | { type: 'agent:finished'; sessionId: string; turnId: string; agentId: string }
    | { type: 'reasoning:delta'; sessionId: string; turnId: string; agentId: string; role: AgentRole; stepSeq: number; delta: string }
    | { type: 'tool:started'; sessionId: string; turnId: string; agentId: string; role: AgentRole; callId: string; name: string; input: string; seq: number; truncated?: boolean }
    | { type: 'tool:finished'; sessionId: string; turnId: string; agentId: string; callId: string; status: 'finished' | 'error'; output?: string; error?: string; truncated?: boolean }
    | { type: 'session:thinking'; sessionId: string; thinking: boolean }
    | { type: 'message:complete'; sessionId: string; message: Message }
  ```

- [ ] **Step 6: Type-check the protocol package in isolation.**

  Run: `yarn workspace @hip/protocol type-check`
  Expected: exits 0. (Downstream `@hip/sidecar`/`src` will report missing `turnId`/`role` at emit sites — fixed in later tasks; that's expected here.)

- [ ] **Step 7: Commit.**

  ```bash
  git add packages/protocol/src/index.ts
  git commit -m "$(cat <<'EOF'
  feat(protocol): TimelineStep, Message.timeline/toolCalls, thinking/language, turnId/role

  Add the execution-trace protocol surface: SessionConfig.thinking (undefined ⇒
  true) + language; TimelineStep union (reasoning|tool) with a turn-global stepSeq;
  Message.timeline + toolCalls; turnId on the streaming events; role on tool:started
  (its seq is the stepSeq); new reasoning:delta + session:thinking ServerMessages;
  new session:setThinking ClientMessage. turnId === assistant message id.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 2 — Persistence schema v5: `messages.timeline TEXT`

**Files:**
- Modify: `packages/sidecar/src/persistence/schema.ts`
- Test: `packages/sidecar/src/persistence/schema.test.ts`, `packages/sidecar/src/persistence/open.test.ts`

- [ ] **Step 1: Update `schema.test.ts` to expect v5 and the `timeline` column (failing test first).** Replace the first test body with:

  ```typescript
    it('adds tool_calls + agent_runs delegation columns + messages.timeline and reaches user_version 5', () => {
      const db = new DatabaseSync(':memory:')
      migrate(db)
      expect(columns(db, 'sessions')).toContain('title_custom')
      expect(columns(db, 'messages')).toContain('stopped')
      expect(columns(db, 'messages')).toContain('timeline')
      expect(columns(db, 'agent_runs')).toEqual(expect.arrayContaining(['task_input', 'parent_agent_id']))
      expect(columns(db, 'tool_calls')).toEqual(
        expect.arrayContaining(['agent_run_id', 'call_id', 'agent_id', 'name', 'input', 'output', 'status', 'error', 'seq', 'truncated']),
      )
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(5)
    })
  ```

- [ ] **Step 2: Update `open.test.ts` to expect v5 (failing test first).** Replace the first test with:

  ```typescript
    it('creates core tables and sets user_version = 5', () => {
      const { db, ftsEnabled } = openDatabase(':memory:')
      const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
      const names = tables.map((t) => t.name)
      expect(names).toEqual(expect.arrayContaining(['sessions', 'messages', 'agent_runs']))
      const cols = (db.prepare(`PRAGMA table_info(messages)`).all() as { name: string }[]).map((c) => c.name)
      expect(cols).toContain('timeline')
      expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(5)
      expect(ftsEnabled).toBe(true)
      db.close()
    })
  ```

- [ ] **Step 3: Run both tests — expect FAIL.**

  Run: `yarn test packages/sidecar/src/persistence/schema.test.ts packages/sidecar/src/persistence/open.test.ts`
  Expected: FAIL — `expected 4 to be 5` plus the missing `timeline` column.

- [ ] **Step 4: Add the `version < 5` migration block** immediately after the `if (version < 4)` block, before `migrate`'s closing brace:

  ```typescript
    if (version < 5) {
      db.exec('BEGIN')
      try {
        // timeline: JSON blob of TimelineStep[] for an assistant turn (reasoning
        // content inline; tool steps reference tool_calls rows by call_id). NULL
        // for user rows and legacy (pre-v5) assistant turns.
        db.exec(`ALTER TABLE messages ADD COLUMN timeline TEXT`)
        db.exec('PRAGMA user_version = 5')
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    }
  ```

- [ ] **Step 5: Run both tests — expect PASS.**

  Run: `yarn test packages/sidecar/src/persistence/schema.test.ts packages/sidecar/src/persistence/open.test.ts`
  Expected: PASS. The idempotency test still passes (running `migrate` twice does not re-enter `version < 5`).

- [ ] **Step 6: Commit.**

  ```bash
  git add packages/sidecar/src/persistence/schema.ts packages/sidecar/src/persistence/schema.test.ts packages/sidecar/src/persistence/open.test.ts
  git commit -m "$(cat <<'EOF'
  feat(sidecar): schema v5 — messages.timeline TEXT

  Additive ALTER TABLE messages ADD COLUMN timeline TEXT, wrapped in the same
  BEGIN/COMMIT/ROLLBACK + PRAGMA user_version pattern as v4. Holds the JSON
  TimelineStep[] for an assistant turn; NULL for user rows and legacy turns.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 3 — Store timeline round-trip: persist + hydrate `Message.timeline`/`toolCalls`

**Files:**
- Modify: `packages/sidecar/src/persistence/store.ts`
- Test: `packages/sidecar/src/persistence/store.test.ts`

- [ ] **Step 1: Add failing round-trip / legacy / cascade tests.** Append before the final closing `})` of the `describe('SessionStore', …)` block (the `insertTurn` assistant arg gains an optional `timeline` field added in Step 3):

  ```typescript
    it('round-trips an assistant message timeline (reasoning + tool) and hydrates toolCalls in order', () => {
      store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
      store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
      store.insertTurn(
        {
          id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 3,
          timeline: [
            { kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'let me think' },
            { kind: 'tool', stepSeq: 1, agentId: 'coder', role: 'coder', callId: 'c1' },
          ],
        },
        's1',
        [{
          agentId: 'coder', role: 'coder', output: 'wrote it', startedAt: 1, finishedAt: 2, seq: 1,
          toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{"path":"/a.ts"}', output: 'ok', status: 'finished', seq: 1 }],
        }],
      )
      const msg = store.loadMessages('s1').find((m) => m.id === 'a1')!
      expect(msg.timeline).toEqual([
        { kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'let me think' },
        { kind: 'tool', stepSeq: 1, agentId: 'coder', role: 'coder', callId: 'c1' },
      ])
      expect(msg.toolCalls!.map((t) => [t.callId, t.name, t.status])).toEqual([['c1', 'write_file', 'finished']])
      expect(msg.toolCalls![0]).toMatchObject({ output: 'ok', seq: 1 })
    })

    it('loads a legacy assistant turn (no timeline) with timeline and toolCalls undefined', () => {
      store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
      store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
      store.insertTurn({ id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'ans', timestamp: 2 }, 's1', [])
      const msg = store.loadMessages('s1').find((m) => m.id === 'a1')!
      expect(msg.timeline).toBeUndefined()
      expect(msg.toolCalls).toBeUndefined()
    })

    it('deleteSession still cascades a message that carries a timeline', () => {
      store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
      store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
      store.insertTurn(
        {
          id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'done', timestamp: 3,
          timeline: [{ kind: 'tool', stepSeq: 0, agentId: 'coder', role: 'coder', callId: 'c1' }],
        },
        's1',
        [{ agentId: 'coder', role: 'coder', output: 'x', startedAt: 1, finishedAt: 2, seq: 0, toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'finished', seq: 0 }] }],
      )
      store.deleteSession('s1')
      expect(store.loadMessages('s1')).toHaveLength(0)
      expect(store.countToolCalls('s1')).toBe(0)
    })
  ```

- [ ] **Step 2: Run the store tests — expect FAIL.**

  Run: `yarn test packages/sidecar/src/persistence/store.test.ts`
  Expected: FAIL — `insertTurn` doesn't accept `timeline`; `msg.timeline`/`msg.toolCalls` come back `undefined`.

- [ ] **Step 3: Persist `timeline` in `insertTurn`.** Replace the method so the assistant param accepts `timeline?` and writes it via an in-transaction `UPDATE` (`insertMessage` has no timeline param):

  ```typescript
    insertTurn(
      assistant: { id: string; sessionId: string; agentId: string; content: string; timestamp: number; stopped?: boolean; timeline?: TimelineStep[] } | null,
      sessionId: string,
      runs: AgentRun[],
    ): void {
      this.db.exec('BEGIN')
      try {
        if (assistant) {
          this.insertMessage({ id: assistant.id, sessionId, role: 'assistant', agentId: assistant.agentId, content: assistant.content, timestamp: assistant.timestamp, stopped: assistant.stopped })
          const tl = assistant.timeline && assistant.timeline.length ? JSON.stringify(assistant.timeline) : null
          this.db.prepare(`UPDATE messages SET timeline=? WHERE id=?`).run(tl, assistant.id)
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

- [ ] **Step 4: Import `TimelineStep` into the store's type imports.** Add `TimelineStep` to the existing `@hip/protocol` import:

  ```typescript
  import type { AgentRole, AgentRun, Message, SessionSummary, SearchHit, TimelineStep, ToolCall, ToolStatus } from '@hip/protocol'
  ```

- [ ] **Step 5: Hydrate `timeline` + `toolCalls` in `loadMessages`.** Replace with:

  ```typescript
    loadMessages(sessionId: string): Message[] {
      const rows = this.db.prepare(`SELECT id,role,agent_id,content,timestamp,stopped,timeline FROM messages WHERE session_id=? ORDER BY seq`).all(sessionId) as
        { id: string; role: 'user' | 'assistant'; agent_id: string | null; content: string; timestamp: number; stopped: number; timeline: string | null }[]
      // Flat tool calls for a turn: every tool_calls row whose owning agent_run links to this message, ordered by the turn-global seq.
      const toolStmt = this.db.prepare(
        `SELECT tc.call_id,tc.agent_id,tc.name,tc.input,tc.output,tc.status,tc.error,tc.seq,tc.truncated
         FROM tool_calls tc JOIN agent_runs ar ON ar.id = tc.agent_run_id
         WHERE ar.message_id=? ORDER BY tc.seq`,
      )
      return rows.map((r) => {
        const base: Message = { id: r.id, role: r.role, content: r.content, agentId: r.agent_id ?? undefined, timestamp: r.timestamp, ...(r.stopped ? { stopped: true } : {}) }
        if (r.timeline != null) {
          base.timeline = JSON.parse(r.timeline) as TimelineStep[]
          const tools = (toolStmt.all(r.id) as { call_id: string; agent_id: string; name: string; input: string; output: string | null; status: ToolStatus; error: string | null; seq: number; truncated: number }[])
            .map((t): ToolCall => ({ callId: t.call_id, agentId: t.agent_id, name: t.name, input: t.input, status: t.status, seq: t.seq, ...(t.output != null ? { output: t.output } : {}), ...(t.error != null ? { error: t.error } : {}), ...(t.truncated ? { truncated: true } : {}) }))
          if (tools.length) base.toolCalls = tools
        }
        return base
      })
    }
  ```

- [ ] **Step 6: Run the store tests — expect PASS.**

  Run: `yarn test packages/sidecar/src/persistence/store.test.ts`
  Expected: PASS — round-trip returns `timeline` verbatim and `toolCalls` in `seq` order; legacy NULL-timeline rows return both `undefined`; cascade still removes messages + tool_calls. Pre-existing user-row assertions unaffected (fields only added when `timeline` is non-NULL).

- [ ] **Step 7: Type-check the sidecar persistence layer.**

  Run: `yarn workspace @hip/sidecar type-check`
  Expected: passes for persistence; remaining sidecar errors are confined to the streaming sites fixed in later tasks.

- [ ] **Step 8: Commit.**

  ```bash
  git add packages/sidecar/src/persistence/store.ts packages/sidecar/src/persistence/store.test.ts
  git commit -m "$(cat <<'EOF'
  feat(sidecar): persist + hydrate Message.timeline and toolCalls

  insertTurn writes the assistant turn's timeline as a JSON blob (NULL when
  empty). loadMessages parses timeline and, when present, hydrates a flat
  toolCalls array by joining tool_calls to the message's agent_runs (message_id)
  ordered by the turn-global seq. Legacy NULL-timeline rows load with both fields
  undefined; cascade deletes unaffected.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 4 — tool-trace: reasoning bursts + `trajectoryToTimeline()`

> `TimelineStep` already exists in `@hip/protocol` (Task 1). This task only consumes it.

**Files:**
- Modify: `packages/sidecar/src/session/tool-trace.ts` (add `ReasoningBurst`, `REASONING_CAP`, `clipReasoning`, extend `TraceRun`, add `trajectoryToTimeline`)
- Test: `packages/sidecar/src/session/tool-trace.test.ts`

- [ ] **Step 1 — Write the failing tests.** Update the import on line 3:

  ```ts
  import { clip, stringify, consumeToolCalls, trajectoryToRuns, trajectoryToTimeline, REASONING_CAP, clipReasoning, type ReasoningBurst, type ToolCallStreamLike, type TraceRun, type TraceRecorder } from './tool-trace.js'
  ```

  Replace the `freshRun()` helper so new runs carry an empty `reasoningBursts`:

  ```ts
  function freshRun(): TraceRun { return { role: 'coder', output: '', startedAt: 0, finishedAt: null, seq: 0, toolCalls: new Map(), reasoningBursts: [] } }
  ```

  Append:

  ```ts
  describe('clipReasoning', () => {
    it('passes short reasoning through untouched', () => {
      expect(clipReasoning('thinking…')).toEqual({ text: 'thinking…', truncated: false })
    })
    it('clips reasoning at REASONING_CAP and flags truncated', () => {
      const big = 'r'.repeat(REASONING_CAP + 500)
      const out = clipReasoning(big)
      expect(out.truncated).toBe(true)
      expect(out.text.length).toBe(REASONING_CAP)
    })
  })

  describe('trajectoryToTimeline', () => {
    function run(over: Partial<TraceRun> & { role: TraceRun['role'] }): TraceRun {
      return { output: '', startedAt: 0, finishedAt: null, seq: 0, toolCalls: new Map(), reasoningBursts: [], ...over }
    }

    it('returns [] for an empty trajectory', () => {
      expect(trajectoryToTimeline(new Map())).toEqual([])
    })

    it('interleaves reasoning + tool steps across two agents by stepSeq', () => {
      const trajectory = new Map<string, TraceRun>([
        ['supervisor', run({ role: 'supervisor', reasoningBursts: [{ stepSeq: 0, content: 'plan the work' }] })],
        ['coder', run({
          role: 'coder',
          reasoningBursts: [{ stepSeq: 2, content: 'now I write the file' }],
          toolCalls: new Map<string, ToolCall>([
            ['c1', { callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'finished', output: 'ok', seq: 1 }],
          ]),
        })],
      ])
      expect(trajectoryToTimeline(trajectory)).toEqual([
        { kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'plan the work' },
        { kind: 'tool', stepSeq: 1, agentId: 'coder', role: 'coder', callId: 'c1' },
        { kind: 'reasoning', stepSeq: 2, agentId: 'coder', role: 'coder', content: 'now I write the file' },
      ])
    })

    it('uses each tool call seq as its stepSeq', () => {
      const trajectory = new Map<string, TraceRun>([
        ['coder', run({
          role: 'coder',
          toolCalls: new Map<string, ToolCall>([
            ['c2', { callId: 'c2', agentId: 'coder', name: 'read_file', input: '{}', status: 'finished', output: 'r', seq: 7 }],
            ['c1', { callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'finished', output: 'w', seq: 4 }],
          ]),
        })],
      ])
      expect(trajectoryToTimeline(trajectory)).toEqual([
        { kind: 'tool', stepSeq: 4, agentId: 'coder', role: 'coder', callId: 'c1' },
        { kind: 'tool', stepSeq: 7, agentId: 'coder', role: 'coder', callId: 'c2' },
      ])
    })

    it('propagates the sticky truncated flag on a reasoning burst', () => {
      const trajectory = new Map<string, TraceRun>([
        ['supervisor', run({ role: 'supervisor', reasoningBursts: [{ stepSeq: 0, content: 'clipped…', truncated: true }] })],
      ])
      expect(trajectoryToTimeline(trajectory)[0]).toEqual({ kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'clipped…', truncated: true })
    })

    it('omits the truncated key when a reasoning burst was not clipped', () => {
      const trajectory = new Map<string, TraceRun>([
        ['supervisor', run({ role: 'supervisor', reasoningBursts: [{ stepSeq: 0, content: 'short' }] })],
      ])
      expect(trajectoryToTimeline(trajectory)[0]).not.toHaveProperty('truncated')
    })
  })
  ```

- [ ] **Step 2 — Run the new tests; confirm FAIL.**

  Run: `yarn test packages/sidecar/src/session/tool-trace.test.ts`
  Expected: import errors — `trajectoryToTimeline`/`REASONING_CAP`/`clipReasoning` not exported.

- [ ] **Step 3 — Implement.** Extend the type import on line 1 to include `TimelineStep`:

  ```ts
  import type { AgentRole, AgentRun, ServerMessage, TimelineStep, ToolCall, ToolStatus } from '@hip/protocol'
  ```

  Add after `clip()`:

  ```ts
  export const REASONING_CAP = 4096

  /** Clip an agent's reasoning burst to REASONING_CAP, reusing the blob-clip pattern. */
  export function clipReasoning(s: string): { text: string; truncated: boolean } {
    return clip(s, REASONING_CAP)
  }

  /** One contiguous burst of reasoning deltas from a single agent, opened when the burst
   *  starts (drawing the next turn-global stepSeq) and closed when a tool fires or the agent ends. */
  export interface ReasoningBurst {
    stepSeq: number
    content: string
    truncated?: boolean
  }
  ```

  Extend `TraceRun` (after its `toolCalls` line):

  ```ts
    toolCalls: Map<string, ToolCall>
    reasoningBursts: ReasoningBurst[]
  ```

  Append at end of file:

  ```ts
  /**
   * Flatten the live trajectory into a single turn-ordered timeline. For every run we emit
   * its reasoning bursts (kind:'reasoning', carrying the burst's own stepSeq) and its tool
   * calls (kind:'tool', stepSeq = toolCall.seq), then sort everything by the shared
   * turn-global stepSeq ascending so reasoning and tools interleave across all agents.
   */
  export function trajectoryToTimeline(trajectory: Map<string, TraceRun>): TimelineStep[] {
    const steps: TimelineStep[] = []
    for (const [agentId, r] of trajectory) {
      for (const b of r.reasoningBursts) {
        steps.push({ kind: 'reasoning', stepSeq: b.stepSeq, agentId, role: r.role, content: b.content, ...(b.truncated ? { truncated: true } : {}) })
      }
      for (const tc of r.toolCalls.values()) {
        steps.push({ kind: 'tool', stepSeq: tc.seq, agentId, role: r.role, callId: tc.callId })
      }
    }
    return steps.sort((a, b) => a.stepSeq - b.stepSeq)
  }
  ```

  > Note: `clip()`'s current signature must accept a cap argument (`clip(s, cap)`). If it is hardcoded to `TOOL_BLOB_CAP`, generalize it to `clip(s, cap = TOOL_BLOB_CAP)` in this step so `clipReasoning` can reuse it.

- [ ] **Step 4 — Re-run the tests; confirm PASS** (existing suite stays green).

  Run: `yarn test packages/sidecar/src/session/tool-trace.test.ts`
  Expected: all pass.

- [ ] **Step 5 — Type-check.**

  Run: `yarn workspace @hip/sidecar type-check`
  Expected: no new errors from the touched files.

- [ ] **Step 6 — Commit.**

  ```bash
  git add packages/sidecar/src/session/tool-trace.ts packages/sidecar/src/session/tool-trace.test.ts
  git commit -m "$(cat <<'EOF'
  feat(sidecar): reasoning bursts + trajectoryToTimeline

  Record per-agent ReasoningBurst[] on TraceRun (clipped at REASONING_CAP, sticky
  truncated) and flatten the trajectory into one turn-global stepSeq-ordered
  timeline that interleaves reasoning and tool steps across agents.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 5 — `verify.ts`: anti-phantom write verification

New module `verifyWrites()`: if the supervisor's final text claims a file was created but no `write_file`/`edit_file` finished this turn, return a localized correction; else `{}`.

**Files:**
- Create: `packages/sidecar/src/session/verify.ts`
- Test: `packages/sidecar/src/session/verify.test.ts`

- [ ] **Step 1 — Write the failing test.** Create `packages/sidecar/src/session/verify.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import type { ToolCall } from '@hip/protocol'
  import { verifyWrites } from './verify.js'
  import type { TraceRun } from './tool-trace.js'

  function run(role: TraceRun['role'], ...toolCalls: ToolCall[]): TraceRun {
    return { role, output: '', startedAt: 0, finishedAt: null, seq: 0, reasoningBursts: [], toolCalls: new Map(toolCalls.map((tc) => [tc.callId, tc])) }
  }
  function tool(over: Partial<ToolCall> & { callId: string; name: string; status: ToolCall['status'] }): ToolCall {
    return { agentId: 'coder', input: '{}', seq: 0, ...over }
  }
  function trajectory(...runs: [string, TraceRun][]): Map<string, TraceRun> {
    return new Map(runs)
  }

  const EN_NOTE = '⚠️ No files were actually created this turn — no write tool was called.'
  const ZH_CN_NOTE = '⚠️ 本回合没有真正创建任何文件——没有调用写入工具。'
  const ZH_TW_NOTE = '⚠️ 本回合沒有真正建立任何檔案——沒有呼叫寫入工具。'

  describe('verifyWrites — lie case (claims creation, zero writes)', () => {
    it('returns the EN correction', () => {
      expect(verifyWrites(trajectory(['supervisor', run('supervisor')]), 'I created self-intro.html for you.', 'en')).toEqual({ correction: EN_NOTE })
    })
    it('returns the zh-CN correction', () => {
      expect(verifyWrites(trajectory(['supervisor', run('supervisor')]), '已创建 self-intro.html 文件。', 'zh-CN')).toEqual({ correction: ZH_CN_NOTE })
    })
    it('returns the zh-TW correction', () => {
      expect(verifyWrites(trajectory(['supervisor', run('supervisor')]), '已建立 self-intro.html 檔案。', 'zh-TW')).toEqual({ correction: ZH_TW_NOTE })
    })
    it('catches wrote/saved/generated phrasings', () => {
      const traj = trajectory(['supervisor', run('supervisor')])
      expect(verifyWrites(traj, 'I wrote the file to index.ts.', 'en')).toEqual({ correction: EN_NOTE })
      expect(verifyWrites(traj, 'Saved your config.json.', 'en')).toEqual({ correction: EN_NOTE })
      expect(verifyWrites(traj, 'Generated a report.md summary.', 'en')).toEqual({ correction: EN_NOTE })
    })
  })

  describe('verifyWrites — truth case (claim backed by a finished write)', () => {
    it('returns {} when a write_file finished', () => {
      expect(verifyWrites(trajectory(['coder', run('coder', tool({ callId: 'c1', name: 'write_file', status: 'finished', output: 'ok' }))]), 'I created self-intro.html for you.', 'en')).toEqual({})
    })
    it('returns {} when an edit_file finished', () => {
      expect(verifyWrites(trajectory(['coder', run('coder', tool({ callId: 'c1', name: 'edit_file', status: 'finished', output: 'ok' }))]), '已创建 self-intro.html 文件。', 'zh-CN')).toEqual({})
    })
  })

  describe('verifyWrites — no false positives', () => {
    it('silent write → no correction', () => {
      expect(verifyWrites(trajectory(['coder', run('coder', tool({ callId: 'c1', name: 'write_file', status: 'finished', output: 'ok' }))]), 'Here is the plan.', 'en')).toEqual({})
    })
    it('no claim + no write → no correction', () => {
      expect(verifyWrites(trajectory(['supervisor', run('supervisor')]), 'I reviewed the approach.', 'en')).toEqual({})
    })
    it('a running (not finished) write does NOT count → lie correction', () => {
      expect(verifyWrites(trajectory(['coder', run('coder', tool({ callId: 'c1', name: 'write_file', status: 'running' }))]), 'I created self-intro.html for you.', 'en')).toEqual({ correction: EN_NOTE })
    })
    it('an errored write does NOT count → lie correction', () => {
      expect(verifyWrites(trajectory(['coder', run('coder', tool({ callId: 'c1', name: 'write_file', status: 'error', error: 'EACCES' }))]), 'I created self-intro.html for you.', 'en')).toEqual({ correction: EN_NOTE })
    })
  })
  ```

- [ ] **Step 2 — Run the test; confirm FAIL** (module missing).

  Run: `yarn test packages/sidecar/src/session/verify.test.ts`
  Expected: cannot resolve `./verify.js`.

- [ ] **Step 3 — Implement.** Create `packages/sidecar/src/session/verify.ts`:

  ```ts
  import type { TraceRun } from './tool-trace.js'

  /** Localized note appended when the model claims a file write that never happened. */
  const NOTE: Record<'en' | 'zh-CN' | 'zh-TW', string> = {
    en: '⚠️ No files were actually created this turn — no write tool was called.',
    'zh-CN': '⚠️ 本回合没有真正创建任何文件——没有调用写入工具。',
    'zh-TW': '⚠️ 本回合沒有真正建立任何檔案——沒有呼叫寫入工具。',
  }

  const WRITE_TOOLS = new Set(['write_file', 'edit_file'])

  const FILE_TOKEN = String.raw`(?:[\w./-]*[\w-]\.[A-Za-z0-9]+|\/[\w./-]+)`
  const EN_VERB = String.raw`(?:created|wrote|saved|generated)`
  const CJK_VERB = String.raw`(?:已创建|已生成|已保存|建立)`
  const CLAIM_PATTERNS: RegExp[] = [
    new RegExp(String.raw`\b${EN_VERB}\b[\s\S]{0,80}?${FILE_TOKEN}`, 'i'),
    new RegExp(String.raw`${FILE_TOKEN}[\s\S]{0,80}?\b${EN_VERB}\b`, 'i'),
    new RegExp(String.raw`${CJK_VERB}[\s\S]{0,40}?${FILE_TOKEN}`),
    new RegExp(String.raw`${FILE_TOKEN}[\s\S]{0,40}?${CJK_VERB}`),
  ]

  function claimsCreation(text: string): boolean {
    return CLAIM_PATTERNS.some((re) => re.test(text))
  }

  /**
   * Detect the "phantom write" lie: the supervisor's final text claims a file was
   * created, but no write_file/edit_file actually FINISHED this turn across any run.
   */
  export function verifyWrites(
    trajectory: Map<string, TraceRun>,
    supervisorText: string,
    language: 'en' | 'zh-CN' | 'zh-TW',
  ): { correction?: string } {
    const writtenPaths = new Set<string>()
    for (const run of trajectory.values()) {
      for (const tc of run.toolCalls.values()) {
        if (WRITE_TOOLS.has(tc.name) && tc.status === 'finished') writtenPaths.add(tc.input)
      }
    }
    if (claimsCreation(supervisorText) && writtenPaths.size === 0) {
      return { correction: NOTE[language] }
    }
    return {}
  }
  ```

- [ ] **Step 4 — Re-run; confirm PASS.**

  Run: `yarn test packages/sidecar/src/session/verify.test.ts`
  Expected: all green.

- [ ] **Step 5 — Type-check.**

  Run: `yarn workspace @hip/sidecar type-check`
  Expected: no errors.

- [ ] **Step 6 — Commit.**

  ```bash
  git add packages/sidecar/src/session/verify.ts packages/sidecar/src/session/verify.test.ts
  git commit -m "$(cat <<'EOF'
  feat(sidecar): verifyWrites — catch phantom file-creation claims

  When the supervisor's final text claims a file was created/written/saved but no
  write_file/edit_file finished this turn, append a localized (en/zh-CN/zh-TW)
  correction note. Claim detection requires both a creation verb and a
  filename/path token; only finished writes count.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 6 — `agents.ts`: cwd-aware prompt builders

Convert the static `SUPERVISOR_PROMPT` + the coder subagent into `cwd`-parameterized builders (builders-only; no leftover constants), and update the one `buildAgent` call site in `session.ts`. Preserve the planner/reviewer behavior and the supervisor delegation ritual.

**Files:**
- Modify: `packages/sidecar/src/session/agents.ts`
- Modify: `packages/sidecar/src/session/session.ts` (the `createDeepAgent` call in `buildAgent`)
- Test: `packages/sidecar/src/session/agents.test.ts`

- [ ] **Step 1 — Write the failing tests.** Replace the contents of `packages/sidecar/src/session/agents.test.ts`:

  ```ts
  import { describe, it, expect } from 'vitest'
  import { roleForName, buildSupervisorPrompt, buildSubagents } from './agents.js'

  const CWD = '/Users/dev/projects/demo'

  describe('roleForName', () => {
    it('maps planner/coder/reviewer to themselves', () => {
      expect(roleForName('planner')).toBe('planner')
      expect(roleForName('coder')).toBe('coder')
      expect(roleForName('reviewer')).toBe('reviewer')
    })
    it('maps undefined/unknown to supervisor', () => {
      expect(roleForName(undefined)).toBe('supervisor')
      expect(roleForName('researcher')).toBe('supervisor')
      expect(roleForName('')).toBe('supervisor')
    })
  })

  describe('buildSupervisorPrompt', () => {
    it('still forces use of the task tool', () => {
      expect(buildSupervisorPrompt(CWD)).toContain('task')
    })
    it('embeds the literal cwd and the sandbox-root rules', () => {
      const prompt = buildSupervisorPrompt(CWD)
      expect(prompt).toContain(CWD)
      expect(prompt).toContain('Never use `/workspace`')
    })
    it('embeds the anti-phantom rule', () => {
      expect(buildSupervisorPrompt(CWD)).toContain('MUST NOT claim')
    })
    it('tells the supervisor to only report files the coder actually wrote', () => {
      expect(buildSupervisorPrompt(CWD)).toContain('only report files the coder actually wrote')
    })
  })

  describe('buildSubagents', () => {
    it('returns planner, coder, reviewer in order', () => {
      expect(buildSubagents(CWD).map((s) => s.name)).toEqual(['planner', 'coder', 'reviewer'])
    })
    it('every subagent has a non-empty description + systemPrompt', () => {
      for (const sub of buildSubagents(CWD)) {
        expect(sub.description.length).toBeGreaterThan(0)
        expect(sub.systemPrompt.length).toBeGreaterThan(0)
      }
    })
    it('every subagent name resolves to a non-supervisor role', () => {
      for (const sub of buildSubagents(CWD)) {
        expect(roleForName(sub.name)).toBe(sub.name)
      }
    })
    it('injects the cwd + anti-phantom rule into the coder spec', () => {
      const coder = buildSubagents(CWD).find((s) => s.name === 'coder')!
      expect(coder.systemPrompt).toContain(CWD)
      expect(coder.systemPrompt).toContain('Never use `/workspace`')
      expect(coder.systemPrompt).toContain('MUST NOT claim')
    })
    it('leaves planner and reviewer prompts free of file-tool injection', () => {
      const subs = buildSubagents(CWD)
      expect(subs.find((s) => s.name === 'planner')!.systemPrompt).not.toContain('Never use `/workspace`')
      expect(subs.find((s) => s.name === 'reviewer')!.systemPrompt).not.toContain('Never use `/workspace`')
    })
  })
  ```

- [ ] **Step 2 — Run; confirm FAIL** (builders not exported).

  Run: `yarn test packages/sidecar/src/session/agents.test.ts`

- [ ] **Step 3 — Rewrite `agents.ts` as builders.** Replace the contents (preserve the EXISTING supervisor/coder wording from the current file where shown as `…BASE`; the strings below are the structure — keep the real ritual text):

  ```ts
  import type { AgentRole } from '@hip/protocol'

  /** One subagent spec in the shape deepagents' `subagents` option expects. */
  export interface SubagentSpec {
    name: string
    description: string
    systemPrompt: string
  }

  /** Real-cwd sandbox rules, appended to every prompt that owns the filesystem tools. */
  function cwdBlock(cwd: string): string {
    return (
      `Your working directory is the project root \`${cwd}\`. Filesystem tools are sandboxed to it. ` +
      'Address every path as an absolute path starting with `/`, relative to this root — ' +
      `e.g. write to \`/self-intro.html\` (maps to \`${cwd}/self-intro.html\`). ` +
      'Never use `/workspace`, `/tmp`, `/home`, or any path outside this root.'
    )
  }

  /** Anti-phantom rule: never claim a write that did not actually happen via a tool call. */
  const ANTI_PHANTOM =
    'You MUST NOT claim, state, or imply any file was created, written, saved, or modified ' +
    'unless you actually called write_file/edit_file for that exact path this turn and it succeeded. ' +
    'If you did not call a write tool, say plainly that no file was created.'

  // NOTE TO IMPLEMENTER: copy the EXISTING SUPERVISOR_PROMPT text from the current agents.ts
  // verbatim into SUPERVISOR_BASE (it is tested live for the delegation ritual). Same for the
  // current coder subagent prompt into CODER_BASE. The strings below are a faithful summary.
  const SUPERVISOR_BASE =
    'You are the Supervisor. You have a `task` tool that delegates to subagents "planner", "coder", and "reviewer". You must complete the task using exactly three sequential `task` calls: (1) planner to get a plan, (2) coder to implement it, (3) reviewer to review it. Your VERY FIRST action must be the `task` call to "planner"; do not write any prose before all three `task` calls have been made. Only after all three return may you write a short final summary.'

  const CODER_BASE =
    'You are the Coder. Implement the plan. You have real file tools — read_file, write_file, edit_file, ls, glob, grep — operating on the project directory; use them to read and write actual files. Output the code and a one-line summary.'

  /** The supervisor prompt, bound to a real project root. */
  export function buildSupervisorPrompt(cwd: string): string {
    return (
      `${SUPERVISOR_BASE}\n\n${cwdBlock(cwd)}\n\n${ANTI_PHANTOM}\n\n` +
      'In your final summary, only report files the coder actually wrote via tool calls.'
    )
  }

  /** The three coding subagents, with the coder bound to a real project root. */
  export function buildSubagents(cwd: string): SubagentSpec[] {
    return [
      { name: 'planner', description: 'Breaks the request into a short ordered plan before any code is written.', systemPrompt: 'You are the Planner. Produce a concise numbered plan. Do not write code.' },
      { name: 'coder', description: 'Writes or edits code to satisfy the plan.', systemPrompt: `${CODER_BASE}\n\n${cwdBlock(cwd)}\n\n${ANTI_PHANTOM}` },
      { name: 'reviewer', description: 'Reviews the coder output for correctness and risks.', systemPrompt: 'You are the Reviewer. Critically review the code for bugs and risks. Be concise.' },
    ]
  }

  const NAME_TO_ROLE: Record<string, AgentRole> = { planner: 'planner', coder: 'coder', reviewer: 'reviewer' }

  export function roleForName(name: string | undefined): AgentRole {
    return name && name in NAME_TO_ROLE ? NAME_TO_ROLE[name] : 'supervisor'
  }
  ```

- [ ] **Step 4 — Update the `buildAgent` call site in `session.ts`.** Replace the import:

  ```ts
  import { buildSubagents, buildSupervisorPrompt, roleForName } from './agents.js'
  ```

  Replace the `createDeepAgent` call inside `buildAgent()` (uses the cwd-bound builder; `cwd ?? '/'` keeps the no-cwd path coherent):

  ```ts
    const promptCwd = this._config.cwd ?? '/'
    this.agent = createDeepAgent({
      model,
      systemPrompt: this._config.systemPrompt ?? buildSupervisorPrompt(promptCwd),
      subagents: buildSubagents(promptCwd) as unknown as NonNullable<Parameters<typeof createDeepAgent>[0]>['subagents'],
      ...(backend ? { backend } : {}),
    })
  ```

- [ ] **Step 5 — Re-run the agents tests; confirm PASS.**

  Run: `yarn test packages/sidecar/src/session/agents.test.ts`
  Expected: all green.

- [ ] **Step 6 — Guard against stale references, then type-check.**

  Run: `grep -rn "SUBAGENTS\|SUPERVISOR_PROMPT" packages/ --include="*.ts" | grep -v node_modules`
  Expected: prints nothing (all migrated).
  Run: `yarn workspace @hip/sidecar type-check`
  Expected: no errors.

- [ ] **Step 7 — Run the session suite** to confirm agent construction didn't regress.

  Run: `yarn test packages/sidecar/src/session/`
  Expected: session/tool-trace/verify/agents suites pass (live DeepSeek cases skip without a key).

- [ ] **Step 8 — Commit.**

  ```bash
  git add packages/sidecar/src/session/agents.ts packages/sidecar/src/session/agents.test.ts packages/sidecar/src/session/session.ts
  git commit -m "$(cat <<'EOF'
  feat(sidecar): cwd-aware prompt builders with anti-phantom rules

  Convert SUPERVISOR_PROMPT + the coder subagent into buildSupervisorPrompt(cwd)
  and buildSubagents(cwd). Both inject a real-cwd sandbox block (absolute paths
  under the project root; never /workspace/tmp/home) and an anti-phantom block
  (never claim a write without a successful write_file/edit_file call). The
  supervisor only reports files the coder actually wrote. Planner/reviewer
  unchanged. Update the session.ts call site.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 7 — Wire reasoning + turnId + stepSeq + model toggle + verification into `session.ts`

Pure **wiring**. Gate = type-check + `yarn build` + the live DeepSeek suite + GUI (the reasoning/timeline/verify logic is already unit-tested in Tasks 4–5). `agents.ts`/`buildAgent` prompts were done in Task 6; schema/store timeline persistence was done in Tasks 2–3 — this task does NOT repeat them.

**Files:**
- Modify: `packages/sidecar/src/session/session.ts`
- Modify: `packages/sidecar/src/session/tool-trace.ts` (widen `ConsumeCtx`; `tool:*` emits carry `turnId`/`role`)
- Modify: `packages/sidecar/src/session/tool-trace.test.ts` (update existing `consumeToolCalls` ctx + assertions)

- [ ] **Step 1 — `resolveModel(config)` + use it in `buildModel`; title generator pinned to `deepseek-chat`.**

  Replace the model constant + add the resolver:

  ```ts
  const DEFAULT_MODEL = 'deepseek-chat'
  const TITLE_MODEL = 'deepseek-chat'
  const TITLE_LEN = 40

  /** thinking === false → fast non-reasoning model; otherwise the reasoner (default). A caller-pinned config.model still wins. */
  export function resolveModel(config: SessionConfig): string {
    return config.model || (config.thinking === false ? 'deepseek-chat' : 'deepseek-reasoner')
  }
  ```

  Route `buildModel` through it and pin the title model:

  ```ts
  function buildModel(config: SessionConfig): ChatOpenAI {
    return new ChatOpenAI({
      model: resolveModel(config),
      apiKey: process.env.DEEPSEEK_API_KEY || 'sk-missing',
      configuration: { baseURL: 'https://api.deepseek.com/v1' },
    })
  }
  ```

  In `buildDefaultTitleGenerator`, set the title model to `TITLE_MODEL` (was `config.model || DEFAULT_MODEL`) and rename its param to `_config` if it no longer reads it.

- [ ] **Step 2 — `runTurn`: hoist `turnId`, single `stepSeq`, reasoning bursts, thread `turnId`/`role`.** Replace the head of `runTurn` (counters + recorder + `ensureStarted`/`finishRemaining`) with:

  ```ts
  private async runTurn(send: SendFn): Promise<string> {
    this.abortController = new AbortController()
    this.running = true

    // turnId === the assistant message id; computed once here and reused by finalizeAndPersist.
    const turnId = `asst-supervisor-${Date.now()}`

    const trajectory = new Map<string, TraceRun>()
    let agentSeq = 0
    let stepSeq = 0                       // ONE turn-global counter for BOTH tools and reasoning bursts
    const nextSeq = () => stepSeq++
    const pending: Promise<void>[] = []
    const started = new Set<string>()

    const openReasoning = new Map<string, { stepSeq: number; content: string }>()
    const REASONING_CAP = 4096
    const reasoningDelta = (agentId: string, role: AgentRole, delta: string) => {
      if (!delta) return
      let burst = openReasoning.get(agentId)
      if (!burst) { burst = { stepSeq: nextSeq(), content: '' }; openReasoning.set(agentId, burst) }
      if (burst.content.length < REASONING_CAP) burst.content = (burst.content + delta).slice(0, REASONING_CAP)
      send({ type: 'reasoning:delta', sessionId: this.id, turnId, agentId, role, stepSeq: burst.stepSeq, delta })
    }
    const closeReasoning = (agentId: string) => {
      const burst = openReasoning.get(agentId)
      if (!burst) return
      openReasoning.delete(agentId)
      const r = trajectory.get(agentId)
      if (r) r.reasoningBursts.push({ stepSeq: burst.stepSeq, content: burst.content, ...(burst.content.length >= REASONING_CAP ? { truncated: true } : {}) })
    }

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
        if (truncated || tc.truncated) tc.truncated = true
      },
    }
    const traceCtx = {
      sessionId: this.id, send, turnId, nextSeq, pending, record: recorder,
      roleOf: (agentId: string): AgentRole => trajectory.get(agentId)?.role ?? 'supervisor',
      onToolStart: (agentId: string) => closeReasoning(agentId),  // close burst BEFORE the tool draws its stepSeq
    }
    const ensureStarted = (agentId: string, role: AgentRole, parentAgentId?: string, taskInput?: string) => {
      if (started.has(agentId)) return
      started.add(agentId)
      trajectory.set(agentId, { role, output: '', startedAt: Date.now(), finishedAt: null, seq: agentSeq++, toolCalls: new Map(), reasoningBursts: [], ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}) })
      send({ type: 'agent:started', sessionId: this.id, turnId, agentId, role, ...(parentAgentId ? { parentAgentId } : {}), ...(taskInput ? { taskInput } : {}) })
    }
    const finishRemaining = () => {
      for (const id of started) {
        closeReasoning(id)
        const r = trajectory.get(id); if (r) r.finishedAt = Date.now()
        send({ type: 'agent:finished', sessionId: this.id, turnId, agentId: id })
      }
      started.clear()
    }
  ```

  Replace the pump bodies so BOTH pumps iterate `msg.reasoning` alongside `msg.text` (per-message `Promise.all`), `token:stream` carries `turnId`, and sub-agent finish closes its burst:

  ```ts
      const pumpSupervisor = async () => {
        for await (const msg of run.messages) {
          await Promise.all([
            (async () => { for await (const delta of msg.text) {
              if (!delta) continue
              supervisorText += delta
              const r = trajectory.get('supervisor'); if (r) r.output += delta
              send({ type: 'token:stream', sessionId: this.id, turnId, agentId: 'supervisor', delta })
            } })(),
            (async () => { for await (const delta of msg.reasoning) { reasoningDelta('supervisor', 'supervisor', delta) } })(),
          ])
        }
      }
      const pumpSubagents = async () => {
        for await (const sub of run.subagents) {
          const agentId = sub.name
          const role = roleForName(sub.name)
          const taskInput = await safeTaskInput(sub)
          ensureStarted(agentId, role, 'supervisor', taskInput)
          await Promise.all([
            (async () => { for await (const msg of sub.messages) {
              await Promise.all([
                (async () => { for await (const delta of msg.text) {
                  if (!delta) continue
                  const r = trajectory.get(agentId); if (r) r.output += delta
                  send({ type: 'token:stream', sessionId: this.id, turnId, agentId, delta })
                } })(),
                (async () => { for await (const delta of msg.reasoning) { reasoningDelta(agentId, role, delta) } })(),
              ])
            } })(),
            consumeToolCalls(agentId, sub.toolCalls, traceCtx),
          ])
          if (started.delete(agentId)) {
            closeReasoning(agentId)
            const r = trajectory.get(agentId); if (r) r.finishedAt = Date.now()
            send({ type: 'agent:finished', sessionId: this.id, turnId, agentId })
          }
        }
      }
  ```

  Update the finalize call sites to pass `turnId` and return its result (abort-with-partial path and the normal tail):

  ```ts
      if (isAbort && supervisorText) {
        return this.finalizeAndPersist(send, turnId, supervisorText, trajectory, true)
      } else { /* …existing error send… */ }
      return ''
    } finally { this.running = false; this.abortController = null }

    return this.finalizeAndPersist(send, turnId, supervisorText, trajectory, false)
  ```

  Burst contract (verify in your diff): a burst opens on the first reasoning delta (draws `nextSeq()`, emits `reasoning:delta`), subsequent deltas append + re-emit the SAME `stepSeq`, and it closes (pushed to `reasoningBursts`) on any tool start (`onToolStart` → before `nextSeq()`) or agent finish.

- [ ] **Step 3 — `tool-trace.ts`: widen `ConsumeCtx`; `tool:*` carry `turnId` (+ `role` on started); update its tests.** Replace `ConsumeCtx`:

  ```ts
  export interface ConsumeCtx {
    sessionId: string
    send: (msg: ServerMessage) => void
    turnId: string
    nextSeq: () => number
    pending: Promise<void>[]
    record: TraceRecorder
    roleOf: (agentId: string) => AgentRole
    onToolStart: (agentId: string) => void
  }
  ```

  In `consumeToolCalls`, before drawing the seq, close the reasoning burst and add the fields to the emits:

  ```ts
      ctx.onToolStart(agentId)
      const seq = ctx.nextSeq()
      const inClip = clip(stringify(tc.input))
      ctx.record.start(agentId, tc.callId, tc.name, inClip.text, seq, inClip.truncated)
      ctx.send({ type: 'tool:started', sessionId: ctx.sessionId, turnId: ctx.turnId, agentId, role: ctx.roleOf(agentId), callId: tc.callId, name: tc.name, input: inClip.text, seq, ...(inClip.truncated ? { truncated: true } : {}) })
  ```

  ```ts
      ctx.send({ type: 'tool:finished', sessionId: ctx.sessionId, turnId: ctx.turnId, agentId, callId: tc.callId, status, ...(output !== undefined ? { output } : {}), ...(error ? { error } : {}), ...(truncated ? { truncated: true } : {}) })
  ```

  **Update the existing `consumeToolCalls` tests in `tool-trace.test.ts`:** every `ConsumeCtx` literal they build now needs `turnId: 'turn1'`, `roleOf: () => 'coder'` (or the agent under test), and `onToolStart: () => {}`. Every expected `tool:started` object needs `turnId: 'turn1'` and `role: 'coder'`; every expected `tool:finished` needs `turnId: 'turn1'`. (Read the file; there are a handful of these literals + `expect(send).toHaveBeenCalledWith(...)` / pushed-array assertions.)

- [ ] **Step 4 — `finalizeAndPersist`: reuse `turnId`, run `verifyWrites`, build + persist + emit `timeline` AND `toolCalls`.** Update imports:

  ```ts
  import { consumeToolCalls, trajectoryToRuns, trajectoryToTimeline, type TraceRun, type TraceRecorder } from './tool-trace.js'
  import { verifyWrites } from './verify.js'
  ```

  Replace the method:

  ```ts
  /** Push the assistant message into context, persist the turn, and emit message:complete.
   *  Returns the final supervisor text (possibly appended with a verification correction). */
  private finalizeAndPersist(send: SendFn, turnId: string, supervisorText: string, trajectory: Map<string, TraceRun>, stopped: boolean): string {
    const { correction } = verifyWrites(trajectory, supervisorText, this._config.language ?? 'en')
    const finalText = correction ? `${supervisorText}\n\n${correction}` : supervisorText

    if (finalText) this.messages.push(new AIMessage(finalText))
    const ts = Date.now()
    const runs: AgentRun[] = trajectoryToRuns(trajectory)
    const timeline = trajectoryToTimeline(trajectory)
    const toolCalls = runs.flatMap((r) => r.toolCalls ?? [])
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
      message: { id: turnId, role: 'assistant', content: finalText, agentId: 'supervisor', timestamp: ts, timeline, toolCalls, ...(stopped ? { stopped: true } : {}) },
    })
    return finalText
  }
  ```

  > The emitted message carries `toolCalls` so the live store (Task 9) can finalize/coerce them; this mirrors what the reload path reconstructs from `tool_calls`.

- [ ] **Step 5 — `setThinking(thinking)` on `Session` (mirrors `setCwd`; NO-OP while running).** After `setCwd`:

  ```ts
  /** Toggle the thinking (reasoner) model and rebuild the agent. NO-OP while a turn is running. */
  setThinking(thinking: boolean): void {
    if (this.running) return
    this._config = { ...this._config, thinking }
    this.buildAgent()
  }
  ```

- [ ] **Step 6 — Gate.**

  Run: `yarn workspace @hip/sidecar type-check && yarn build && yarn test packages/sidecar/src/session`
  Expected: type-check exit 0; build succeeds; the `session`/`tool-trace`/`verify`/`agents` suites pass (live DeepSeek describe runs with a key, skips without). Then **GUI acceptance** (manual): a cwd-bound session, thinking ON, reasoning bursts stream and the timeline renders.

- [ ] **Step 7 — Commit.**

  ```bash
  git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/tool-trace.ts packages/sidecar/src/session/tool-trace.test.ts
  git commit -m "$(cat <<'EOF'
  feat(sidecar): wire reasoning capture, turnId/stepSeq, model toggle, write verification

  runTurn hoists turnId (= assistant message id) and a single turn-global stepSeq
  feeding tools + reasoning bursts; both pumps iterate msg.reasoning and emit
  reasoning:delta; ConsumeCtx/tool:* carry turnId+role. finalizeAndPersist runs
  verifyWrites, then persists+emits timeline and toolCalls. resolveModel toggles
  reasoner/chat (titles stay deepseek-chat); Session.setThinking rebuilds the agent.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 8 — `session-manager.ts`: `session:setThinking` handler

Mirror the `session:setCwd` handler; persist config; echo `session:thinking`. Default-config fallback gains `thinking: true` (and drop the hardcoded `model` so `resolveModel` chooses the reasoner).

**Files:**
- Modify: `packages/sidecar/src/session/session-manager.ts`
- Test: `packages/sidecar/src/session/session-manager-fs.test.ts`

- [ ] **Step 1 — Add the handler + default `thinking: true`.** After the `session:setCwd` case:

  ```ts
      case 'session:setThinking': {
        const s = this.ensureSession(msg.sessionId)
        s.setThinking(msg.thinking)
        this.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
        send({ type: 'session:thinking', sessionId: msg.sessionId, thinking: msg.thinking })
        break
      }
  ```

  Update the cold-resume default-config fallback in `ensureSession`:

  ```ts
    const config: SessionConfig = row ? JSON.parse(row.config) : { llmProvider: 'deepseek', model: '', tools: [], thinking: true }
  ```

  > `model: ''` + `thinking: true` resolves to `deepseek-reasoner` (the previous `'deepseek-chat'` would have pinned the fast model and defeated the toggle).

- [ ] **Step 2 — Run; confirm type-check passes.**

  Run: `yarn workspace @hip/sidecar type-check`
  Expected: exit 0 (the switch is exhaustive; `session:setThinking`/`session:thinking` are Task 1 types).

- [ ] **Step 3 — Unit test the handler.** Extend `session-manager-fs.test.ts` (fold the two extra imports into the existing import group):

  ```ts
  import { openDatabase } from '../persistence/open.js'
  import { SessionStore } from '../persistence/store.js'

  describe('session-manager setThinking', () => {
    it('echoes session:thinking', () => {
      const { mgr, sent, send } = setup()
      sent.length = 0
      mgr.handle({ type: 'session:setThinking', sessionId: 's1', thinking: false }, send)
      expect(sent).toContainEqual({ type: 'session:thinking', sessionId: 's1', thinking: false })
    })

    it('persists thinking into the session config', () => {
      const { db } = openDatabase(':memory:')
      const store = new SessionStore(db, false)
      const sent: ServerMessage[] = []
      const send = (m: ServerMessage) => sent.push(m)
      const mgr = new SessionManager(store, () => new FakeListChatModel({ responses: ['ok'] }), path.join(root, '.scratch2'))
      mgr.handle({ type: 'session:create', id: 's2', config: { llmProvider: 'deepseek', model: '', tools: [] } }, send)
      mgr.handle({ type: 'session:setThinking', sessionId: 's2', thinking: false }, send)
      const saved = JSON.parse(store.getSession('s2')!.config) as { thinking?: boolean }
      expect(saved.thinking).toBe(false)
    })
  })
  ```

  > Adjust constructor/fixture names (`setup`, `FakeListChatModel`, `root`, `getSession`) to whatever the file actually uses — read it first.

- [ ] **Step 4 — Run; confirm PASS.**

  Run: `yarn test packages/sidecar/src/session/session-manager-fs.test.ts`
  Expected: existing cases + the two new ones pass (fake model; no key needed).

- [ ] **Step 5 — Commit.**

  ```bash
  git add packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/session-manager-fs.test.ts
  git commit -m "$(cat <<'EOF'
  feat(sidecar): session:setThinking handler — toggle, persist config, echo session:thinking

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 9 — Frontend store reducer: build the timeline on the assistant Message

**Files:**
- Modify: `src/domain/sessionStore.ts`
- Test: `src/domain/sessionStore.test.ts`

> Keeps existing `AgentVM` behavior intact (the panel still uses it until Task 13). `message:complete` now receives `timeline` + `toolCalls` from the sidecar (Task 7).

- [ ] **Step 1 — Write the failing reducer tests.** Append inside the existing `describe('applyServerMessage', …)` block (reuse the `baseSession()` fixture + `now` arg):

  ```ts
    it('supervisor agent:started creates a provisional assistant message keyed by turnId', () => {
      const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }] })] }
      const next = applyServerMessage(s0, { type: 'agent:started', sessionId: 's1', agentId: 'supervisor', role: 'supervisor', turnId: 't1' }, 1000)
      const msgs = next.sessions[0].messages
      expect(msgs).toHaveLength(2)
      expect(msgs[1]).toMatchObject({ id: 't1', role: 'assistant', content: '', timeline: [], toolCalls: [] })
      expect(next.sessions[0].agents[0]).toMatchObject({ id: 'supervisor', role: 'supervisor', status: 'running' })
    })

    it('supervisor agent:started reuses an existing message with the same turnId', () => {
      const s0 = { sessions: [baseSession({ messages: [{ id: 't1', role: 'assistant', content: 'partial', timeline: [], toolCalls: [], timestamp: 5 }] })] }
      const next = applyServerMessage(s0, { type: 'agent:started', sessionId: 's1', agentId: 'supervisor', role: 'supervisor', turnId: 't1' }, 1000)
      expect(next.sessions[0].messages).toHaveLength(1)
      expect(next.sessions[0].messages[0]).toMatchObject({ id: 't1', content: 'partial' })
    })

    it('reasoning:delta upserts a reasoning step; same stepSeq concatenates', () => {
      const s0 = { sessions: [baseSession({ messages: [{ id: 't1', role: 'assistant', content: '', timeline: [], toolCalls: [], timestamp: 0 }] })] }
      const a1 = applyServerMessage(s0, { type: 'reasoning:delta', sessionId: 's1', turnId: 't1', agentId: 'supervisor', role: 'supervisor', stepSeq: 0, delta: 'Let me ' }, 0)
      const a2 = applyServerMessage(a1, { type: 'reasoning:delta', sessionId: 's1', turnId: 't1', agentId: 'supervisor', role: 'supervisor', stepSeq: 0, delta: 'think.' }, 0)
      expect(a2.sessions[0].messages[0].timeline).toEqual([{ kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'Let me think.' }])
    })

    it('tool:started then tool:finished produce one tool step + a finished ToolCall', () => {
      const s0 = { sessions: [baseSession({ messages: [{ id: 't1', role: 'assistant', content: '', timeline: [], toolCalls: [], timestamp: 0 }] })] }
      const started = applyServerMessage(s0, { type: 'tool:started', sessionId: 's1', turnId: 't1', agentId: 'coder', role: 'coder', callId: 'c1', name: 'write_file', input: '{"path":"/a.ts"}', seq: 2 }, 0)
      expect(started.sessions[0].messages[0].timeline).toEqual([{ kind: 'tool', stepSeq: 2, agentId: 'coder', role: 'coder', callId: 'c1' }])
      expect(started.sessions[0].messages[0].toolCalls).toEqual([{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{"path":"/a.ts"}', status: 'running', seq: 2 }])
      const finished = applyServerMessage(started, { type: 'tool:finished', sessionId: 's1', turnId: 't1', agentId: 'coder', callId: 'c1', status: 'finished', output: 'ok' }, 0)
      expect(finished.sessions[0].messages[0].toolCalls![0]).toMatchObject({ callId: 'c1', status: 'finished', output: 'ok' })
    })

    it('message:complete replaces with authoritative timeline and coerces a running tool', () => {
      const s0 = { sessions: [baseSession({ messages: [
        { id: 'u1', role: 'user', content: 'hi', timestamp: 0 },
        { id: 't1', role: 'assistant', content: 'partial', timeline: [{ kind: 'tool', stepSeq: 0, agentId: 'coder', role: 'coder', callId: 'c1' }], toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'running', seq: 0 }], timestamp: 5 },
      ] })] }
      const authoritative = { id: 't1', role: 'assistant' as const, content: 'done', agentId: 'supervisor', timestamp: 9,
        timeline: [{ kind: 'reasoning' as const, stepSeq: 0, agentId: 'supervisor', role: 'supervisor' as const, content: 'thought' }],
        toolCalls: [{ callId: 'c1', agentId: 'coder', name: 'write_file', input: '{}', status: 'running' as const, seq: 0 }] }
      const next = applyServerMessage(s0, { type: 'message:complete', sessionId: 's1', message: authoritative }, 9)
      const m = next.sessions[0].messages.at(-1)!
      expect(m.timeline).toEqual([{ kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'thought' }])
      expect(m.toolCalls![0]).toMatchObject({ callId: 'c1', status: 'error', error: 'interrupted' })
      expect(next.sessions[0].status).toBe('idle')
    })

    it('session:thinking flips config.thinking', () => {
      const s0 = { sessions: [baseSession()] }
      const off = applyServerMessage(s0, { type: 'session:thinking', sessionId: 's1', thinking: false }, 0)
      expect(off.sessions[0].config.thinking).toBe(false)
    })

    it('reasoning:delta for an unknown turnId is a no-op', () => {
      const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }] })] }
      const next = applyServerMessage(s0, { type: 'reasoning:delta', sessionId: 's1', turnId: 'ghost', agentId: 'supervisor', role: 'supervisor', stepSeq: 0, delta: 'x' }, 0)
      expect(next.sessions[0].messages).toEqual(s0.sessions[0].messages)
    })
  ```

  Run: `yarn test src/domain/sessionStore.test.ts` → Expected: the new cases FAIL (unknown event types hit `default`, no provisional message, etc.); existing cases pass.

- [ ] **Step 2 — Add `DEFAULT_CONFIG.thinking`, a message-level tool coercion + the provisional/reasoning helpers.**

  ```ts
  export const DEFAULT_CONFIG: SessionConfig = { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], thinking: true }
  ```

  Add `TimelineStep` to the `@hip/protocol` import. Then, next to the existing `coerceRunningTools`/`appendAssistantDelta`:

  ```ts
  /** Coerce any tool still 'running' on a Message to error, mirroring the agent-level helper. */
  function coerceRunningToolCalls(toolCalls: ToolCall[] | undefined): ToolCall[] | undefined {
    if (!toolCalls?.some((tc) => tc.status === 'running')) return toolCalls
    return toolCalls.map((tc) => (tc.status === 'running' ? { ...tc, status: 'error' as const, error: tc.error ?? 'interrupted' } : tc))
  }

  /** Ensure a provisional assistant Message keyed by turnId exists; reuse if already present. */
  function ensureAssistantMessage(messages: Message[], turnId: string, agentId: string, now: number): Message[] {
    if (messages.some((m) => m.id === turnId)) return messages
    return [...messages, { id: turnId, role: 'assistant', content: '', agentId, timestamp: now, timeline: [], toolCalls: [] }]
  }

  /** Upsert a reasoning step (by stepSeq) onto the assistant Message with id===turnId. No-op if absent. */
  function upsertReasoning(messages: Message[], turnId: string, step: { stepSeq: number; agentId: string; role: AgentRole; delta: string }): Message[] {
    if (!messages.some((m) => m.id === turnId)) return messages
    return messages.map((m) => {
      if (m.id !== turnId) return m
      const timeline = m.timeline ?? []
      const exists = timeline.some((t) => t.kind === 'reasoning' && t.stepSeq === step.stepSeq)
      const nextTimeline = exists
        ? timeline.map((t) => (t.kind === 'reasoning' && t.stepSeq === step.stepSeq ? { ...t, content: t.content + step.delta } : t))
        : [...timeline, { kind: 'reasoning' as const, stepSeq: step.stepSeq, agentId: step.agentId, role: step.role, content: step.delta }]
      return { ...m, timeline: nextTimeline }
    })
  }
  ```

- [ ] **Step 3 — Wire the reducer cases** (keep every existing line; add the message-side writes). `agent:started` adds the provisional message; new `reasoning:delta` + `session:thinking` cases; `tool:started`/`tool:finished` additionally write the message's timeline/toolCalls; `message:complete` coerces the delivered toolCalls:

  ```ts
    case 'agent:started':
      return update(msg.sessionId, (s) => ({
        ...s, status: 'running', error: null,
        messages: msg.role === 'supervisor' ? ensureAssistantMessage(s.messages, msg.turnId, msg.agentId, now) : s.messages,
        agents: upsertAgent(s.agents, { id: msg.agentId, role: msg.role, title: ROLE_TITLE[msg.role], status: 'running', tokens: '', tokenCount: 0, elapsedMs: 0, startedAt: now, toolCalls: [], ...(msg.taskInput ? { taskInput: msg.taskInput } : {}), ...(msg.parentAgentId ? { parentAgentId: msg.parentAgentId } : {}) }),
      }))

    case 'reasoning:delta':
      return update(msg.sessionId, (s) => ({ ...s, messages: upsertReasoning(s.messages, msg.turnId, { stepSeq: msg.stepSeq, agentId: msg.agentId, role: msg.role, delta: msg.delta }) }))

    case 'tool:started':
      return update(msg.sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) => m.id === msg.turnId ? { ...m, timeline: [...(m.timeline ?? []), { kind: 'tool' as const, stepSeq: msg.seq, agentId: msg.agentId, role: msg.role, callId: msg.callId } satisfies TimelineStep], toolCalls: [...(m.toolCalls ?? []), { callId: msg.callId, agentId: msg.agentId, name: msg.name, input: msg.input, status: 'running' as const, seq: msg.seq, ...(msg.truncated ? { truncated: true } : {}) }] } : m),
        agents: s.agents.map((a) => a.id === msg.agentId ? { ...a, toolCalls: [...a.toolCalls, { callId: msg.callId, agentId: msg.agentId, name: msg.name, input: msg.input, status: 'running' as const, seq: msg.seq, ...(msg.truncated ? { truncated: true } : {}) }] } : a),
      }))

    case 'tool:finished':
      return update(msg.sessionId, (s) => ({
        ...s,
        messages: s.messages.map((m) => m.toolCalls?.some((tc) => tc.callId === msg.callId) ? { ...m, toolCalls: m.toolCalls.map((tc) => tc.callId === msg.callId ? { ...tc, status: msg.status, ...(msg.output !== undefined ? { output: msg.output } : {}), ...(msg.error !== undefined ? { error: msg.error } : {}), ...(tc.truncated || msg.truncated ? { truncated: true } : {}) } : tc) } : m),
        agents: s.agents.map((a) => a.id === msg.agentId ? { ...a, toolCalls: a.toolCalls.map((tc) => tc.callId === msg.callId ? { ...tc, status: msg.status, ...(msg.output !== undefined ? { output: msg.output } : {}), ...(msg.error !== undefined ? { error: msg.error } : {}), ...(tc.truncated || msg.truncated ? { truncated: true } : {}) } : tc) } : a),
      }))

    case 'message:complete': {
      const finalized: Message = { ...msg.message, toolCalls: coerceRunningToolCalls(msg.message.toolCalls) }
      return update(msg.sessionId, (s) => ({ ...s, status: 'idle', messages: finalizeAssistant(s.messages, finalized), agents: coerceRunningTools(s.agents) }))
    }

    case 'session:thinking':
      return update(msg.sessionId, (s) => ({ ...s, config: { ...s.config, thinking: msg.thinking } }))
  ```

  > `token:stream` is unchanged — `appendAssistantDelta` already appends supervisor deltas to the trailing assistant message (the provisional `turnId` message). `finalizeAssistant` must replace the message with id===turnId (it already updates the trailing assistant message; confirm it matches by id).

- [ ] **Step 4 — Run new tests green, then full suite + type-check.**

  Run: `yarn test src/domain/sessionStore.test.ts && yarn type-check`
  Expected: all pass; type-check exit 0. Then `yarn test` (whole suite) → all pass.

- [ ] **Step 5 — Commit.**

  ```bash
  git add src/domain/sessionStore.ts src/domain/sessionStore.test.ts
  git commit -m "$(cat <<'EOF'
  feat(store): build assistant-message timeline (reasoning + tool steps) keyed by turnId

  agent:started (supervisor) seeds a provisional { id:turnId } assistant message;
  reasoning:delta upserts reasoning steps by stepSeq; tool:started/finished push a
  tool step + ToolCall onto the message; message:complete finalizes with the
  authoritative timeline and coerces running tools; session:thinking flips
  config.thinking; DEFAULT_CONFIG.thinking defaults true. Existing AgentVM
  behavior preserved.

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Task 10 — i18n keys: `thinkingMode` / `thinkingModeHint` / `thoughtFor`

Add three `chat`-namespace keys to all three locales (types derive from `zh-CN`, so a missing key is a compile error — that's the gate).

**Files:** `src/i18n/zh-CN.ts`, `src/i18n/en.ts`, `src/i18n/zh-TW.ts`

- [ ] **Step 1 — `zh-CN.ts` (type source) first.** Append after `stopped` in `translation.chat`:

  ```ts
        thinkingMode: '思考',
        thinkingModeHint: '显示模型的思考过程（deepseek-reasoner；更慢、更贵）',
        thoughtFor: '已思考 {{seconds}} 秒',
  ```

- [ ] **Step 2 — `en.ts`.** Append after `stopped` (note double quotes — the hint has an apostrophe):

  ```ts
        thinkingMode: 'Thinking',
        thinkingModeHint: "Show the model's reasoning (deepseek-reasoner; slower, pricier)",
        thoughtFor: 'Thought for {{seconds}}s',
  ```

- [ ] **Step 3 — `zh-TW.ts`.** Append after `stopped`:

  ```ts
        thinkingMode: '思考',
        thinkingModeHint: '顯示模型的思考過程（deepseek-reasoner；較慢、較貴）',
        thoughtFor: '已思考 {{seconds}} 秒',
  ```

- [ ] **Step 4 — Gate.**

  Run: `yarn type-check`
  Expected: exit 0. (A missing key triggers `TS2741: Property 'thinkingMode' is missing …`.)

- [ ] **Step 5 — Commit.**

  ```bash
  git add src/i18n/zh-CN.ts src/i18n/en.ts src/i18n/zh-TW.ts
  git commit -m "feat(i18n): thinking-mode + thoughtFor keys (en, zh-CN, zh-TW)

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 11 — Inline timeline UI (`TurnTimeline`, MessageBubble, ChatPane autoscroll)

Render `message.timeline` (sorted by `stepSeq`) inline ABOVE the markdown answer in each assistant bubble. Reasoning steps → collapsible "Thought for Xs" disclosure; tool steps → existing `ToolCallRow` (resolved from `message.toolCalls` by `callId`) with a small role-colored agent badge. `ToolCallRow` stays in `src/components/artifact/` (imported cross-folder; no move). `TurnTimeline` returns `null` for empty/legacy timelines.

**Files:**
- Create: `src/components/chat/TurnTimeline.tsx`
- Modify: `src/components/chat/MessageBubble.tsx`, `src/components/chat/ChatPane.tsx`

- [ ] **Step 1 — Create `src/components/chat/TurnTimeline.tsx`.**

  ```tsx
  import { useState } from 'react'
  import { useTranslation } from 'react-i18next'
  import { ChevronRight, Brain } from 'lucide-react'
  import type { AgentRole, TimelineStep, ToolCall } from '@hip/protocol'
  import { cn } from '@/lib/utils'
  import { ToolCallRow } from '@/components/artifact/ToolCallRow'

  const ROLE_COLOR: Record<AgentRole, string> = {
    supervisor: 'var(--role-supervisor)', planner: 'var(--role-planner)', coder: 'var(--role-coder)', reviewer: 'var(--role-reviewer)',
  }

  function AgentBadge({ role }: { role: AgentRole }) {
    return <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: ROLE_COLOR[role] }} aria-hidden />
  }

  function ThinkingDisclosure({ role, content, seconds }: { role: AgentRole; content: string; seconds?: number }) {
    const { t } = useTranslation()
    const [open, setOpen] = useState(false)
    const label = seconds != null ? t('chat.thoughtFor', { seconds }) : t('chat.thinkingMode')
    return (
      <div className="flex gap-2">
        <AgentBadge role={role} />
        <div className="min-w-0 flex-1">
          <button onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex items-center gap-1.5 text-left text-[12px] text-ink-tertiary transition-colors hover:text-ink-secondary" data-testid="thinking-disclosure">
            <ChevronRight size={12} className={cn('shrink-0 transition-transform', open && 'rotate-90')} />
            <Brain size={12} className="shrink-0" />
            <span>{label}</span>
          </button>
          {open && <pre className="mt-1 whitespace-pre-wrap break-words border-l border-border pl-3 font-sans text-[12.5px] leading-relaxed text-ink-secondary">{content}</pre>}
        </div>
      </div>
    )
  }

  interface TurnTimelineProps {
    steps?: TimelineStep[]
    toolCalls?: ToolCall[]
    onToolClick?: (callId: string) => void
  }

  /** Inline, flat per-turn activity (reasoning + tool steps), ordered by the turn-global stepSeq. */
  export function TurnTimeline({ steps, toolCalls, onToolClick }: TurnTimelineProps) {
    if (!steps || steps.length === 0) return null
    const ordered = [...steps].sort((a, b) => a.stepSeq - b.stepSeq)
    const byCallId = new Map((toolCalls ?? []).map((tc) => [tc.callId, tc]))
    return (
      <div className="mb-2 flex flex-col gap-1.5" data-testid="turn-timeline">
        {ordered.map((step) => {
          if (step.kind === 'reasoning') return <ThinkingDisclosure key={`r-${step.stepSeq}`} role={step.role} content={step.content} />
          const tool = byCallId.get(step.callId)
          if (!tool) return null
          return (
            <div key={`t-${step.stepSeq}`} className="flex gap-2">
              <AgentBadge role={step.role} />
              <div className="min-w-0 flex-1" onClickCapture={onToolClick ? () => onToolClick(step.callId) : undefined}>
                <ToolCallRow tool={tool} />
              </div>
            </div>
          )
        })}
      </div>
    )
  }
  ```

- [ ] **Step 2 — Integrate into `MessageBubble`, above the markdown.** Add `import { TurnTimeline } from './TurnTimeline'`, then render it before `<ReactMarkdown>`:

  ```tsx
            {message.role === 'assistant' && (
              <TurnTimeline steps={message.timeline} toolCalls={message.toolCalls} />
            )}
            <ReactMarkdown components={{ pre: CodeBlock }}>{message.content}</ReactMarkdown>
            {streaming && <StreamingCursor />}
  ```

- [ ] **Step 3 — Fix `ChatPane` autoscroll to follow in-flight timeline growth.** Replace the autoscroll effect + `last`/`showThinking` derivation:

  ```tsx
    const last = messages[messages.length - 1]
    const lastActivity = last?.role === 'assistant' ? last.content.length + (last.timeline?.length ?? 0) + (last.toolCalls?.length ?? 0) : 0

    useEffect(() => {
      const el = bottomRef.current
      if (el) el.scrollIntoView({ behavior: 'smooth' })
    }, [messages.length, lastActivity, error])

    // Pre-first-token spinner only: once the assistant message exists, its inline timeline takes over.
    const showThinking = status === 'running' && last?.role === 'user'
  ```

- [ ] **Step 4 — Gate: type-check + build.**

  Run: `yarn type-check && yarn build`
  Expected: exit 0 / `✓ built`.

- [ ] **Step 5 — GUI note (manual).** Thinking ON, send "create an HTML self-intro at /self-intro.html". Verify inline, above the answer: a "Thinking / Thought for Xs" disclosure that expands to reasoning prose; tool rows with role-colored dots; steps in execution order; autoscroll follows streaming; the pre-first-token spinner only shows briefly.

- [ ] **Step 6 — Commit.**

  ```bash
  git add src/components/chat/TurnTimeline.tsx src/components/chat/MessageBubble.tsx src/components/chat/ChatPane.tsx
  git commit -m "feat(ui): inline TurnTimeline — reasoning disclosures + tool rows above the answer

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 12 — Thinking toggle (`sessionService.setThinking` + Composer toggle)

**Files:**
- Modify: `src/domain/sessionService.ts`, `src/components/chat/Composer.tsx`, `src/components/chat/InputBar.tsx`, `src/components/chat/NewConversation.tsx`

- [ ] **Step 1 — `sessionService.setThinking` (mirror `setProjectDir`/`setCwd`).** After `setProjectDir`:

  ```ts
    setThinking(id: string, thinking: boolean): void {
      useDomainStore.getState().apply({ type: 'session:thinking', sessionId: id, thinking }) // optimistic
      this.transport.send({ type: 'session:setThinking', sessionId: id, thinking })
    }
  ```

- [ ] **Step 2 — Composer: replace the static model label with a toggle.** Add `Brain` to the lucide import + `import { cn } from '@/lib/utils'`; delete `const ACTIVE_MODEL = 'deepseek-chat'`. Extend props with `thinking = true`, `onToggleThinking?`, `thinkingDisabled?` and `const toggleDisabled = thinkingDisabled || !onToggleThinking`. Replace the `<span>{ACTIVE_MODEL}</span>` with:

  ```tsx
          <button
            type="button"
            onClick={() => onToggleThinking?.(!thinking)}
            disabled={toggleDisabled}
            aria-pressed={thinking}
            title={t('chat.thinkingModeHint')}
            data-testid="thinking-toggle"
            className={cn('flex items-center gap-1.5 px-2 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50', thinking ? 'text-accent' : 'text-ink-tertiary hover:text-ink-secondary')}
          >
            <Brain size={13} className="shrink-0" />
            <span>{t('chat.thinkingMode')}</span>
          </button>
  ```

- [ ] **Step 3 — Wire in `InputBar`.** Read the active session + pass thinking state:

  ```tsx
    const session = useActiveSession()
    const activeSessionId = useActiveSessionId()
    const thinking = session?.config.thinking ?? true
    // …Composer:
    //   thinking={thinking}
    //   thinkingDisabled={status === 'running'}
    //   onToggleThinking={activeSessionId ? (next) => sessionService.setThinking(activeSessionId, next) : undefined}
  ```

  (Add `useActiveSession`, `useActiveSessionId` to the `@/domain` import.)

- [ ] **Step 4 — `NewConversation`: show default-ON, inert toggle.** Pass `thinking thinkingDisabled` to its `Composer` (no committed session yet; `DEFAULT_CONFIG.thinking` flows at first send).

- [ ] **Step 5 — Gate: type-check + build.**

  Run: `yarn type-check && yarn build`
  Expected: exit 0 / `✓ built`.

- [ ] **Step 6 — GUI note.** Composer footer shows a brain-icon "Thinking" (accent = ON) where `deepseek-chat` was; click toggles; greyed out while running; OFF → `deepseek-chat`, ON → reasoning inline.

- [ ] **Step 7 — Commit.**

  ```bash
  git add src/domain/sessionService.ts src/components/chat/Composer.tsx src/components/chat/InputBar.tsx src/components/chat/NewConversation.tsx
  git commit -m "feat(ui): thinking toggle in the composer + sessionService.setThinking

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 13 — Panel repurpose (per-turn detail view; inline row → panel)

Re-point `AgentDashboard`/`AgentCard` at the SELECTED turn's activity, derived from a message's `timeline` + `toolCalls` (default = latest/in-flight assistant message), grouped by `agentId`. Stop the panel reading the session-global `AgentVM` array (leave the array + `useAgents` in the store — a later cleanup can drop them if fully orphaned). Clicking an inline tool row opens the panel scoped to that turn.

**Files:**
- Modify: `src/store/uiStore.ts`, `src/domain/hooks.ts`, `src/domain/index.ts`, `src/components/artifact/AgentDashboard.tsx`, `src/components/artifact/AgentCard.tsx`, `src/components/chat/MessageBubble.tsx`

- [ ] **Step 1 — `uiStore`: add `tracePanelTurnId` + setters.**

  ```ts
    tracePanelTurnId: string | null
    setTracePanelTurn: (id: string | null) => void
    openTraceForTurn: (id: string) => void
  ```
  ```ts
    tracePanelTurnId: null,
    setTracePanelTurn: (id) => set((s) => (s.tracePanelTurnId === id ? s : { tracePanelTurnId: id })),
    openTraceForTurn: (id) => set({ tracePanelTurnId: id, activeTab: 'agents', panelOpen: true }),
  ```

- [ ] **Step 2 — `hooks.ts`: add a stable `useMessageById` selector** (returns a stored ref or `null`):

  ```ts
  export function useMessageById(id: string | null): Message | null {
    return useDomainStore((s) => {
      if (!id) return null
      const sess = s.sessions.find((x) => x.id === s.activeSessionId)
      return sess?.messages.find((m) => m.id === id) ?? null
    })
  }
  ```

- [ ] **Step 3 — `domain/index.ts`: export `useMessageById`** (add to the existing hooks re-export; keep `useAgents` exported).

- [ ] **Step 4 — Rewrite `AgentDashboard` to derive per-agent groups from the selected turn** (derivation OUTSIDE the selector):

  ```tsx
  import { useTranslation } from 'react-i18next'
  import type { AgentRole, Message, TimelineStep, ToolCall } from '@hip/protocol'
  import { useActiveMessages, useActiveSessionStatus, useMessageById } from '@/domain'
  import { useUiStore } from '@/store/uiStore'
  import { AgentCard, type TurnAgent } from './AgentCard'

  function groupByAgent(message: Message | null, live: boolean): TurnAgent[] {
    if (!message) return []
    const steps: TimelineStep[] = message.timeline ?? []
    const toolByCallId = new Map((message.toolCalls ?? []).map((tc) => [tc.callId, tc]))
    const order: string[] = []
    const buckets = new Map<string, { role: AgentRole; reasoning: string[]; tools: ToolCall[] }>()
    for (const step of [...steps].sort((a, b) => a.stepSeq - b.stepSeq)) {
      let b = buckets.get(step.agentId)
      if (!b) { b = { role: step.role, reasoning: [], tools: [] }; buckets.set(step.agentId, b); order.push(step.agentId) }
      if (step.kind === 'reasoning') b.reasoning.push(step.content)
      else { const tc = toolByCallId.get(step.callId); if (tc) b.tools.push(tc) }
    }
    return order.map((agentId) => {
      const b = buckets.get(agentId)!
      const anyRunning = b.tools.some((tc) => tc.status === 'running')
      return { agentId, role: b.role, reasoning: b.reasoning.join('\n\n'), tools: b.tools, status: live && anyRunning ? 'running' : 'done' }
    })
  }

  export function AgentDashboard() {
    const { t } = useTranslation()
    const messages = useActiveMessages()
    const status = useActiveSessionStatus()
    const selectedId = useUiStore((s) => s.tracePanelTurnId)
    const latestAssistant = [...messages].reverse().find((m) => m.role === 'assistant') ?? null
    const turnId = selectedId ?? latestAssistant?.id ?? null
    const selected = useMessageById(turnId)
    const turn = selected ?? latestAssistant
    const live = status === 'running' && turn?.id === latestAssistant?.id
    const agents = groupByAgent(turn, live)
    const supervisor = agents.find((a) => a.role === 'supervisor')
    const children = agents.filter((a) => a.role !== 'supervisor')
    if (agents.length === 0) return <div className="text-[12px] text-ink-tertiary">{t('artifact.noTools')}</div>
    return (
      <div className="flex flex-col gap-3">
        {supervisor && <AgentCard agent={supervisor} live={live} />}
        {children.length > 0 && (
          <>
            <div className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t('artifact.subAgents')}</div>
            <div className="flex flex-col gap-2.5">{children.map((agent) => <AgentCard key={agent.agentId} agent={agent} live={live} />)}</div>
          </>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 5 — Rewrite `AgentCard` to take the per-turn `TurnAgent` shape** (reuse `ToolTrace`; show reasoning above it):

  ```tsx
  import { useState } from 'react'
  import { useTranslation } from 'react-i18next'
  import { ChevronRight } from 'lucide-react'
  import type { AgentRole, ToolCall } from '@hip/protocol'
  import { cn } from '@/lib/utils'
  import { ToolTrace } from './ToolTrace'

  export interface TurnAgent {
    agentId: string
    role: AgentRole
    reasoning: string
    tools: ToolCall[]
    status: 'running' | 'done'
  }

  const ROLE_COLOR: Record<AgentRole, string> = { supervisor: 'var(--role-supervisor)', planner: 'var(--role-planner)', coder: 'var(--role-coder)', reviewer: 'var(--role-reviewer)' }
  const ROLE_TITLE: Record<AgentRole, string> = { supervisor: 'Supervisor', planner: 'Planner', coder: 'Coder', reviewer: 'Reviewer' }

  function StatusDot({ status, color }: { status: TurnAgent['status']; color: string }) {
    if (status === 'running') return <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: color }} />
    return <span className="h-2 w-2 rounded-full bg-ink-tertiary" />
  }

  export function AgentCard({ agent, live }: { agent: TurnAgent; live: boolean }) {
    const { t } = useTranslation()
    const color = ROLE_COLOR[agent.role]
    const running = live && agent.status === 'running'
    const [manual, setManual] = useState<boolean | null>(null)
    const open = manual ?? running
    return (
      <div className={cn('flex flex-col rounded-lg border bg-surface transition-colors', running ? 'border-accent/40' : 'border-border')}>
        <button onClick={() => setManual(!open)} aria-expanded={open} className="flex items-center justify-between gap-2 p-3 text-left" data-testid="agent-card-header">
          <div className="flex min-w-0 items-center gap-2">
            <ChevronRight size={12} className={cn('shrink-0 text-ink-tertiary transition-transform', open && 'rotate-90')} />
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
            <span className="truncate text-[13px] font-semibold text-ink">{ROLE_TITLE[agent.role]}</span>
            {agent.tools.length > 0 && <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] text-ink-tertiary">{t('artifact.toolsCount', { count: agent.tools.length })}</span>}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <StatusDot status={agent.status} color={color} />
            <span className="text-[11px] capitalize text-ink-tertiary">{agent.status}</span>
          </div>
        </button>
        {open && (
          <div className="flex flex-col gap-2 border-t border-border p-3 pt-2.5">
            {agent.reasoning && <pre className="whitespace-pre-wrap break-words rounded-md bg-surface-muted px-2.5 py-1.5 font-sans text-[12px] leading-snug text-ink-secondary">{agent.reasoning}</pre>}
            <ToolTrace tools={agent.tools} />
          </div>
        )}
      </div>
    )
  }
  ```

- [ ] **Step 6 — Wire the inline tool-row click.** In `MessageBubble`, add `const openTraceForTurn = useUiStore((s) => s.openTraceForTurn)` (import `useUiStore`), and pass `onToolClick={() => openTraceForTurn(message.id)}` to `<TurnTimeline>`.

- [ ] **Step 7 — Gate: type-check + build.**

  Run: `yarn type-check && yarn build`
  Expected: exit 0 / `✓ built`. (`useAgents` now has no panel consumer — fine; still exported. Remove any now-unused `AgentVM` import you touched.)

- [ ] **Step 8 — GUI note.** Open the panel → Agents tab. It shows THIS turn's agents (supervisor + sub-agents), each with reasoning + tool trace; live agent is accent-bordered + pulsing then collapses; clicking an inline tool row opens the panel scoped to that turn; a legacy/empty turn shows the `noTools` empty state.

- [ ] **Step 9 — Commit.**

  ```bash
  git add src/store/uiStore.ts src/domain/hooks.ts src/domain/index.ts src/components/artifact/AgentDashboard.tsx src/components/artifact/AgentCard.tsx src/components/chat/MessageBubble.tsx
  git commit -m "feat(ui): repurpose agents panel as a per-turn detail view

  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
  ```

---

## Task 14 — Final verification + whole-branch review + GUI acceptance

**Files:** none (verification + review).

- [ ] **Step 1 — Full automated suite.**

  Run: `yarn test`
  Expected: all test files pass (protocol/sidecar/store/reducer suites + live DeepSeek describes skip without a key).

- [ ] **Step 2 — Type-checks + build.**

  Run: `yarn type-check && yarn workspace @hip/sidecar type-check && yarn build`
  Expected: all exit 0 / `✓ built`.

- [ ] **Step 3 — Whole-branch adversarial review.** Dispatch a fresh code-review subagent over the entire diff `main..feat/agent-execution-trace` for this slice (per subagent-driven-development's final review). Focus areas: the turn-global `stepSeq` ordering (live vs reload identical), the provisional-message lifecycle (no orphaned/duplicate assistant messages across multi-turn + regenerate + cancel), Zustand v5 (no fresh-array selectors introduced), the `message:complete` finalize replacing by `id===turnId`, and v4→v5 back-compat (legacy NULL-timeline sessions load + render plain). Fix any Critical/Important findings (implementer subagent), re-review, then proceed.

- [ ] **Step 4 — Manual GUI acceptance (user-owned, live DeepSeek).** Verify end to end:
  - "用一个 HTML 做个自我介绍" with thinking ON → **either** a real file appears in the Files tab **or** the answer carries the honest "no files were actually created" correction (never a silent phantom).
  - Inline thinking disclosures render and expand; tool rows show with role badges; steps are in execution order.
  - Reload the session → the timeline reproduces in the same order (live == persisted).
  - Toggle thinking OFF → next turn uses `deepseek-chat`, no reasoning steps; timeline degrades to tools-only.
  - Cancel mid-tool → partial persists, running tools coerce to error, no unhandled rejection in the sidecar log.
  - Panel → Agents tab shows the selected turn grouped by agent; inline tool-row click opens it.

- [ ] **Step 5 — Finish.** Use superpowers:finishing-a-development-branch.

