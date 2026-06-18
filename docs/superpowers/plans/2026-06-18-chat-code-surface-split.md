# Chat / Code Surface Split — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the app into two independent left-rail surfaces — **Chat** (conversation-only, sandboxed agent, doc/image preview) and **Code** (conversation + directory tree + git) — that share one session engine but never share conversations.

**Architecture:** A persisted `SessionConfig.surface: 'chat' | 'code'` (carried on `SessionSummary` so the sidebar filters cheaply; legacy rows inferred from a scratch cwd). `uiStore.activeView` gains `'code'`; the same chat components are reused, branched by surface; the right panel is the existing `ArtifactPanel` for Code vs. a new slim `PreviewPanel` for Chat. Code restores its last conversation on launch; Chat opens new (asymmetric, per industry norm).

**Tech Stack:** TypeScript, React, Zustand (+ `persist` middleware), react-i18next, Node sidecar (`node:sqlite`), `@hip/protocol` (path-mapped source), Vitest.

**Spec:** `docs/superpowers/specs/2026-06-18-chat-code-surface-split-design.md`

---

## Test-harness reality (read before starting)

- The repo has **no React render-test harness** (no `*.test.tsx`, no Testing Library). Logic is unit-tested in pure helpers and Zustand stores (`*.test.ts`). So: **extract logic into tested helpers**, and verify React components with `yarn type-check` + `yarn build` + (final) manual GUI. Do **not** add a new component-test framework.
- **Paid-test trap:** a bare `yarn vitest run src` substring-matches `packages/sidecar/src` and fires paid real-LLM suites. Per task, run the **exact file path** only (e.g. `yarn vitest run src/lib/sessions.test.ts`) — that runs just that file and is paid-free. The full `yarn test` at the end must be run paid-free by moving `~/.hip/config/auth.json` aside first, then restoring it.
- Commit after each task. Branch is `feat/chat-code-surface-split`.

## File map (what each touched/created file is responsible for)

**Protocol**
- `packages/protocol/src/index.ts` — add `surface` to `SessionConfig` + `SessionSummary`.

**Sidecar**
- `packages/sidecar/src/session/scratch.ts` — add `isScratchCwd(cwd, id, root?)`.
- `packages/sidecar/src/session/surface.ts` *(new)* — `surfaceOf(config, id)` (explicit field, else infer from scratch cwd).
- `packages/sidecar/src/persistence/store.ts` — `listSessions()` emits `surface`.

**Frontend — pure helpers**
- `src/lib/sessions.ts` — add `surfaceOf(config)` + `filterBySurface(sessions, surface)`.
- `src/lib/renderedArtifacts.ts` — add `collectConversationArtifacts(messages)`.

**Frontend — state / domain**
- `src/store/uiStore.ts` — `activeView` adds `'code'`; chat-panel state (`chatPanelOpen`, `selectedArtifactPath`); per-surface conversation ids (`codeSessionId` persisted, `chatSessionId` in-memory); wrap store in `persist`.
- `src/domain/sessionStore.ts` — `summaryToVM` carries `surface`; `session:loaded` preserves `surface`.
- `src/domain/sessionService.ts` — `configFromDraft(draft, surface)`; `setSurface(view)`; record per-surface id on select/create; clear on delete.

**Frontend — components**
- `src/components/rail/MenuRail.tsx` — add the **Code** rail button.
- `src/routes/AppLayout.tsx` — swap right panel by surface; `SidebarPeek` for chat+code.
- `src/components/layout/TitleBar.tsx` — render `ChatTitleBar` for code too.
- `src/components/layout/ChatTitleBar.tsx` — surface-aware panel toggle.
- `src/components/sidebar/SessionList.tsx` — filter by active surface.
- `src/components/chat/Composer.tsx` — add `submitDisabled` prop.
- `src/components/chat/NewConversation.tsx` — surface-aware extras + submit gating.
- `src/components/chat/InputBar.tsx` — surface-aware left slot.
- `src/components/artifact/ArtifactCard.tsx` — export `iconFor`; surface branch in `open()`.
- `src/components/artifact/PreviewPanel.tsx` *(new)* — Chat's tree-less artifacts preview.

**i18n**
- `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts` — `nav.code`, code new-conversation greeting/hint, preview-panel keys.

---

# Slice A — Protocol + sidecar surface field

### Task 1: Protocol `surface` field

**Files:**
- Modify: `packages/protocol/src/index.ts` (SessionConfig ~13-24; SessionSummary ~226-232)

- [ ] **Step 1: Add `surface` to `SessionConfig`**

In `packages/protocol/src/index.ts`, add the field to the `SessionConfig` interface (after `permissionMode`):

```ts
  permissionMode?: PermissionMode  // per-conversation gate; undefined ⇒ treated as 'edit'
  /** Which top-level surface owns this conversation. 'chat' = sandboxed conversation-only;
   *  'code' = conversation + directory tree + git. undefined on a legacy row ⇒ inferred from
   *  the cwd (a scratch cwd ⇒ 'chat', else 'code'); see surfaceOf in the sidecar. */
  surface?: 'chat' | 'code'
```

- [ ] **Step 2: Add `surface` to `SessionSummary`**

```ts
export interface SessionSummary {
  id: string
  title: string
  preview: string
  updatedAt: number
  messageCount: number
  surface: 'chat' | 'code'
}
```

- [ ] **Step 3: Type-check**

Run: `yarn type-check`
Expected: FAIL — `store.ts`'s `listSessions()` return no longer satisfies `SessionSummary` (missing `surface`). This is expected; Task 4 fixes it. (If you want a green checkpoint now, proceed to commit — the failure is resolved within this slice.)

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/index.ts
git commit -m "feat(protocol): add SessionConfig.surface + SessionSummary.surface"
```

---

### Task 2: `isScratchCwd` helper (sidecar)

**Files:**
- Modify: `packages/sidecar/src/session/scratch.ts`
- Test: `packages/sidecar/src/session/scratch.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/sidecar/src/session/scratch.test.ts` (and add `isScratchCwd` to the existing import on line 5):

```ts
describe('isScratchCwd', () => {
  it('true when cwd is exactly the session scratch dir', () => {
    expect(isScratchCwd(scratchDirFor('s1', root), 's1', root)).toBe(true)
  })
  it('false for a real project dir', () => {
    expect(isScratchCwd('/Users/me/project', 's1', root)).toBe(false)
  })
  it('false for another session’s scratch dir', () => {
    expect(isScratchCwd(scratchDirFor('s2', root), 's1', root)).toBe(false)
  })
  it('false for undefined cwd, and never throws on a bad id', () => {
    expect(isScratchCwd(undefined, 's1', root)).toBe(false)
    expect(isScratchCwd('/whatever', '../evil', root)).toBe(false)
  })
})
```

Update the import line:
```ts
import { scratchDirFor, ensureScratchDir, removeScratchDir, defaultScratchRoot, isScratchCwd } from './scratch.js'
```

- [ ] **Step 2: Run the test (red)**

Run: `yarn vitest run packages/sidecar/src/session/scratch.test.ts`
Expected: FAIL — `isScratchCwd is not a function`.

- [ ] **Step 3: Implement `isScratchCwd`**

Append to `packages/sidecar/src/session/scratch.ts`:

```ts
/** True iff `cwd` is exactly this session's scratch dir (the pure-chat sandbox), under `root`.
 *  Never throws — a bad/empty id or path simply yields false. */
export function isScratchCwd(cwd: string | undefined, sessionId: string, root: string = defaultScratchRoot()): boolean {
  if (!cwd) return false
  try {
    return path.resolve(cwd) === path.resolve(scratchDirFor(sessionId, root))
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run the test (green)**

Run: `yarn vitest run packages/sidecar/src/session/scratch.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/scratch.ts packages/sidecar/src/session/scratch.test.ts
git commit -m "feat(sidecar): isScratchCwd helper"
```

---

### Task 3: `surfaceOf` helper (sidecar)

**Files:**
- Create: `packages/sidecar/src/session/surface.ts`
- Test: `packages/sidecar/src/session/surface.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/sidecar/src/session/surface.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { scratchDirFor } from './scratch.js'
import { surfaceOf } from './surface.js'

let root: string
beforeEach(() => { root = mkdtempSync(path.join(os.tmpdir(), 'hip-surface-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

describe('surfaceOf', () => {
  it('honors an explicit surface field', () => {
    expect(surfaceOf({ surface: 'chat', cwd: '/Users/me/project' }, 's1', root)).toBe('chat')
    expect(surfaceOf({ surface: 'code', cwd: scratchDirFor('s1', root) }, 's1', root)).toBe('code')
  })
  it('infers chat from a scratch cwd when the field is absent (legacy row)', () => {
    expect(surfaceOf({ cwd: scratchDirFor('s1', root) }, 's1', root)).toBe('chat')
  })
  it('infers code from a real project cwd when the field is absent', () => {
    expect(surfaceOf({ cwd: '/Users/me/project' }, 's1', root)).toBe('code')
  })
  it('defaults to code when neither field nor cwd is present', () => {
    expect(surfaceOf({}, 's1', root)).toBe('code')
  })
})
```

- [ ] **Step 2: Run the test (red)**

Run: `yarn vitest run packages/sidecar/src/session/surface.test.ts`
Expected: FAIL — cannot find module `./surface.js`.

- [ ] **Step 3: Implement `surfaceOf`**

Create `packages/sidecar/src/session/surface.ts`:

```ts
import type { SessionConfig } from '@hip/protocol'
import { isScratchCwd } from './scratch.js'

/** Resolve a session's surface: the explicit field wins; legacy rows infer from a scratch cwd
 *  (the pure-chat sandbox ⇒ 'chat', any other/absent cwd ⇒ 'code'). The `root` arg is for tests. */
export function surfaceOf(
  config: Pick<SessionConfig, 'surface' | 'cwd'>,
  sessionId: string,
  root?: string,
): 'chat' | 'code' {
  if (config.surface === 'chat' || config.surface === 'code') return config.surface
  return isScratchCwd(config.cwd, sessionId, root) ? 'chat' : 'code'
}
```

- [ ] **Step 4: Run the test (green)**

Run: `yarn vitest run packages/sidecar/src/session/surface.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/session/surface.ts packages/sidecar/src/session/surface.test.ts
git commit -m "feat(sidecar): surfaceOf (explicit field, else infer from scratch cwd)"
```

---

### Task 4: `listSessions()` emits `surface`

**Files:**
- Modify: `packages/sidecar/src/persistence/store.ts` (imports; `listSessions` ~193-201)
- Test: `packages/sidecar/src/persistence/store.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/sidecar/src/persistence/store.test.ts`. (`scratchDirFor` import is added so the legacy-inference case uses a real scratch path.) Add at top imports:

```ts
import { scratchDirFor } from '../session/scratch.js'
```

Then a new describe block:

```ts
describe('SessionStore listSessions surface', () => {
  let store: SessionStore
  beforeEach(() => { store = freshStore() })

  it('returns the explicit surface from the stored config', () => {
    const codeCfg = JSON.stringify({ llmProvider: 'd', model: 'm', tools: [], surface: 'code', cwd: '/proj' })
    const chatCfg = JSON.stringify({ llmProvider: 'd', model: 'm', tools: [], surface: 'chat' })
    store.insertSession({ id: 'c', title: 't', config: codeCfg, createdAt: 1, updatedAt: 2 })
    store.insertSession({ id: 'h', title: 't', config: chatCfg, createdAt: 1, updatedAt: 1 })
    const list = store.listSessions()
    expect(list.find((s) => s.id === 'c')!.surface).toBe('code')
    expect(list.find((s) => s.id === 'h')!.surface).toBe('chat')
  })

  it('infers a legacy session: scratch cwd ⇒ chat, real cwd ⇒ code', () => {
    const legacyChat = JSON.stringify({ llmProvider: 'd', model: 'm', tools: [], cwd: scratchDirFor('lc') })
    const legacyCode = JSON.stringify({ llmProvider: 'd', model: 'm', tools: [], cwd: '/Users/me/proj' })
    store.insertSession({ id: 'lc', title: 't', config: legacyChat, createdAt: 1, updatedAt: 2 })
    store.insertSession({ id: 'ld', title: 't', config: legacyCode, createdAt: 1, updatedAt: 1 })
    const list = store.listSessions()
    expect(list.find((s) => s.id === 'lc')!.surface).toBe('chat')
    expect(list.find((s) => s.id === 'ld')!.surface).toBe('code')
  })
})
```

- [ ] **Step 2: Run the test (red)**

Run: `yarn vitest run packages/sidecar/src/persistence/store.test.ts`
Expected: FAIL — `surface` is `undefined` on the returned summaries.

- [ ] **Step 3: Implement**

In `packages/sidecar/src/persistence/store.ts`:

Add to the protocol type import (line 2), add `SessionConfig`:
```ts
import type { AgentRole, AgentRun, Checkpoint, Message, SessionConfig, SessionSummary, SearchHit, TimelineStep, ToolCall, ToolStatus, TurnUsage } from '@hip/protocol'
```
Add a new import near the top:
```ts
import { surfaceOf } from '../session/surface.js'
```
Replace `listSessions()` (~193-201) with:
```ts
  listSessions(): SessionSummary[] {
    const rows = this.db.prepare(`
      SELECT s.id, s.title, s.config AS config, s.updated_at AS updatedAt,
        (SELECT content FROM messages m WHERE m.session_id=s.id ORDER BY seq DESC LIMIT 1) AS preview,
        (SELECT COUNT(*) FROM messages m WHERE m.session_id=s.id) AS messageCount
      FROM sessions s ORDER BY s.updated_at DESC
    `).all() as { id: string; title: string; config: string; updatedAt: number; preview: string | null; messageCount: number }[]
    return rows.map((r) => {
      let surface: 'chat' | 'code' = 'code'
      try { surface = surfaceOf(JSON.parse(r.config) as SessionConfig, r.id) } catch { surface = 'code' }
      return { id: r.id, title: r.title, surface, updatedAt: r.updatedAt, messageCount: r.messageCount, preview: (r.preview ?? '').slice(0, PREVIEW_LEN) }
    })
  }
```

- [ ] **Step 4: Run the test (green) + type-check**

Run: `yarn vitest run packages/sidecar/src/persistence/store.test.ts`
Expected: PASS.
Run: `yarn type-check`
Expected: PASS — `SessionSummary` is now satisfied (Task 1's error resolved).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/persistence/store.ts packages/sidecar/src/persistence/store.test.ts
git commit -m "feat(sidecar): listSessions emits surface (explicit + legacy inference)"
```

---

# Slice B — Frontend data model

### Task 5: Frontend `surfaceOf` + `filterBySurface`

**Files:**
- Modify: `src/lib/sessions.ts`
- Test: `src/lib/sessions.test.ts` *(create if absent)*

- [ ] **Step 1: Write the failing test**

Create/append `src/lib/sessions.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { surfaceOf, filterBySurface } from './sessions'

describe('surfaceOf (frontend)', () => {
  it('returns the explicit surface', () => {
    expect(surfaceOf({ surface: 'chat' })).toBe('chat')
    expect(surfaceOf({ surface: 'code' })).toBe('code')
  })
  it('defaults to code when absent (the sidecar normally stamps it)', () => {
    expect(surfaceOf({})).toBe('code')
    expect(surfaceOf({ surface: undefined })).toBe('code')
  })
})

describe('filterBySurface', () => {
  const mk = (id: string, surface?: 'chat' | 'code') => ({ id, config: { surface } })
  it('keeps only sessions whose surface matches', () => {
    const list = [mk('a', 'chat'), mk('b', 'code'), mk('c', 'chat')]
    expect(filterBySurface(list, 'chat').map((s) => s.id)).toEqual(['a', 'c'])
    expect(filterBySurface(list, 'code').map((s) => s.id)).toEqual(['b'])
  })
  it('treats a missing surface as code', () => {
    const list = [mk('a'), mk('b', 'chat')]
    expect(filterBySurface(list, 'code').map((s) => s.id)).toEqual(['a'])
  })
})
```

- [ ] **Step 2: Run the test (red)**

Run: `yarn vitest run src/lib/sessions.test.ts`
Expected: FAIL — `surfaceOf`/`filterBySurface` are not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/sessions.ts`:

```ts
import type { SessionConfig } from '@hip/protocol'

/** The surface a session belongs to. The sidecar stamps `config.surface`; a missing value
 *  (only a transient/edge case) is treated as 'code', the fuller surface. */
export function surfaceOf(config: Pick<SessionConfig, 'surface'>): 'chat' | 'code' {
  return config.surface === 'chat' || config.surface === 'code' ? config.surface : 'code'
}

/** Keep only the sessions belonging to `surface`. Generic over anything carrying a config.surface. */
export function filterBySurface<T extends { config: Pick<SessionConfig, 'surface'> }>(
  sessions: T[],
  surface: 'chat' | 'code',
): T[] {
  return sessions.filter((s) => surfaceOf(s.config) === surface)
}
```

- [ ] **Step 4: Run the test (green)**

Run: `yarn vitest run src/lib/sessions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/sessions.ts src/lib/sessions.test.ts
git commit -m "feat(sessions): surfaceOf + filterBySurface helpers"
```

---

### Task 6: VM carries `surface`; `session:loaded` preserves it

**Files:**
- Modify: `src/domain/sessionStore.ts` (`summaryToVM` ~134-136; `session:loaded` reducer ~268-282)
- Test: `src/domain/sessionStore.test.ts` *(find existing; append)*

> Append to the existing `src/domain/sessionStore.test.ts`. Reuse its imports — add `applyServerMessage` to the existing `./sessionStore` import and `SessionSummary` to the existing `@hip/protocol` import if they aren't already imported (don't add duplicate import statements).

- [ ] **Step 1: Write the failing test**

Append (adjust imports per the note above):

```ts
describe('sessionStore surface', () => {
  const summary = (id: string, surface: 'chat' | 'code'): SessionSummary =>
    ({ id, title: 't', preview: '', updatedAt: 1, messageCount: 0, surface })

  it('session:list:result carries surface onto the VM config', () => {
    const next = applyServerMessage({ sessions: [] }, { type: 'session:list:result', sessions: [summary('a', 'chat'), summary('b', 'code')] }, 1)
    expect(next.sessions.find((s) => s.id === 'a')!.config.surface).toBe('chat')
    expect(next.sessions.find((s) => s.id === 'b')!.config.surface).toBe('code')
  })

  it('session:loaded preserves the surface when the loaded config omits it', () => {
    const start = applyServerMessage({ sessions: [] }, { type: 'session:list:result', sessions: [summary('a', 'chat')] }, 1)
    const loaded = applyServerMessage(start, { type: 'session:loaded', sessionId: 'a', messages: [], config: { llmProvider: 'd', model: 'm', tools: [] } }, 2)
    expect(loaded.sessions.find((s) => s.id === 'a')!.config.surface).toBe('chat')
  })
})
```

- [ ] **Step 2: Run the test (red)**

Run: `yarn vitest run src/domain/sessionStore.test.ts`
Expected: FAIL — `config.surface` is `undefined` (summaryToVM uses DEFAULT_CONFIG; session:loaded overwrites with the surfaceless config).

- [ ] **Step 3: Implement**

In `src/domain/sessionStore.ts`, change `summaryToVM` (~134-136):

```ts
function summaryToVM(s: SessionSummary): SessionVM {
  return { id: s.id, config: { ...DEFAULT_CONFIG, surface: s.surface }, title: s.title, preview: s.preview, updatedAtMs: s.updatedAt, loaded: false, messages: [], status: 'idle', error: null, interrupt: null }
}
```

In the `case 'session:loaded':` reducer (~268-282), change the `config` line to preserve a known surface when the loaded config omits it:

```ts
        return {
          ...s,
          loaded: true,
          config: msg.config ? { ...msg.config, surface: msg.config.surface ?? s.config.surface } : s.config,
          messages: msg.messages,
          status: interrupted ? 'error' : 'idle',
          error: interrupted ? { code: 'INTERRUPTED', message: '' } : null,
        }
```

- [ ] **Step 4: Run the test (green)**

Run: `yarn vitest run src/domain/sessionStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "feat(domain): carry surface onto session VMs; preserve on load"
```

---

### Task 7: `configFromDraft` derives surface from the draft mode

> Surface comes from the draft's mode (`'project'` ⇒ Code, `'chat'` ⇒ Chat). The Chat new-conversation view (Task 15) keeps chat drafts in chat mode, so mode ⟺ surface at commit — no dependency on `uiStore.activeView`, and `sendMessage` is unchanged.

**Files:**
- Modify: `src/domain/sessionService.ts` (`configFromDraft` ~356-365 only)
- Test: `src/domain/sessionService.configFromDraft.test.ts`

- [ ] **Step 1: Rewrite the failing test (single-arg, surface from mode)**

Replace the `describe('configFromDraft', …)` cases (keep the `beforeEach` providers seed). Single-arg calls; the baseURL-override test stays as-is:

```ts
  it('null draft → default config + surface chat (no cwd)', () => {
    const cfg = configFromDraft(null)
    expect(cfg.surface).toBe('chat')
    expect(cfg.cwd).toBeUndefined()
    expect(cfg.llmProvider).toBe('deepseek')
  })
  it('project draft → surface code + keeps cwd', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'project', cwd: '/p', text: '' })
    expect(cfg.surface).toBe('code')
    expect(cfg.cwd).toBe('/p')
  })
  it('chat draft → surface chat, no cwd', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '' })
    expect(cfg.surface).toBe('chat')
    expect(cfg.cwd).toBeUndefined()
  })
  it('draft without modelKey → default llmProvider', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '' })
    expect(cfg.llmProvider).toBe('deepseek')
    expect(cfg.agentId).toBeUndefined()
  })
  it('modelKey maps llmProvider + model + baseURL from catalog', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '', modelKey: 'openai/gpt-4o' })
    expect(cfg.llmProvider).toBe('openai')
    expect(cfg.model).toBe('gpt-4o')
    expect(cfg.baseURL).toBe('https://api.openai.com/v1')
  })
  it('project draft with modelKey keeps cwd and resolves model', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'project', cwd: '/work', text: '', modelKey: 'openai/gpt-4o' })
    expect(cfg.cwd).toBe('/work')
    expect(cfg.llmProvider).toBe('openai')
  })
  it('never sets agentId', () => {
    expect('agentId' in configFromDraft({ tempId: 't', mode: 'chat', text: '', modelKey: 'openai/gpt-4o' })).toBe(false)
  })
  it('project (code) draft carries permissionMode', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'project', cwd: '/p', text: '', permissionMode: 'full' })
    expect(cfg.permissionMode).toBe('full')
  })
  it('chat draft ignores permissionMode (sandbox, no picker)', () => {
    const cfg = configFromDraft({ tempId: 't', mode: 'chat', text: '', permissionMode: 'full' })
    expect(cfg.permissionMode).toBeUndefined()
  })
```

- [ ] **Step 2: Run the test (red)**

Run: `yarn vitest run src/domain/sessionService.configFromDraft.test.ts`
Expected: FAIL — `cfg.surface` is undefined; the chat-ignores-permissionMode case fails.

- [ ] **Step 3: Implement (only the function; `sendMessage` is unchanged)**

Replace `configFromDraft` (~356-365) in `src/domain/sessionService.ts`:

```ts
/** Build the committed SessionConfig from the current draft. Surface is derived from the draft
 *  mode — a project draft (folder picked) is a Code conversation; a chat draft is a sandboxed
 *  Chat conversation. The Chat new-conversation view keeps chat drafts in chat mode, so the chat
 *  branch never carries a cwd/permissionMode (Chat is picker-less). */
export function configFromDraft(draft: Draft | null): SessionConfig {
  const surface: 'chat' | 'code' = draft?.mode === 'project' ? 'code' : 'chat'
  const base: SessionConfig =
    surface === 'code' && draft?.cwd
      ? { ...DEFAULT_CONFIG, surface, cwd: draft.cwd }
      : { ...DEFAULT_CONFIG, surface }
  const withMode: SessionConfig =
    surface === 'code' && draft?.permissionMode ? { ...base, permissionMode: draft.permissionMode } : base
  if (!draft?.modelKey) return withMode
  const { catalog, config } = useProvidersStore.getState()
  const { llmProvider, model, baseURL } = resolveModelConfig(catalog, config, draft.modelKey)
  return { ...withMode, llmProvider, model, ...(baseURL ? { baseURL } : {}) }
}
```

The `sendMessage` caller already calls `configFromDraft(draft)` — leave it unchanged.

- [ ] **Step 4: Run the test (green) + type-check**

Run: `yarn vitest run src/domain/sessionService.configFromDraft.test.ts`
Expected: PASS.
Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionService.ts src/domain/sessionService.configFromDraft.test.ts
git commit -m "feat(domain): configFromDraft sets surface from the draft mode"
```

---

# Slice C — uiStore + per-surface restoration

### Task 8: uiStore — `code` view, chat-panel state, per-surface ids, persist

**Files:**
- Modify: `src/store/uiStore.ts`
- Test: `src/store/uiStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/store/uiStore.test.ts`:

```ts
describe('uiStore - code surface', () => {
  beforeEach(() => useUiStore.setState({ activeView: 'chat', chatPanelOpen: false, selectedArtifactPath: null, chatSessionId: null, codeSessionId: null }))

  it('setActiveView accepts code', () => {
    useUiStore.getState().setActiveView('code')
    expect(useUiStore.getState().activeView).toBe('code')
  })
  it('toggleChatPanel / setChatPanelOpen drive the chat preview panel', () => {
    useUiStore.getState().toggleChatPanel()
    expect(useUiStore.getState().chatPanelOpen).toBe(true)
    useUiStore.getState().setChatPanelOpen(false)
    expect(useUiStore.getState().chatPanelOpen).toBe(false)
  })
  it('setSelectedArtifactPath stores + clears the selected file', () => {
    useUiStore.getState().setSelectedArtifactPath('/a.md')
    expect(useUiStore.getState().selectedArtifactPath).toBe('/a.md')
    useUiStore.getState().setSelectedArtifactPath(null)
    expect(useUiStore.getState().selectedArtifactPath).toBeNull()
  })
  it('per-surface conversation ids are independent', () => {
    useUiStore.getState().setChatSessionId('h1')
    useUiStore.getState().setCodeSessionId('c1')
    expect(useUiStore.getState().chatSessionId).toBe('h1')
    expect(useUiStore.getState().codeSessionId).toBe('c1')
  })
})
```

- [ ] **Step 2: Run the tests (red)**

Run: `yarn vitest run src/store/uiStore.test.ts`
Expected: FAIL — new fields/actions undefined; `setActiveView('code')` is a type error at build but the runtime test fails on the missing actions.

- [ ] **Step 3: Implement**

Rewrite `src/store/uiStore.ts`. Change the `ActiveView` type, add the new state, and wrap the store in `persist` (only `codeSessionId` is persisted, mirroring `draftStore`'s memory-storage fallback):

```ts
import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import type { CheckpointMode } from '@hip/protocol'

export type ArtifactTab = 'files' | 'agents' | 'timeline' | 'changes'

export type ActiveView = 'chat' | 'code' | 'settings'

interface UiState {
  collapsed: boolean
  setCollapsed: (v: boolean) => void
  toggleCollapsed: () => void

  settingsNavCollapsed: boolean
  setSettingsNavCollapsed: (v: boolean) => void
  toggleSettingsNav: () => void

  search: string
  setSearch: (q: string) => void

  scrollTargetMessageId: string | null
  setScrollTarget: (id: string | null) => void

  // Code surface: the four-tab ArtifactPanel.
  panelOpen: boolean
  activeTab: ArtifactTab
  setTab: (t: ArtifactTab) => void
  togglePanel: () => void
  setPanelOpen: (v: boolean) => void

  // Chat surface: the slim preview/artifacts panel.
  chatPanelOpen: boolean
  toggleChatPanel: () => void
  setChatPanelOpen: (v: boolean) => void
  selectedArtifactPath: string | null
  setSelectedArtifactPath: (p: string | null) => void

  // Per-surface open conversation. codeSessionId is persisted (Code restores last on launch);
  // chatSessionId is in-memory only (Chat opens new on cold launch — industry norm).
  chatSessionId: string | null
  setChatSessionId: (id: string | null) => void
  codeSessionId: string | null
  setCodeSessionId: (id: string | null) => void

  activeView: ActiveView
  setActiveView: (v: ActiveView) => void

  diffViewMode: 'unified' | 'split'
  setDiffViewMode: (m: 'unified' | 'split') => void

  checkpointMode: CheckpointMode
  setCheckpointMode: (m: CheckpointMode) => void
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

const storage = createJSONStorage<{ codeSessionId: string | null }>(() =>
  typeof localStorage !== 'undefined' ? localStorage : memoryStorage(),
)

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      collapsed: false,
      setCollapsed: (v) => set((s) => (s.collapsed === v ? s : { collapsed: v })),
      toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),

      settingsNavCollapsed: false,
      setSettingsNavCollapsed: (v) =>
        set((s) => (s.settingsNavCollapsed === v ? s : { settingsNavCollapsed: v })),
      toggleSettingsNav: () => set((s) => ({ settingsNavCollapsed: !s.settingsNavCollapsed })),

      search: '',
      setSearch: (q) => set({ search: q }),

      scrollTargetMessageId: null,
      setScrollTarget: (id) => set((s) => (s.scrollTargetMessageId === id ? s : { scrollTargetMessageId: id })),

      panelOpen: false,
      activeTab: 'agents',
      setTab: (t) => set({ activeTab: t }),
      togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
      setPanelOpen: (v) => set((s) => (s.panelOpen === v ? s : { panelOpen: v })),

      chatPanelOpen: false,
      toggleChatPanel: () => set((s) => ({ chatPanelOpen: !s.chatPanelOpen })),
      setChatPanelOpen: (v) => set((s) => (s.chatPanelOpen === v ? s : { chatPanelOpen: v })),
      selectedArtifactPath: null,
      setSelectedArtifactPath: (p) => set((s) => (s.selectedArtifactPath === p ? s : { selectedArtifactPath: p })),

      chatSessionId: null,
      setChatSessionId: (id) => set((s) => (s.chatSessionId === id ? s : { chatSessionId: id })),
      codeSessionId: null,
      setCodeSessionId: (id) => set((s) => (s.codeSessionId === id ? s : { codeSessionId: id })),

      activeView: 'chat',
      setActiveView: (v) => set((s) => (s.activeView === v ? s : { activeView: v })),

      diffViewMode: 'unified',
      setDiffViewMode: (m) => set({ diffViewMode: m }),

      checkpointMode: 'this-turn',
      setCheckpointMode: (m) => set({ checkpointMode: m }),
    }),
    { name: 'hip-ui', storage, partialize: (s) => ({ codeSessionId: s.codeSessionId }) },
  ),
)
```

- [ ] **Step 4: Run the tests (green)**

Run: `yarn vitest run src/store/uiStore.test.ts`
Expected: PASS (existing activeView/panel tests still pass; persist is transparent with memoryStorage).

- [ ] **Step 5: Commit**

```bash
git add src/store/uiStore.ts src/store/uiStore.test.ts
git commit -m "feat(uiStore): code view + chat-panel state + per-surface ids (persist codeSessionId)"
```

---

### Task 9: `sessionService.setSurface` + per-surface bookkeeping

**Files:**
- Modify: `src/domain/sessionService.ts` (imports; `selectSession` ~147-160; `createSession` ~139-145; `deleteSession` ~162-165; add `setSurface`)
- Test: `src/domain/sessionService.setSurface.test.ts` *(new)*

- [ ] **Step 1: Write the failing test**

Create `src/domain/sessionService.setSurface.test.ts`, using the repo's `FakeTransport` pattern (mirror `src/domain/sessionService.test.ts`) so no live WebSocket is needed:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { ClientMessage, ServerMessage } from '@hip/protocol'
import { SessionService } from './sessionService'
import { useDomainStore, type SessionVM } from './sessionStore'
import { useUiStore } from '@/store/uiStore'
import type { ConnectionStatus, Transport } from './transport'

class FakeTransport implements Transport {
  sent: ClientMessage[] = []
  async connect() {}
  disconnect() {}
  send(msg: ClientMessage) { this.sent.push(msg) }
  onMessage(_h: (m: ServerMessage) => void) { return () => {} }
  onStatus(_h: (s: ConnectionStatus) => void) { return () => {} }
}

function vm(id: string, surface: 'chat' | 'code'): SessionVM {
  return { id, config: { llmProvider: 'd', model: '', tools: [], surface }, title: 't', preview: '', updatedAtMs: 1, loaded: true, messages: [], status: 'idle', error: null, interrupt: null }
}

let svc: SessionService
beforeEach(() => {
  svc = new SessionService(new FakeTransport())
  useDomainStore.setState({ sessions: [vm('h1', 'chat'), vm('c1', 'code')], activeSessionId: null })
  useUiStore.setState({ activeView: 'chat', chatSessionId: null, codeSessionId: null })
})

describe('setSurface', () => {
  it('entering code restores its remembered conversation', () => {
    useUiStore.setState({ codeSessionId: 'c1' })
    svc.setSurface('code')
    expect(useUiStore.getState().activeView).toBe('code')
    expect(useDomainStore.getState().activeSessionId).toBe('c1')
  })
  it('entering code with no/invalid remembered id shows new-conversation', () => {
    useUiStore.setState({ codeSessionId: 'gone' })
    svc.setSurface('code')
    expect(useDomainStore.getState().activeSessionId).toBeNull()
  })
  it('snapshots the leaving surface, then restores it on return', () => {
    useDomainStore.setState({ activeSessionId: 'h1' })
    svc.setSurface('code')   // snapshots chatSessionId = h1
    expect(useUiStore.getState().chatSessionId).toBe('h1')
    svc.setSurface('chat')
    expect(useDomainStore.getState().activeSessionId).toBe('h1')
  })
  it('refuses to restore a conversation from the wrong surface', () => {
    useUiStore.setState({ codeSessionId: 'h1' }) // h1 is a chat session
    svc.setSurface('code')
    expect(useDomainStore.getState().activeSessionId).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test (red)**

Run: `yarn vitest run src/domain/sessionService.setSurface.test.ts`
Expected: FAIL — `setSurface is not a function`.

- [ ] **Step 3: Implement**

In `src/domain/sessionService.ts`:

Add to the imports (top) the frontend `surfaceOf`:
```ts
import { surfaceOf } from '@/lib/sessions'
```
(`useUiStore` is already imported.)

Add a private helper + `setSurface` as methods on `SessionService` (place after `selectSession`):

```ts
  /** Remember the currently-open conversation for the active surface (so returning restores it,
   *  and so Code's persisted last-conversation pointer stays fresh across launches). */
  private rememberActiveForSurface(id: string | null): void {
    const view = useUiStore.getState().activeView
    if (view === 'chat') useUiStore.getState().setChatSessionId(id)
    else if (view === 'code') useUiStore.getState().setCodeSessionId(id)
  }

  /** Switch the active top-level surface. Snapshots the leaving surface's open conversation, then
   *  restores the entering surface's (validated against the loaded list + its surface). Code restores
   *  its last conversation; Chat starts at new-conversation on cold launch (chatSessionId starts null). */
  setSurface(view: 'chat' | 'code'): void {
    const cur = useUiStore.getState().activeView
    const activeId = useDomainStore.getState().activeSessionId
    if (cur === 'chat') useUiStore.getState().setChatSessionId(activeId)
    else if (cur === 'code') useUiStore.getState().setCodeSessionId(activeId)
    useUiStore.getState().setActiveView(view)
    const want = view === 'chat' ? useUiStore.getState().chatSessionId : useUiStore.getState().codeSessionId
    const sessions = useDomainStore.getState().sessions
    if (want != null && sessions.some((s) => s.id === want && surfaceOf(s.config) === view)) {
      this.selectSession(want)
    } else {
      useDomainStore.getState().deselect()
    }
  }
```

In `selectSession` (~147-160), after `useDomainStore.getState().selectSession(id)`, remember it for the active surface (so clicking a sidebar item updates the per-surface pointer):

```ts
  selectSession(id: string, messageId?: string): void {
    useDomainStore.getState().selectSession(id)
    this.rememberActiveForSurface(id)
    // …unchanged: lazy load, diff summary, checkpoint list, scroll target…
```

In `createSession` (~139-145), remember the new id for the active surface:

```ts
  createSession(config: SessionConfig = DEFAULT_CONFIG): string {
    const id = nanoid()
    const enriched: SessionConfig = { ...config, language: currentLanguage() }
    useDomainStore.getState().createSession(id, enriched)
    this.rememberActiveForSurface(id)
    this.transport.send({ type: 'session:create', id, config: enriched })
    return id
  }
```

In `deleteSession` (~162-165), clear any per-surface pointer that referenced the deleted session:

```ts
  deleteSession(id: string): void {
    useDomainStore.getState().deleteSession(id)
    if (useUiStore.getState().chatSessionId === id) useUiStore.getState().setChatSessionId(null)
    if (useUiStore.getState().codeSessionId === id) useUiStore.getState().setCodeSessionId(null)
    this.transport.send({ type: 'session:delete', sessionId: id })
  }
```

- [ ] **Step 4: Run the test (green) + type-check**

Run: `yarn vitest run src/domain/sessionService.setSurface.test.ts`
Expected: PASS.
Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionService.ts src/domain/sessionService.setSurface.test.ts
git commit -m "feat(domain): setSurface + per-surface conversation bookkeeping"
```

---

# Slice D — Navigation, layout, composer

### Task 10: i18n keys (all three locales)

**Files:**
- Modify: `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`

- [ ] **Step 1: Add `nav.code`**

In each locale's `nav` block (en.ts ~395-398; same key in zh-CN.ts / zh-TW.ts):
- en: `code: 'Code',`
- zh-CN: `code: '代码',`
- zh-TW: `code: '程式碼',`

- [ ] **Step 2: Add code new-conversation + preview keys to the `chat` block**

Add to each locale's `chat` block:
- en: `codeGreeting: 'What should we build?',` and `codeNeedFolder: 'Choose a project folder to start coding',`
- zh-CN: `codeGreeting: '我们来写点什么？',` and `codeNeedFolder: '选择一个项目文件夹以开始编码',`
- zh-TW: `codeGreeting: '我們來寫點什麼？',` and `codeNeedFolder: '選擇一個專案資料夾以開始編碼',`

- [ ] **Step 3: Add preview-panel keys to the `artifact` block**

Add to each locale's `artifact` block:
- en: `noArtifacts: 'Generated documents and images will appear here',`, `copyArtifact: 'Copy',`, `downloadArtifact: 'Download',`
- zh-CN: `noArtifacts: '智能体生成的文档与图片会显示在这里',`, `copyArtifact: '复制',`, `downloadArtifact: '下载',`
- zh-TW: `noArtifacts: '智慧代理產生的文件與圖片會顯示在這裡',`, `copyArtifact: '複製',`, `downloadArtifact: '下載',`

- [ ] **Step 4: Type-check**

Run: `yarn type-check`
Expected: PASS. (The `as const` resources widen the i18n key union automatically; en.ts is the key source of truth — keep zh-CN/zh-TW key sets identical to en.)

- [ ] **Step 5: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "i18n(surface): nav.code + code greeting/hint + preview-panel keys"
```

---

### Task 11: MenuRail — Code rail button

**Files:**
- Modify: `src/components/rail/MenuRail.tsx`

- [ ] **Step 1: Implement**

In `src/components/rail/MenuRail.tsx`:

Add `FolderGit2` to the lucide import (line 4):
```ts
import { MessageSquare, FolderGit2, Settings, LogOut } from 'lucide-react'
```
Add the sessionService import (with the existing `@/domain` usage pattern):
```ts
import { sessionService } from '@/domain'
```
Replace the `<nav>` block (~45-52) so Chat and Code both switch surfaces via `sessionService.setSurface`, and Code is highlighted on `activeView === 'code'`:

```tsx
      <nav className="mt-3 flex w-full flex-col items-center gap-1">
        <RailButton
          icon={MessageSquare}
          label={t('nav.chat')}
          active={activeView === 'chat'}
          onClick={() => sessionService.setSurface('chat')}
        />
        <RailButton
          icon={FolderGit2}
          label={t('nav.code')}
          active={activeView === 'code'}
          onClick={() => sessionService.setSurface('code')}
        />
      </nav>
```

(The avatar dropdown's Settings item keeps `setActiveView('settings')`.)

- [ ] **Step 2: Verify**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/rail/MenuRail.tsx
git commit -m "feat(rail): Code surface button"
```

---

### Task 12: TitleBar + ChatTitleBar render for the Code surface

> The AppLayout right-panel swap depends on `PreviewPanel` (Task 19), so it is deferred to **Task 20**. This task only adapts the title bars (no forward dependency), so it type-checks green on its own.

**Files:**
- Modify: `src/components/layout/TitleBar.tsx`, `src/components/layout/ChatTitleBar.tsx`

- [ ] **Step 1: TitleBar — render ChatTitleBar for code too**

In `src/components/layout/TitleBar.tsx`, change the conditional so the conversation title bar shows for chat AND code:
```tsx
      {activeView === 'settings' ? (
        <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 truncate text-body font-medium text-ink">
          {t('settings.title')}
        </span>
      ) : (
        <ChatTitleBar />
      )}
```

- [ ] **Step 2: ChatTitleBar — surface-aware panel toggle**

In `src/components/layout/ChatTitleBar.tsx`, read the active view + both toggles and pick the right one (~27-36 region):
```ts
  const activeView = useUiStore((s) => s.activeView)
  const togglePanel = useUiStore((s) => s.togglePanel)
  const toggleChatPanel = useUiStore((s) => s.toggleChatPanel)
  const onTogglePanel = activeView === 'code' ? togglePanel : toggleChatPanel
```
Change the toggle button's handler (~90-100) from `onClick={togglePanel}` to `onClick={onTogglePanel}`.

- [ ] **Step 3: Verify**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/layout/TitleBar.tsx src/components/layout/ChatTitleBar.tsx
git commit -m "feat(layout): conversation title bar (+ surface-aware panel toggle) for Code"
```

---

### Task 13: SessionList — filter by surface

**Files:**
- Modify: `src/components/sidebar/SessionList.tsx`

- [ ] **Step 1: Implement**

In `src/components/sidebar/SessionList.tsx`:

Add imports:
```ts
import { filterBySurface } from '@/lib/sessions'
```
Read the active view and restrict the list + the content-hit lookups to the current surface. Replace the `const local = filterSessions(sessions, q)` region (~9-25) with:

```ts
  const activeView = useUiStore((s) => s.activeView)
  const surface = activeView === 'code' ? 'code' : 'chat'
  const sessions = filterBySurface(useSessions(), surface)
  const search = useUiStore((s) => s.search)
  const activeSessionId = useActiveSessionId()
  const hits = useSearchHits()

  const q = search.trim()
  const local = filterSessions(sessions, q)
  const surfaceIds = new Set(sessions.map((s) => s.id))
  const seen = new Set(local.map((s) => s.id))
  const contentHits = q
    ? hits.filter((h) => {
        if (!h.sessionId || !surfaceIds.has(h.sessionId) || seen.has(h.sessionId)) return false
        seen.add(h.sessionId)
        return true
      })
    : []
```

(The `contentHits.map` lookup `sessions.find(...)` then resolves within the surface-filtered list — fine since `surfaceIds` already gated them.)

- [ ] **Step 2: Verify**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/SessionList.tsx
git commit -m "feat(sidebar): filter the conversation list by active surface"
```

---

### Task 14: Composer — `submitDisabled` prop

**Files:**
- Modify: `src/components/chat/Composer.tsx`

- [ ] **Step 1: Implement**

In `src/components/chat/Composer.tsx`, add `submitDisabled` to the props (after `leftSlot`):
```ts
  leftSlot,
  submitDisabled,
}: {
  …
  leftSlot?: React.ReactNode
  submitDisabled?: boolean
}) {
```
Respect it in the Enter handler:
```ts
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (!running && !submitDisabled) onSubmit()
          }
        }}
```
And in the send button's `disabled`:
```tsx
          <button
            onClick={onSubmit}
            disabled={!value.trim() || submitDisabled}
            data-testid="composer-send"
            …
```

- [ ] **Step 2: Verify**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/Composer.tsx
git commit -m "feat(composer): optional submitDisabled prop"
```

---

### Task 15: NewConversation — surface-aware

**Files:**
- Modify: `src/components/chat/NewConversation.tsx`

- [ ] **Step 1: Implement**

Replace `src/components/chat/NewConversation.tsx` with:

```tsx
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useDraftStore } from '@/store/draftStore'
import { useUiStore } from '@/store/uiStore'
import { sessionService } from '@/domain'
import { Composer } from './Composer'
import { FolderPill } from './FolderPill'
import { ModelPicker } from './ModelPicker'
import { PermissionModePicker } from './PermissionModePicker'

export function NewConversation() {
  const { t } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)
  const surface = activeView === 'code' ? 'code' : 'chat'
  const draft = useDraftStore((s) => s.draft)
  const text = draft?.text ?? ''

  // Ensure a draft exists; keep Chat drafts in chat mode so a leftover project draft (e.g. a
  // folder picked in Code, then switched to Chat without sending) can't commit as a Code session.
  // (configFromDraft derives surface from draft.mode, so mode must match the surface here.)
  useEffect(() => {
    useDraftStore.getState().ensureDraft()
    if (surface === 'chat' && useDraftStore.getState().draft?.mode === 'project') {
      useDraftStore.getState().clearProject()
    }
  }, [surface])

  // Code requires a project folder before the first send; Chat is always sandboxed.
  const hasFolder = draft?.mode === 'project' && !!draft.cwd
  const canSend = surface === 'chat' ? !!text.trim() : !!text.trim() && hasFolder

  const submit = () => {
    if (!canSend) return
    sessionService.sendMessage(text) // commit: creates the session (surface-aware) + resets the draft
  }

  return (
    <div className="flex flex-1 flex-col items-center overflow-y-auto px-5" data-testid="new-conversation">
      <div className="mt-[20vh] w-full max-w-3xl">
        <h1 className="mb-4 text-center text-display font-semibold text-ink">
          {surface === 'code' ? t('chat.codeGreeting') : t('chat.newConversationGreeting')}
        </h1>
        <Composer
          value={text}
          onChange={(v) => useDraftStore.getState().setText(v)}
          onSubmit={submit}
          autoFocus
          submitDisabled={!canSend}
          leftSlot={surface === 'code' ? <><ModelPicker /><PermissionModePicker /></> : <ModelPicker />}
        />
        {surface === 'code' && (
          <div className="mt-2 flex flex-col items-center gap-1">
            <FolderPill />
            {!hasFolder && <span className="text-meta text-ink-tertiary">{t('chat.codeNeedFolder')}</span>}
          </div>
        )}
      </div>
    </div>
  )
}
```

(Chat no longer renders `FolderPill` or the permission picker; Code requires a folder before the send button enables.)

- [ ] **Step 2: Verify**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/NewConversation.tsx
git commit -m "feat(chat): surface-aware new-conversation (Code folder+permission; Chat sandbox)"
```

---

### Task 16: InputBar — surface-aware left slot

**Files:**
- Modify: `src/components/chat/InputBar.tsx`

- [ ] **Step 1: Implement**

In `src/components/chat/InputBar.tsx`, show the permission picker only for a committed Code session:

```tsx
import { useState } from 'react'
import { Composer } from './Composer'
import { ModelPicker } from './ModelPicker'
import { PermissionModePicker } from './PermissionModePicker'
import { sessionService, useActiveSession, useActiveSessionStatus, useConnectionStatus } from '@/domain'
import { surfaceOf } from '@/lib/sessions'

export function InputBar() {
  const [value, setValue] = useState('')
  const status = useActiveSessionStatus()
  const connection = useConnectionStatus()
  const active = useActiveSession()
  const isCode = active ? surfaceOf(active.config) === 'code' : false
  const reconnecting = status === 'running' && connection !== 'connected'
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
          reconnecting={reconnecting}
          leftSlot={isCode ? <><ModelPicker /><PermissionModePicker /></> : <ModelPicker />}
        />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/InputBar.tsx
git commit -m "feat(chat): InputBar shows the permission picker only for Code sessions"
```

---

# Slice E — Chat preview panel (Artifacts)

### Task 17: `collectConversationArtifacts(messages)`

**Files:**
- Modify: `src/lib/renderedArtifacts.ts`
- Test: `src/lib/renderedArtifacts.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/renderedArtifacts.test.ts` (reuse its existing `ToolCall`/`Message` helpers; if it only builds `ToolCall[]`, wrap them in minimal messages):

```ts
import { collectConversationArtifacts } from './renderedArtifacts'
import type { Message } from '@hip/protocol'

function asstMsg(id: string, toolCalls: Message['toolCalls']): Message {
  return { id, role: 'assistant', content: '', timestamp: 1, toolCalls }
}
const w = (callId: string, path: string, seq: number) =>
  ({ callId, agentId: 'supervisor', name: 'write_file', input: JSON.stringify({ path }), status: 'finished' as const, seq })

describe('collectConversationArtifacts', () => {
  it('aggregates renderable artifacts across assistant turns, last write wins, first-seen order', () => {
    const messages: Message[] = [
      asstMsg('a', [w('1', '/doc.md', 0), w('2', '/pic.png', 1)]),
      { id: 'u', role: 'user', content: 'x', timestamp: 2 },
      asstMsg('b', [w('3', '/doc.md', 0)]), // re-write of doc.md → stays in first-seen position
    ]
    const out = collectConversationArtifacts(messages)
    expect(out.map((a) => a.path)).toEqual(['/doc.md', '/pic.png'])
  })
  it('ignores user messages and non-renderable writes; empty input → []', () => {
    expect(collectConversationArtifacts([])).toEqual([])
    expect(collectConversationArtifacts([asstMsg('a', [w('1', '/main.ts', 0)])])).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test (red)**

Run: `yarn vitest run src/lib/renderedArtifacts.test.ts`
Expected: FAIL — `collectConversationArtifacts` not exported.

- [ ] **Step 3: Implement**

Append to `src/lib/renderedArtifacts.ts`:

```ts
import type { Message } from '@hip/protocol'

/** Conversation-level rollup of renderable artifacts: the union of every assistant turn's
 *  extractRenderedArtifacts, deduped by path keeping the LAST write while preserving first-seen
 *  order. Drives the Chat surface's PreviewPanel list. Never throws. */
export function collectConversationArtifacts(messages: Message[]): RenderedArtifact[] {
  const byPath = new Map<string, RenderedArtifact>()
  const order: string[] = []
  for (const m of messages) {
    if (m.role !== 'assistant') continue
    for (const a of extractRenderedArtifacts(m.toolCalls)) {
      if (!byPath.has(a.path)) order.push(a.path)
      byPath.set(a.path, a)
    }
  }
  return order.map((p) => byPath.get(p)!)
}
```

- [ ] **Step 4: Run the test (green)**

Run: `yarn vitest run src/lib/renderedArtifacts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/renderedArtifacts.ts src/lib/renderedArtifacts.test.ts
git commit -m "feat(artifacts): collectConversationArtifacts (conversation-level rollup)"
```

---

### Task 18: ArtifactCard — export `iconFor`; surface-aware `open()`

**Files:**
- Modify: `src/components/artifact/ArtifactCard.tsx`

- [ ] **Step 1: Export `iconFor`**

Change `function iconFor(` (line 11) to `export function iconFor(` so the PreviewPanel reuses the same kind→icon map.

- [ ] **Step 2: Surface-aware open**

Replace the `open` function body (~26-41) so Chat routes to the preview panel and Code keeps the files tab:

```tsx
  const open = (path: string) => {
    if (!scopeId) return
    // Drive the existing FS preview pipeline (same as FileTree's Node.onClick).
    useFsStore.getState().setActive(scopeId, path)
    if (isDraft) sessionService.readDraftFile(scopeId, path)
    else sessionService.readFile(scopeId, path)
    const ui = useUiStore.getState()
    if (ui.activeView === 'code') {
      // Code: open the artifact panel's Files tab (defer the tab switch one tick if it was closed).
      if (!ui.panelOpen) {
        ui.setPanelOpen(true)
        setTimeout(() => useUiStore.getState().setTab('files'), 0)
      } else {
        ui.setTab('files')
      }
    } else {
      // Chat: open the slim preview panel and select this artifact.
      ui.setSelectedArtifactPath(path)
      ui.setChatPanelOpen(true)
    }
  }
```

- [ ] **Step 3: Verify**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/artifact/ArtifactCard.tsx
git commit -m "feat(artifact): export iconFor; route ArtifactCard open by surface"
```

---

### Task 19: PreviewPanel component

**Files:**
- Create: `src/components/artifact/PreviewPanel.tsx`

- [ ] **Step 1: Implement**

Create `src/components/artifact/PreviewPanel.tsx`. It lists the conversation's produced artifacts (left) and renders the selected one via the existing `FilePreview` (right), with a Copy/Download/Close header. No tree, no git.

```tsx
import { useTranslation } from 'react-i18next'
import { X, Copy, Download } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useFsScope } from '@/store/useFsScope'
import { useFsStore } from '@/store/fsStore'
import { useActiveMessages, sessionService } from '@/domain'
import { collectConversationArtifacts } from '@/lib/renderedArtifacts'
import { iconFor } from './ArtifactCard'
import { FilePreview } from './FilePreview'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

/** Decode a base64 string to bytes (for downloading image/pdf artifacts). */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function PreviewPanel() {
  const { t } = useTranslation()
  const { scopeId, isDraft } = useFsScope()
  const messages = useActiveMessages()
  const artifacts = collectConversationArtifacts(messages)
  const selected = useUiStore((s) => s.selectedArtifactPath)
  const toggleChatPanel = useUiStore((s) => s.toggleChatPanel)
  const preview = useFsStore((s) => (scopeId ? s.bySession[scopeId]?.preview : undefined))

  const select = (path: string) => {
    if (!scopeId) return
    useFsStore.getState().setActive(scopeId, path)
    if (isDraft) sessionService.readDraftFile(scopeId, path)
    else sessionService.readFile(scopeId, path)
    useUiStore.getState().setSelectedArtifactPath(path)
  }

  const ready = preview && preview.status === 'ready' && preview.content != null
  const copy = () => { if (ready && preview.encoding !== 'base64') void navigator.clipboard?.writeText(preview.content!) }
  const download = () => {
    if (!ready || selected == null) return
    const name = selected.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || 'artifact'
    const blob = preview.encoding === 'base64'
      ? new Blob([base64ToBytes(preview.content!)], { type: preview.mimeType || 'application/octet-stream' })
      : new Blob([preview.content!], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = name; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex h-full animate-panel-in flex-col bg-surface">
      <div data-tauri-drag-region className="flex h-11 shrink-0 items-center justify-between border-b border-border px-2">
        <span className="truncate pl-1 text-body font-medium text-ink" data-tauri-drag-region="false">
          {selected ? (selected.split(/[/\\]/).pop() || selected) : t('artifact.files')}
        </span>
        <div className="flex items-center gap-1" data-tauri-drag-region="false">
          <Button variant="ghost" size="icon" onClick={copy} title={t('artifact.copyArtifact')} disabled={!ready || preview?.encoding === 'base64'}>
            <Copy size={15} />
          </Button>
          <Button variant="ghost" size="icon" onClick={download} title={t('artifact.downloadArtifact')} disabled={!ready}>
            <Download size={15} />
          </Button>
          <Button variant="ghost" size="icon" onClick={toggleChatPanel} title={t('artifact.closePanel')}>
            <X size={16} />
          </Button>
        </div>
      </div>

      {artifacts.length === 0 ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-body text-ink-tertiary" data-testid="preview-no-artifacts">
          {t('artifact.noArtifacts')}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <ul className="w-40 shrink-0 overflow-y-auto border-r border-border py-1">
            {artifacts.map((a) => {
              const Icon = iconFor(a.kind)
              return (
                <li key={a.path}>
                  <button
                    type="button"
                    onClick={() => select(a.path)}
                    title={a.path}
                    className={cn(
                      'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-meta transition-colors',
                      selected === a.path ? 'bg-accent-active text-accent-strong' : 'text-ink hover:bg-surface-muted',
                    )}
                  >
                    <Icon size={14} className="shrink-0 text-ink-tertiary" />
                    <span className="truncate">{a.name}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="min-w-0 flex-1"><FilePreview /></div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify (whole app type-checks + builds)**

Run: `yarn type-check`
Expected: PASS (this resolves the `PreviewPanel` import added in Task 12).
Run: `yarn build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/artifact/PreviewPanel.tsx
git commit -m "feat(artifact): Chat PreviewPanel (tree-less artifacts list + FilePreview)"
```

---

### Task 20: AppLayout — surface-aware right panel (integration)

> Runs last because it imports `PreviewPanel` (Task 19) and uses the chat-panel state (Task 8) + the code title bar (Task 12). Now everything it references exists, so it type-checks + builds green.

**Files:**
- Modify: `src/routes/AppLayout.tsx`

- [ ] **Step 1: Implement**

In `src/routes/AppLayout.tsx`:

Add the import:
```ts
import { PreviewPanel } from '@/components/artifact/PreviewPanel'
```
Read the chat-panel state alongside the existing reads (~17-22):
```ts
  const chatPanelOpen = useUiStore((s) => s.chatPanelOpen)
  const setChatPanelOpen = useUiStore((s) => s.setChatPanelOpen)
```
Replace the `{panelOpen && ( … ArtifactPanel … )}` block (~81-99) with the surface-aware version:
```tsx
        {(() => {
          const codeOpen = activeView === 'code' && panelOpen
          const chatOpen = activeView === 'chat' && chatPanelOpen
          if (!codeOpen && !chatOpen) return null
          return (
            <>
              <PanelResizeHandle className="group relative z-10 w-2 -mx-1 bg-transparent">
                <div className="mx-auto h-full w-px bg-border transition-colors group-hover:bg-accent group-data-[resize-handle-state=drag]:bg-accent" />
              </PanelResizeHandle>
              <Panel
                defaultSize={26}
                minSize={18}
                maxSize={65}
                collapsible
                collapsedSize={0}
                onCollapse={() => (codeOpen ? setPanelOpen(false) : setChatPanelOpen(false))}
                onExpand={() => (codeOpen ? setPanelOpen(true) : setChatPanelOpen(true))}
              >
                {codeOpen ? <ArtifactPanel /> : <PreviewPanel />}
              </Panel>
            </>
          )
        })()}
```
Change the SidebarPeek guard (~102) to show on both conversation surfaces:
```tsx
        {activeView !== 'settings' && <SidebarPeek />}
```

- [ ] **Step 2: Verify (whole app)**

Run: `yarn type-check && yarn build`
Expected: both PASS.

- [ ] **Step 3: Commit**

```bash
git add src/routes/AppLayout.tsx
git commit -m "feat(layout): surface-aware right panel (ArtifactPanel vs PreviewPanel)"
```

---

# Final verification

- [ ] **Step 1: Full type-check + build**

Run: `yarn type-check && yarn build`
Expected: both PASS.

- [ ] **Step 2: Full test suite, paid-free**

```bash
mv ~/.hip/config/auth.json ~/.hip/config/auth.json.bak 2>/dev/null || true
yarn test
mv ~/.hip/config/auth.json.bak ~/.hip/config/auth.json 2>/dev/null || true
```
Expected: all suites PASS (paid real-LLM suites skip with no key).

- [ ] **Step 3: Dispatch the final whole-implementation code review** (per subagent-driven-development), then hand off via `superpowers:finishing-a-development-branch`.

- [ ] **Step 4: Manual `yarn tauri dev` GUI acceptance** (not a code step — for the human):
  - Rail shows Chat + Code; switching highlights the right one.
  - Chat: no folder picker, no permission picker; sending works (sandbox); produced doc/image opens the slim PreviewPanel (list + render), no tree/git.
  - Code: folder picker + permission picker; send disabled until a folder is chosen; ArtifactPanel (files/changes/timeline) works; git tabs gated as before.
  - Sidebars are independent per surface; conversations don't cross.
  - Restart the app: Chat opens new-conversation; Code restores its last conversation + folder.
  - Delete a remembered Code conversation, switch to Code → falls back to new-conversation (no crash).

---

## Notes on decisions baked into this plan

- **Surface is derived from the draft mode at commit** (`configFromDraft(draft)`: `mode 'project'` ⇒ Code, `'chat'` ⇒ Chat). The Chat new-conversation view forces chat drafts to chat mode on entry, so a folder picked in Code and abandoned can't leak into a Chat send. This keeps `sendMessage` unchanged and avoids a cross-task type dependency on the `ActiveView` union.
- **No new sidecar permission logic.** A Chat session is simply a no-cwd session: the sidecar assigns a scratch cwd and the default `edit` mode jails all tools to that sandbox (with `run_script` HITL-gated) — exactly "all tools, sandbox scope."
- **Restoration is asymmetric and id-keyed.** Only `codeSessionId` is persisted (Code restores on launch); `chatSessionId` is in-memory (Chat opens new on cold launch). In-app surface switching restores both via the snapshot-on-leave logic. Pointers are validated against the loaded list + the session's own surface before selecting (dangling/cross-surface pointers fall back to new-conversation).
- **`SidebarToggle` is unchanged** — it already treats any non-settings view as the conversation sidebar, so Code works without edits.
