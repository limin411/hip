# Search Jump-to-Message Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking a search content-hit lands the user on the matched message (scroll-to-center + a ~2s fading highlight) and the sidebar snippet shows a real `<mark>` highlight instead of leaked `[brackets]`.

**Architecture:** A transient `scrollTargetMessageId` in `uiStore` carries the clicked hit's `messageId` from `SessionList` → `sessionService.selectSession(id, messageId?)` → `ChatPane`, which anchors each message with `data-message-id`, scrolls to + highlights the target, suppresses the slice-4 bottom-autoscroll while a target is pending, then clears the target. Separately, the sidecar FTS `snippet()` switches its delimiters from `[`/`]` to control-char sentinels (U+0001 / U+0002) that a new pure `splitSnippet` parses into marked/unmarked segments for `SessionItem` to render. No protocol change.

**Tech Stack:** React + Zustand (frontend), Vitest (Node, full ICU), better-sqlite3 FTS5 (sidecar), TypeScript, yarn workspaces. Spec: `docs/superpowers/specs/2026-06-10-search-jump-to-message-design.md`.

**Sentinel notation:** Throughout this plan the match delimiters are written as the JS escape literals `'\u0001'` (start) and `'\u0002'` (end). **Type them exactly as `\u0001` / `\u0002`** — never paste raw control bytes (they are invisible in editors and break diffs). On the sidecar side they are produced by SQLite's `char(1)` / `char(2)`.

**Conventions for this repo:**
- Pure lib + store + sidecar code is unit-tested (Vitest). Presentational React (ChatPane / SessionItem / SessionList wiring) is verified by `yarn type-check` + manual GUI acceptance — **no DOM/RTL tests** (project convention).
- Commit trailer is required on every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- Run the frontend test suite from the repo root with `yarn test`; type-check with `yarn type-check`. Sidecar tests run via root `yarn workspace @hip/sidecar test`.
- Branch is already `feat/search-jump-to-message` in the main working tree (no worktree).

---

## File Structure

**Create:**
- `src/lib/snippet.ts` — pure `splitSnippet(s)` splitting a sentinel-delimited string into ordered `{ text, mark }` segments.
- `src/lib/snippet.test.ts` — unit tests for `splitSnippet`.

**Modify:**
- `packages/sidecar/src/persistence/store.ts` — `search()` FTS `snippet()` delimiters → sentinels.
- `packages/sidecar/src/persistence/store.test.ts` — assert sentinel markers around an FTS match.
- `src/store/uiStore.ts` — add `scrollTargetMessageId` + `setScrollTarget`.
- `src/store/uiStore.test.ts` — tests for the new field/action.
- `src/domain/sessionService.ts` — `selectSession(id, messageId?)` sets the scroll target.
- `src/domain/sessionService.test.ts` — tests for the new param.
- `src/components/sidebar/SessionList.tsx` — content-hit `onSelect` carries `h.messageId`.
- `src/components/sidebar/SessionItem.tsx` — render `snippet` via `splitSnippet` + `<mark>`.
- `src/components/chat/ChatPane.tsx` — per-message anchor, target scroll+highlight effect, autoscroll coordination.

**Task order rationale:** Tasks 1–4 are independently testable units with no UI dependency (snippet parser, sidecar snippet producer, store field, service wiring). Tasks 5–7 are the presentational consumers (type-check only). Task 8 is the whole-suite verification gate. Each task leaves the build green.

---

### Task 1: `splitSnippet` pure parser

**Files:**
- Create: `src/lib/snippet.ts`
- Test: `src/lib/snippet.test.ts`

The sidecar emits search snippets where matched terms are wrapped in two control-char sentinels: `'\u0001'` (start of match) and `'\u0002'` (end of match). `splitSnippet` turns such a string into an ordered list of segments so the UI can render `mark` segments inside `<mark>` and the rest as plain text. A string with no sentinels (e.g. a title hit) yields a single unmarked segment.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/snippet.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { splitSnippet } from './snippet'

const S = '\u0001' // match start sentinel
const E = '\u0002' // match end sentinel

describe('splitSnippet', () => {
  it('no markers → a single unmarked segment', () => {
    expect(splitSnippet('plain title')).toEqual([{ text: 'plain title', mark: false }])
  })

  it('one match in the middle → text / mark / text', () => {
    expect(splitSnippet(`before ${S}match${E} after`)).toEqual([
      { text: 'before ', mark: false },
      { text: 'match', mark: true },
      { text: ' after', mark: false },
    ])
  })

  it('multiple matches', () => {
    expect(splitSnippet(`${S}a${E} mid ${S}b${E}`)).toEqual([
      { text: 'a', mark: true },
      { text: ' mid ', mark: false },
      { text: 'b', mark: true },
    ])
  })

  it('leading and trailing match (no surrounding plain text)', () => {
    expect(splitSnippet(`${S}only${E}`)).toEqual([{ text: 'only', mark: true }])
  })

  it('empty string → no segments', () => {
    expect(splitSnippet('')).toEqual([])
  })

  it('drops empty segments between adjacent markers', () => {
    expect(splitSnippet(`${S}b${E}${S}c${E}`)).toEqual([
      { text: 'b', mark: true },
      { text: 'c', mark: true },
    ])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test src/lib/snippet.test.ts`
Expected: FAIL — `Failed to resolve import "./snippet"` / `splitSnippet is not a function`.

- [ ] **Step 3: Implement `splitSnippet`**

Create `src/lib/snippet.ts`:

```ts
/** Sentinel control chars wrapping a matched term in a search snippet (set by the sidecar FTS query). */
const MARK_START = '\u0001'
const MARK_END = '\u0002'

export interface SnippetSegment {
  text: string
  mark: boolean
}

/**
 * Split a sentinel-delimited search snippet into ordered segments.
 * Text between U+0001 and U+0002 is a match (`mark: true`); everything else is plain (`mark: false`).
 * A string with no sentinels yields a single unmarked segment; empty segments are dropped.
 */
export function splitSnippet(s: string): SnippetSegment[] {
  const out: SnippetSegment[] = []
  let i = 0
  while (i < s.length) {
    const start = s.indexOf(MARK_START, i)
    if (start === -1) {
      if (i < s.length) out.push({ text: s.slice(i), mark: false })
      break
    }
    if (start > i) out.push({ text: s.slice(i, start), mark: false })
    const end = s.indexOf(MARK_END, start + 1)
    if (end === -1) {
      // Unterminated start sentinel: treat the remainder (minus the sentinel) as a match.
      out.push({ text: s.slice(start + 1), mark: true })
      break
    }
    if (end > start + 1) out.push({ text: s.slice(start + 1, end), mark: true })
    i = end + 1
  }
  return out
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test src/lib/snippet.test.ts`
Expected: PASS (6/6).

- [ ] **Step 5: Commit**

```bash
git add src/lib/snippet.ts src/lib/snippet.test.ts
git commit -m "feat(search): pure splitSnippet for sentinel-delimited highlight

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Sidecar FTS snippet uses sentinel delimiters

**Files:**
- Modify: `packages/sidecar/src/persistence/store.ts:161` (the `snippet(...)` call inside `search()`)
- Test: `packages/sidecar/src/persistence/store.test.ts`

The FTS query currently wraps matches in literal `[`/`]`, which leak into the sidebar as visible brackets. Switch to the control-char sentinels that `splitSnippet` (Task 1) parses, produced by SQLite's `char(1)` / `char(2)`. Only the FTS branch uses `snippet()`; the title branch (`snippet: t.title`) and the non-FTS LIKE fallback (`substr(...)`) emit no sentinels, which `splitSnippet` renders as a single unmarked segment — unchanged behavior.

- [ ] **Step 1: Write the failing test**

Add to `packages/sidecar/src/persistence/store.test.ts` (inside the `describe('SessionStore', …)` block, near the existing search tests around line 52):

```ts
  it('FTS content snippet wraps the match in sentinel delimiters', () => {
    store.insertSession({ id: 's1', title: '关于配置', config: cfg, createdAt: 1, updatedAt: 1 })
    store.insertMessage({ id: 'u1', sessionId: 's1', role: 'user', agentId: null, content: '未配置密钥请在设置中配置', timestamp: 1 })
    const hit = store.search('设置中').find((h) => h.messageId === 'u1')
    expect(hit).toBeDefined()
    // U+0001 / U+0002 wrap the matched term; the legacy '[' / ']' must be gone.
    expect(hit!.snippet).toContain('\u0001')
    expect(hit!.snippet).toContain('\u0002')
    expect(hit!.snippet).not.toContain('[')
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from repo root): `yarn workspace @hip/sidecar test store.test`
Expected: FAIL — the snippet contains `[`/`]`, not `\u0001`/`\u0002`.

> If the host's SQLite build lacks the trigram tokenizer, `ftsEnabled` is false and this FTS test cannot exercise the sentinel path. The existing `search finds a Chinese substring via FTS` test in this file relies on the same capability and currently passes, so FTS is available here — proceed. If it were unavailable, that existing test would already be failing; do not add an `ftsEnabled` guard the sibling test doesn't have.

- [ ] **Step 3: Change the snippet delimiters**

In `packages/sidecar/src/persistence/store.ts`, inside `search()`, change the FTS SELECT's `snippet(...)` call from:

```ts
          snippet(messages_fts, 0, '[', ']', '…', 12) AS snippet, m.timestamp AS timestamp
```

to:

```ts
          snippet(messages_fts, 0, char(1), char(2), '…', 12) AS snippet, m.timestamp AS timestamp
```

(`char(1)` / `char(2)` are the SQLite literals for the U+0001 / U+0002 sentinels — cleaner than embedding raw control bytes in the SQL string. The rest of the query — `FROM messages_fts JOIN … WHERE messages_fts MATCH ? ORDER BY rank LIMIT 50` — is unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn workspace @hip/sidecar test store.test`
Expected: PASS — the new test passes and the existing `search finds a Chinese substring via FTS and returns a snippet` / `search matches session titles too` tests still pass (they assert on `sessionId`/`messageId`, not snippet text).

- [ ] **Step 5: Commit**

```bash
git add packages/sidecar/src/persistence/store.ts packages/sidecar/src/persistence/store.test.ts
git commit -m "feat(sidecar): FTS snippet uses sentinel delimiters for highlight

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: `uiStore` transient scroll target

**Files:**
- Modify: `src/store/uiStore.ts`
- Test: `src/store/uiStore.test.ts`

A transient (not persisted) target message id, set when a search hit is clicked and cleared once `ChatPane` consumes it.

- [ ] **Step 1: Write the failing tests**

Add to `src/store/uiStore.test.ts` (new `describe` block at the end of the file):

```ts
describe('uiStore - scroll target', () => {
  it('initial scrollTargetMessageId is null', () => {
    useUiStore.setState({ scrollTargetMessageId: null })
    expect(useUiStore.getState().scrollTargetMessageId).toBeNull()
  })

  it('setScrollTarget stores an id and clears it with null', () => {
    useUiStore.getState().setScrollTarget('m42')
    expect(useUiStore.getState().scrollTargetMessageId).toBe('m42')
    useUiStore.getState().setScrollTarget(null)
    expect(useUiStore.getState().scrollTargetMessageId).toBeNull()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test src/store/uiStore.test.ts`
Expected: FAIL — `setScrollTarget is not a function` / `scrollTargetMessageId` undefined.

- [ ] **Step 3: Add the field and action**

In `src/store/uiStore.ts`, add to the `UiState` interface (after the `search` group, i.e. after `setSearch`):

```ts
  // Transient scroll target: the messageId of a clicked search hit. ChatPane scrolls
  // to it + briefly highlights it, then clears it. Not persisted.
  scrollTargetMessageId: string | null
  setScrollTarget: (id: string | null) => void
```

And in the `create<UiState>` store body (after the `search`/`setSearch` lines):

```ts
  scrollTargetMessageId: null,
  setScrollTarget: (id) => set((s) => (s.scrollTargetMessageId === id ? s : { scrollTargetMessageId: id })),
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test src/store/uiStore.test.ts`
Expected: PASS (existing panel/tab tests + 2 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/store/uiStore.ts src/store/uiStore.test.ts
git commit -m "feat(ui): transient scrollTargetMessageId in uiStore

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: `sessionService.selectSession(id, messageId?)` sets the target

**Files:**
- Modify: `src/domain/sessionService.ts:86-91` (the `selectSession` method) + imports
- Test: `src/domain/sessionService.test.ts`

`selectSession` gains an optional `messageId`. It runs its existing body (domain select + lazy `session:load` when `!loaded`) and then sets the scroll target to `messageId ?? null` — so a title/local click (no messageId) clears any stale target.

- [ ] **Step 1: Write the failing tests**

In `src/domain/sessionService.test.ts`, add the import near the existing imports at the top of the file:

```ts
import { useUiStore } from '@/store/uiStore'
```

In `beforeEach`, reset the target alongside the other stores:

```ts
  useUiStore.setState({ scrollTargetMessageId: null })
```

Add these tests inside the `describe('SessionService', …)` block:

```ts
  it('selectSession with a messageId sets activeSessionId and the scroll target', () => {
    const t = new FakeTransport()
    new SessionService(t).selectSession('s1', 'm9')
    expect(useDomainStore.getState().activeSessionId).toBe('s1')
    expect(useUiStore.getState().scrollTargetMessageId).toBe('m9')
  })

  it('selectSession without a messageId clears any stale scroll target', () => {
    useUiStore.setState({ scrollTargetMessageId: 'stale' })
    const t = new FakeTransport()
    new SessionService(t).selectSession('s1')
    expect(useUiStore.getState().scrollTargetMessageId).toBeNull()
  })

  it('selectSession lazy-loads history for an unloaded session and still sets the target', () => {
    useDomainStore.setState({
      sessions: [{ id: 's2', config: { llmProvider: 'deepseek', model: 'm', tools: [] }, title: 'T2', preview: 'P', updatedAtMs: 0, loaded: false, messages: [], status: 'idle', error: null }],
      activeSessionId: null,
    })
    const t = new FakeTransport()
    new SessionService(t).selectSession('s2', 'm1')
    expect(t.sent.some((m) => m.type === 'session:load' && (m as { sessionId: string }).sessionId === 's2')).toBe(true)
    expect(useUiStore.getState().scrollTargetMessageId).toBe('m1')
  })
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `yarn test src/domain/sessionService.test.ts`
Expected: FAIL — `selectSession` takes 1 arg; `scrollTargetMessageId` not set.

- [ ] **Step 3: Update `selectSession`**

In `src/domain/sessionService.ts`, add the import near the other store imports (after the `useDraftStore` import on line 8):

```ts
import { useUiStore } from '@/store/uiStore'
```

Replace the method (currently lines 86–91):

```ts
  selectSession(id: string): void {
    useDomainStore.getState().selectSession(id)
    // Lazily fetch history the first time a summary-only session is opened.
    const s = useDomainStore.getState().sessions.find((x) => x.id === id)
    if (s && !s.loaded) this.transport.send({ type: 'session:load', sessionId: id })
  }
```

with:

```ts
  selectSession(id: string, messageId?: string): void {
    useDomainStore.getState().selectSession(id)
    // Lazily fetch history the first time a summary-only session is opened.
    const s = useDomainStore.getState().sessions.find((x) => x.id === id)
    if (s && !s.loaded) this.transport.send({ type: 'session:load', sessionId: id })
    // Carry a clicked search hit's message into the scroll target; a plain select clears any stale one.
    useUiStore.getState().setScrollTarget(messageId ?? null)
  }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `yarn test src/domain/sessionService.test.ts`
Expected: PASS (existing tests + 3 new ones).

- [ ] **Step 5: Commit**

```bash
git add src/domain/sessionService.ts src/domain/sessionService.test.ts
git commit -m "feat(domain): selectSession carries a search hit's messageId into the scroll target

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: `SessionList` carries the hit's messageId

**Files:**
- Modify: `src/components/sidebar/SessionList.tsx:51`

The content-hit branch must pass `h.messageId` so the jump lands on the match. The local/title branch stays single-arg (no specific message → clears any stale target). Presentational — verified by type-check.

- [ ] **Step 1: Update the content-hit onSelect**

In `src/components/sidebar/SessionList.tsx`, change the content-hit `SessionItem`'s `onSelect` (line 51) from:

```tsx
            onSelect={() => sessionService.selectSession(s.id)}
```

to:

```tsx
            onSelect={() => sessionService.selectSession(s.id, h.messageId ?? undefined)}
```

Leave the local-sessions `onSelect` (line 38) unchanged: `onSelect={() => sessionService.selectSession(session.id)}`.

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS — `h.messageId` is `string | null`; `?? undefined` matches the optional `messageId?: string` param.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/SessionList.tsx
git commit -m "feat(search): pass content-hit messageId into selectSession

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: `SessionItem` renders the snippet with `<mark>`

**Files:**
- Modify: `src/components/sidebar/SessionItem.tsx:6` (imports) + `:94-96` (snippet render)

Replace the plain-text snippet with `splitSnippet`-parsed segments, wrapping match segments in `<mark>`. A title/LIKE snippet (no sentinels) renders as one plain segment — unchanged appearance, minus the old leaked brackets. Presentational — verified by type-check.

- [ ] **Step 1: Import `splitSnippet`**

In `src/components/sidebar/SessionItem.tsx`, add to the imports (after the `datetime` import on line 6):

```ts
import { splitSnippet } from '@/lib/snippet'
```

- [ ] **Step 2: Render the snippet via segments**

Replace the current snippet block (lines 94–96):

```tsx
          {snippet && !editing && (
            <span className="block truncate text-[12px] text-ink-tertiary">{snippet}</span>
          )}
```

with:

```tsx
          {snippet && !editing && (
            <span className="block truncate text-[12px] text-ink-tertiary">
              {splitSnippet(snippet).map((seg, i) =>
                seg.mark ? (
                  <mark key={i} className="rounded bg-accent-subtle px-0.5 text-ink">
                    {seg.text}
                  </mark>
                ) : (
                  <span key={i}>{seg.text}</span>
                ),
              )}
            </span>
          )}
```

- [ ] **Step 3: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/SessionItem.tsx
git commit -m "feat(search): render sidebar snippet match with <mark> highlight

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `ChatPane` anchors, scrolls to, and highlights the target

**Files:**
- Modify: `src/components/chat/ChatPane.tsx`

The heart of the slice. Each message gets a `data-message-id` wrapper that `ChatPane` owns (so `MessageBubble` stays search-unaware). A target effect locates the anchor, centers it, highlights it for ~2s, then clears the `uiStore` target. The slice-4 bottom-autoscroll is suppressed while a target is pending so the jump isn't yanked to the end. Presentational — verified by type-check + manual GUI acceptance.

Key timing facts that make this correct:
- `sessionService.selectSession(id, messageId)` sets `activeSessionId` **and** `scrollTargetMessageId` synchronously, so the next render sees both.
- The **session-switch reset** must read the target at switch time but must **not** re-run when the target is later cleared (clearing it to `null` must not flip `atBottom` back to `true` and re-arm autoscroll). So that effect keeps `[activeSessionId]` deps and reads the target via `useUiStore.getState()` — not via a subscribed variable.
- The **target effect** and the **autoscroll gate** *do* subscribe to `scrollTargetMessageId` (they must react to it).

- [ ] **Step 1: Add the `cn` import and subscribe to the target**

In `src/components/chat/ChatPane.tsx`, add to the imports (after the `useUiStore` import on line 5):

```ts
import { cn } from '@/lib/utils'
```

Inside the component, after `const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)` (line 15), add:

```tsx
  const scrollTargetMessageId = useUiStore((s) => s.scrollTargetMessageId)
  const setScrollTarget = useUiStore((s) => s.setScrollTarget)
```

After `const [atBottom, setAtBottom] = useState(true)` (line 18), add:

```tsx
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
```

- [ ] **Step 2: Coordinate the session-switch reset with a pending target**

Replace the session-switch reset effect (line 27):

```tsx
  // Reset to "follow" when switching sessions so a freshly opened thread starts pinned to the latest.
  useEffect(() => { setAtBottom(true) }, [activeSessionId])
```

with (read the live target via getState so this runs ONLY on session switch, never on target-clear):

```tsx
  // On session switch, follow the latest — UNLESS a search jump is pending, in which case the
  // target effect positions the view and we stay unpinned until the user scrolls back down.
  // Read the target via getState (not a subscription) so clearing it later does not re-arm autoscroll.
  useEffect(() => {
    setAtBottom(useUiStore.getState().scrollTargetMessageId ? false : true)
  }, [activeSessionId])
```

- [ ] **Step 3: Gate the autoscroll on a pending target**

Replace the autoscroll effect (lines 34–37):

```tsx
  useEffect(() => {
    if (!atBottom) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, error, lastActivity, atBottom])
```

with:

```tsx
  useEffect(() => {
    if (!atBottom || scrollTargetMessageId) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, error, lastActivity, atBottom, scrollTargetMessageId])
```

- [ ] **Step 4: Add the target scroll + highlight effect**

Add this effect immediately after the autoscroll effect from Step 3:

```tsx
  // Search jump: when a target message id is set, center it and flash a highlight, then clear the
  // target. If the session is still loading, `messages` is empty and the effect no-ops until they
  // arrive (it re-runs on `messages`). If messages are present but the anchor is gone (deleted/
  // regenerated since indexing), clear the stale target so it doesn't linger.
  useEffect(() => {
    if (!scrollTargetMessageId) return
    const el = scrollRef.current?.querySelector(`[data-message-id="${scrollTargetMessageId}"]`)
    if (el) {
      el.scrollIntoView({ block: 'center' })
      setHighlightedId(scrollTargetMessageId)
      setScrollTarget(null)
      const timer = setTimeout(() => setHighlightedId(null), 2000)
      return () => clearTimeout(timer)
    }
    if (messages.length > 0) setScrollTarget(null)
  }, [scrollTargetMessageId, messages, setScrollTarget])
```

- [ ] **Step 5: Wrap each message in an anchored div**

Replace the `messages.map(...)` block (lines 45–55):

```tsx
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
```

with (key + `data-message-id` move to the wrapper; highlight class is applied conditionally):

```tsx
          {messages.map((m, i) => {
            const isLastMessage = i === messages.length - 1
            return (
              <div
                key={`${activeSessionId ?? 'none'}-${m.id}-${i}`}
                data-message-id={m.id}
                className={cn(
                  highlightedId === m.id &&
                    'rounded-lg ring-2 ring-accent/50 bg-accent-subtle transition-[background,box-shadow] duration-700',
                )}
              >
                <MessageBubble
                  message={m}
                  streaming={status === 'running' && m.role === 'assistant' && isLastMessage}
                  isLastAssistant={m.role === 'assistant' && isLastMessage && status !== 'running'}
                />
              </div>
            )
          })}
```

- [ ] **Step 6: Type-check**

Run: `yarn type-check`
Expected: PASS — `scrollRef` is `RefObject<HTMLDivElement>`; `querySelector` returns `Element | null`; `scrollIntoView` exists on `Element`.

- [ ] **Step 7: Commit**

```bash
git add src/components/chat/ChatPane.tsx
git commit -m "feat(chat): scroll to + highlight the search target, suppress autoscroll while pending

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Final verification gate

**Files:** none (verification only).

- [ ] **Step 1: Full frontend test suite**

Run (repo root): `yarn test`
Expected: PASS — all existing tests + the new `snippet`, `uiStore`, and `sessionService` tests green.

- [ ] **Step 2: Sidecar test suite**

Run: `yarn workspace @hip/sidecar test`
Expected: PASS — including the new sentinel-snippet test.

- [ ] **Step 3: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 4: Build**

Run: `yarn build`
Expected: succeeds (no type/bundle errors).

- [ ] **Step 5: Confirm no stray legacy delimiters / dead code**

Run:
```bash
rg -n "'\['|'\]'" packages/sidecar/src/persistence/store.ts || echo "no literal bracket delimiters remain"
rg -n "splitSnippet" src
```
Expected: the bracket grep finds nothing in `search()`; `splitSnippet` is referenced by `snippet.ts`, `snippet.test.ts`, and `SessionItem.tsx`.

- [ ] **Step 6: Manual GUI acceptance (project convention — run by the human, document here)**

The visual jump/highlight + sidebar `<mark>` are not DOM-tested. Verify manually:
1. In a session with long history, search a term that matches a message near the **top**. Click the hit → the view centers on that message and it flashes a highlight for ~2s, then fades. It is **not** yanked to the bottom.
2. The matched term in the sidebar snippet shows a real highlight (no `[brackets]`).
3. After the jump, streaming a new turn (or arriving tokens) does **not** auto-scroll to bottom until you scroll down (then follow resumes); the jump-to-latest button appears while scrolled up.
4. Clicking a **title-only** hit (or a normal session) opens it pinned to the latest message (no stale highlight from a prior jump).
5. Switch to zh-CN / zh-TW and repeat (1)–(2) to confirm nothing locale-specific broke.

---

## Self-Review

**1. Spec coverage:**
- D1 transient target in uiStore → Task 3. ✓
- D2 scroll-to-center + ~2s fading highlight → Task 7 (Steps 4–5). ✓
- D3 per-message `data-message-id` wrapper ChatPane owns (MessageBubble unaware) → Task 7 Step 5. ✓
- D4 pending target suppresses bottom-autoscroll + session-switch reset → Task 7 Steps 2–3. ✓
- D5 sidebar snippet highlight via sentinels + `<mark>` → Task 1 (parser) + Task 2 (sidecar) + Task 6 (render). ✓
- D6 out-of-scope items (Cmd+F, multi-hit nav, substring highlight) → not implemented. ✓
- Data-flow step "carry messageId on click" → Task 5. ✓
- No protocol change → confirmed (`SearchHit.messageId` already exists; snippet stays `string`). ✓
- Risk "stale target if anchor absent after load" → Task 7 Step 4 (`if (messages.length > 0) setScrollTarget(null)`). ✓
- Testing strategy (snippet pure tests; uiStore/sessionService tests; sidecar sentinel test; presentational = type-check + GUI) → Tasks 1,2,3,4 tests + Tasks 5,6,7 type-check + Task 8 GUI. ✓

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to Task N" — every code step shows full code. Sentinels written as visible `\u0001`/`\u0002` escapes, never raw bytes. ✓

**3. Type consistency:**
- `splitSnippet(s: string): SnippetSegment[]` with `{ text: string; mark: boolean }` — used identically in Task 1 and Task 6. ✓
- `setScrollTarget(id: string | null)` / `scrollTargetMessageId: string \| null` — consistent across Tasks 3, 4, 7. ✓
- `selectSession(id: string, messageId?: string)` — defined in Task 4, called with `(s.id, h.messageId ?? undefined)` in Task 5 (`h.messageId` is `string | null`, `?? undefined` → `string | undefined`, matches optional param). ✓
- `highlightedId: string | null` — declared and used only in Task 7. ✓
- Sidecar `char(1)`/`char(2)` produce the `\u0001`/`\u0002` that `splitSnippet`'s `MARK_START`/`MARK_END` match. ✓

No gaps found.
