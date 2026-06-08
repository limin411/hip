# Message Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the message-bubble interaction layer to hip's chat — Stop, Copy (message + code block), Thinking placeholder, Regenerate (last assistant only), and inline error retry.

**Architecture:** Two features are pure frontend (Copy, Thinking). Stop, Regenerate, and Retry unify around one new client op (`message:regenerate`) and one schema migration (a `stopped` column). The sidecar `Session` is refactored to extract a reusable `runTurn`; its abort branch now persists the partial reply with `stopped=true`; a new `regenerate()` deletes the last assistant turn (DB cascade) and re-runs. Retry reuses the regenerate op (it deletes the trailing assistant only *if present*).

**Tech Stack:** TypeScript, React 18, Zustand v5, react-i18next, react-markdown v9, lucide-react; sidecar: deepagents + LangChain over `node:sqlite`; Vitest (node env); spec at `docs/superpowers/specs/2026-06-08-message-actions-design.md`.

**Conventions (from the repo):**
- Tests are `*.test.ts` run by `yarn test` (Vitest, `environment: 'node'`). There is **no DOM/RTL infra** — presentational components are verified by `yarn type-check` + manual GUI acceptance, not unit tests.
- Sidecar deterministic tests inject `FakeListChatModel` from `@langchain/core/utils/testing` (cycles its `responses` array per model call). Live-DeepSeek tests are `describe.skipIf(!apiKey)`.
- Run a single sidecar test file: `yarn test packages/sidecar/src/persistence/store.test.ts`.
- Run a single frontend test file: `yarn test src/domain/sessionStore.test.ts`.
- Branch is `feat/message-actions`. Commit after every task.

---

## File Structure

**Protocol** — `packages/protocol/src/index.ts`: add `Message.stopped?` + `message:regenerate` client op.

**Persistence** — `packages/sidecar/src/persistence/`:
- `schema.ts`: migration `user_version 2 → 3` (`messages.stopped`).
- `store.ts`: `stopped` plumbing in `insertMessage`/`insertTurn`/`loadMessages`; new `deleteLastAssistantMessage`.

**Sidecar session** — `packages/sidecar/src/session/`:
- `session.ts`: extract `runTurn` + `finalizeAndPersist`; abort persists partial (`stopped`); new `regenerate()` + `running` guard.
- `session-manager.ts`: route `message:regenerate`.

**Frontend domain** — `src/domain/`:
- `sessionStore.ts`: `regenerateLastTurn` action (Message.stopped already flows through `finalizeAssistant`).
- `sessionService.ts`: `regenerate()`.
- `hooks.ts`: `useActiveSessionStatus()`.

**Frontend UI** — `src/`:
- `ipc/clipboard.ts` (new): `copyText` with `execCommand` fallback.
- `components/chat/MessageActions.tsx` (new), `CodeBlock.tsx` (new), `ThinkingBubble.tsx` (new).
- `components/chat/Composer.tsx`, `InputBar.tsx`, `MessageBubble.tsx`, `ChatPane.tsx` (modify).
- `i18n/{en,zh-CN,zh-TW}.ts`: new `chat.*` strings.

---

## Task 1: Protocol — `Message.stopped` + `message:regenerate`

**Files:**
- Modify: `packages/protocol/src/index.ts:11-17` (Message), `:50-64` (ClientMessage union)

- [ ] **Step 1: Add the `stopped` field to `Message`**

In `packages/protocol/src/index.ts`, change the `Message` interface:

```ts
export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  agentId?: string
  timestamp: number
  stopped?: boolean // assistant turn was cancelled mid-stream; partial content kept
}
```

- [ ] **Step 2: Add the `message:regenerate` client op**

In the `ClientMessage` union, add this line right after the `message:cancel` line (`:54`):

```ts
  | { type: 'message:regenerate'; sessionId: string }
```

- [ ] **Step 3: Type-check the workspace**

Run: `yarn workspace @hip/sidecar type-check && yarn type-check`
Expected: PASS (no errors). The new optional field and union member compile; nothing consumes them yet.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): add Message.stopped + message:regenerate"
```

---

## Task 2: Persistence — migration `user_version 2 → 3` (`messages.stopped`)

**Files:**
- Modify: `packages/sidecar/src/persistence/schema.ts:44-69` (migrate)
- Test: `packages/sidecar/src/persistence/schema.test.ts`

- [ ] **Step 1: Update the migration test to expect v3 + the stopped column**

In `packages/sidecar/src/persistence/schema.test.ts`, replace the first test (`'adds title_custom (default 0) and reaches user_version 2'`) with:

```ts
  it('adds title_custom, a stopped column, and reaches user_version 3', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(columns(db, 'sessions')).toContain('title_custom')
    expect(columns(db, 'messages')).toContain('stopped')
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(3)
    db.exec(`INSERT INTO sessions(id,title,config,created_at,updated_at) VALUES('s','t','{}',1,1)`)
    db.exec(`INSERT INTO messages(id,session_id,seq,role,content,timestamp) VALUES('m','s',1,'user','hi',1)`)
    expect((db.prepare(`SELECT stopped FROM messages WHERE id='m'`).get() as { stopped: number }).stopped).toBe(0)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test packages/sidecar/src/persistence/schema.test.ts`
Expected: FAIL — `user_version` is `2`, and `messages` has no `stopped` column.

- [ ] **Step 3: Add the `version < 3` migration block**

In `packages/sidecar/src/persistence/schema.ts`, inside `migrate`, after the `if (version < 2) { ... }` block (before the closing `}` of the function):

```ts
  if (version < 3) {
    db.exec('BEGIN')
    try {
      // stopped: 1 = assistant turn was cancelled mid-stream (partial content kept).
      db.exec(`ALTER TABLE messages ADD COLUMN stopped INTEGER NOT NULL DEFAULT 0`)
      db.exec('PRAGMA user_version = 3')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test packages/sidecar/src/persistence/schema.test.ts`
Expected: PASS (both the updated test and the existing idempotency test).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/persistence/schema.ts packages/sidecar/src/persistence/schema.test.ts
git commit -m "feat(persistence): migrate messages.stopped (user_version 3)"
```

---

## Task 3: Persistence — `stopped` plumbing in the store

**Files:**
- Modify: `packages/sidecar/src/persistence/store.ts:45-50` (insertMessage), `:52-73` (insertTurn), `:75-79` (loadMessages)
- Test: `packages/sidecar/src/persistence/store.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/sidecar/src/persistence/store.test.ts`, add inside the `describe('SessionStore', ...)` block:

```ts
  it('persists and loads the stopped flag on an assistant turn', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn({ id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'partial', timestamp: 2, stopped: true }, 's1', [])
    expect(store.loadMessages('s1').at(-1)).toMatchObject({ id: 'a1', role: 'assistant', content: 'partial', stopped: true })
  })

  it('omits stopped for a normal (non-cancelled) message', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    expect(store.loadMessages('s1')[0].stopped).toBeUndefined()
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test packages/sidecar/src/persistence/store.test.ts`
Expected: FAIL — `insertTurn`'s assistant arg has no `stopped` (type error) and `loadMessages` never returns `stopped`.

- [ ] **Step 3: Add `stopped` to `insertMessage`**

Replace `insertMessage` (`store.ts:45-50`) with:

```ts
  insertMessage(r: { id: string; sessionId: string; role: 'user' | 'assistant'; agentId: string | null; content: string; timestamp: number; stopped?: boolean }): number {
    const seq = this.nextSeq(r.sessionId)
    this.db.prepare(`INSERT INTO messages(id,session_id,seq,role,agent_id,content,timestamp,stopped) VALUES(?,?,?,?,?,?,?,?)`)
      .run(r.id, r.sessionId, seq, r.role, r.agentId, r.content, r.timestamp, r.stopped ? 1 : 0)
    return seq
  }
```

- [ ] **Step 4: Thread `stopped` through `insertTurn`**

In `insertTurn` (`store.ts:52-73`), change the `assistant` parameter type and the `insertMessage` call. Replace the signature line and the `if (assistant) { ... }` body:

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
```

(Leave the rest of `insertTurn` — the `agent_runs` loop and COMMIT/ROLLBACK — unchanged.)

- [ ] **Step 5: Return `stopped` from `loadMessages`**

Replace `loadMessages` (`store.ts:75-79`) with:

```ts
  loadMessages(sessionId: string): Message[] {
    const rows = this.db.prepare(`SELECT id,role,agent_id,content,timestamp,stopped FROM messages WHERE session_id=? ORDER BY seq`).all(sessionId) as
      { id: string; role: 'user' | 'assistant'; agent_id: string | null; content: string; timestamp: number; stopped: number }[]
    return rows.map((r) => ({ id: r.id, role: r.role, content: r.content, agentId: r.agent_id ?? undefined, timestamp: r.timestamp, ...(r.stopped ? { stopped: true } : {}) }))
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `yarn test packages/sidecar/src/persistence/store.test.ts`
Expected: PASS — including the existing `'loadMessages returns protocol Message shape'` test (a normal message still has no `stopped` key, so `toEqual` matches).

- [ ] **Step 7: Commit**

```bash
git add packages/sidecar/src/persistence/store.ts packages/sidecar/src/persistence/store.test.ts
git commit -m "feat(persistence): persist/load Message.stopped through the store"
```

---

## Task 4: Persistence — `deleteLastAssistantMessage`

**Files:**
- Modify: `packages/sidecar/src/persistence/store.ts` (add method near `deleteSession`)
- Test: `packages/sidecar/src/persistence/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Add inside `describe('SessionStore', ...)`:

```ts
  it('deleteLastAssistantMessage removes a trailing assistant turn and cascades agent_runs', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    store.insertTurn(
      { id: 'a1', sessionId: 's1', agentId: 'supervisor', content: 'ans', timestamp: 2 },
      's1',
      [{ agentId: 'planner', role: 'planner', output: 'p', startedAt: 1, finishedAt: 2, seq: 0 }],
    )
    expect(store.deleteLastAssistantMessage('s1')).toBe(true)
    expect(store.loadMessages('s1').map((m) => m.id)).toEqual(['u1'])
    expect(store.loadAgentRuns('s1')).toHaveLength(0)
  })

  it('deleteLastAssistantMessage is a no-op when the last message is a user message', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    expect(store.deleteLastAssistantMessage('s1')).toBe(false)
    expect(store.loadMessages('s1')).toHaveLength(1)
  })

  it('deleteLastAssistantMessage is a no-op on an empty session', () => {
    store.insertSession({ id: 's1', title: 't', config: cfg, createdAt: 1, updatedAt: 1 })
    expect(store.deleteLastAssistantMessage('s1')).toBe(false)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test packages/sidecar/src/persistence/store.test.ts`
Expected: FAIL — `deleteLastAssistantMessage` is not a function.

- [ ] **Step 3: Implement the method**

In `packages/sidecar/src/persistence/store.ts`, add this method immediately above `deleteSession` (`:127`):

```ts
  /** Delete the most recent message iff it is an assistant turn. Cascades agent_runs + FTS via triggers/FKs. Returns true if one was removed. */
  deleteLastAssistantMessage(sessionId: string): boolean {
    const last = this.db.prepare(`SELECT id, role FROM messages WHERE session_id=? ORDER BY seq DESC LIMIT 1`).get(sessionId) as
      | { id: string; role: string }
      | undefined
    if (!last || last.role !== 'assistant') return false
    this.db.prepare(`DELETE FROM messages WHERE id=?`).run(last.id)
    return true
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test packages/sidecar/src/persistence/store.test.ts`
Expected: PASS. (`agent_runs.message_id ... ON DELETE CASCADE` removes the linked run; `PRAGMA foreign_keys=ON` is set in `open.ts:10`.)

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/persistence/store.ts packages/sidecar/src/persistence/store.test.ts
git commit -m "feat(persistence): deleteLastAssistantMessage (cascades runs)"
```

---

## Task 5: Sidecar — refactor `Session` to extract `runTurn` + `finalizeAndPersist` (no behavior change)

**Files:**
- Modify: `packages/sidecar/src/session/session.ts:66-303`
- Test (regression only): existing `session-unit.test.ts`, `session-persist.test.ts`

- [ ] **Step 1: Add module-level `Run` type + class `running` field**

In `packages/sidecar/src/session/session.ts`, add this type just below the existing `TitleGenerator` type (after `:32`):

```ts
type Run = { role: AgentRole; output: string; startedAt: number; finishedAt: number | null; seq: number }
```

Then in the `Session` class field block (near `:71`), add:

```ts
  private running = false
```

- [ ] **Step 2: Replace `sendMessage` with a slimmed version that delegates to `runTurn`**

Replace the entire `sendMessage` method (`:143-294`) with:

```ts
  async sendMessage(content: string, _send: SendFn, userMessageId?: string): Promise<void> {
    if (this.usesEnvModel && !process.env.DEEPSEEK_API_KEY?.trim()) {
      _send({ type: 'error', sessionId: this.id, code: 'NO_API_KEY', message: 'DeepSeek API key not configured. Set it in Settings.' })
      return
    }

    // Persist the user message + bump/derive session metadata before running.
    const userTs = Date.now()
    let isFirstTurn = false
    if (this.store) {
      const seq = this.store.insertMessage({ id: userMessageId ?? `u-${userTs}`, sessionId: this.id, role: 'user', agentId: null, content, timestamp: userTs })
      this.store.touchSession(this.id, userTs)
      isFirstTurn = seq === 1
      if (isFirstTurn) {
        const title = deriveTitle(content)
        if (this.store.updateTitleIfAuto(this.id, title) === 1) {
          _send({ type: 'session:title', sessionId: this.id, title })
        }
      }
    }

    this.messages.push(new HumanMessage(content))
    const supervisorText = await this.runTurn(_send)

    // Auto-title refine: once, on the first turn, only while still auto-titled.
    if (isFirstTurn && this.titleGenerator && supervisorText && this.store) {
      try {
        const refined = sanitizeTitle(await this.titleGenerator({ firstUserMessage: content, firstReply: supervisorText }))
        if (refined && this.store.updateTitleIfAuto(this.id, refined) === 1) {
          _send({ type: 'session:title', sessionId: this.id, title: refined })
        }
      } catch {
        // swallow: the title is non-critical
      }
    }
  }
```

- [ ] **Step 3: Add `runTurn` (the extracted streaming core) below `sendMessage`**

```ts
  /** Stream one turn for the HumanMessage already at the tail of this.messages.
   *  Returns the supervisor text on clean completion, or '' on abort/error. */
  private async runTurn(send: SendFn): Promise<string> {
    this.abortController = new AbortController()
    this.running = true

    const trajectory = new Map<string, Run>()
    let agentSeq = 0
    const started = new Set<string>()
    const ensureStarted = (agentId: string, role: AgentRole) => {
      if (started.has(agentId)) return
      started.add(agentId)
      trajectory.set(agentId, { role, output: '', startedAt: Date.now(), finishedAt: null, seq: agentSeq++ })
      send({ type: 'agent:started', sessionId: this.id, agentId, role })
    }
    const finishRemaining = () => {
      for (const id of started) {
        const r = trajectory.get(id); if (r) r.finishedAt = Date.now()
        send({ type: 'agent:finished', sessionId: this.id, agentId: id })
      }
      started.clear()
    }

    let supervisorText = ''
    ensureStarted('supervisor', 'supervisor')
    try {
      const run = await this.agent.streamEvents(
        { messages: this.messages },
        { version: 'v3', signal: this.abortController.signal },
      )
      const pumpSupervisor = async () => {
        for await (const msg of run.messages) {
          for await (const delta of msg.text) {
            if (!delta) continue
            supervisorText += delta
            const r = trajectory.get('supervisor'); if (r) r.output += delta
            send({ type: 'token:stream', sessionId: this.id, agentId: 'supervisor', delta })
          }
        }
      }
      const pumpSubagents = async () => {
        for await (const sub of run.subagents) {
          const agentId = sub.name
          ensureStarted(agentId, roleForName(sub.name))
          for await (const msg of sub.messages) {
            for await (const delta of msg.text) {
              if (!delta) continue
              const r = trajectory.get(agentId); if (r) r.output += delta
              send({ type: 'token:stream', sessionId: this.id, agentId, delta })
            }
          }
          if (started.delete(agentId)) {
            const r = trajectory.get(agentId); if (r) r.finishedAt = Date.now()
            send({ type: 'agent:finished', sessionId: this.id, agentId })
          }
        }
      }
      await Promise.all([pumpSupervisor(), pumpSubagents()])
      finishRemaining()
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      finishRemaining()
      send({
        type: 'error',
        sessionId: this.id,
        code: isAbort ? 'CANCELLED' : 'AGENT_ERROR',
        message: isAbort ? 'User cancelled the request' : err instanceof Error ? err.message : String(err),
      })
      return ''
    } finally {
      this.running = false
      this.abortController = null
    }

    this.finalizeAndPersist(send, supervisorText, trajectory, false)
    return supervisorText
  }
```

> NOTE: this Task 5 version keeps the **original** abort behavior (always emit `CANCELLED`/`AGENT_ERROR`, no partial persist). Task 6 changes only the `catch` branch.

- [ ] **Step 4: Add `finalizeAndPersist` below `runTurn`**

```ts
  /** Push the assistant message into context, persist the turn, and emit message:complete. */
  private finalizeAndPersist(send: SendFn, supervisorText: string, trajectory: Map<string, Run>, stopped: boolean): void {
    if (supervisorText) this.messages.push(new AIMessage(supervisorText))
    const ts = Date.now()
    const assistantId = `asst-supervisor-${ts}`
    const runs: AgentRun[] = [...trajectory.entries()].map(([agentId, r]) => ({
      agentId, role: r.role, output: r.output, startedAt: r.startedAt, finishedAt: r.finishedAt, seq: r.seq,
    }))
    if (this.store) {
      this.store.insertTurn(
        supervisorText ? { id: assistantId, sessionId: this.id, agentId: 'supervisor', content: supervisorText, timestamp: ts, stopped } : null,
        this.id,
        runs,
      )
      this.store.touchSession(this.id, ts)
    }
    send({
      type: 'message:complete',
      sessionId: this.id,
      message: { id: assistantId, role: 'assistant', content: supervisorText, agentId: 'supervisor', timestamp: ts, ...(stopped ? { stopped: true } : {}) },
    })
  }
```

- [ ] **Step 5: Run the existing sidecar tests to verify no behavior change**

Run: `yarn test packages/sidecar/src/session/session-unit.test.ts packages/sidecar/src/session/session-persist.test.ts`
Expected: PASS — same events and persistence as before the refactor.

- [ ] **Step 6: Type-check the sidecar**

Run: `yarn workspace @hip/sidecar type-check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/sidecar/src/session/session.ts
git commit -m "refactor(sidecar): extract runTurn + finalizeAndPersist from sendMessage"
```

---

## Task 6: Sidecar — abort persists the partial reply with `stopped=true`

**Files:**
- Modify: `packages/sidecar/src/session/session.ts` (the `catch` branch inside `runTurn`)
- Test: `packages/sidecar/src/session/multiagent.integration.test.ts` (live-DeepSeek, `skipIf`)

> **Deterministic coverage** of the persisted-partial shape lives in Task 3 (`insertTurn` with `stopped` → `loadMessages`). The *abort wiring* (cancel mid-stream → persist partial) is timing-dependent through the deepagents stream, so — matching the repo's existing convention (cancel is only tested against the real API) — it is covered by extending the live integration test plus manual GUI acceptance (Task 21).

- [ ] **Step 1: Extend the live cancel integration test to assert the persisted partial**

In `packages/sidecar/src/session/multiagent.integration.test.ts`, add these imports at the top:

```ts
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'
```

Then, inside the `describe.skipIf(!apiKey)(...)` block, add a third test:

```ts
  it(
    'on cancel keeps the partial reply, persisted with stopped=true',
    async () => {
      const { db, ftsEnabled } = openDatabase(':memory:')
      const store = new SessionStore(db, ftsEnabled)
      store.insertSession({ id: 'it-cancel-persist', title: '新对话', config: JSON.stringify({ llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }), createdAt: 1, updatedAt: 1 })
      const session = new Session('it-cancel-persist', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }, createModel(), store)

      const events: Ev[] = []
      const promise = session.sendMessage('Write a very long, detailed TypeScript module with many functions.', (m) => events.push(m as Ev), 'u1')
      const checkInterval = setInterval(() => {
        if (events.some((e) => e.type === 'token:stream')) { session.cancel(); clearInterval(checkInterval) }
      }, 50)
      await promise
      clearInterval(checkInterval)

      const msgs = store.loadMessages('it-cancel-persist')
      const asst = msgs.find((m) => m.role === 'assistant')
      expect(asst).toBeDefined()
      expect(asst!.stopped).toBe(true)
      expect((asst!.content ?? '').length).toBeGreaterThan(0)
      // The partial was finalized for the client too.
      expect(events.some((e) => e.type === 'message:complete')).toBe(true)
    },
    90_000,
  )
```

- [ ] **Step 2: Change the `runTurn` catch branch to persist a non-empty partial on abort**

In `packages/sidecar/src/session/session.ts`, replace the `catch (err) { ... }` block inside `runTurn` with:

```ts
    } catch (err) {
      const isAbort = err instanceof Error && err.name === 'AbortError'
      finishRemaining()
      if (isAbort && supervisorText) {
        // Keep the partial: finalize + persist with stopped=true (also enters next-turn context).
        this.finalizeAndPersist(send, supervisorText, trajectory, true)
      } else {
        send({
          type: 'error',
          sessionId: this.id,
          code: isAbort ? 'CANCELLED' : 'AGENT_ERROR',
          message: isAbort ? 'User cancelled the request' : err instanceof Error ? err.message : String(err),
        })
      }
      return ''
    } finally {
```

(Leave the `finally { this.running = false; this.abortController = null }` exactly as in Task 5.)

- [ ] **Step 3: Verify the deterministic + (optional) live tests**

Run (deterministic regression — must pass without a key): `yarn test packages/sidecar/src/persistence packages/sidecar/src/session/session-persist.test.ts`
Expected: PASS.

Run (live, only with a key in `.env`): `yarn test packages/sidecar/src/session/multiagent.integration.test.ts`
Expected: PASS with a key; SKIPPED without one.

- [ ] **Step 4: Type-check + commit**

```bash
yarn workspace @hip/sidecar type-check
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/multiagent.integration.test.ts
git commit -m "feat(sidecar): persist the partial reply with stopped=true on cancel"
```

---

## Task 7: Sidecar — `Session.regenerate()`

**Files:**
- Modify: `packages/sidecar/src/session/session.ts` (add `regenerate` method)
- Test: `packages/sidecar/src/session/session-regenerate.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `packages/sidecar/src/session/session-regenerate.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { Session } from './session.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }
function store() { const { db, ftsEnabled } = openDatabase(':memory:'); return new SessionStore(db, ftsEnabled) }

describe('Session.regenerate', () => {
  let st: SessionStore
  beforeEach(() => { st = store(); st.insertSession({ id: 's1', title: '新对话', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 }) })

  it('deletes the last assistant turn and re-runs (one assistant message remains)', async () => {
    const session = new Session('s1', cfg, new FakeListChatModel({ responses: ['answer'] }), st)
    await session.sendMessage('hi', () => {}, 'u1')
    expect(st.loadMessages('s1').filter((m) => m.role === 'assistant')).toHaveLength(1)

    const events: { type: string }[] = []
    await session.regenerate((m) => events.push(m))

    const msgs = st.loadMessages('s1')
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(1) // old deleted, one new
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
    expect(events.some((e) => e.type === 'agent:started')).toBe(true)
  })

  it('re-runs without deleting when the last message is a user message (retry-after-error)', async () => {
    st.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: 'hi', timestamp: 1 })
    const session = new Session('s1', cfg, new FakeListChatModel({ responses: ['recovered'] }), st)
    session.hydrate(st.loadMessages('s1')) // this.messages = [HumanMessage('hi')]

    const events: { type: string }[] = []
    await session.regenerate((m) => events.push(m))

    const msgs = st.loadMessages('s1')
    expect(msgs.filter((m) => m.role === 'user')).toHaveLength(1)
    expect(msgs.filter((m) => m.role === 'assistant')).toHaveLength(1)
    expect(events.some((e) => e.type === 'message:complete')).toBe(true)
  })

  it('is a no-op on an empty session (nothing to redo)', async () => {
    const session = new Session('s1', cfg, new FakeListChatModel({ responses: ['x'] }), st)
    const events: { type: string }[] = []
    await session.regenerate((m) => events.push(m))
    expect(events).toHaveLength(0)
    expect(st.loadMessages('s1')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test packages/sidecar/src/session/session-regenerate.test.ts`
Expected: FAIL — `session.regenerate` is not a function.

- [ ] **Step 3: Implement `regenerate` below `finalizeAndPersist`**

In `packages/sidecar/src/session/session.ts`:

```ts
  /** Re-run the last turn: drop the trailing assistant reply (if any) and stream a fresh one. */
  async regenerate(send: SendFn): Promise<void> {
    if (this.running) return
    if (this.usesEnvModel && !process.env.DEEPSEEK_API_KEY?.trim()) {
      send({ type: 'error', sessionId: this.id, code: 'NO_API_KEY', message: 'DeepSeek API key not configured. Set it in Settings.' })
      return
    }
    const tail = this.messages[this.messages.length - 1]
    if (tail instanceof AIMessage) {
      this.messages.pop()
      this.store?.deleteLastAssistantMessage(this.id)
    }
    // After dropping an assistant reply, the tail must be the user turn to redo.
    if (!(this.messages[this.messages.length - 1] instanceof HumanMessage)) return
    await this.runTurn(send)
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test packages/sidecar/src/session/session-regenerate.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check + commit**

```bash
yarn workspace @hip/sidecar type-check
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-regenerate.test.ts
git commit -m "feat(sidecar): Session.regenerate re-runs the last turn"
```

---

## Task 8: Sidecar — route `message:regenerate` in the manager

**Files:**
- Modify: `packages/sidecar/src/session/session-manager.ts:45-50`
- Test: `packages/sidecar/src/session/session-manager-regenerate.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/session/session-manager-regenerate.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import * as os from 'node:os'
import * as path from 'node:path'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }

describe('SessionManager message:regenerate routing', () => {
  it('routes message:regenerate to Session.regenerate (assistant count stays 1)', async () => {
    const { db, ftsEnabled } = openDatabase(':memory:')
    const store = new SessionStore(db, ftsEnabled)
    const scratch = path.join(os.tmpdir(), 'hip-test-scratch-regen')
    const mgr = new SessionManager(store, () => new FakeListChatModel({ responses: ['answer'] }), scratch)
    const events: ServerMessage[] = []
    const send = (m: ServerMessage) => events.push(m)

    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    await mgr.handleAsync({ type: 'message:send', sessionId: 's1', id: 'u1', content: 'hi', role: 'user' }, send)
    expect(store.loadMessages('s1').filter((m) => m.role === 'assistant')).toHaveLength(1)

    await mgr.handleAsync({ type: 'message:regenerate', sessionId: 's1' }, send)
    expect(store.loadMessages('s1').filter((m) => m.role === 'assistant')).toHaveLength(1)
    expect(store.loadMessages('s1').filter((m) => m.role === 'user')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test packages/sidecar/src/session/session-manager-regenerate.test.ts`
Expected: FAIL — `message:regenerate` falls through the switch (no assistant re-run; or a TS exhaustiveness/typing nudge).

- [ ] **Step 3: Add the routing case**

In `packages/sidecar/src/session/session-manager.ts`, add this case right after the `message:cancel` case (`:48-50`):

```ts
      case 'message:regenerate':
        await this.ensureSession(msg.sessionId).regenerate(send)
        break
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test packages/sidecar/src/session/session-manager-regenerate.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full sidecar suite + type-check**

Run: `yarn test packages/sidecar && yarn workspace @hip/sidecar type-check`
Expected: PASS (live-LLM tests skip without a key).

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/session-manager-regenerate.test.ts
git commit -m "feat(sidecar): route message:regenerate to Session.regenerate"
```

---

## Task 9: Domain store — `regenerateLastTurn` + `stopped` passthrough test

**Files:**
- Modify: `packages/sidecar/...` none. `src/domain/sessionStore.ts:175-237` (DomainStore interface + impl)
- Test: `src/domain/sessionStore.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/domain/sessionStore.test.ts`, add inside `describe('applyServerMessage', ...)`:

```ts
  it('message:complete carries the stopped flag through finalize', () => {
    const s0 = { sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, { id: 'asst', role: 'assistant', content: 'partial', timestamp: 5 }] })] }
    const next = applyServerMessage(s0, { type: 'message:complete', sessionId: 's1', message: { id: 'asst', role: 'assistant', content: 'partial', agentId: 'supervisor', timestamp: 5, stopped: true } }, 10)
    expect(next.sessions[0].messages.at(-1)).toMatchObject({ content: 'partial', stopped: true })
    expect(next.sessions[0].status).toBe('idle')
  })
```

And add a new `describe` block at the end of the file (after the `applyServerMessage` block):

```ts
describe('regenerateLastTurn', () => {
  it('drops a trailing assistant message, clears agents, and resets to running', () => {
    useDomainStore.setState({
      sessions: [baseSession({
        messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, { id: 'a1', role: 'assistant', content: 'ans', timestamp: 1 }],
        agents: [{ id: 'supervisor', role: 'supervisor', title: 'Supervisor', status: 'done', tokens: 'ans', tokenCount: 3, elapsedMs: 1, startedAt: 0 }],
        status: 'idle', error: { code: 'X', message: 'y' },
      })],
      activeSessionId: 's1',
    })
    useDomainStore.getState().regenerateLastTurn('s1')
    const s = useDomainStore.getState().sessions[0]
    expect(s.messages.map((m) => m.id)).toEqual(['u1'])
    expect(s.agents).toEqual([])
    expect(s.status).toBe('running')
    expect(s.error).toBeNull()
  })

  it('keeps a trailing user message (retry-after-error path)', () => {
    useDomainStore.setState({
      sessions: [baseSession({ messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }], status: 'error', error: { code: 'AGENT_ERROR', message: 'boom' } })],
      activeSessionId: 's1',
    })
    useDomainStore.getState().regenerateLastTurn('s1')
    const s = useDomainStore.getState().sessions[0]
    expect(s.messages.map((m) => m.id)).toEqual(['u1'])
    expect(s.status).toBe('running')
    expect(s.error).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test src/domain/sessionStore.test.ts`
Expected: FAIL — `regenerateLastTurn` is not a function. (The `stopped` passthrough test should already PASS, since `finalizeAssistant` copies `msg.message` verbatim — that's intentional; it guards the behavior.)

- [ ] **Step 3: Declare `regenerateLastTurn` in the store interface**

In `src/domain/sessionStore.ts`, add to the `DomainStore` interface (after `appendUserMessage`, `:188`):

```ts
  regenerateLastTurn: (sessionId: string) => void
```

- [ ] **Step 4: Implement the action**

In the `useDomainStore` create body, add after `appendUserMessage` (`:226-234`):

```ts
  regenerateLastTurn: (sessionId) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== sessionId) return sess
        const last = sess.messages[sess.messages.length - 1]
        const messages = last && last.role === 'assistant' ? sess.messages.slice(0, -1) : sess.messages
        return { ...sess, messages, agents: [], status: 'running' as const, error: null }
      }),
    })),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `yarn test src/domain/sessionStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "feat(store): regenerateLastTurn action + stopped passthrough test"
```

---

## Task 10: Domain service — `regenerate()`

**Files:**
- Modify: `src/domain/sessionService.ts:150-153` (after `cancel`)
- Test: `src/domain/sessionService.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/domain/sessionService.test.ts`, add inside `describe('SessionService', ...)`:

```ts
  it('regenerate optimistically drops the trailing assistant and sends message:regenerate', () => {
    useDomainStore.setState({
      sessions: [{ id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [] }, title: 'T', preview: 'P', updatedAt: 'now', updatedAtMs: 0, loaded: true, messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }, { id: 'a1', role: 'assistant', content: 'ans', timestamp: 1 }], agents: [], status: 'idle', error: null }],
      activeSessionId: 's1',
    })
    const t = new FakeTransport()
    new SessionService(t).regenerate()
    expect(useDomainStore.getState().sessions[0].messages.map((m) => m.role)).toEqual(['user'])
    expect(t.sent.at(-1)).toMatchObject({ type: 'message:regenerate', sessionId: 's1' })
  })

  it('regenerate is a no-op while a turn is running', () => {
    useDomainStore.setState({
      sessions: [{ id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [] }, title: 'T', preview: 'P', updatedAt: 'now', updatedAtMs: 0, loaded: true, messages: [{ id: 'u1', role: 'user', content: 'hi', timestamp: 0 }], agents: [], status: 'running', error: null }],
      activeSessionId: 's1',
    })
    const t = new FakeTransport()
    new SessionService(t).regenerate()
    expect(t.sent.some((m) => m.type === 'message:regenerate')).toBe(false)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test src/domain/sessionService.test.ts`
Expected: FAIL — `regenerate` is not a function.

- [ ] **Step 3: Implement `regenerate` after `cancel`**

In `src/domain/sessionService.ts`, add right after the `cancel()` method (`:150-153`):

```ts
  regenerate(): void {
    const { activeSessionId, sessions } = useDomainStore.getState()
    if (!activeSessionId) return
    const sess = sessions.find((x) => x.id === activeSessionId)
    if (!sess || sess.status === 'running') return
    useDomainStore.getState().regenerateLastTurn(activeSessionId)
    this.transport.send({ type: 'message:regenerate', sessionId: activeSessionId })
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test src/domain/sessionService.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionService.ts src/domain/sessionService.test.ts
git commit -m "feat(domain): sessionService.regenerate (optimistic + send)"
```

---

## Task 11: Domain hooks — `useActiveSessionStatus`

**Files:**
- Modify: `src/domain/hooks.ts`, `src/domain/index.ts` (re-export if it lists hooks explicitly)

- [ ] **Step 1: Add the selector hook**

In `src/domain/hooks.ts`, after `useActiveSessionError` (`:30`), add:

```ts
export function useActiveSessionStatus(): SessionVM['status'] {
  return useDomainStore((s) => s.sessions.find((x) => x.id === s.activeSessionId)?.status ?? 'idle')
}
```

- [ ] **Step 2: Ensure it is exported from the domain barrel**

Check `src/domain/index.ts`. If it re-exports hooks via `export * from './hooks'`, no change is needed. If it lists hook names explicitly, add `useActiveSessionStatus` to that list.

- [ ] **Step 3: Type-check**

Run: `yarn type-check`
Expected: PASS. (Returns a primitive string — complies with the Zustand-selector rule in AGENTS.md.)

- [ ] **Step 4: Commit**

```bash
git add src/domain/hooks.ts src/domain/index.ts
git commit -m "feat(domain): useActiveSessionStatus hook"
```

---

## Task 12: IPC — `copyText` clipboard helper

**Files:**
- Create: `src/ipc/clipboard.ts`

- [ ] **Step 1: Implement `copyText`**

Create `src/ipc/clipboard.ts`:

```ts
/**
 * Copy text to the clipboard. Tries the async Clipboard API first (works in a
 * secure context under a user gesture), then falls back to a hidden-textarea
 * execCommand for environments where it is blocked. Returns whether it succeeded.
 *
 * If the bundled WKWebView blocks both, swap this for @tauri-apps/plugin-clipboard-manager
 * (requires the cargo plugin + a clipboard-manager:allow-write capability).
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/ipc/clipboard.ts
git commit -m "feat(ipc): copyText clipboard helper with execCommand fallback"
```

---

## Task 13: i18n — message-action strings

**Files:**
- Modify: `src/i18n/en.ts:25`, `src/i18n/zh-CN.ts:25`, `src/i18n/zh-TW.ts:25` (the `chat` block, after `clearFolder`)

- [ ] **Step 1: Add keys to `en.ts`**

In `src/i18n/en.ts`, replace the line `      clearFolder: 'Pure chat',` with:

```ts
      clearFolder: 'Pure chat',
      stop: 'Stop',
      copy: 'Copy',
      copyCode: 'Copy code',
      regenerate: 'Regenerate',
      thinking: 'Thinking…',
      retry: 'Retry',
      stopped: 'Stopped',
```

- [ ] **Step 2: Add keys to `zh-CN.ts`**

In `src/i18n/zh-CN.ts`, replace the line `      clearFolder: '纯对话',` with:

```ts
      clearFolder: '纯对话',
      stop: '停止',
      copy: '复制',
      copyCode: '复制代码',
      regenerate: '重新生成',
      thinking: '思考中…',
      retry: '重试',
      stopped: '已停止',
```

- [ ] **Step 3: Add keys to `zh-TW.ts`**

In `src/i18n/zh-TW.ts`, replace the line `      clearFolder: '純對話',` with:

```ts
      clearFolder: '純對話',
      stop: '停止',
      copy: '複製',
      copyCode: '複製程式碼',
      regenerate: '重新生成',
      thinking: '思考中…',
      retry: '重試',
      stopped: '已停止',
```

- [ ] **Step 4: Type-check (the `as const` keys must match across locales)**

Run: `yarn type-check`
Expected: PASS — `i18next.d.ts` derives its resource type from `en`; identical keys in all three locales keep types consistent.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat(i18n): message-action strings (en/zh-CN/zh-TW)"
```

---

## Task 14: Composer — Send ↔ Stop toggle

**Files:**
- Modify: `src/components/chat/Composer.tsx`

- [ ] **Step 1: Add `running`/`onStop` props and the Stop button**

Replace the whole file `src/components/chat/Composer.tsx` with:

```tsx
import { useTranslation } from 'react-i18next'
import { ArrowUp, Square } from 'lucide-react'
import { Textarea } from '@/components/ui/Textarea'

const ACTIVE_MODEL = 'deepseek-chat'

export function Composer({
  value,
  onChange,
  onSubmit,
  autoFocus,
  running,
  onStop,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  autoFocus?: boolean
  running?: boolean
  onStop?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-border bg-surface p-2 shadow-pop focus-within:ring-2 focus-within:ring-accent/30">
      <Textarea
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSubmit()
          }
        }}
        rows={2}
        placeholder={t('chat.inputPlaceholder')}
        className="border-0 px-2 py-1 focus-visible:ring-0"
      />
      <div className="flex items-center justify-between px-1 pt-1">
        <span className="text-[12px] text-ink-tertiary">{ACTIVE_MODEL}</span>
        {running && onStop ? (
          <button
            onClick={onStop}
            data-testid="composer-stop"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover"
            title={t('chat.stop')}
          >
            <Square size={15} />
          </button>
        ) : (
          <button
            onClick={onSubmit}
            disabled={!value.trim()}
            data-testid="composer-send"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            title={t('chat.send')}
          >
            <ArrowUp size={17} />
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS — `NewConversation` (which omits the new optional props) still compiles.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/Composer.tsx
git commit -m "feat(chat): Composer Send↔Stop toggle"
```

---

## Task 15: InputBar — wire Stop to cancel

**Files:**
- Modify: `src/components/chat/InputBar.tsx`

- [ ] **Step 1: Pass `running`/`onStop` from the active session status**

Replace the whole file `src/components/chat/InputBar.tsx` with:

```tsx
import { useState } from 'react'
import { Composer } from './Composer'
import { sessionService, useActiveSessionStatus } from '@/domain'

export function InputBar() {
  const [value, setValue] = useState('')
  const status = useActiveSessionStatus()
  const submit = () => {
    const text = value.trim()
    if (!text) return
    sessionService.sendMessage(text)
    setValue('')
  }
  return (
    <div className="shrink-0 px-5 pb-5">
      <div className="mx-auto max-w-3xl">
        <Composer
          value={value}
          onChange={setValue}
          onSubmit={submit}
          running={status === 'running'}
          onStop={() => sessionService.cancel()}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS. (If `@/domain` does not re-export `useActiveSessionStatus`, fix Task 11 Step 2.)

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/InputBar.tsx
git commit -m "feat(chat): InputBar Stop button cancels the running turn"
```

---

## Task 16: MessageActions component

**Files:**
- Create: `src/components/chat/MessageActions.tsx`

- [ ] **Step 1: Implement the hover action row**

Create `src/components/chat/MessageActions.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check, RefreshCw } from 'lucide-react'
import type { Message } from '@hip/protocol'
import { copyText } from '@/ipc/clipboard'
import { sessionService } from '@/domain'

export function MessageActions({ message, isLastAssistant }: { message: Message; isLastAssistant: boolean }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    if (await copyText(message.content)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const btn = 'flex h-6 w-6 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink-secondary'

  return (
    <div className="mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
      <button onClick={onCopy} data-testid="msg-copy" title={t('chat.copy')} className={btn}>
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
      {isLastAssistant && (
        <button onClick={() => sessionService.regenerate()} data-testid="msg-regenerate" title={t('chat.regenerate')} className={btn}>
          <RefreshCw size={14} />
        </button>
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
git add src/components/chat/MessageActions.tsx
git commit -m "feat(chat): MessageActions hover row (copy + regenerate)"
```

---

## Task 17: CodeBlock component (per-code-block copy)

**Files:**
- Create: `src/components/chat/CodeBlock.tsx`

- [ ] **Step 1: Implement the react-markdown `pre` override**

Create `src/components/chat/CodeBlock.tsx`:

```tsx
import { useState, type ComponentPropsWithoutRef, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Check } from 'lucide-react'
import { copyText } from '@/ipc/clipboard'

/** Extract the raw code text from react-markdown's <pre> children (a <code> element). */
function codeTextOf(children: unknown): string {
  const el = children as ReactElement<{ children?: unknown }> | undefined
  const inner = el?.props?.children
  return (typeof inner === 'string' ? inner : '').replace(/\n$/, '')
}

/**
 * Replacement for the markdown `pre` element: keeps the styled <pre> and adds a
 * hover copy button. `node` (react-markdown's hast node) is destructured out so it
 * is never spread onto the DOM; the loose props type stays assignable to the
 * `components.pre` slot.
 */
export function CodeBlock({ children, node, ...props }: ComponentPropsWithoutRef<'pre'> & { node?: unknown }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const code = codeTextOf(children)

  const onCopy = async () => {
    if (await copyText(code)) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="group/code relative">
      <pre {...props}>{children}</pre>
      <button
        onClick={onCopy}
        data-testid="code-copy"
        title={t('chat.copyCode')}
        className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-surface/80 text-ink-tertiary opacity-0 transition-opacity hover:text-ink-secondary group-hover/code:opacity-100"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/CodeBlock.tsx
git commit -m "feat(chat): CodeBlock with per-block copy button"
```

---

## Task 18: ThinkingBubble component

**Files:**
- Create: `src/components/chat/ThinkingBubble.tsx`

- [ ] **Step 1: Implement the placeholder bubble**

Create `src/components/chat/ThinkingBubble.tsx`:

```tsx
import { useTranslation } from 'react-i18next'

export function ThinkingBubble() {
  const { t } = useTranslation()
  return (
    <div className="flex gap-3" data-testid="thinking-bubble">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
        AI
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-[12px] font-medium text-ink-secondary">hip</div>
        <div className="text-[14px] leading-relaxed text-ink-tertiary">
          <span className="animate-pulse">{t('chat.thinking')}</span>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ThinkingBubble.tsx
git commit -m "feat(chat): ThinkingBubble first-token placeholder"
```

---

## Task 19: MessageBubble — actions, stopped badge, CodeBlock

**Files:**
- Modify: `src/components/chat/MessageBubble.tsx`

- [ ] **Step 1: Wire actions, the stopped badge, and the CodeBlock override**

Replace the whole file `src/components/chat/MessageBubble.tsx` with:

```tsx
import ReactMarkdown from 'react-markdown'
import { useTranslation } from 'react-i18next'
import type { Message } from '@hip/protocol'
import { Avatar } from '@/components/ui/Avatar'
import { StreamingCursor } from './StreamingCursor'
import { MessageActions } from './MessageActions'
import { CodeBlock } from './CodeBlock'
import { cn } from '@/lib/utils'

interface MessageBubbleProps {
  message: Message
  streaming?: boolean
  isLastAssistant?: boolean
}

export function MessageBubble({ message, streaming, isLastAssistant }: MessageBubbleProps) {
  const { t } = useTranslation()
  const isUser = message.role === 'user'

  return (
    <div className="group flex gap-3">
      {isUser ? (
        <Avatar name={t('chat.user')} size={28} />
      ) : (
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-white">
          AI
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex items-center gap-2 text-[12px] font-medium text-ink-secondary">
          <span>{isUser ? t('chat.you') : 'hip'}</span>
          {message.stopped && (
            <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-normal text-ink-tertiary" data-testid="stopped-badge">
              {t('chat.stopped')}
            </span>
          )}
        </div>
        <div
          className={cn(
            'max-w-none text-[14px] leading-relaxed text-ink',
            '[&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-surface-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-[12.5px]',
            '[&_code]:font-mono [&_code]:text-[12.5px]',
            '[&_table]:my-2 [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
            '[&_ul]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_p]:my-1.5',
          )}
        >
          <ReactMarkdown components={{ pre: CodeBlock }}>{message.content}</ReactMarkdown>
          {streaming && <StreamingCursor />}
        </div>
        {!streaming && <MessageActions message={message} isLastAssistant={!!isLastAssistant} />}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS. (react-markdown v9 accepts a `components.pre` override; `CodeBlock`'s loose prop type satisfies it.)

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/MessageBubble.tsx
git commit -m "feat(chat): MessageBubble actions row, stopped badge, code-block copy"
```

---

## Task 20: ChatPane — thinking bubble, inline retry, isLastAssistant, streaming gate

**Files:**
- Modify: `src/components/chat/ChatPane.tsx`

- [ ] **Step 1: Add status, the thinking bubble, the inline retry, and pass isLastAssistant**

Replace the whole file `src/components/chat/ChatPane.tsx` with:

```tsx
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { sessionService, useActiveSessionId, useActiveMessages, useActiveSessionError, useActiveSessionStatus } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import { MessageBubble } from './MessageBubble'
import { ThinkingBubble } from './ThinkingBubble'

export function ChatPane() {
  const { t } = useTranslation()
  const activeSessionId = useActiveSessionId()
  const messages = useActiveMessages()
  const error = useActiveSessionError()
  const status = useActiveSessionStatus()
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = bottomRef.current
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, error, status])

  const last = messages[messages.length - 1]
  const showThinking = status === 'running' && last?.role === 'user'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-6">
        {messages.map((m, i) => {
          const isLastMessage = i === messages.length - 1
          return (
            <MessageBubble
              key={`${activeSessionId ?? 'none'}-${m.id}-${i}`}
              message={m}
              streaming={status === 'running' && m.role === 'assistant' && isLastMessage}
              isLastAssistant={m.role === 'assistant' && isLastMessage && status !== 'running'}
            />
          )
        })}
        {showThinking && <ThinkingBubble />}
        {error && (
          <div
            className={`border px-4 py-3 text-[13px] ${
              error.code === 'NO_API_KEY'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
                : 'border-danger/30 bg-danger/10 text-danger'
            }`}
            data-testid="chat-error"
          >
            <p>
              {error.code === 'NO_API_KEY'
                ? t('chat.errorNoApiKey')
                : t('chat.errorGeneric', { message: error.message })}
            </p>
            {error.code === 'NO_API_KEY' ? (
              <button
                onClick={() => setSettingsOpen(true)}
                className="mt-2 bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover"
              >
                {t('chat.openSettings')}
              </button>
            ) : (
              <button
                onClick={() => sessionService.regenerate()}
                data-testid="chat-error-retry"
                className="mt-2 bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover"
              >
                {t('chat.retry')}
              </button>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ChatPane.tsx
git commit -m "feat(chat): thinking placeholder, inline retry, regenerate on last reply"
```

---

## Task 21: Full verification + manual GUI acceptance

**Files:** none (verification only)

- [ ] **Step 1: Run the entire test suite**

Run: `yarn test`
Expected: PASS — all green (live-DeepSeek suites skip without a key in `.env`; with a key, they pass).

- [ ] **Step 2: Type-check frontend + sidecar**

Run: `yarn type-check && yarn workspace @hip/sidecar type-check`
Expected: PASS.

- [ ] **Step 3: Production build (guards the Zustand-selector / React #185 class of bug)**

Run: `yarn build`
Expected: PASS (tsc + vite build succeed).

- [ ] **Step 4: Manual GUI acceptance (live DeepSeek — per repo convention for LLM paths)**

Start the app (`scripts/dev.sh start`, or `yarn tauri dev`), ensure a DeepSeek key is set in Settings, then verify:
- Send a message → a **Thinking…** placeholder shows until the first token; the send button becomes a **Stop** button while running.
- Click **Stop** mid-stream → streaming halts, the partial reply stays with a **已停止 / Stopped** badge; reload the window → the partial reply (with badge) is still there.
- Hover an assistant bubble → **Copy** and (on the latest reply) **Regenerate** appear. Copy pastes the markdown elsewhere.
- Click **Regenerate** on the last reply → the old reply is replaced by a fresh run (no duplicate bubble).
- Hover a fenced code block → a **copy** button appears and copies the code.
- Force an error (e.g. clear the key, send) → an inline error shows; for a generic error a **Retry** button re-runs the turn; for the no-key error a **Go to Settings** button appears.

- [ ] **Step 5: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore(chat): message-actions verification fixups"
```

---

## Notes for the Implementer

- **Order matters:** Tasks 1→8 (protocol → persistence → sidecar) must precede the frontend tasks; `finalizeAndPersist` in Task 5 depends on the `stopped` plumbing from Task 3.
- **The abort-persist path (Task 6)** is exercised end-to-end only under a live key; its deterministic guarantees are the store round-trip (Task 3) and the `regenerate` tests (Task 7). Don't add a flaky mid-stream fake-model cancel test.
- **No DOM test infra:** do not introduce `@testing-library/react`/jsdom for this slice — presentational tasks (14–20) are gated on `yarn type-check` + the Task 21 GUI checklist, matching the repo's conventions.
- **Clipboard:** if Task 21 reveals the bundled WKWebView blocks both `navigator.clipboard` and `execCommand`, swap `src/ipc/clipboard.ts` for `@tauri-apps/plugin-clipboard-manager` (cargo plugin + `clipboard-manager:allow-write` capability) — out of scope unless the manual check fails.
```
