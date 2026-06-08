# New-Conversation UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new conversation starts on a centered-composer landing where the user picks a project folder or stays in pure-chat (sandbox); the session is a persisted local draft that materializes a sidebar row only on the first message.

**Architecture:** A single persisted client `draft` (zustand + localStorage) lives outside the committed `sessions[]`. Its file tree renders via **cwd-keyed** sidecar FS messages (`fs:lsCwd`/`fs:readCwd`) so no server session exists until the first message commits it (`session:create` → row appears). Pure-chat sessions get a server-derived scratch dir (`~/.hip/scratch/<id>`) bound as their `cwd`.

**Tech Stack:** TypeScript, React 18, Zustand 5 (+persist middleware), react-i18next, Tauri 2, Node sidecar (deepagents/LangGraph), Vitest (node env), WebdriverIO+Tauri E2E. Monorepo: `@hip/protocol` (source-only), `@hip/sidecar`, frontend (`src/`).

**Spec:** `docs/superpowers/specs/2026-06-08-new-conversation-ux-design.md`

**Conventions / commands:**
- Frontend type-check: `yarn type-check` · Sidecar type-check: `yarn workspace @hip/sidecar type-check`
- Run one test file: `npx vitest run <path>` · Full unit suite: `yarn test`
- E2E: `yarn test:e2e` (no Rust changes here, so the existing debug bundle is reused; the webview loads live Vite, so frontend changes are picked up without rebuilding the app binary).
- `@hip/protocol` is consumed as source (`main: src/index.ts`) — no build step.
- Note on titles: the sidebar row is titled by the sidecar's existing `deriveTitle(firstMessage)` on the first turn (`session.ts:15-18,161-166`); since we commit on the first user message, rows are always titleable — no new client title code is needed.

**⚠️ Execution order:** Complete **Task 11 (i18n keys) before Tasks 7–10**. Those components call the typed `t('chat.pickFolder')` / `t('artifact.sandboxPending')` etc.; because the i18next types are derived strictly from `en`, the new keys must exist first or those tasks' `yarn type-check` step fails. (Tasks are otherwise independent and run in numeric order.)

---

### Task 1: Protocol — cwd-keyed FS messages

**Files:**
- Modify: `packages/protocol/src/index.ts`

Additive only (no existing type loosened), so both workspaces keep compiling.

- [ ] **Step 1: Add the two client messages**

In `packages/protocol/src/index.ts`, in the `ClientMessage` union, after the `fs:read` line (line 62), add:

```ts
  | { type: 'fs:lsCwd'; cwd: string; path: string }
  | { type: 'fs:readCwd'; cwd: string; path: string }
```

- [ ] **Step 2: Add the two server result messages**

In the `ServerMessage` union, after the `fs:read:result` line (line 79), add:

```ts
  | { type: 'fs:lsCwd:result'; cwd: string; path: string; entries: FsEntry[]; error?: string }
  | { type: 'fs:readCwd:result'; cwd: string; path: string; content?: string; encoding?: 'utf8' | 'base64'; mimeType?: string; truncated?: boolean; error?: string }
```

- [ ] **Step 3: Type-check both workspaces**

Run: `yarn type-check && yarn workspace @hip/sidecar type-check`
Expected: both pass (no usages yet; purely additive).

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): cwd-keyed fs:lsCwd/fs:readCwd messages for draft file trees"
```

---

### Task 2: Sidecar — scratch dir helper

**Files:**
- Create: `packages/sidecar/src/session/scratch.ts`
- Test: `packages/sidecar/src/session/scratch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/session/scratch.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { scratchDirFor, ensureScratchDir, removeScratchDir } from './scratch.js'

let root: string
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'hip-scratch-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('scratch', () => {
  it('scratchDirFor joins root + sessionId without IO', () => {
    expect(scratchDirFor('abc', root)).toBe(path.join(root, 'abc'))
  })
  it('ensureScratchDir creates the directory', () => {
    const dir = ensureScratchDir('s1', root)
    expect(existsSync(dir)).toBe(true)
  })
  it('removeScratchDir deletes it and is a no-op when absent', () => {
    const dir = ensureScratchDir('s2', root)
    removeScratchDir('s2', root)
    expect(existsSync(dir)).toBe(false)
    expect(() => removeScratchDir('never', root)).not.toThrow()
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/sidecar/src/session/scratch.test.ts`
Expected: FAIL — `Cannot find module './scratch.js'`.

- [ ] **Step 3: Implement the helper**

Create `packages/sidecar/src/session/scratch.ts`:

```ts
import { mkdirSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

/** Default per-user root for pure-chat sandbox workspaces. */
export function defaultScratchRoot(): string {
  return path.join(os.homedir(), '.hip', 'scratch')
}

/** Deterministic scratch dir path for a session (pure, no IO). */
export function scratchDirFor(sessionId: string, root: string = defaultScratchRoot()): string {
  return path.join(root, sessionId)
}

/** Create (recursively) and return the scratch dir. Synchronous so callers stay sync. */
export function ensureScratchDir(sessionId: string, root: string = defaultScratchRoot()): string {
  const dir = scratchDirFor(sessionId, root)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Best-effort removal of a session's scratch dir (no-op if absent). */
export function removeScratchDir(sessionId: string, root: string = defaultScratchRoot()): void {
  rmSync(scratchDirFor(sessionId, root), { recursive: true, force: true })
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/sidecar/src/session/scratch.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/scratch.ts packages/sidecar/src/session/scratch.test.ts
git commit -m "feat(sidecar): scratch-dir helper for pure-chat sandboxes"
```

---

### Task 2.5 note
Tasks 3 and 4 both modify `session-manager.ts`. Do Task 3 first (scratch on create), then Task 4 (cwd-keyed FS), to avoid edit conflicts.

---

### Task 3: Sidecar — scratch dir on session create/delete

**Files:**
- Modify: `packages/sidecar/src/session/session-manager.ts`
- Modify (keep existing tests green): `packages/sidecar/src/session/session-manager-fs.test.ts:19`, `packages/sidecar/src/session/session-manager-persist.test.ts`
- Test: `packages/sidecar/src/session/session-manager-scratch.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/session/session-manager-scratch.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'm', tools: [] }
let scratchRoot: string
beforeEach(() => { scratchRoot = mkdtempSync(path.join(os.tmpdir(), 'hip-scrtest-')) })
afterEach(() => { rmSync(scratchRoot, { recursive: true, force: true }) })

function mgr(): SessionManager {
  return new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), scratchRoot)
}

describe('SessionManager scratch dir', () => {
  it('derives + creates a scratch cwd for a no-cwd session and reports it via session:cwd', () => {
    const sent: ServerMessage[] = []
    mgr().handle({ type: 'session:create', id: 'chat1', config: cfg }, (m) => sent.push(m))
    const cwdMsg = sent.find((m) => m.type === 'session:cwd') as Extract<ServerMessage, { type: 'session:cwd' }>
    expect(cwdMsg).toBeDefined()
    expect(cwdMsg.cwd).toBe(path.join(scratchRoot, 'chat1'))
    expect(existsSync(path.join(scratchRoot, 'chat1'))).toBe(true)
  })
  it('does NOT create a scratch dir when a cwd is provided (project session)', () => {
    const sent: ServerMessage[] = []
    mgr().handle({ type: 'session:create', id: 'proj1', config: { ...cfg, cwd: scratchRoot } }, (m) => sent.push(m))
    expect(sent.some((m) => m.type === 'session:cwd')).toBe(false)
    expect(existsSync(path.join(scratchRoot, 'proj1'))).toBe(false)
  })
  it('removes the scratch dir on session:delete', () => {
    const m = mgr()
    m.handle({ type: 'session:create', id: 'chat2', config: cfg }, () => {})
    expect(existsSync(path.join(scratchRoot, 'chat2'))).toBe(true)
    m.handle({ type: 'session:delete', sessionId: 'chat2' }, () => {})
    expect(existsSync(path.join(scratchRoot, 'chat2'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run packages/sidecar/src/session/session-manager-scratch.test.ts`
Expected: FAIL — constructor ignores a 3rd arg; no `session:cwd` emitted on create.

- [ ] **Step 3: Implement scratch wiring in session-manager**

In `packages/sidecar/src/session/session-manager.ts`:

(a) Add the import near the top (after the `Session` import, line 3):

```ts
import { ensureScratchDir, removeScratchDir, defaultScratchRoot } from './scratch.js'
```

(b) Add the `scratchRoot` constructor param (replace the constructor at lines 18-21):

```ts
  constructor(
    private readonly store?: SessionStore,
    private readonly modelFactory: ModelFactory = () => undefined,
    private readonly scratchRoot: string = defaultScratchRoot(),
  ) {}
```

(c) Replace `createSession` (lines 93-98) with:

```ts
  private createSession(id: string, config: SessionConfig, send: SendFn): void {
    let cfg = config
    if (!cfg.cwd) cfg = { ...cfg, cwd: ensureScratchDir(id, this.scratchRoot) }
    const now = Date.now()
    this.store?.insertSession({ id, title: '新对话', config: JSON.stringify(cfg), createdAt: now, updatedAt: now })
    this.sessions.set(id, new Session(id, cfg, this.modelFactory(cfg), this.store))
    send({ type: 'session:created', sessionId: id })
    // A no-cwd (pure-chat) session got a server-derived scratch cwd — tell the client.
    if (!config.cwd) send({ type: 'session:cwd', sessionId: id, cwd: cfg.cwd! })
  }
```

(d) In the `session:delete` case (lines 58-62), add the scratch cleanup line:

```ts
      case 'session:delete':
        this.store?.deleteSession(msg.sessionId)
        this.sessions.delete(msg.sessionId)
        removeScratchDir(msg.sessionId, this.scratchRoot)
        send({ type: 'session:deleted', sessionId: msg.sessionId })
        break
```

- [ ] **Step 4: Keep existing SessionManager tests from polluting the real home dir**

These two suites create no-cwd sessions, which now create a scratch dir. Inject a tmp root.

In `packages/sidecar/src/session/session-manager-fs.test.ts`, change the `setup()` constructor (line 19) to:

```ts
  const mgr = new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), path.join(root, '.scratch'))
```

In `packages/sidecar/src/session/session-manager-persist.test.ts`, replace the imports block + `mk()` (lines 1-19) with:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { FakeListChatModel } from '@langchain/core/utils/testing'
import { mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { ServerMessage } from '@hip/protocol'
import { SessionManager } from './session-manager.js'
import { openDatabase } from '../persistence/open.js'
import { SessionStore } from '../persistence/store.js'

const cfg = { llmProvider: 'deepseek' as const, model: 'deepseek-chat', tools: [] }
function mk(scratchRoot: string) {
  const { db, ftsEnabled } = openDatabase(':memory:')
  const store = new SessionStore(db, ftsEnabled)
  const mgr = new SessionManager(store, () => new FakeListChatModel({ responses: ['ok'] }), scratchRoot)
  return { store, mgr }
}

describe('SessionManager persistence', () => {
  let store: SessionStore, mgr: SessionManager, sent: ServerMessage[], scratchRoot: string
  const send = (m: ServerMessage) => sent.push(m)
  beforeEach(() => { scratchRoot = mkdtempSync(path.join(os.tmpdir(), 'hip-scr-')); ({ store, mgr } = mk(scratchRoot)); sent = [] })
  afterEach(() => { rmSync(scratchRoot, { recursive: true, force: true }) })
```

(Leave the rest of that file's test bodies unchanged.)

- [ ] **Step 5: Run the affected sidecar tests**

Run: `npx vitest run packages/sidecar/src/session/session-manager-scratch.test.ts packages/sidecar/src/session/session-manager-fs.test.ts packages/sidecar/src/session/session-manager-persist.test.ts`
Expected: PASS (all three suites).

- [ ] **Step 6: Type-check the sidecar**

Run: `yarn workspace @hip/sidecar type-check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/session-manager-scratch.test.ts packages/sidecar/src/session/session-manager-fs.test.ts packages/sidecar/src/session/session-manager-persist.test.ts
git commit -m "feat(sidecar): bind a scratch-dir cwd for pure-chat sessions; clean up on delete"
```

---

### Task 4: Sidecar — handle cwd-keyed FS requests

**Files:**
- Modify: `packages/sidecar/src/session/session-manager.ts`
- Test: `packages/sidecar/src/session/session-manager-fs.test.ts`

- [ ] **Step 1: Write the failing tests**

In `packages/sidecar/src/session/session-manager-fs.test.ts`, add these tests inside the `describe('session-manager fs', ...)` block (after the existing `fs:read` test):

```ts
  it('fs:lsCwd lists a directory without a session', async () => {
    const { sent, send } = setup()
    await (await import('./session-manager.js'))
    const mgr2 = new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), path.join(root, '.scratch'))
    await mgr2.handleAsync({ type: 'fs:lsCwd', cwd: root, path: root }, send)
    const ls = sent.find((m) => m.type === 'fs:lsCwd:result') as Extract<ServerMessage, { type: 'fs:lsCwd:result' }>
    expect(ls.entries.some((e) => e.name === 'README.md')).toBe(true)
  })

  it('fs:readCwd reads a file without a session', async () => {
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => sent.push(m)
    const mgr2 = new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), path.join(root, '.scratch'))
    await mgr2.handleAsync({ type: 'fs:readCwd', cwd: root, path: path.join(root, 'README.md') }, send)
    const read = sent.find((m) => m.type === 'fs:readCwd:result') as Extract<ServerMessage, { type: 'fs:readCwd:result' }>
    expect(read.content).toContain('# Hi')
  })

  it('fs:lsCwd rejects a path outside the cwd', async () => {
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => sent.push(m)
    const mgr2 = new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), path.join(root, '.scratch'))
    await mgr2.handleAsync({ type: 'fs:lsCwd', cwd: root, path: '/etc' }, send)
    const ls = sent.find((m) => m.type === 'fs:lsCwd:result') as Extract<ServerMessage, { type: 'fs:lsCwd:result' }>
    expect(ls.error).toBeTruthy()
  })
```

> Simplify the first test (the stray `await import` line is unnecessary). Use:
```ts
  it('fs:lsCwd lists a directory without a session', async () => {
    const sent: ServerMessage[] = []
    const send = (m: ServerMessage) => sent.push(m)
    const mgr2 = new SessionManager(undefined, () => new FakeListChatModel({ responses: ['ok'] }), path.join(root, '.scratch'))
    await mgr2.handleAsync({ type: 'fs:lsCwd', cwd: root, path: root }, send)
    const ls = sent.find((m) => m.type === 'fs:lsCwd:result') as Extract<ServerMessage, { type: 'fs:lsCwd:result' }>
    expect(ls.entries.some((e) => e.name === 'README.md')).toBe(true)
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run packages/sidecar/src/session/session-manager-fs.test.ts`
Expected: FAIL — no `fs:lsCwd:result` / `fs:readCwd:result` emitted.

- [ ] **Step 3: Implement the cwd-keyed FS handlers**

In `packages/sidecar/src/session/session-manager.ts`:

(a) Add `FsEntry` to the protocol import (line 1) and import workspace-fs (after the scratch import added in Task 3):

```ts
import type { ClientMessage, ServerMessage, SessionConfig, FsEntry } from '@hip/protocol'
```
```ts
import * as workspaceFs from './workspace-fs.js'
```

(b) Add two `case`s to the `handleAsync` switch (after the existing `fs:read` case, before the closing `}` of the switch):

```ts
      case 'fs:lsCwd': {
        const r = await this.lsCwd(msg.cwd, msg.path)
        send({ type: 'fs:lsCwd:result', cwd: msg.cwd, path: msg.path, entries: r.entries ?? [], error: r.error })
        break
      }
      case 'fs:readCwd': {
        const r = await this.readCwd(msg.cwd, msg.path)
        send(
          'error' in r
            ? { type: 'fs:readCwd:result', cwd: msg.cwd, path: msg.path, error: r.error }
            : { type: 'fs:readCwd:result', cwd: msg.cwd, path: msg.path, content: r.content, encoding: r.encoding, mimeType: r.mimeType, truncated: r.truncated },
        )
        break
      }
```

(c) Add the two private helpers (e.g. just below `ensureSession`):

```ts
  /** List a directory keyed by a raw cwd (for un-committed drafts — no session needed). */
  private async lsCwd(cwd: string, p: string): Promise<{ entries?: FsEntry[]; error?: string }> {
    try { return { entries: await workspaceFs.lsDir(cwd, p) } }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  }

  /** Read a file for preview keyed by a raw cwd (draft). */
  private async readCwd(cwd: string, p: string): Promise<workspaceFs.PreviewResult> {
    try { return await workspaceFs.readForPreview(cwd, p) }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) } }
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run packages/sidecar/src/session/session-manager-fs.test.ts`
Expected: PASS (original 3 + new 3).

- [ ] **Step 5: Type-check the sidecar**

Run: `yarn workspace @hip/sidecar type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/session-manager-fs.test.ts
git commit -m "feat(sidecar): serve fs:lsCwd/fs:readCwd directly from workspace-fs (draft trees)"
```

---

### Task 5: Frontend — draftStore

**Files:**
- Create: `src/store/draftStore.ts`
- Test: `src/store/draftStore.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/store/draftStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useDraftStore } from './draftStore'

beforeEach(() => useDraftStore.setState({ draft: null }))

describe('draftStore', () => {
  it('ensureDraft creates a singleton chat draft and returns the same on repeat', () => {
    const a = useDraftStore.getState().ensureDraft()
    const b = useDraftStore.getState().ensureDraft()
    expect(a.tempId).toBe(b.tempId)
    expect(a.mode).toBe('chat')
  })
  it('setText updates the draft text', () => {
    useDraftStore.getState().ensureDraft()
    useDraftStore.getState().setText('hello')
    expect(useDraftStore.getState().draft?.text).toBe('hello')
  })
  it('pickProject sets project mode + cwd (creating a draft if none)', () => {
    useDraftStore.getState().pickProject('/proj')
    expect(useDraftStore.getState().draft).toMatchObject({ mode: 'project', cwd: '/proj' })
  })
  it('clearProject reverts to chat mode', () => {
    useDraftStore.getState().pickProject('/proj')
    useDraftStore.getState().clearProject()
    expect(useDraftStore.getState().draft).toMatchObject({ mode: 'chat', cwd: undefined })
  })
  it('reset clears the draft', () => {
    useDraftStore.getState().ensureDraft()
    useDraftStore.getState().reset()
    expect(useDraftStore.getState().draft).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/store/draftStore.test.ts`
Expected: FAIL — `Cannot find module './draftStore'`.

- [ ] **Step 3: Implement the store**

Create `src/store/draftStore.ts`:

```ts
import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { nanoid } from 'nanoid'

export interface Draft {
  tempId: string
  mode: 'project' | 'chat'
  cwd?: string
  text: string
}

interface DraftStore {
  draft: Draft | null
  ensureDraft: () => Draft
  setText: (text: string) => void
  pickProject: (cwd: string) => void
  clearProject: () => void
  reset: () => void
}

// In-memory fallback so node test runs (no localStorage/DOM) don't crash on persist.
function memoryStorage(): StateStorage {
  const m: Record<string, string> = {}
  return {
    getItem: (k) => (k in m ? m[k] : null),
    setItem: (k, v) => { m[k] = v },
    removeItem: (k) => { delete m[k] },
  }
}

const storage = createJSONStorage<{ draft: Draft | null }>(() =>
  typeof localStorage !== 'undefined' ? localStorage : memoryStorage(),
)

export const useDraftStore = create<DraftStore>()(
  persist(
    (set, get) => ({
      draft: null,
      ensureDraft: () => {
        const cur = get().draft
        if (cur) return cur
        const d: Draft = { tempId: nanoid(), mode: 'chat', text: '' }
        set({ draft: d })
        return d
      },
      setText: (text) => set((s) => (s.draft ? { draft: { ...s.draft, text } } : s)),
      pickProject: (cwd) =>
        set((s) => {
          const base: Draft = s.draft ?? { tempId: nanoid(), mode: 'chat', text: '' }
          return { draft: { ...base, mode: 'project', cwd } }
        }),
      clearProject: () => set((s) => (s.draft ? { draft: { ...s.draft, mode: 'chat', cwd: undefined } } : s)),
      reset: () => set({ draft: null }),
    }),
    { name: 'hip-draft', storage, partialize: (s) => ({ draft: s.draft }) },
  ),
)
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/store/draftStore.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Type-check the frontend**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/store/draftStore.ts src/store/draftStore.test.ts
git commit -m "feat(store): persisted single-draft store for new conversations"
```

---

### Task 6: Frontend — sessionService commit + draft FS + deselect

**Files:**
- Modify: `src/domain/sessionStore.ts` (add `deselect`)
- Modify: `src/domain/sessionService.ts`
- Test: `src/domain/sessionService.test.ts`

- [ ] **Step 1: Write the failing tests**

In `src/domain/sessionService.test.ts`:

(a) Add an import at the top:

```ts
import { useDraftStore } from '@/store/draftStore'
```

(b) In `beforeEach` (after the `useFsStore.setState(...)` line, line 28), reset the draft:

```ts
  useDraftStore.setState({ draft: null })
```

(c) Add these tests inside `describe('SessionService', ...)`:

```ts
  it('commits a project draft on first send: session:create with cwd, then message:send, draft cleared', () => {
    useDomainStore.setState({ activeSessionId: null })
    useDraftStore.setState({ draft: { tempId: 'd1', mode: 'project', cwd: '/proj', text: '' } })
    const t = new FakeTransport()
    new SessionService(t).sendMessage('hello')
    const create = t.sent.find((m) => m.type === 'session:create') as Extract<ClientMessage, { type: 'session:create' }>
    expect(create.config.cwd).toBe('/proj')
    expect(t.sent.at(-1)).toMatchObject({ type: 'message:send', content: 'hello' })
    expect(useDraftStore.getState().draft).toBeNull()
    expect(useDomainStore.getState().activeSessionId).toBe(create.id)
  })

  it('commits a chat draft with no cwd in the config', () => {
    useDomainStore.setState({ activeSessionId: null })
    useDraftStore.setState({ draft: { tempId: 'd2', mode: 'chat', text: '' } })
    const t = new FakeTransport()
    new SessionService(t).sendMessage('hi there')
    const create = t.sent.find((m) => m.type === 'session:create') as Extract<ClientMessage, { type: 'session:create' }>
    expect(create.config.cwd).toBeUndefined()
  })

  it('lsDraft sends fs:lsCwd', () => {
    const t = new FakeTransport()
    new SessionService(t).lsDraft('/proj', '/proj/src')
    expect(t.sent.at(-1)).toMatchObject({ type: 'fs:lsCwd', cwd: '/proj', path: '/proj/src' })
  })

  it('readDraftFile marks preview loading (keyed by cwd) and sends fs:readCwd', () => {
    const t = new FakeTransport()
    new SessionService(t).readDraftFile('/proj', '/proj/a.md')
    expect(useFsStore.getState().bySession['/proj'].preview).toMatchObject({ status: 'loading', path: '/proj/a.md' })
    expect(t.sent.at(-1)).toMatchObject({ type: 'fs:readCwd', cwd: '/proj', path: '/proj/a.md' })
  })

  it('fs:lsCwd:result populates entries under the cwd key', () => {
    const t = new FakeTransport()
    new SessionService(t)
    t.push({ type: 'fs:lsCwd:result', cwd: '/proj', path: '/proj', entries: [{ name: 'a.md', path: '/proj/a.md', isDir: false }] })
    expect(useFsStore.getState().bySession['/proj'].entriesByDir['/proj']).toHaveLength(1)
  })

  it('newConversation ensures a draft and deselects the active session', () => {
    useDomainStore.setState({ activeSessionId: 's1' })
    const t = new FakeTransport()
    new SessionService(t).newConversation()
    expect(useDomainStore.getState().activeSessionId).toBeNull()
    expect(useDraftStore.getState().draft).not.toBeNull()
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/domain/sessionService.test.ts`
Expected: FAIL — `lsDraft`/`readDraftFile`/`newConversation` undefined; no commit path.

- [ ] **Step 3: Add `deselect` to the domain store**

In `src/domain/sessionStore.ts`:

(a) In the `DomainStore` interface (after `selectSession`, line ~184), add:

```ts
  deselect: () => void
```

(b) In the store implementation (after `selectSession: (id) => set({ activeSessionId: id }),`, line 211), add:

```ts
  deselect: () => set({ activeSessionId: null }),
```

- [ ] **Step 4: Implement commit + draft FS + newConversation in sessionService**

In `src/domain/sessionService.ts`:

(a) Add the import (after the `useFsStore` import, line 8):

```ts
import { useDraftStore } from '@/store/draftStore'
```

(b) In `receive()` (after the `fs:read:result` branch, before the `message:complete` branch), add:

```ts
    } else if (msg.type === 'fs:lsCwd:result') {
      useFsStore.getState().setEntries(msg.cwd, msg.path, msg.entries)
    } else if (msg.type === 'fs:readCwd:result') {
      useFsStore.getState().setPreview(msg.cwd, {
        status: 'ready', path: msg.path, content: msg.content, encoding: msg.encoding, mimeType: msg.mimeType, truncated: msg.truncated, error: msg.error,
      })
```

(c) Replace `sendMessage` (lines 106-116) with the commit-aware version:

```ts
  sendMessage(content: string): void {
    const text = content.trim()
    if (!text) return
    let { activeSessionId } = useDomainStore.getState()
    if (!activeSessionId) {
      // Commit the draft: create a real (persisted) session, then send.
      const draft = useDraftStore.getState().draft
      const config: SessionConfig =
        draft?.mode === 'project' && draft.cwd ? { ...DEFAULT_CONFIG, cwd: draft.cwd } : DEFAULT_CONFIG
      activeSessionId = this.createSession(config)
      if (draft?.cwd) useFsStore.getState().clearSession(draft.cwd)
      useDraftStore.getState().reset()
    }
    const id = nanoid()
    useDomainStore.getState().appendUserMessage(activeSessionId, id, text)
    this.transport.send({ type: 'message:send', sessionId: activeSessionId, id, content: text, role: 'user' })
  }
```

(d) Add three methods (e.g. after `readFile`, around line 100):

```ts
  /** Start a fresh new-conversation draft (no committed session yet). */
  newConversation(): void {
    useDraftStore.getState().ensureDraft()
    useDomainStore.getState().deselect()
  }

  /** List a directory for an un-committed draft (cwd-keyed, no session). */
  lsDraft(cwd: string, path: string): void {
    this.transport.send({ type: 'fs:lsCwd', cwd, path })
  }

  /** Read a file for an un-committed draft (cwd-keyed). Preview is keyed by cwd. */
  readDraftFile(cwd: string, path: string): void {
    useFsStore.getState().setPreview(cwd, { status: 'loading', path })
    this.transport.send({ type: 'fs:readCwd', cwd, path })
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/domain/sessionService.test.ts`
Expected: PASS (existing + 6 new). The existing `sendMessage optimistically appends...` test still passes because its `beforeEach` sets `activeSessionId: 's1'` (commit branch skipped).

- [ ] **Step 6: Type-check the frontend**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/sessionStore.ts src/domain/sessionService.ts src/domain/sessionService.test.ts
git commit -m "feat(domain): commit drafts on first send; cwd-keyed draft FS; deselect/newConversation"
```

---

### Task 7: Frontend — fs scope + draft-aware FileTree/FilePreview

**Files:**
- Create: `src/store/useFsScope.ts`
- Modify: `src/components/artifact/FileTree.tsx`
- Modify: `src/components/artifact/FilePreview.tsx`

No unit test (node test env has no DOM; components are covered by the Task 12 E2E). Verified by type-check here.

- [ ] **Step 1: Create the scope hook**

Create `src/store/useFsScope.ts`:

```ts
import { useActiveSession } from '@/domain'
import { useDraftStore } from '@/store/draftStore'

/**
 * The current filesystem scope for the Files panel:
 * - a committed session (keyed by session id, root = its cwd), or
 * - a project-mode draft (keyed by cwd, root = cwd, served via cwd-keyed FS), or
 * - none (chat-mode draft pre-commit, or nothing selected).
 */
export interface FsScope {
  scopeId: string | null
  cwd?: string
  isDraft: boolean
  chatDraft: boolean
}

export function useFsScope(): FsScope {
  const active = useActiveSession()
  const draft = useDraftStore((s) => s.draft)
  if (active) return { scopeId: active.id, cwd: active.config.cwd, isDraft: false, chatDraft: false }
  if (draft?.mode === 'project' && draft.cwd) return { scopeId: draft.cwd, cwd: draft.cwd, isDraft: true, chatDraft: false }
  return { scopeId: null, cwd: undefined, isDraft: false, chatDraft: draft?.mode === 'chat' }
}
```

- [ ] **Step 2: Rewrite FileTree to be scope-aware**

Replace the entire contents of `src/components/artifact/FileTree.tsx` with:

```tsx
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ChevronDown, File, Folder, FolderOpen, FolderGit2, RefreshCw } from 'lucide-react'
import type { FsEntry } from '@hip/protocol'
import { useActiveSession, sessionService } from '@/domain'
import { useFsStore } from '@/store/fsStore'
import { useFsScope } from '@/store/useFsScope'
import { useDraftStore } from '@/store/draftStore'
import { pickDirectory } from '@/ipc/dialog'
import { cn } from '@/lib/utils'

function basename(p: string): string {
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

function Node({ entry, scopeId, isDraft, depth }: { entry: FsEntry; scopeId: string; isDraft: boolean; depth: number }) {
  const open = useFsStore((s) => !!s.bySession[scopeId]?.expanded[entry.path])
  const active = useFsStore((s) => s.bySession[scopeId]?.activePath === entry.path)
  const children = useFsStore((s) => s.bySession[scopeId]?.entriesByDir[entry.path])

  const onClick = () => {
    if (entry.isDir) {
      useFsStore.getState().toggleExpanded(scopeId, entry.path)
      if (!children) (isDraft ? sessionService.lsDraft(scopeId, entry.path) : sessionService.lsDir(scopeId, entry.path))
    } else {
      useFsStore.getState().setActive(scopeId, entry.path)
      if (isDraft) sessionService.readDraftFile(scopeId, entry.path)
      else sessionService.readFile(scopeId, entry.path)
    }
  }

  return (
    <div>
      <div
        data-testid="tree-entry"
        data-path={entry.path}
        onClick={onClick}
        className={cn(
          'flex cursor-pointer items-center gap-1.5 rounded-md py-1 pr-2 text-[13px] transition-colors',
          active ? 'bg-accent-subtle text-accent' : 'text-ink hover:bg-surface-muted',
        )}
        style={{ paddingLeft: depth * 14 + 6 }}
      >
        {entry.isDir
          ? open ? <ChevronDown size={14} className="text-ink-tertiary" /> : <ChevronRight size={14} className="text-ink-tertiary" />
          : <span className="w-3.5" />}
        {entry.isDir
          ? open ? <FolderOpen size={15} className="text-accent" /> : <Folder size={15} className="text-accent" />
          : <File size={15} className="text-ink-tertiary" />}
        <span className="truncate">{entry.name}</span>
      </div>
      {entry.isDir && open && children?.map((c) => <Node key={c.path} entry={c} scopeId={scopeId} isDraft={isDraft} depth={depth + 1} />)}
    </div>
  )
}

export function FileTree() {
  const { t } = useTranslation()
  const active = useActiveSession()
  const { scopeId, cwd, isDraft, chatDraft } = useFsScope()
  const rootEntries = useFsStore((s) => (scopeId && cwd ? s.bySession[scopeId]?.entriesByDir[cwd] : undefined))

  // Load the root listing once a workspace is bound and not yet cached.
  useEffect(() => {
    if (scopeId && cwd && !rootEntries) {
      if (isDraft) sessionService.lsDraft(scopeId, cwd)
      else sessionService.lsDir(scopeId, cwd)
    }
  }, [scopeId, cwd, isDraft, rootEntries])

  const choose = async () => {
    const dir = await pickDirectory()
    if (!dir) return
    if (active) sessionService.setProjectDir(active.id, dir)
    else useDraftStore.getState().pickProject(dir)
  }

  if (!cwd) {
    if (chatDraft) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-ink-tertiary" data-testid="file-tree">
          <Folder size={32} className="opacity-40" />
          <div className="max-w-[220px] text-[13px]">{t('artifact.sandboxPending')}</div>
        </div>
      )
    }
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-ink-tertiary" data-testid="file-tree">
        <Folder size={32} className="opacity-40" />
        <div className="max-w-[200px] text-[13px]">{t('artifact.selectFolderDesc')}</div>
        <button
          data-testid="select-folder"
          onClick={choose}
          className="rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover"
        >
          {t('artifact.selectFolder')}
        </button>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col" data-testid="file-tree">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border px-2">
        <span className="flex items-center gap-1.5 truncate text-[12px] font-medium text-ink-secondary" title={cwd}>
          <FolderGit2 size={13} className="shrink-0 text-ink-tertiary" />
          {basename(cwd)}
        </span>
        <div className="flex items-center gap-0.5">
          <button
            title={t('artifact.refresh')}
            data-testid="refresh-tree"
            onClick={() => scopeId && (isDraft ? sessionService.lsDraft(scopeId, cwd) : sessionService.lsDir(scopeId, cwd))}
            className="rounded p-1 text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <RefreshCw size={13} />
          </button>
          <button
            title={t('artifact.changeFolder')}
            onClick={choose}
            className="rounded p-1 text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
          >
            <Folder size={13} />
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto py-1">
        {scopeId && rootEntries?.map((e) => <Node key={e.path} entry={e} scopeId={scopeId} isDraft={isDraft} depth={0} />)}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Point FilePreview at the scope**

In `src/components/artifact/FilePreview.tsx`:

(a) Replace the `useActiveSession` import (line 3) with:

```ts
import { useFsScope } from '@/store/useFsScope'
```

(b) Replace the `sessionId` line (line 36) with:

```ts
  const sessionId = useFsScope().scopeId
```

- [ ] **Step 4: Type-check the frontend**

Run: `yarn type-check`
Expected: PASS. (Note: `artifact.sandboxPending` is added in Task 11 — if type-check flags the missing i18n key, do Task 11 first or add the key now. To keep this task green standalone, add the key in all three locale files as part of this step if needed.)

- [ ] **Step 5: Commit**

```bash
git add src/store/useFsScope.ts src/components/artifact/FileTree.tsx src/components/artifact/FilePreview.tsx
git commit -m "feat(artifact): draft-aware FileTree/FilePreview via useFsScope (cwd-keyed)"
```

---

### Task 8: Frontend — extract Composer; refactor InputBar

**Files:**
- Create: `src/components/chat/Composer.tsx`
- Modify: `src/components/chat/InputBar.tsx`

Verified by type-check + Task 12 E2E.

- [ ] **Step 1: Create the shared Composer**

Create `src/components/chat/Composer.tsx`:

```tsx
import { useTranslation } from 'react-i18next'
import { ArrowUp } from 'lucide-react'
import { Textarea } from '@/components/ui/Textarea'

const ACTIVE_MODEL = 'deepseek-chat'

export function Composer({
  value,
  onChange,
  onSubmit,
  autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  autoFocus?: boolean
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
        <button
          onClick={onSubmit}
          disabled={!value.trim()}
          data-testid="composer-send"
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          title={t('chat.send')}
        >
          <ArrowUp size={17} />
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Slim InputBar down to a Composer wrapper**

Replace the entire contents of `src/components/chat/InputBar.tsx` with:

```tsx
import { useState } from 'react'
import { Composer } from './Composer'
import { sessionService } from '@/domain'

export function InputBar() {
  const [value, setValue] = useState('')
  const submit = () => {
    const text = value.trim()
    if (!text) return
    sessionService.sendMessage(text)
    setValue('')
  }
  return (
    <div className="shrink-0 px-5 pb-5">
      <div className="mx-auto max-w-3xl">
        <Composer value={value} onChange={setValue} onSubmit={submit} />
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Type-check the frontend**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/Composer.tsx src/components/chat/InputBar.tsx
git commit -m "refactor(chat): extract shared Composer; InputBar reuses it"
```

---

### Task 9: Frontend — NewConversation landing + FolderPill

**Files:**
- Create: `src/components/chat/FolderPill.tsx`
- Create: `src/components/chat/NewConversation.tsx`

Verified by type-check + Task 12 E2E.

- [ ] **Step 1: Create the FolderPill**

Create `src/components/chat/FolderPill.tsx`:

```tsx
import { Folder } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useDraftStore } from '@/store/draftStore'
import { useUiStore } from '@/store/uiStore'
import { pickDirectory } from '@/ipc/dialog'

function basename(p: string): string {
  const a = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return a[a.length - 1] || p
}

export function FolderPill() {
  const { t } = useTranslation()
  const draft = useDraftStore((s) => s.draft)
  const bound = draft?.mode === 'project' && draft.cwd ? draft.cwd : null

  const pick = async () => {
    const dir = await pickDirectory()
    if (!dir) return
    useDraftStore.getState().pickProject(dir)
    // "pick a folder → Files panel opens" (D1)
    useUiStore.getState().setPanelOpen(true)
    useUiStore.getState().setTab('files')
  }

  if (bound) {
    return (
      <div className="flex items-center gap-2 text-[12px] text-ink-secondary">
        <button
          onClick={pick}
          data-testid="pick-folder"
          title={bound}
          className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 hover:bg-surface-muted"
        >
          <Folder size={13} className="text-accent" />
          {basename(bound)}
        </button>
        <button onClick={() => useDraftStore.getState().clearProject()} className="text-ink-tertiary hover:text-ink">
          {t('chat.clearFolder')}
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={pick}
      data-testid="pick-folder"
      className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-[12px] text-ink-secondary hover:bg-surface-muted"
    >
      <Folder size={13} className="text-ink-tertiary" />
      {t('chat.pickFolder')}
      <span className="text-ink-tertiary">· {t('chat.orJustChat')}</span>
    </button>
  )
}
```

- [ ] **Step 2: Create the NewConversation landing**

Create `src/components/chat/NewConversation.tsx`:

```tsx
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useDraftStore } from '@/store/draftStore'
import { sessionService } from '@/domain'
import { Composer } from './Composer'
import { FolderPill } from './FolderPill'

export function NewConversation() {
  const { t } = useTranslation()
  const draft = useDraftStore((s) => s.draft)
  const text = draft?.text ?? ''

  // Ensure a draft exists so the composer text binds + persists.
  useEffect(() => { useDraftStore.getState().ensureDraft() }, [])

  const submit = () => {
    const tx = text.trim()
    if (!tx) return
    sessionService.sendMessage(tx) // commit: creates the session + resets the draft
  }

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-5" data-testid="new-conversation">
      <div className="mt-[20vh] w-full max-w-3xl">
        <h1 className="mb-4 text-center text-[20px] font-semibold text-ink">{t('chat.newConversationGreeting')}</h1>
        <Composer value={text} onChange={(v) => useDraftStore.getState().setText(v)} onSubmit={submit} autoFocus />
        <div className="mt-2 flex justify-center">
          <FolderPill />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Type-check the frontend**

Run: `yarn type-check`
Expected: PASS (i18n keys land in Task 11; if flagged, add them now or do Task 11 first).

- [ ] **Step 4: Commit**

```bash
git add src/components/chat/FolderPill.tsx src/components/chat/NewConversation.tsx
git commit -m "feat(chat): centered NewConversation landing with folder pill"
```

---

### Task 10: Frontend — wire NewChatButton + AppLayout

**Files:**
- Modify: `src/components/sidebar/NewChatButton.tsx`
- Modify: `src/routes/AppLayout.tsx`

Verified by type-check + Task 12 E2E.

- [ ] **Step 1: NewChatButton starts a draft**

In `src/components/sidebar/NewChatButton.tsx`, replace the `onClick` (line 9):

```tsx
      onClick={() => sessionService.newConversation()}
```

- [ ] **Step 2: AppLayout renders the landing when no session is active**

In `src/routes/AppLayout.tsx`:

(a) `sessionService` is already imported at line 4. Change that import to also pull in `useActiveSessionId`, and add the `NewConversation` import:

```ts
import { sessionService, useActiveSessionId } from '@/domain'
import { NewConversation } from '@/components/chat/NewConversation'
```

(b) Add the selector inside the component (with the other `useUiStore` selectors, ~line 19):

```ts
  const activeSessionId = useActiveSessionId()
```

(c) Replace the center Panel body (lines 74-80) with:

```tsx
        <Panel minSize={34}>
          <div className="flex h-full flex-col bg-surface">
            <ChatHeader />
            {activeSessionId == null ? (
              <NewConversation />
            ) : (
              <>
                <ChatPane />
                <InputBar />
              </>
            )}
          </div>
        </Panel>
```

- [ ] **Step 3: Type-check the frontend**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/NewChatButton.tsx src/routes/AppLayout.tsx
git commit -m "feat(app): show centered NewConversation landing for new chats; New Chat starts a draft"
```

---

### Task 11: Frontend — i18n keys (3 locales)

**Files:**
- Modify: `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`

Types derive from `en`, so all three must carry the same keys or type-check fails. Purely additive.

- [ ] **Step 1: Add keys to `en.ts`**

In `src/i18n/en.ts`, in the `chat` block (after `errorGeneric`/`openSettings`), add:

```ts
      newConversationGreeting: 'What are we building?',
      pickFolder: 'Choose project folder',
      orJustChat: 'or just chat (sandbox)',
      clearFolder: 'Pure chat',
```

In the `artifact` block (after `loading`), add:

```ts
      sandboxPending: 'A sandbox workspace is created when you send the first message',
```

- [ ] **Step 2: Add the same keys to `zh-CN.ts`**

`chat`:

```ts
      newConversationGreeting: '我们来做点什么？',
      pickFolder: '选择项目文件夹',
      orJustChat: '或直接对话（沙箱）',
      clearFolder: '纯对话',
```

`artifact`:

```ts
      sandboxPending: '发送第一条消息后将创建沙箱工作区',
```

- [ ] **Step 3: Add the same keys to `zh-TW.ts`**

`chat`:

```ts
      newConversationGreeting: '我們來做點什麼？',
      pickFolder: '選擇專案資料夾',
      orJustChat: '或直接對話（沙箱）',
      clearFolder: '純對話',
```

`artifact`:

```ts
      sandboxPending: '傳送第一則訊息後將建立沙箱工作區',
```

- [ ] **Step 4: Type-check + run unit suite**

Run: `yarn type-check && yarn test`
Expected: both PASS (all unit tests green across frontend + sidecar).

- [ ] **Step 5: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat(i18n): new-conversation + sandbox-pending strings (en/zh-CN/zh-TW)"
```

---

### Task 12: E2E — new-conversation real-machine flow

**Files:**
- Modify: `src/components/sidebar/SessionItem.tsx` (add a testid)
- Replace: `e2e/specs/project-workspace.spec.ts` → rewrite for the new flow
- Reuse: `e2e/fixtures/sample-project/` (README.md, index.html, logo.png, src/a.ts)

- [ ] **Step 1: Add a stable testid to SessionItem**

In `src/components/sidebar/SessionItem.tsx`, add `data-testid="session-item"` to the trigger `div` (line 50, the `<div onClick={editing ? undefined : onSelect} ...>`):

```tsx
        <div
          data-testid="session-item"
          onClick={editing ? undefined : onSelect}
```

- [ ] **Step 2: Rewrite the E2E spec for the new flow**

Replace the entire contents of `e2e/specs/project-workspace.spec.ts` with:

```ts
import { expect } from 'expect-webdriverio'
import * as path from 'node:path'

const FIXTURE = path.resolve('e2e/fixtures/sample-project')
const entry = (suffix: string) => browser.$(`[data-testid="tree-entry"][data-path$="${suffix}"]`)
const sessionItems = () => browser.$$('[data-testid="session-item"]')

describe('new conversation', () => {
  before(async () => {
    await browser.pause(2500)
    const skip = await browser.$('button=跳过登录')
    if (await skip.isExisting()) {
      await browser.execute((el: HTMLElement) => el.click(), (await skip) as unknown as HTMLElement)
      await browser.waitUntil(async () => (await browser.getUrl()).includes('#/app'), { timeout: 10000, interval: 200 })
    }
    // Seam: native folder dialog can't be driven by wdio — return the fixture path.
    await browser.execute((dir: string) => {
      ;(window as unknown as { __hipPickDir?: () => Promise<string> }).__hipPickDir = () => Promise.resolve(dir)
    }, FIXTURE)
  })

  it('a new chat shows the centered composer landing', async () => {
    // The sidecar cold-starts (tsx compiles on first launch); wsClient buffers sends
    // until connected, so we wait generously for the first paint.
    await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ timeout: 120000 })
    expect(await (await browser.$('[data-testid="pick-folder"]')).isExisting()).toBe(true)
  })

  it('picking a folder opens the tree without creating a sidebar row', async () => {
    const before = (await sessionItems()).length
    await (await browser.$('[data-testid="pick-folder"]')).click()
    await (await entry('/README.md')).waitForExist({ timeout: 60000 })
    expect((await sessionItems()).length).toBe(before) // still a draft — no row
  })

  it('renders a Markdown preview (rendered, not source)', async () => {
    await (await entry('/README.md')).click()
    const md = await browser.$('[data-testid="preview-markdown"]')
    await md.waitForExist({ timeout: 30000 })
    await browser.waitUntil(async () => (await md.getText()).includes('Sample Project'), { timeout: 10000, interval: 500 })
  })

  it('renders HTML in a sandboxed iframe', async () => {
    await (await entry('/index.html')).click()
    const frame = await browser.$('[data-testid="preview-html"]')
    await frame.waitForExist({ timeout: 30000 })
    expect(await frame.getAttribute('sandbox')).toBe('')
  })

  it('renders an image as a data URL', async () => {
    await (await entry('/logo.png')).click()
    const img = await browser.$('[data-testid="preview-image"] img')
    await img.waitForExist({ timeout: 30000 })
    await browser.waitUntil(async () => ((await img.getAttribute('src')) ?? '').includes('data:image/png;base64,'), { timeout: 10000, interval: 500 })
  })

  it('lazily expands a directory and previews a text file', async () => {
    await (await entry('/src')).click()
    await (await entry('/a.ts')).waitForExist({ timeout: 30000 })
    await (await entry('/a.ts')).click()
    const txt = await browser.$('[data-testid="preview-text"]')
    await txt.waitForExist({ timeout: 30000 })
    await browser.waitUntil(async () => (await txt.getText()).includes('export const a'), { timeout: 10000, interval: 500 })
  })

  it('sending the first message commits the session and replaces the landing', async () => {
    const before = (await sessionItems()).length
    const ta = await browser.$('[data-testid="new-conversation"] textarea')
    await ta.setValue('hello world')
    await (await browser.$('[data-testid="new-conversation"] [data-testid="composer-send"]')).click()
    // Landing disappears (a committed session is now active)…
    await (await browser.$('[data-testid="new-conversation"]')).waitForExist({ reverse: true, timeout: 30000 })
    // …and exactly one sidebar row appears.
    await browser.waitUntil(async () => (await sessionItems()).length === before + 1, { timeout: 30000, interval: 500 })
  })
})
```

- [ ] **Step 3: Run the E2E suite on the real app**

No Rust changes, so the existing debug bundle is reused (the webview loads live Vite). If the app binary does not yet exist, build it once: `yarn tauri build --debug`.

Run: `yarn test:e2e`
Expected: PASS (7 tests). If a sidecar from a prior run is holding the SQLite lock, kill stray `node --import tsx packages/sidecar/src/main.ts` processes first (known leaky-sidecar gap).

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/SessionItem.tsx e2e/specs/project-workspace.spec.ts
git commit -m "test(e2e): new-conversation flow (landing, draft tree, commit-on-send)"
```

---

### Task 13: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Frontend type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 2: Sidecar type-check**

Run: `yarn workspace @hip/sidecar type-check`
Expected: PASS.

- [ ] **Step 3: Full unit suite**

Run: `yarn test`
Expected: PASS (all files — existing + new draftStore/scratch/cwd-FS/commit tests).

- [ ] **Step 4: E2E**

Run: `yarn test:e2e`
Expected: PASS (7 tests).

- [ ] **Step 5: Manual GUI smoke (live-LLM path, per project convention)**

Launch the app, start a new chat, confirm: centered composer; pick a folder → Files panel opens with the tree, no sidebar row; type a message → row appears, composer docks to the bottom; reload the window with an unsent draft (text + folder) → draft restored; pure-chat send → a session commits and its scratch tree is browsable.

---

## Self-Review

**Spec coverage:**
- G1 start-time directory choice → Tasks 9 (FolderPill) + 7 (draft tree) + 3 (scratch for pure-chat). ✓
- G2 no empty sidebar row → Tasks 5/6 (draft + commit-on-send) + 10 (landing) + 12 (E2E asserts no row pre-send). ✓
- G3 centered composer → Tasks 8/9/10. ✓
- D1 composer+pill → Tasks 9/10. ✓  D2 lazy materialize → Tasks 6/10. ✓  D3 persist draft → Task 5 (persist middleware) + Task 12/13 reload check. ✓  D4 scratch+tree → Tasks 3/7. ✓  D5 greeting only → Task 9 (no chips). ✓
- Approach A (cwd-keyed FS, no server session until commit) → Tasks 1/4/6/7. ✓
- Edge: chat-draft "sandbox pending" placeholder → Task 7 + key in Task 11. ✓  Title fallback → covered by existing sidecar `deriveTitle` (documented; no task). ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code. (Task 4 Step 1 includes a corrected snippet replacing a stray `await import` line — use the corrected version.)

**Type consistency:** `Draft`/`DraftStore`, `useFsScope`/`FsScope`, `scratchDirFor`/`ensureScratchDir`/`removeScratchDir`/`defaultScratchRoot`, `lsDraft`/`readDraftFile`/`newConversation`/`deselect`, `fs:lsCwd`/`fs:readCwd` (+`:result`), `Composer({value,onChange,onSubmit,autoFocus})`, testids `new-conversation`/`pick-folder`/`composer-send`/`session-item` — all consistent across tasks.
