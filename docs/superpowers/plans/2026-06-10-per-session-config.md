# Per-Session Config (Slice 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore persisted session config on reload (bug fix), and let users attach per-conversation instructions ("styles") that append to the supervisor prompt, picked from a reusable local library.

**Architecture:** Two parts share `@hip/protocol` but touch disjoint message types. Part 1 (`session:loaded.config`) is a 3-file correctness fix. Part 2 clones the proven `session:setThinking` mutation path end to end: client message → idle-guarded `Session` setter → `store.updateConfig` persist → server echo of the REAL state → reducer folds it into `config`. The preset library is a pure `localStorage` zustand store (copy of `draftStore`'s persist setup); the sidecar only ever sees resolved instruction text.

**Tech Stack:** TypeScript monorepo (yarn workspaces). Sidecar: Node + better-sqlite3 + deepagents/langchain. Frontend: React + Zustand + radix UI + react-i18next. Tests: vitest (root `yarn test <path>`). No DOM/RTL tests — presentational changes are type-check + manual GUI acceptance per project convention.

**Conventions:**
- Run a single test file with `yarn test <path>` from the repo root (vitest covers all workspaces). There is **no** `yarn workspace @hip/sidecar test` script.
- Type-check: `yarn type-check`. Build: `yarn build`.
- Commit trailer (every commit): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Live-DeepSeek integration tests are flaky-tolerated (network), not a deterministic gate.

---

## File Structure

| File | Responsibility | Part |
|---|---|---|
| `packages/protocol/src/index.ts` | `session:loaded.config?`; `session:setSystemPrompt`; `session:systemPrompt` | 1+2 |
| `packages/sidecar/src/session/agents.ts` | `buildSupervisorPrompt(cwd, userInstructions?)` appends instructions | 2 |
| `packages/sidecar/src/session/session.ts` | `buildAgent` composes; `setSystemPrompt` setter | 2 |
| `packages/sidecar/src/session/session-manager.ts` | `session:load` returns config; `session:setSystemPrompt` handler | 1+2 |
| `src/domain/sessionStore.ts` | reducer: `session:loaded` adopts config; `session:systemPrompt` case | 1+2 |
| `src/domain/sessionService.ts` | `setSystemPrompt` method | 2 |
| `src/store/stylesStore.ts` (new) | `localStorage` preset library | 2 |
| `src/lib/styles.ts` (new) | `resolveStyleLabel` pure helper | 2 |
| `src/components/chat/Composer.tsx` | `leftSlot` prop | 2 |
| `src/components/chat/InputBar.tsx` | render `<StylePicker/>` into `leftSlot` | 2 |
| `src/components/chat/StylePicker.tsx` (new) | chip + DropdownMenu picker + Manager modal | 2 |
| `src/i18n/{en,zh-CN,zh-TW}.ts` | style keys (3 locales) | 2 |

**Task order:** protocol → sidecar (agents → session → manager) → domain (reducer → service) → frontend stores/helpers (stylesStore, styles) → i18n → UI → final gate. Earlier tasks define the types/contracts later tasks consume.

---

## Task 1: Protocol — additive message types

**Files:**
- Modify: `packages/protocol/src/index.ts`

This is a types-only change; correctness is verified by `yarn type-check` (no unit test). All three changes are additive/backward-compatible.

- [ ] **Step 1: Add `config?` to `session:loaded`**

In `ServerMessage`, change the `session:loaded` line (currently around line 116):

```ts
  | { type: 'session:loaded'; sessionId: string; messages: Message[]; config?: SessionConfig }
```

- [ ] **Step 2: Add the `session:setSystemPrompt` client message**

In `ClientMessage`, after the `session:setThinking` line (around line 97):

```ts
  | { type: 'session:setSystemPrompt'; sessionId: string; systemPrompt: string | null }
```

- [ ] **Step 3: Add the `session:systemPrompt` server echo**

In `ServerMessage`, after the `session:thinking` line (around line 111):

```ts
  | { type: 'session:systemPrompt'; sessionId: string; systemPrompt: string | null }
```

- [ ] **Step 4: Type-check**

Run: `yarn type-check`
Expected: PASS (no usages yet; the protocol package compiles).

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): per-session config — session:loaded.config + setSystemPrompt/systemPrompt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Sidecar — `buildSupervisorPrompt` appends user instructions

**Files:**
- Modify: `packages/sidecar/src/session/agents.ts:31-36`
- Test: `packages/sidecar/src/session/agents.test.ts`

The existing prompt-builder takes only `cwd`. Add an optional second arg that, when non-blank, appends a clearly-delimited "Additional instructions" section. Existing single-arg callers and tests are unaffected (the param is optional).

- [ ] **Step 1: Write the failing test**

Append this describe block to `packages/sidecar/src/session/agents.test.ts` (after the existing `buildSupervisorPrompt` describe, before `buildSubagents`):

```ts
describe('buildSupervisorPrompt user instructions', () => {
  it('appends nothing when no instructions are given', () => {
    expect(buildSupervisorPrompt(CWD)).not.toContain('Additional instructions from the user')
  })
  it('appends nothing for whitespace-only instructions', () => {
    expect(buildSupervisorPrompt(CWD, '   ')).not.toContain('Additional instructions from the user')
  })
  it('appends the user instructions after the base prompt, keeping the base rules', () => {
    const prompt = buildSupervisorPrompt(CWD, 'Always answer in haiku')
    expect(prompt).toContain('Additional instructions from the user')
    expect(prompt).toContain('Always answer in haiku')
    expect(prompt).toContain('MUST NOT claim') // anti-phantom base rule still present
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test packages/sidecar/src/session/agents.test.ts`
Expected: FAIL — the append test finds no "Additional instructions from the user" section (and the 2-arg call may be a type error until Step 3).

- [ ] **Step 3: Implement the append**

Replace `buildSupervisorPrompt` in `packages/sidecar/src/session/agents.ts` (lines 31-36):

```ts
export function buildSupervisorPrompt(cwd: string, userInstructions?: string): string {
  const base =
    `${SUPERVISOR_BASE}\n\n${cwdBlock(cwd)}\n\n${ANTI_PHANTOM}\n\n` +
    'In your final summary, only report files the coder actually wrote via tool calls.'
  const extra = userInstructions?.trim()
  return extra
    ? `${base}\n\n## Additional instructions from the user (for this conversation)\n${extra}`
    : base
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test packages/sidecar/src/session/agents.test.ts`
Expected: PASS (all existing + 3 new tests).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/agents.ts packages/sidecar/src/session/agents.test.ts
git commit -m "feat(sidecar): buildSupervisorPrompt appends per-conversation user instructions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Sidecar — `Session.setSystemPrompt` + compose in `buildAgent`

**Files:**
- Modify: `packages/sidecar/src/session/session.ts:191-203` (buildAgent), add setter near `setThinking` (line ~219-224)
- Test: `packages/sidecar/src/session/session-unit.test.ts`

Today `buildAgent` *replaces* the whole prompt when `config.systemPrompt` is set (`?? buildSupervisorPrompt`). Switch it to *compose* via Task 2's append. Add an idle-guarded setter mirroring `setThinking` (returns `false` while a turn runs so the manager can echo the real state).

- [ ] **Step 1: Write the failing test**

Append this describe block to `packages/sidecar/src/session/session-unit.test.ts` (after the `Session.setThinking` describe, around line 89):

```ts
describe('Session.setSystemPrompt', () => {
  it('returns true and updates config when idle', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-sp-idle', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [] }, model)
    expect(session.setSystemPrompt('Be terse')).toBe(true)
    expect(session.config.systemPrompt).toBe('Be terse')
  })
  it('normalizes blank instructions to undefined', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-sp-blank', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], systemPrompt: 'old' }, model)
    expect(session.setSystemPrompt('   ')).toBe(true)
    expect(session.config.systemPrompt).toBeUndefined()
  })
  it('clears on null', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-sp-null', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], systemPrompt: 'old' }, model)
    expect(session.setSystemPrompt(null)).toBe(true)
    expect(session.config.systemPrompt).toBeUndefined()
  })
  it('returns false and leaves config unchanged while a turn is running', () => {
    const model = new FakeListChatModel({ responses: ['ok'] })
    const session = new Session('t-sp-running', { llmProvider: 'deepseek', model: 'deepseek-chat', tools: [], systemPrompt: 'keep' }, model)
    ;(session as unknown as { running: boolean }).running = true
    expect(session.setSystemPrompt('new')).toBe(false)
    expect(session.config.systemPrompt).toBe('keep')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test packages/sidecar/src/session/session-unit.test.ts`
Expected: FAIL — `session.setSystemPrompt` is not a function.

- [ ] **Step 3a: Compose in `buildAgent`**

In `packages/sidecar/src/session/session.ts`, change the `systemPrompt` line in `buildAgent` (line 199) from:

```ts
      systemPrompt: this._config.systemPrompt ?? buildSupervisorPrompt(promptCwd),
```

to:

```ts
      systemPrompt: buildSupervisorPrompt(promptCwd, this._config.systemPrompt),
```

- [ ] **Step 3b: Add the setter**

In `packages/sidecar/src/session/session.ts`, immediately after the `setThinking` method (it ends around line 224), add:

```ts
  /** Set/clear per-conversation instructions and rebuild the agent. NO-OP (returns false) while a turn is running. */
  setSystemPrompt(systemPrompt: string | null): boolean {
    if (this.running) return false
    const next = systemPrompt?.trim() || undefined
    this._config = { ...this._config, systemPrompt: next }
    this.buildAgent()
    return true
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test packages/sidecar/src/session/session-unit.test.ts`
Expected: PASS (existing setThinking/resolveModel/agentRuns tests + 4 new).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/session.ts packages/sidecar/src/session/session-unit.test.ts
git commit -m "feat(sidecar): Session.setSystemPrompt (idle-guarded) + compose prompt in buildAgent

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Sidecar — manager handler + `session:load` returns config

**Files:**
- Modify: `packages/sidecar/src/session/session-manager.ts:57-59` (session:load), add case after `session:setThinking` (line ~90)
- Test: `packages/sidecar/src/session/session-manager-persist.test.ts`

Clone the `session:setThinking` handler for `setSystemPrompt` (persist on apply, echo the real state). Extend `session:load` to include the persisted config.

- [ ] **Step 1: Write the failing tests**

Append these tests inside the `describe('SessionManager persistence', …)` block in `packages/sidecar/src/session/session-manager-persist.test.ts` (e.g. after the existing `session:setThinking` tests, before the `cancelAllRunning` test). They reuse the file's `mgr`/`store`/`sent`/`send`/`cfg` setup:

```ts
  it('session:setSystemPrompt persists systemPrompt into the session config', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    mgr.handle({ type: 'session:setSystemPrompt', sessionId: 's1', systemPrompt: 'Be terse' }, send)
    expect(JSON.parse(store.getSession('s1')!.config).systemPrompt).toBe('Be terse')
  })

  it('session:setSystemPrompt null clears the persisted systemPrompt', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: { ...cfg, systemPrompt: 'old' } }, send)
    mgr.handle({ type: 'session:setSystemPrompt', sessionId: 's1', systemPrompt: null }, send)
    expect(JSON.parse(store.getSession('s1')!.config).systemPrompt).toBeUndefined()
  })

  it('session:setSystemPrompt echoes session:systemPrompt with the real state', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: cfg }, send)
    sent = []
    mgr.handle({ type: 'session:setSystemPrompt', sessionId: 's1', systemPrompt: 'Be terse' }, send)
    const echo = sent.find((m) => m.type === 'session:systemPrompt') as Extract<ServerMessage, { type: 'session:systemPrompt' }>
    expect(echo).toMatchObject({ sessionId: 's1', systemPrompt: 'Be terse' })
  })

  it('session:load echoes the persisted config', () => {
    mgr.handle({ type: 'session:create', id: 's1', config: { ...cfg, systemPrompt: 'X' } }, send)
    sent = []
    mgr.handle({ type: 'session:load', sessionId: 's1' }, send)
    const loaded = sent.find((m) => m.type === 'session:loaded') as Extract<ServerMessage, { type: 'session:loaded' }>
    expect(loaded.config?.systemPrompt).toBe('X')
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test packages/sidecar/src/session/session-manager-persist.test.ts`
Expected: FAIL — no `session:setSystemPrompt` handler; `session:loaded` carries no `config`.

- [ ] **Step 3a: Add config to `session:load`**

In `packages/sidecar/src/session/session-manager.ts`, replace the `session:load` case (lines 57-59):

```ts
      case 'session:load': {
        const config = this.store
          ? (JSON.parse(this.store.getSession(msg.sessionId)?.config ?? 'null') ?? undefined)
          : undefined
        send({ type: 'session:loaded', sessionId: msg.sessionId, messages: this.store?.loadMessagesWithRuns(msg.sessionId) ?? [], config })
        break
      }
```

- [ ] **Step 3b: Add the `session:setSystemPrompt` handler**

In the same file, immediately after the `session:setThinking` case block (it ends around line 90), add:

```ts
      case 'session:setSystemPrompt': {
        const s = this.ensureSession(msg.sessionId)
        const applied = s.setSystemPrompt(msg.systemPrompt)
        if (applied) this.store?.updateConfig(msg.sessionId, JSON.stringify(s.config))
        send({ type: 'session:systemPrompt', sessionId: msg.sessionId, systemPrompt: s.config.systemPrompt ?? null })
        break
      }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test packages/sidecar/src/session/session-manager-persist.test.ts`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/session-manager.ts packages/sidecar/src/session/session-manager-persist.test.ts
git commit -m "feat(sidecar): session:setSystemPrompt handler + session:load returns persisted config

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Frontend reducer — `session:systemPrompt` + `session:loaded` adopts config

**Files:**
- Modify: `src/domain/sessionStore.ts` (`session:loaded` case ~238-251; add `session:systemPrompt` case)
- Test: `src/domain/sessionStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these tests inside the `describe('applyServerMessage', …)` block in `src/domain/sessionStore.test.ts` (it uses the `baseSession`/`emptySession` helpers and the `{ sessions: [...] }` state shape):

```ts
  it('session:systemPrompt sets config.systemPrompt', () => {
    const s0 = { sessions: [baseSession({ id: 's1' })] }
    const next = applyServerMessage(s0, { type: 'session:systemPrompt', sessionId: 's1', systemPrompt: 'Be terse' }, 0)
    expect(next.sessions[0].config.systemPrompt).toBe('Be terse')
  })

  it('session:systemPrompt null clears config.systemPrompt', () => {
    const s0 = { sessions: [baseSession({ id: 's1', config: { llmProvider: 'deepseek', model: 'm', tools: [], systemPrompt: 'old' } })] }
    const next = applyServerMessage(s0, { type: 'session:systemPrompt', sessionId: 's1', systemPrompt: null }, 0)
    expect(next.sessions[0].config.systemPrompt).toBeUndefined()
  })

  it('session:loaded adopts the server config when present', () => {
    const s0 = { sessions: [baseSession({ id: 's1', loaded: false })] }
    const next = applyServerMessage(s0, { type: 'session:loaded', sessionId: 's1',
      messages: [{ id: 'a1', role: 'assistant', content: 'x', timestamp: 1 }],
      config: { llmProvider: 'deepseek', model: '', tools: [], thinking: false, systemPrompt: 'Z' },
    }, 0)
    expect(next.sessions[0].config).toMatchObject({ thinking: false, systemPrompt: 'Z' })
  })

  it('session:loaded keeps current config when the server omits it', () => {
    const s0 = { sessions: [baseSession({ id: 's1', loaded: false, config: { llmProvider: 'deepseek', model: 'm', tools: [], thinking: true } })] }
    const next = applyServerMessage(s0, { type: 'session:loaded', sessionId: 's1',
      messages: [{ id: 'a1', role: 'assistant', content: 'x', timestamp: 1 }],
    }, 0)
    expect(next.sessions[0].config.thinking).toBe(true)
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test src/domain/sessionStore.test.ts`
Expected: FAIL — no `session:systemPrompt` case; `session:loaded` does not set `config`.

- [ ] **Step 3a: Adopt config in `session:loaded`**

In `src/domain/sessionStore.ts`, in the `session:loaded` case, add the `config` line to the returned object (alongside `loaded`/`messages`/`status`/`error`):

```ts
        return {
          ...s,
          loaded: true,
          config: msg.config ?? s.config,
          messages: msg.messages,
          status: interrupted ? 'error' : 'idle',
          error: interrupted ? { code: 'INTERRUPTED', message: '' } : null,
        }
```

- [ ] **Step 3b: Add the `session:systemPrompt` case**

In the same `switch`, add a case (e.g. right after the `session:thinking` case, ~line 219):

```ts
    case 'session:systemPrompt':
      return update(msg.sessionId, (s) => ({ ...s, config: { ...s.config, systemPrompt: msg.systemPrompt || undefined } }))
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test src/domain/sessionStore.test.ts`
Expected: PASS (existing + 4 new).

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "feat(domain): reducer adopts session:loaded config + folds session:systemPrompt

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Frontend service — `sessionService.setSystemPrompt`

**Files:**
- Modify: `src/domain/sessionService.ts` (add method near `setThinking`, ~line 112-115)
- Test: `src/domain/sessionService.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these inside the `describe('SessionService', …)` block in `src/domain/sessionService.test.ts` (uses `FakeTransport`; `beforeEach` seeds session `s1` active):

```ts
  it('setSystemPrompt optimistically sets config and sends session:setSystemPrompt', () => {
    const t = new FakeTransport()
    new SessionService(t).setSystemPrompt('s1', 'Be terse')
    expect(useDomainStore.getState().sessions[0].config.systemPrompt).toBe('Be terse')
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:setSystemPrompt', sessionId: 's1', systemPrompt: 'Be terse' })
  })

  it('setSystemPrompt null clears config and sends null', () => {
    const t = new FakeTransport()
    useDomainStore.setState({ sessions: [{ ...useDomainStore.getState().sessions[0], config: { llmProvider: 'deepseek', model: 'm', tools: [], systemPrompt: 'old' } }] })
    new SessionService(t).setSystemPrompt('s1', null)
    expect(useDomainStore.getState().sessions[0].config.systemPrompt).toBeUndefined()
    expect(t.sent.at(-1)).toMatchObject({ type: 'session:setSystemPrompt', sessionId: 's1', systemPrompt: null })
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn test src/domain/sessionService.test.ts`
Expected: FAIL — `setSystemPrompt` is not a function.

- [ ] **Step 3: Implement the method**

In `src/domain/sessionService.ts`, immediately after the `setThinking` method (ends ~line 115), add:

```ts
  setSystemPrompt(id: string, systemPrompt: string | null): void {
    useDomainStore.getState().apply({ type: 'session:systemPrompt', sessionId: id, systemPrompt }) // optimistic
    this.transport.send({ type: 'session:setSystemPrompt', sessionId: id, systemPrompt })
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `yarn test src/domain/sessionService.test.ts`
Expected: PASS (existing + 2 new).

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionService.ts src/domain/sessionService.test.ts
git commit -m "feat(domain): sessionService.setSystemPrompt (optimistic + send)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Frontend — styles preset library store

**Files:**
- Create: `src/store/stylesStore.ts`
- Test: `src/store/stylesStore.test.ts`

A `localStorage`-persisted zustand store, copying `src/store/draftStore.ts`'s persist setup (memory fallback for node tests, `partialize`, named key).

- [ ] **Step 1: Write the failing test**

Create `src/store/stylesStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStylesStore } from './stylesStore'

beforeEach(() => useStylesStore.setState({ presets: [] }))

describe('stylesStore', () => {
  it('addPreset appends a preset with an id and returns it', () => {
    const p = useStylesStore.getState().addPreset('Terse', 'Be brief')
    expect(p.id).toBeTruthy()
    expect(p).toMatchObject({ name: 'Terse', text: 'Be brief' })
    expect(useStylesStore.getState().presets).toEqual([p])
  })

  it('updatePreset patches name/text by id', () => {
    const p = useStylesStore.getState().addPreset('A', 'a')
    useStylesStore.getState().updatePreset(p.id, { name: 'B' })
    expect(useStylesStore.getState().presets[0]).toMatchObject({ id: p.id, name: 'B', text: 'a' })
  })

  it('removePreset drops by id', () => {
    const p = useStylesStore.getState().addPreset('A', 'a')
    useStylesStore.getState().removePreset(p.id)
    expect(useStylesStore.getState().presets).toEqual([])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/store/stylesStore.test.ts`
Expected: FAIL — cannot resolve `./stylesStore`.

- [ ] **Step 3: Implement the store**

Create `src/store/stylesStore.ts`:

```ts
import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import { nanoid } from 'nanoid'

export interface StylePreset {
  id: string
  name: string
  text: string
}

interface StylesStore {
  presets: StylePreset[]
  addPreset: (name: string, text: string) => StylePreset
  updatePreset: (id: string, patch: Partial<Pick<StylePreset, 'name' | 'text'>>) => void
  removePreset: (id: string) => void
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

const storage = createJSONStorage<{ presets: StylePreset[] }>(() =>
  typeof localStorage !== 'undefined' ? localStorage : memoryStorage(),
)

export const useStylesStore = create<StylesStore>()(
  persist(
    (set) => ({
      presets: [],
      addPreset: (name, text) => {
        const preset: StylePreset = { id: nanoid(), name, text }
        set((s) => ({ presets: [...s.presets, preset] }))
        return preset
      },
      updatePreset: (id, patch) =>
        set((s) => ({ presets: s.presets.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removePreset: (id) => set((s) => ({ presets: s.presets.filter((p) => p.id !== id) })),
    }),
    { name: 'hip-styles', storage, partialize: (s) => ({ presets: s.presets }) },
  ),
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/store/stylesStore.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/store/stylesStore.ts src/store/stylesStore.test.ts
git commit -m "feat(store): stylesStore — localStorage preset library

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Frontend — `resolveStyleLabel` pure helper

**Files:**
- Create: `src/lib/styles.ts`
- Test: `src/lib/styles.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/styles.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveStyleLabel } from './styles'

const presets = [{ id: '1', name: 'Terse', text: 'Be brief' }]

describe('resolveStyleLabel', () => {
  it('returns none when no instructions are set', () => {
    expect(resolveStyleLabel(undefined, presets)).toEqual({ kind: 'none' })
  })
  it('returns the preset name when the text matches a preset', () => {
    expect(resolveStyleLabel('Be brief', presets)).toEqual({ kind: 'preset', name: 'Terse' })
  })
  it('returns custom when instructions are set but match no preset', () => {
    expect(resolveStyleLabel('Something else', presets)).toEqual({ kind: 'custom' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `yarn test src/lib/styles.test.ts`
Expected: FAIL — cannot resolve `./styles`.

- [ ] **Step 3: Implement the helper**

Create `src/lib/styles.ts`:

```ts
import type { StylePreset } from '@/store/stylesStore'

export type StyleLabel =
  | { kind: 'none' }
  | { kind: 'custom' }
  | { kind: 'preset'; name: string }

/** Resolve the chip label for a session's instructions: a matching preset's name,
 *  'custom' when set but unmatched, or 'none' when unset. Pure (copy semantics). */
export function resolveStyleLabel(systemPrompt: string | undefined, presets: StylePreset[]): StyleLabel {
  if (!systemPrompt) return { kind: 'none' }
  const match = presets.find((p) => p.text === systemPrompt)
  return match ? { kind: 'preset', name: match.name } : { kind: 'custom' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `yarn test src/lib/styles.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/styles.ts src/lib/styles.test.ts
git commit -m "feat(lib): resolveStyleLabel — map session instructions to a chip label

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: i18n — style keys (3 locales)

**Files:**
- Modify: `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`

Add these keys to the `chat` block of each locale (after `jumpToLatest`). Keep the three files structurally identical (`i18next.d.ts` types usage against `en`).

- [ ] **Step 1: Add keys to `en.ts`**

In `src/i18n/en.ts`, in the `chat:` block, after the `jumpToLatest` line, add:

```ts
      style: 'Style',
      styleNone: 'None',
      styleCustom: 'Custom',
      styleHint: 'Per-conversation instructions',
      styleManage: 'Manage styles…',
      styleDialogTitle: 'Conversation styles',
      styleName: 'Name',
      styleInstructions: 'Instructions',
      styleNew: 'New style',
      styleDelete: 'Delete style',
      styleEmpty: 'No saved styles yet. Create one below.',
```

- [ ] **Step 2: Add the same keys to `zh-CN.ts`**

In `src/i18n/zh-CN.ts`, in the `chat:` block, after `jumpToLatest`:

```ts
      style: '风格',
      styleNone: '无',
      styleCustom: '自定义',
      styleHint: '本对话的附加指令',
      styleManage: '管理风格…',
      styleDialogTitle: '对话风格',
      styleName: '名称',
      styleInstructions: '指令',
      styleNew: '新建风格',
      styleDelete: '删除风格',
      styleEmpty: '还没有保存的风格，请在下方新建。',
```

- [ ] **Step 3: Add the same keys to `zh-TW.ts`**

In `src/i18n/zh-TW.ts`, in the `chat:` block, after `jumpToLatest`:

```ts
      style: '風格',
      styleNone: '無',
      styleCustom: '自訂',
      styleHint: '本對話的附加指令',
      styleManage: '管理風格…',
      styleDialogTitle: '對話風格',
      styleName: '名稱',
      styleInstructions: '指令',
      styleNew: '新增風格',
      styleDelete: '刪除風格',
      styleEmpty: '還沒有儲存的風格，請在下方新增。',
```

- [ ] **Step 4: Type-check**

Run: `yarn type-check`
Expected: PASS (all three locales structurally consistent).

- [ ] **Step 5: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat(i18n): conversation-style keys (en/zh-CN/zh-TW)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: Frontend UI — Composer slot + StylePicker + InputBar wiring

**Files:**
- Modify: `src/components/chat/Composer.tsx` (add `leftSlot` prop)
- Create: `src/components/chat/StylePicker.tsx`
- Modify: `src/components/chat/InputBar.tsx` (render `<StylePicker/>`)

Presentational — verified by `yarn type-check` + manual GUI acceptance (no DOM tests, per project convention). Verify against radix `DropdownMenu`/`Modal` and the `Input`/`Textarea` primitives.

- [ ] **Step 1: Add `leftSlot` to Composer**

In `src/components/chat/Composer.tsx`, add `leftSlot?: React.ReactNode` to the props type (after `reconnecting`):

```ts
  reconnecting?: boolean
  leftSlot?: React.ReactNode
```

Destructure it in the signature (after `reconnecting,`): add `leftSlot,`. Then wrap the Thinking button + slot in a left group. Replace the bottom bar's left side — change:

```tsx
      <div className="flex items-center justify-between px-1 pt-1">
        <button
          type="button"
          onClick={() => onToggleThinking?.(!thinking)}
          disabled={toggleDisabled}
          aria-pressed={thinking}
          title={t('chat.thinkingModeHint')}
          data-testid="thinking-toggle"
          className={cn('flex items-center gap-1.5 px-2 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50', thinking ? 'text-accent' : 'text-ink-tertiary hover:text-ink-secondary')}
        >
          <Brain size={13} className="shrink-0" aria-hidden />
          <span>{t('chat.thinkingMode')}</span>
        </button>
```

to (wrap the existing button in a flex group and render the slot after it):

```tsx
      <div className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onToggleThinking?.(!thinking)}
            disabled={toggleDisabled}
            aria-pressed={thinking}
            title={t('chat.thinkingModeHint')}
            data-testid="thinking-toggle"
            className={cn('flex items-center gap-1.5 px-2 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50', thinking ? 'text-accent' : 'text-ink-tertiary hover:text-ink-secondary')}
          >
            <Brain size={13} className="shrink-0" aria-hidden />
            <span>{t('chat.thinkingMode')}</span>
          </button>
          {leftSlot}
        </div>
```

(The `{running && onStop ? (...) : (...)}` block stays as the second child of the `justify-between` container — do not move it.)

- [ ] **Step 2: Create StylePicker**

Create `src/components/chat/StylePicker.tsx`:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { SlidersHorizontal, Check, Plus, Trash2 } from 'lucide-react'
import { sessionService, useActiveSession, useActiveSessionId, useActiveSessionStatus } from '@/domain'
import { useStylesStore } from '@/store/stylesStore'
import { resolveStyleLabel } from '@/lib/styles'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Textarea } from '@/components/ui/Textarea'
import { cn } from '@/lib/utils'

export function StylePicker() {
  const { t } = useTranslation()
  const session = useActiveSession()
  const activeId = useActiveSessionId()
  const status = useActiveSessionStatus()
  const presets = useStylesStore((s) => s.presets)
  const [manageOpen, setManageOpen] = useState(false)

  if (!activeId || !session) return null
  const disabled = status === 'running'
  const current = session.config.systemPrompt
  const label = resolveStyleLabel(current, presets)
  const text =
    label.kind === 'preset' ? label.name : label.kind === 'custom' ? t('chat.styleCustom') : t('chat.style')
  const apply = (value: string | null) => sessionService.setSystemPrompt(activeId, value)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            title={t('chat.styleHint')}
            data-testid="style-chip"
            className={cn(
              'flex items-center gap-1.5 px-2 py-1 text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              label.kind === 'none' ? 'text-ink-tertiary hover:text-ink-secondary' : 'text-accent',
            )}
          >
            <SlidersHorizontal size={13} className="shrink-0" aria-hidden />
            <span className="max-w-[120px] truncate">{text}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem onSelect={() => apply(null)}>
            <Check size={14} className={cn('shrink-0', current ? 'opacity-0' : 'opacity-100')} />
            <span>{t('chat.styleNone')}</span>
          </DropdownMenuItem>
          {presets.map((p) => (
            <DropdownMenuItem key={p.id} onSelect={() => apply(p.text)}>
              <Check size={14} className={cn('shrink-0', current === p.text ? 'opacity-100' : 'opacity-0')} />
              <span className="truncate">{p.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setManageOpen(true)}>
            <SlidersHorizontal size={14} className="shrink-0" />
            <span>{t('chat.styleManage')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <StyleManager open={manageOpen} onOpenChange={setManageOpen} />
    </>
  )
}

function StyleManager({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation()
  const presets = useStylesStore((s) => s.presets)
  const addPreset = useStylesStore((s) => s.addPreset)
  const updatePreset = useStylesStore((s) => s.updatePreset)
  const removePreset = useStylesStore((s) => s.removePreset)
  const [name, setName] = useState('')
  const [text, setText] = useState('')

  const create = () => {
    const n = name.trim()
    const tx = text.trim()
    if (!n || !tx) return
    addPreset(n, tx)
    setName('')
    setText('')
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t('chat.styleDialogTitle')}>
      <div className="flex flex-col gap-4 p-5">
        {presets.length === 0 && <p className="text-[13px] text-ink-tertiary">{t('chat.styleEmpty')}</p>}
        {presets.map((p) => (
          <div key={p.id} className="flex flex-col gap-1.5 border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <Input value={p.name} onChange={(e) => updatePreset(p.id, { name: e.target.value })} className="flex-1" />
              <button
                type="button"
                onClick={() => removePreset(p.id)}
                title={t('chat.styleDelete')}
                className="shrink-0 text-ink-tertiary transition-colors hover:text-danger"
              >
                <Trash2 size={15} />
              </button>
            </div>
            <Textarea value={p.text} onChange={(e) => updatePreset(p.id, { text: e.target.value })} rows={3} />
          </div>
        ))}
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('chat.styleName')} />
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={t('chat.styleInstructions')} />
          <button
            type="button"
            onClick={create}
            disabled={!name.trim() || !text.trim()}
            className="flex items-center gap-1.5 self-end bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            <Plus size={14} />
            {t('chat.styleNew')}
          </button>
        </div>
      </div>
    </Modal>
  )
}
```

> **Verify before wiring:** confirm `Input` (`src/components/ui/Input.tsx`) and `Textarea` (`src/components/ui/Textarea.tsx`) accept `value`/`onChange`/`className`/`placeholder` (and `rows` for Textarea). They are used this way elsewhere (Composer uses Textarea with `value`/`onChange`/`rows`/`placeholder`/`className`). If `Input` forwards native props, the above compiles as-is. Adjust prop names only if the primitive differs.

- [ ] **Step 3: Wire StylePicker into InputBar**

In `src/components/chat/InputBar.tsx`, import the picker and pass it as `leftSlot`. Add the import:

```ts
import { StylePicker } from './StylePicker'
```

Add the prop to the `<Composer … />` element (e.g. after `onToggleThinking={…}`):

```tsx
          leftSlot={<StylePicker />}
```

- [ ] **Step 4: Type-check + build**

Run: `yarn type-check && yarn build`
Expected: PASS. (StylePicker reads the active session itself; it renders `null` when none is selected, so a chat-draft pre-commit shows no chip.)

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/Composer.tsx src/components/chat/StylePicker.tsx src/components/chat/InputBar.tsx
git commit -m "feat(chat): per-conversation style chip — picker + preset manager

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Final verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite**

Run: `yarn test`
Expected: All green. (One flaky live-DeepSeek integration test is tolerated — re-run once to confirm it's network, not feature code. The new tests in Tasks 2–8 must be deterministically green.)

- [ ] **Step 2: Type-check + build**

Run: `yarn type-check && yarn build`
Expected: PASS, no errors.

- [ ] **Step 3: Grep checks (no leftover replace-semantics, wiring present)**

```bash
# The old replace path is gone (compose is the only call):
grep -n "systemPrompt ?? buildSupervisorPrompt" packages/sidecar/src/session/session.ts   # expect: no matches
grep -n "buildSupervisorPrompt(promptCwd, this._config.systemPrompt)" packages/sidecar/src/session/session.ts  # expect: 1 match
# Picker is wired:
grep -rn "StylePicker" src/components/chat/InputBar.tsx   # expect: import + usage
# Protocol message reaches the reducer + service:
grep -n "session:systemPrompt\|session:setSystemPrompt" src/domain/sessionStore.ts src/domain/sessionService.ts
```

- [ ] **Step 4: Manual GUI acceptance checklist (hand off to the user — do not self-sign)**

Per project convention (`prefer-gui-over-real-llm-tests`), the live/visual path is the user's to accept. The checklist:
1. Open a conversation → the style chip shows "Style" (neutral). Open it → "None" is checked.
2. Manage styles → create a preset (e.g. "Terse" / "Answer in one sentence"). It appears in the picker.
3. Pick the preset → chip turns accent and shows "Terse". Send a message → the reply honors the instruction.
4. Reload the app (or reopen the session) → the chip still shows "Terse" (Part-1 config restore), and the thinking toggle + Files cwd are correct.
5. While a turn is streaming → the chip is disabled.
6. Pick "None" → chip returns to neutral; next reply is un-styled.
7. Edit the preset's text after applying it → the conversation's chip falls back to "Custom" (copy semantics — expected).
8. zh-CN / zh-TW: chip + manager dialog labels are localized.

- [ ] **Step 5: Finish the branch**

Use **superpowers:finishing-a-development-branch**.

---

## Self-Review (filled in by plan author)

**1. Spec coverage:**
- Part 1 config restore → Tasks 1 (protocol field), 4 (sidecar emits config), 5 (reducer adopts). ✓
- No model selector → not implemented; `resolveModel` untouched. ✓
- Append semantics, supervisor only → Tasks 2 (append helper), 3 (compose in buildAgent; subagents untouched). ✓
- `session:setSystemPrompt` + echo, idle-only → Tasks 1, 3 (setter), 4 (handler). ✓
- Service + reducer plumbing → Tasks 5, 6. ✓
- localStorage preset library (no SQLite) → Task 7. ✓
- Chip label helper → Task 8. ✓
- Chip + DropdownMenu picker + Modal manager, left of nothing-pushed-through-Composer → Task 10 (`leftSlot`). ✓
- i18n 3 locales → Task 9. ✓
- Error handling (running-reject echo, legacy undefined, blank→undefined, older-sidecar config absent) → covered by Task 3 (blank/running), Task 4 (echo real state), Task 5 (`msg.config ?? s.config`). ✓
- Out-of-scope (draft styles, subagent injection, generic configure, Projects) → not implemented. StylePicker returns null with no active session (no draft support). ✓

**2. Placeholder scan:** No TBD/TODO; every code step shows full code. The one advisory ("Verify Input/Textarea props") names the exact files and the existing usage to compare against — not a placeholder.

**3. Type consistency:** `setSystemPrompt(id, systemPrompt: string | null)` consistent across service (Task 6), session (Task 3), manager (Task 4). `session:systemPrompt`/`session:setSystemPrompt` payloads identical in protocol (Task 1), reducer (Task 5), service (Task 6), manager (Task 4). `StylePreset {id,name,text}` consistent across stylesStore (Task 7), styles helper (Task 8), StylePicker (Task 10). `resolveStyleLabel` return `{kind:'none'|'custom'|'preset'}` consistent between Task 8 and Task 10's `label.kind` switch.
```
