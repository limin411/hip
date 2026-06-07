# Session Titles (Auto-title + Rename) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every conversation a live, meaningful title — an instant truncated placeholder on the first message, refined into a concise DeepSeek-generated title after the first reply — and let users rename any session via a right-click context menu, with user-set titles never overwritten by auto-titling.

**Architecture:** The sidecar is authoritative for the persisted title. A single new `session:title` server message carries every title change (instant truncate, LLM refine, rename echo) to the frontend's Zustand store. A `title_custom` column (schema v2) pins user-set titles; the LLM refine writes through an `updateTitleIfAuto` guard (`WHERE … AND title_custom = 0`) so a rename always wins. The LLM-title call is an injectable seam that stays **off** for injected-model sessions, keeping offline tests deterministic and CI free of API spend.

**Tech Stack:** TypeScript; Node 24 `node:sqlite`; LangChain `ChatOpenAI` (DeepSeek); `@hip/protocol` (raw TS source, shared); React + Zustand + react-i18next; radix `@radix-ui/react-context-menu` (new); vitest (`environment: 'node'`).

**Spec:** `docs/superpowers/specs/2026-06-07-session-titles-design.md`

---

## Conventions for the implementer

- **Branch:** all work happens on the existing `feat/session-titles` branch (already checked out). Do not switch to `main`.
- **Commit trailer:** every commit message must end with this line (repo convention):
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
  The `git commit` commands below show only the subject for brevity — append the trailer.
- **Running tests offline:** NEVER pass a bare `src` positional to vitest — it substring-matches `packages/sidecar/src/**` and pulls in the two real-LLM suites (`session.test.ts`, `multiagent.integration.test.ts`) that spend DeepSeek quota. Always use the precise paths shown in each task.
- **`@hip/protocol`** is consumed as TS source (its `package.json` `main`/`types` point at `src/index.ts`); editing it needs no build step.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `packages/protocol/src/index.ts` | Add `session:rename` (client) + `session:title` (server) | 1 |
| `packages/sidecar/src/persistence/schema.ts` | v1→v2 migration: `title_custom` column | 2 |
| `packages/sidecar/src/persistence/store.ts` | `updateTitleIfAuto`, `setCustomTitle`; drop `updateTitle` | 3 |
| `packages/sidecar/src/session/session.ts` | `TitleGenerator` seam; push instant truncate; LLM refine + `sanitizeTitle` | 4, 5 |
| `packages/sidecar/src/session/session-manager.ts` | handle `session:rename` (+ `sanitizeRename`) | 6 |
| `src/domain/sessionStore.ts` | reducer `session:title`; `renameSession` action | 7 |
| `src/domain/sessionService.ts` | `renameSession()` | 7 |
| `src/components/ui/ContextMenu.tsx` | **new** radix context-menu wrapper | 8 |
| `src/components/sidebar/SessionItem.tsx` | right-click menu + inline title edit | 9 |
| `src/i18n/{en,zh-CN,zh-TW}.ts` | `sidebar.renameSession` | 9 |
| `package.json` | `@radix-ui/react-context-menu` | 8 |

Tasks are ordered so each builds only on earlier ones. Tasks 8–9 (React components) have **no automated tests** — the project has no jsdom/testing-library and `environment: 'node'`; they are validated in the GUI acceptance (Task 10), matching the existing convention.

---

## Task 1: Protocol — `session:rename` + `session:title`

**Files:**
- Modify: `packages/protocol/src/index.ts:41-62`

- [ ] **Step 1: Add the client message**

In the `ClientMessage` union (after the `session:delete` line), add:

```ts
  | { type: 'session:delete'; sessionId: string }
  | { type: 'session:rename'; sessionId: string; title: string }
```

- [ ] **Step 2: Add the server message**

In the `ServerMessage` union (after the `session:deleted` line), add:

```ts
  | { type: 'session:deleted'; sessionId: string }
  | { type: 'session:title'; sessionId: string; title: string }
```

- [ ] **Step 3: Verify the protocol type-checks**

Run: `yarn type-check`
Expected: PASS (exit 0), no errors. This confirms the union edits are well-formed and the frontend still compiles against the unchanged usages.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): add session:rename and session:title messages"
```

---

## Task 2: Schema v2 — `title_custom` column

**Files:**
- Modify: `packages/sidecar/src/persistence/schema.ts:43-57`
- Test: `packages/sidecar/src/persistence/schema.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/persistence/schema.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { DatabaseSync } from './sqlite.js'
import { migrate } from './schema.js'

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)
}

describe('migrate', () => {
  it('adds title_custom (default 0) and reaches user_version 2', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    expect(columns(db, 'sessions')).toContain('title_custom')
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2)
    db.exec(`INSERT INTO sessions(id,title,config,created_at,updated_at) VALUES('s','t','{}',1,1)`)
    expect((db.prepare(`SELECT title_custom FROM sessions WHERE id='s'`).get() as { title_custom: number }).title_custom).toBe(0)
  })

  it('is idempotent and upgrades an existing v1 database in place', () => {
    const db = new DatabaseSync(':memory:')
    migrate(db)
    migrate(db) // second run must not throw (e.g. duplicate column)
    expect(columns(db, 'sessions').filter((c) => c === 'title_custom')).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/sidecar/src/persistence/schema.test.ts`
Expected: FAIL — `title_custom` not in columns, `user_version` is 1 (the v2 migration doesn't exist yet).

- [ ] **Step 3: Add the v2 migration**

In `packages/sidecar/src/persistence/schema.ts`, replace the `migrate` function (lines 43-57) with:

```ts
/** Create core tables (v1) and apply incremental migrations. Idempotent. */
export function migrate(db: DatabaseSync): void {
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  if (version < 1) {
    db.exec('BEGIN')
    try {
      db.exec(DDL)
      db.exec('PRAGMA user_version = 1')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
  if (version < 2) {
    db.exec('BEGIN')
    try {
      // title_custom: 0 = auto-derived title, 1 = user-set (never auto-overwritten).
      db.exec(`ALTER TABLE sessions ADD COLUMN title_custom INTEGER NOT NULL DEFAULT 0`)
      db.exec('PRAGMA user_version = 2')
      db.exec('COMMIT')
    } catch (e) {
      db.exec('ROLLBACK')
      throw e
    }
  }
}
```

Note: the local `version` is read once before any migration runs, so a fresh DB (`version = 0`) executes both blocks; an existing v1 DB (`version = 1`) executes only the v2 block.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/sidecar/src/persistence/schema.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Verify existing persistence tests still pass**

Run: `npx vitest run packages/sidecar/src/persistence`
Expected: PASS (all probe/open/store/schema tests). The new column has a default, so existing inserts are unaffected.

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/persistence/schema.ts packages/sidecar/src/persistence/schema.test.ts
git commit -m "feat(persistence): schema v2 adds title_custom column"
```

---

## Task 3: Store — `updateTitleIfAuto` + `setCustomTitle`

**Files:**
- Modify: `packages/sidecar/src/persistence/store.ts:25-27`
- Test: `packages/sidecar/src/persistence/store.test.ts:12-14` (add cases)

- [ ] **Step 1: Write the failing tests**

In `packages/sidecar/src/persistence/store.test.ts`, add these cases inside the `describe('SessionStore', …)` block (after the existing `it('inserts and lists …')`):

```ts
  it('updateTitleIfAuto changes an auto title and reports the change count', () => {
    store.insertSession({ id: 's1', title: '新对话', config: cfg, createdAt: 1, updatedAt: 1 })
    expect(store.updateTitleIfAuto('s1', '截取标题')).toBe(1)
    expect(store.getSession('s1')!.title).toBe('截取标题')
  })

  it('updateTitleIfAuto is a no-op once a title is pinned', () => {
    store.insertSession({ id: 's1', title: '新对话', config: cfg, createdAt: 1, updatedAt: 1 })
    store.setCustomTitle('s1', '我的标题')
    expect(store.updateTitleIfAuto('s1', '自动标题')).toBe(0)
    expect(store.getSession('s1')!.title).toBe('我的标题')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/sidecar/src/persistence/store.test.ts`
Expected: FAIL — `store.updateTitleIfAuto`/`store.setCustomTitle` are not functions.

- [ ] **Step 3: Replace `updateTitle` with the two guarded methods**

In `packages/sidecar/src/persistence/store.ts`, replace the `updateTitle` method (lines 25-27):

```ts
  updateTitle(id: string, title: string): void {
    this.db.prepare(`UPDATE sessions SET title=? WHERE id=?`).run(title, id)
  }
```

with:

```ts
  /** Set the title only if it hasn't been user-pinned. Returns the number of rows changed (0 or 1). */
  updateTitleIfAuto(id: string, title: string): number {
    return this.db.prepare(`UPDATE sessions SET title=? WHERE id=? AND title_custom=0`).run(title, id).changes
  }

  /** Set a user-chosen title and pin it so auto-titling never overwrites it. */
  setCustomTitle(id: string, title: string): void {
    this.db.prepare(`UPDATE sessions SET title=?, title_custom=1 WHERE id=?`).run(title, id)
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run packages/sidecar/src/persistence/store.test.ts`
Expected: PASS (existing cases + 2 new).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/persistence/store.ts packages/sidecar/src/persistence/store.test.ts
git commit -m "feat(persistence): guarded updateTitleIfAuto + setCustomTitle"
```

---

## Task 4: Session — push the instant truncated title + `TitleGenerator` seam

**Files:**
- Modify: `packages/sidecar/src/session/session.ts:1-73`
- Test: `packages/sidecar/src/session/session-title.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/session/session-title.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import type { ServerMessage } from '@hip/protocol'
import { Session } from './session.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }
function store() { const { db, ftsEnabled } = openDatabase(':memory:'); return new SessionStore(db, ftsEnabled) }

describe('Session auto-title', () => {
  let st: SessionStore
  beforeEach(() => { st = store(); st.insertSession({ id: 's1', title: '新对话', config: JSON.stringify(cfg), createdAt: 1, updatedAt: 1 }) })

  it('pushes a session:title with the truncated first message (no LLM when a model is injected)', async () => {
    const sent: ServerMessage[] = []
    const model = new FakeListChatModel({ responses: ['hi'] })
    await new Session('s1', cfg, model, st).sendMessage('给会话加重命名能力', (m) => sent.push(m), 'u-1')
    const titles = sent.filter((m) => m.type === 'session:title') as Extract<ServerMessage, { type: 'session:title' }>[]
    expect(titles).toHaveLength(1)
    expect(titles[0].title).toContain('给会话加重命名能力')
    expect(st.getSession('s1')!.title).toContain('给会话加重命名能力')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run packages/sidecar/src/session/session-title.test.ts`
Expected: FAIL — no `session:title` message is sent (the title write is silent today), so `titles` has length 0.

- [ ] **Step 3: Add the `TitleGenerator` seam and the default generator**

In `packages/sidecar/src/session/session.ts`, update the messages import (line 4) to include `SystemMessage`:

```ts
import { HumanMessage, AIMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
```

Then, just below the existing `deriveTitle` function (after line 17), add:

```ts
export type TitleGenerator = (input: { firstUserMessage: string; firstReply: string }) => Promise<string>

const TITLE_SYSTEM_PROMPT =
  'You generate a very short title (at most 6 words, or about 16 Chinese characters) for a chat conversation. ' +
  'Use the same language as the user. Reply with ONLY the title — no quotes, no trailing punctuation.'

/** Production title generator: one cheap DeepSeek completion. Not used when a model is injected (tests). */
function buildDefaultTitleGenerator(config: SessionConfig): TitleGenerator {
  return async ({ firstUserMessage, firstReply }) => {
    const model = new ChatOpenAI({
      model: config.model || DEFAULT_MODEL,
      apiKey: process.env.DEEPSEEK_API_KEY || 'sk-missing',
      configuration: { baseURL: 'https://api.deepseek.com/v1' },
      maxTokens: 24,
      temperature: 0.3,
    })
    const res = await model.invoke([
      new SystemMessage(TITLE_SYSTEM_PROMPT),
      new HumanMessage(`${firstUserMessage}\n\n[assistant reply]: ${firstReply.slice(0, 200)}`),
    ])
    return typeof res.content === 'string' ? res.content : ''
  }
}
```

- [ ] **Step 4: Add the constructor param + field**

Replace the class fields + constructor (lines 30-47) so it accepts and resolves a `titleGenerator`:

```ts
  private readonly agent: ReturnType<typeof createDeepAgent>
  private readonly messages: BaseMessage[] = []
  private abortController: AbortController | null = null
  private readonly usesEnvModel: boolean
  private readonly titleGenerator?: TitleGenerator

  constructor(
    readonly id: string,
    readonly config: SessionConfig,
    model?: BaseLanguageModel,
    private readonly store?: SessionStore,
    titleGenerator?: TitleGenerator,
  ) {
    this.usesEnvModel = !model
    // Inject a generator (tests), else build the real one only for the env-keyed
    // production model. Injected-model sessions get no generator → no LLM title.
    this.titleGenerator = titleGenerator ?? (this.usesEnvModel ? buildDefaultTitleGenerator(config) : undefined)
    this.agent = createDeepAgent({
      model: model ?? buildModel(config),
      systemPrompt: config.systemPrompt ?? SUPERVISOR_PROMPT,
      subagents: SUBAGENTS as unknown as NonNullable<Parameters<typeof createDeepAgent>[0]>['subagents'],
    })
  }
```

- [ ] **Step 5: Push the instant truncated title**

Replace the persist-before-run block (lines 67-73) so it uses the guarded update and pushes `session:title`, capturing whether this is the first turn:

```ts
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
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run packages/sidecar/src/session/session-title.test.ts`
Expected: PASS (1 test).

- [ ] **Step 7: Verify the existing session/persist suites still pass**

Run: `npx vitest run packages/sidecar/src/session/session-persist.test.ts packages/sidecar/src/session/session-unit.test.ts packages/sidecar/src/session/session-manager-persist.test.ts`
Expected: PASS. The "derives the session title" test still holds (truncate still writes via `updateTitleIfAuto`); `session-unit.test.ts` constructs a Session with no store, so the new push is skipped.

- [ ] **Step 8: Commit**

```bash
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-title.test.ts
git commit -m "feat(session): push instant truncated title + title-generator seam"
```

---

## Task 5: Session — LLM refine after the first reply + `sanitizeTitle`

**Files:**
- Modify: `packages/sidecar/src/session/session.ts` (export `sanitizeTitle`; add refine block after `message:complete`)
- Test: `packages/sidecar/src/session/session-title.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**

In `packages/sidecar/src/session/session-title.test.ts`, update the import line to also pull in `sanitizeTitle`:

```ts
import { Session, sanitizeTitle } from './session.js'
```

Then add these cases inside the `describe('Session auto-title', …)` block:

```ts
  it('refines the title via the generator after the first reply', async () => {
    const sent: ServerMessage[] = []
    const model = new FakeListChatModel({ responses: ['some reply'] })
    const gen = async () => '重命名与自动标题'
    await new Session('s1', cfg, model, st, gen).sendMessage('帮我加个功能', (m) => sent.push(m), 'u-1')
    const titles = sent.filter((m) => m.type === 'session:title') as Extract<ServerMessage, { type: 'session:title' }>[]
    expect(titles).toHaveLength(2)               // instant truncate, then refine
    expect(titles.at(-1)!.title).toBe('重命名与自动标题')
    expect(st.getSession('s1')!.title).toBe('重命名与自动标题')
  })

  it('does not overwrite a user-pinned title', async () => {
    st.setCustomTitle('s1', '我的标题')
    const sent: ServerMessage[] = []
    const model = new FakeListChatModel({ responses: ['reply'] })
    const gen = async () => '生成的标题'
    await new Session('s1', cfg, model, st, gen).sendMessage('问题', (m) => sent.push(m), 'u-1')
    expect(sent.some((m) => m.type === 'session:title')).toBe(false)
    expect(st.getSession('s1')!.title).toBe('我的标题')
  })

  it('sanitizeTitle strips quotes/trailing punctuation, collapses whitespace, truncates', () => {
    expect(sanitizeTitle('  "Hello  World"  ')).toBe('Hello World')
    expect(sanitizeTitle('标题。')).toBe('标题')
    expect(sanitizeTitle('x'.repeat(50))).toHaveLength(40)
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/sidecar/src/session/session-title.test.ts`
Expected: FAIL — `sanitizeTitle` is not exported; the refine push doesn't happen (only 1 title for the "refines" case).

- [ ] **Step 3: Add `sanitizeTitle`**

In `packages/sidecar/src/session/session.ts`, just below `deriveTitle` (and the `TITLE_LEN` constant already at line 12), add:

```ts
/** Normalize a generated/echoed title: one line, no wrapping quotes, no trailing punctuation, bounded length. */
export function sanitizeTitle(raw: string): string {
  const oneLine = raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’「」『』]+/, '')
    .replace(/["'“”‘’「」『』]+$/, '')
    .replace(/[。.！!？?，,、；;：:]+$/, '')
    .trim()
  return oneLine.length > TITLE_LEN ? oneLine.slice(0, TITLE_LEN) : oneLine
}
```

- [ ] **Step 4: Add the refine block**

In `sendMessage`, immediately after the final `_send({ type: 'message:complete', … })` call (the end of the method, around lines 175-185), append:

```ts
    // Auto-title refine: once, on the first turn, only while still auto-titled.
    // Best-effort — failures keep the truncated title. The pinned guard lives in
    // updateTitleIfAuto, so a rename during this turn wins (changes === 0 here).
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/sidecar/src/session/session-title.test.ts`
Expected: PASS (1 from Task 4 + 3 new).

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-title.test.ts
git commit -m "feat(session): LLM title refine after first reply + sanitizeTitle"
```

---

## Task 6: SessionManager — handle `session:rename`

**Files:**
- Modify: `packages/sidecar/src/session/session-manager.ts:28-59`
- Test: `packages/sidecar/src/session/session-manager-persist.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**

In `packages/sidecar/src/session/session-manager-persist.test.ts`, add these cases inside the `describe('SessionManager persistence', …)` block:

```ts
  it('session:rename sets a pinned custom title and echoes session:title', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    sent = []
    mgr.handle({ type: 'session:rename', sessionId: 's1', title: '  我的项目  ' }, send)
    expect(store.getSession('s1')!.title).toBe('我的项目')
    const echo = sent.find((m) => m.type === 'session:title') as Extract<ServerMessage, { type: 'session:title' }>
    expect(echo).toMatchObject({ sessionId: 's1', title: '我的项目' })
  })

  it('session:rename falls back to 新对话 for blank input', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    mgr.handle({ type: 'session:rename', sessionId: 's1', title: '   ' }, send)
    expect(store.getSession('s1')!.title).toBe('新对话')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run packages/sidecar/src/session/session-manager-persist.test.ts`
Expected: FAIL — `session:rename` is unhandled, so no `session:title` echo and the title is unchanged.

- [ ] **Step 3: Add the `sanitizeRename` helper**

In `packages/sidecar/src/session/session-manager.ts`, after the imports/type aliases (after line 7), add:

```ts
/** Normalize a user-typed rename: one line, bounded length, blank → default. */
function sanitizeRename(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim().slice(0, 200) || '新对话'
}
```

- [ ] **Step 4: Handle the message**

In the `handleAsync` switch, add a `session:rename` case after the `session:delete` case (after line 57):

```ts
      case 'session:rename': {
        const title = sanitizeRename(msg.title)
        this.store?.setCustomTitle(msg.sessionId, title)
        send({ type: 'session:title', sessionId: msg.sessionId, title })
        break
      }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run packages/sidecar/src/session/session-manager-persist.test.ts`
Expected: PASS (existing cases + 2 new).

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/session-manager-persist.test.ts
git commit -m "feat(session-manager): handle session:rename"
```

---

## Task 7: Frontend domain — `session:title` reducer + `renameSession`

**Files:**
- Modify: `src/domain/sessionStore.ts:153-159` (reducer), `:169-223` (store interface + action)
- Modify: `src/domain/sessionService.ts:62-69`
- Test: `src/domain/sessionStore.test.ts`, `src/domain/sessionService.test.ts` (add cases)

- [ ] **Step 1: Write the failing tests**

In `src/domain/sessionStore.test.ts`, add to the `describe('applyServerMessage', …)` block:

```ts
  it('session:title updates the session title', () => {
    const next = applyServerMessage({ sessions: [baseSession()] }, { type: 'session:title', sessionId: 's1', title: 'New Name' }, 0)
    expect(next.sessions[0].title).toBe('New Name')
  })
```

and to the `describe('useDomainStore actions', …)` block:

```ts
  it('renameSession updates the title optimistically', () => {
    reset()
    useDomainStore.getState().createSession('s1', { llmProvider: 'deepseek', model: 'm', tools: [] })
    useDomainStore.getState().renameSession('s1', 'Renamed')
    expect(useDomainStore.getState().sessions[0].title).toBe('Renamed')
  })
```

In `src/domain/sessionService.test.ts`, add to the `describe('SessionService', …)` block:

```ts
  it('renameSession optimistically updates the store and sends session:rename', () => {
    const t = new FakeTransport()
    new SessionService(t).renameSession('s1', 'My Title')
    expect(useDomainStore.getState().sessions[0].title).toBe('My Title')
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:rename', sessionId: 's1', title: 'My Title' })
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/domain/sessionStore.test.ts src/domain/sessionService.test.ts`
Expected: FAIL — `session:title` falls through the reducer's `default` (title unchanged); `renameSession` is not a function.

- [ ] **Step 3: Add the reducer case**

In `src/domain/sessionStore.ts`, in the `applyServerMessage` switch, add a case before `default:` (after the `session:deleted` case, line 154):

```ts
    case 'session:title':
      return update(msg.sessionId, (s) => ({ ...s, title: msg.title }))
```

- [ ] **Step 4: Add the store action**

In the `DomainStore` interface (after the `deleteSession` line, ~line 179), add:

```ts
  renameSession: (id: string, title: string) => void
```

In the `useDomainStore` implementation, add the action (after the `deleteSession` action, ~line 211):

```ts
  renameSession: (id, title) =>
    set((s) => ({ sessions: s.sessions.map((x) => (x.id === id ? { ...x, title } : x)) })),
```

- [ ] **Step 5: Add the service method**

In `src/domain/sessionService.ts`, after the `deleteSession` method (line 65), add:

```ts
  renameSession(id: string, title: string): void {
    useDomainStore.getState().renameSession(id, title)
    this.transport.send({ type: 'session:rename', sessionId: id, title })
  }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/domain/sessionStore.test.ts src/domain/sessionService.test.ts`
Expected: PASS (existing + 3 new).

- [ ] **Step 7: Commit**

```bash
git add src/domain/sessionStore.ts src/domain/sessionService.ts src/domain/sessionStore.test.ts src/domain/sessionService.test.ts
git commit -m "feat(domain): session:title reducer + renameSession action/service"
```

---

## Task 8: `ContextMenu.tsx` UI primitive (+ dependency)

**Files:**
- Modify: `package.json` (add dependency)
- Create: `src/components/ui/ContextMenu.tsx`

No automated test (no jsdom; `environment: 'node'`). Verified via `yarn type-check` + GUI (Task 10).

- [ ] **Step 1: Add the radix context-menu dependency**

Run: `yarn add @radix-ui/react-context-menu`
Expected: resolves a 2.x version (peer with the React/radix already installed) and updates `package.json` + lockfile.

- [ ] **Step 2: Create the wrapper (mirrors `DropdownMenu.tsx`)**

Create `src/components/ui/ContextMenu.tsx`:

```tsx
import * as ContextMenuPrimitive from '@radix-ui/react-context-menu'
import { forwardRef } from 'react'
import { cn } from '@/lib/utils'

export const ContextMenu = ContextMenuPrimitive.Root
export const ContextMenuTrigger = ContextMenuPrimitive.Trigger

export const ContextMenuContent = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Content>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Portal>
    <ContextMenuPrimitive.Content
      ref={ref}
      className={cn(
        'z-50 min-w-[160px] rounded-lg border border-border bg-surface p-1 shadow-float',
        'data-[state=open]:animate-in data-[state=closed]:animate-out',
        className,
      )}
      {...props}
    />
  </ContextMenuPrimitive.Portal>
))
ContextMenuContent.displayName = 'ContextMenuContent'

export const ContextMenuItem = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Item>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Item
    ref={ref}
    className={cn(
      'flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-ink outline-none',
      'focus:bg-surface-muted data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  />
))
ContextMenuItem.displayName = 'ContextMenuItem'

export const ContextMenuSeparator = forwardRef<
  React.ElementRef<typeof ContextMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenuPrimitive.Separator ref={ref} className={cn('my-1 h-px bg-border', className)} {...props} />
))
ContextMenuSeparator.displayName = 'ContextMenuSeparator'
```

- [ ] **Step 3: Verify it type-checks**

Run: `yarn type-check`
Expected: PASS — the radix types resolve and the wrapper compiles.

- [ ] **Step 4: Commit**

```bash
git add package.json yarn.lock src/components/ui/ContextMenu.tsx
git commit -m "feat(ui): add ContextMenu primitive (radix)"
```

---

## Task 9: `SessionItem` — right-click menu + inline rename + i18n

**Files:**
- Modify: `src/i18n/en.ts:23-28`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts` (sidebar block)
- Modify: `src/components/sidebar/SessionItem.tsx` (full rewrite)

No automated test (React component; validated in Task 10's GUI acceptance).

- [ ] **Step 1: Add the i18n key to all three locales**

In `src/i18n/en.ts`, in the `sidebar` block (after `deleteSession: 'Delete Session',`):

```ts
      deleteSession: 'Delete Session',
      renameSession: 'Rename',
```

In `src/i18n/zh-CN.ts`, in the `sidebar` block (after `deleteSession: '删除会话',`):

```ts
      deleteSession: '删除会话',
      renameSession: '重命名',
```

In `src/i18n/zh-TW.ts`, in the `sidebar` block (after `deleteSession: '刪除會話',`):

```ts
      deleteSession: '刪除會話',
      renameSession: '重新命名',
```

- [ ] **Step 2: Verify all three locales have the key**

Run: `grep -c "renameSession" src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts`
Expected: each file reports `1`. (`zh-CN.ts` drives the typed key surface via `i18next.d.ts`; the other two must match at runtime.)

- [ ] **Step 3: Rewrite `SessionItem.tsx`**

Replace the entire contents of `src/components/sidebar/SessionItem.tsx` with:

```tsx
import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { type SessionVM, sessionService } from '@/domain'
import { cn } from '@/lib/utils'
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '@/components/ui/ContextMenu'

interface SessionItemProps {
  session: SessionVM
  active: boolean
  onSelect: () => void
  onDelete: () => void
}

export function SessionItem({ session, active, onSelect, onDelete }: SessionItemProps) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(session.title)
  const inputRef = useRef<HTMLInputElement>(null)
  // Dedupe Enter+blur (and Escape+blur) so we commit/cancel an edit exactly once.
  const committedRef = useRef(false)

  // Focus + select on the next frame: lets radix finish its close-focus restore first.
  useEffect(() => {
    if (!editing) return
    const id = requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select() })
    return () => cancelAnimationFrame(id)
  }, [editing])

  const startEdit = () => { committedRef.current = false; setDraft(session.title); setEditing(true) }
  const commit = () => {
    if (committedRef.current) return
    committedRef.current = true
    setEditing(false)
    const next = draft.trim()
    if (next && next !== session.title) sessionService.renameSession(session.id, next)
  }
  const cancel = () => { committedRef.current = true; setEditing(false) }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          onClick={editing ? undefined : onSelect}
          className={cn(
            'group flex cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 transition-colors',
            active ? 'bg-accent-subtle' : 'hover:bg-surface-muted',
          )}
        >
          <div className="flex items-center justify-between gap-2">
            {editing ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commit() }
                  else if (e.key === 'Escape') { e.preventDefault(); cancel() }
                }}
                onBlur={commit}
                className="min-w-0 flex-1 rounded border border-accent/40 bg-surface px-1 py-0 text-[13px] text-ink outline-none"
              />
            ) : (
              <span className={cn('truncate text-[13px] text-ink', active ? 'font-semibold' : 'font-medium')}>
                {session.title}
              </span>
            )}
            <button
              onClick={(e) => { e.stopPropagation(); onDelete() }}
              className="hidden shrink-0 text-ink-tertiary hover:text-danger group-hover:block"
              title={t('sidebar.deleteSession')}
            >
              <X size={14} />
            </button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[12px] text-ink-tertiary">{session.preview}</span>
            <span className="shrink-0 text-[11px] text-ink-tertiary">{session.updatedAt}</span>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={startEdit}>{t('sidebar.renameSession')}</ContextMenuItem>
        <ContextMenuItem className="text-danger focus:bg-danger/10" onSelect={onDelete}>
          {t('sidebar.deleteSession')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
```

Notes for the implementer:
- `session.title` changes are driven by props (the store updates optimistically on rename and is corrected by the server `session:title` echo); local `draft` is only the in-progress edit buffer.
- `sessionService` is re-exported from `@/domain` (see `src/domain/index.ts`) — import it from there, like `SessionList.tsx` does.

- [ ] **Step 4: Verify it type-checks**

Run: `yarn type-check`
Expected: PASS — `t('sidebar.renameSession')` resolves against the typed resources, and the `ContextMenu` imports compile.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/components/sidebar/SessionItem.tsx
git commit -m "feat(sidebar): right-click rename via context menu + inline edit"
```

---

## Task 10: Integration verification + GUI acceptance

**Files:** none (verification only).

- [ ] **Step 1: Full offline test suite (precise paths — never bare `src`)**

Run:

```bash
npx vitest run \
  packages/sidecar/src/persistence \
  packages/sidecar/src/session/session-title.test.ts \
  packages/sidecar/src/session/session-persist.test.ts \
  packages/sidecar/src/session/session-manager-persist.test.ts \
  packages/sidecar/src/session/session-unit.test.ts \
  src/domain src/lib src/store
```

Expected: all PASS. The two real-LLM suites (`packages/sidecar/src/session/session.test.ts`, `multiagent.integration.test.ts`) are intentionally NOT in the path list, so no DeepSeek quota is spent.

- [ ] **Step 2: Type-check the frontend + protocol**

Run: `yarn type-check`
Expected: PASS (exit 0).

- [ ] **Step 3: GUI acceptance (user-run)**

Launch `yarn tauri dev` and verify:
1. New chat shows `新对话`; sending the first message flips the sidebar title to the truncated text **immediately**.
2. After the first reply finishes, the title refines to a concise LLM-generated summary **without** a reload.
3. Right-click a session → **Rename** → inline edit → Enter persists; relaunch the app and the renamed title survives.
4. Rename a brand-new session, then send a first message and get a reply: the auto-title does **not** overwrite the manual name.
5. The hover **✕** quick-delete and the context-menu **Delete** both work.
6. `Esc` cancels an inline rename; an empty rename falls back to `新对话`.

- [ ] **Step 4: Finish the branch**

After GUI acceptance passes, use **superpowers:finishing-a-development-branch** to merge `feat/session-titles` back to `main` (per the established workflow).

---

## Self-Review

**1. Spec coverage:**
- Hybrid auto-title (instant truncate push + LLM refine) → Tasks 4, 5. ✓
- `session:title` push reused for all three sources → Task 1 (message), 4/5 (truncate+refine), 6 (rename echo). ✓
- `title_custom` pinning + `updateTitleIfAuto` guard → Tasks 2, 3; race-proofing asserted in Task 5's "does not overwrite a pinned title". ✓
- Manual rename via right-click menu + inline edit → Tasks 8, 9. ✓
- Injectable `TitleGenerator` off for injected-model sessions → Task 4 (constructor resolution); guards existing tests (Task 4 Step 7). ✓
- Frontend reducer + optimistic `renameSession` → Task 7. ✓
- i18n key in 3 locales → Task 9. ✓
- Edge cases (empty rename → `新对话`; LLM failure swallowed; no-key path) → Task 6 (blank fallback), Task 5 (try/catch). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows complete code; every test step shows assertions; every run step shows the command + expected result. ✓

**3. Type consistency:** `updateTitleIfAuto(id, title): number` and `setCustomTitle(id, title): void` (Task 3) are used identically in Tasks 4–6. `TitleGenerator` (Task 4) signature `{ firstUserMessage, firstReply } => Promise<string>` matches its call sites in Task 5 and the test stubs. `session:title` / `session:rename` shapes (Task 1) match every producer/consumer (Tasks 5, 6, 7). `sanitizeTitle` exported in Task 5 and imported by the same test file. `renameSession(id, title)` consistent across store/service/component (Tasks 7, 9). ✓
