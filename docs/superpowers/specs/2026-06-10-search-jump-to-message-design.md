# Search Jump-to-Message — Design

**Status:** Approved (2026-06-10)
**Theme:** Roadmap theme 4 — the search feature's missing last hop. Recall already works; clicking a hit doesn't land you on the match.

## Motivation — recall works, the jump doesn't

Verified against current code (search untouched by slices 1–4):

- `SearchBox` debounces (200ms) into the sidecar FTS; `SessionList` renders title/preview matches plus FTS content-hits (deduped to the best-ranked hit per session) with snippets.
- **The jump is dropped.** Both `SessionList` branches call `onSelect={() => sessionService.selectSession(s.id)}` (SessionList.tsx:38,51) — the hit's `messageId` is discarded. `SearchHit.messageId` is populated for content hits (the FTS query selects `m.id`), `null` for title-only hits.
- **No scroll target exists.** `MessageBubble` renders no per-message DOM anchor; `ChatPane` only scrolls to `bottomRef`. So even if `messageId` were passed, there's nothing to scroll to — and the slice-4 bottom-autoscroll would pull you to the end anyway.
- **Snippet brackets leak.** The FTS query uses literal `[`/`]` snippet delimiters (`store.ts` search()), and `SessionItem` renders the snippet as plain text, so a match shows as `[match]` with no real highlight.

## Locked decisions

- **D1 — Transient scroll target in `uiStore`.** `scrollTargetMessageId: string | null`; `selectSession(id, messageId?)` sets it; `ChatPane` consumes and clears it.
- **D2 — Landing = scroll-to-center + ~2s fading highlight** on the matched message, then back to normal (does not persist).
- **D3 — Per-message DOM anchor on a wrapper `ChatPane` owns** (`data-message-id`), so `MessageBubble` stays unaware of search.
- **D4 — A pending scroll target suppresses the bottom-autoscroll** (slice-4), so the jump isn't yanked to the end; normal autoscroll resumes once the target is consumed.
- **D5 — Sidebar snippet highlight** via sentinel FTS delimiters + `<mark>` parsing.
- **D6 — Out of scope:** in-conversation Cmd+F find, multi-hit-per-session navigation, sub-string term highlighting inside the opened message.

## Architecture overview

Four small units across the search→navigation path:
1. **`uiStore`** — owns the transient `scrollTargetMessageId`.
2. **`sessionService.selectSession(id, messageId?)` + `SessionList`** — carry the hit's messageId into the target.
3. **`ChatPane`** — anchors each message, scrolls to + highlights the target, coordinates with the bottom-autoscroll, clears the target.
4. **sidecar `store.ts` search() + `lib/snippet.ts` + `SessionItem`** — real snippet highlight.

No protocol change: `SearchHit.messageId` already exists; the snippet stays a `string` (sentinel-delimited internally).

## Data flow

1. User types → FTS hits in the sidebar (unchanged). A content hit carries `messageId` (best-ranked match in that session).
2. User clicks the hit → `sessionService.selectSession(s.id, h.messageId)` → sets `activeSessionId`, lazy-loads history if `!loaded`, and `uiStore.setScrollTarget(h.messageId)`.
3. `ChatPane` renders the session. Its target effect (keyed on `[scrollTargetMessageId, messages]`) finds `[data-message-id="<target>"]` in the scroll container:
   - **found** → `scrollIntoView({ block: 'center' })`, set local `highlightedId`, **clear** `uiStore` target, start a ~2s timer to clear `highlightedId`.
   - **not found** (session still loading) → no-op; the effect re-runs when `messages` arrive.
4. While a target is pending, the bottom-autoscroll effect is suppressed and the session-switch `atBottom` reset is skipped, so the jump positions the view; once consumed, normal follow-on-stream resumes.

## Frontend changes

- **`src/store/uiStore.ts`**: add `scrollTargetMessageId: string | null` (init `null`) + `setScrollTarget(id: string | null)`.
- **`src/domain/sessionService.ts`**: `selectSession(id: string, messageId?: string)` — existing body (`domain.selectSession(id)` + lazy `session:load` when `!loaded`) plus `useUiStore.getState().setScrollTarget(messageId ?? null)`.
- **`src/components/sidebar/SessionList.tsx`**: the content-hit `onSelect` becomes `() => sessionService.selectSession(s.id, h.messageId ?? undefined)`. The local/title branch stays `selectSession(s.id)` (no specific message → clears any stale target).
- **`src/components/chat/ChatPane.tsx`**:
  - Read `scrollTargetMessageId` + `setScrollTarget` from `uiStore`; add local `const [highlightedId, setHighlightedId] = useState<string | null>(null)`.
  - Wrap each message: `<div key={…} data-message-id={m.id} className={cn(highlightedId === m.id && 'rounded-lg ring-2 ring-accent/50 bg-accent-subtle transition-[background,box-shadow] duration-700')}> <MessageBubble … /> </div>` (move the existing key to the wrapper).
  - Target effect on `[scrollTargetMessageId, messages]`: locate the anchored element via `scrollRef.current?.querySelector(...)`; if found, scroll center + `setHighlightedId(id)` + `setScrollTarget(null)` + `setTimeout(() => setHighlightedId(null), 2000)` (clear the timer on unmount/re-run). If not found, return.
  - Bottom-autoscroll coordination (D4): gate the existing autoscroll effect with `if (!atBottom || scrollTargetMessageId) return`; change the session-switch reset to `setAtBottom(scrollTargetMessageId ? false : true)`.
- **`src/lib/snippet.ts` (new, pure)**: `splitSnippet(s: string): { text: string; mark: boolean }[]` — splits a sentinel-delimited (`\u0001`…`\u0002`) string into ordered segments. Unit-tested.
- **`src/components/sidebar/SessionItem.tsx`**: render `snippet` via `splitSnippet`, wrapping `mark` segments in `<mark className="rounded bg-accent-subtle px-0.5 text-ink">`.

## Sidecar change

- **`packages/sidecar/src/persistence/store.ts` search()**: change the FTS `snippet(messages_fts, 0, '[', ']', '…', 12)` delimiters to the sentinels `'\u0001'` / `'\u0002'`. (The title-hit branch returns `snippet: t.title` with no delimiters → `splitSnippet` yields a single unmarked segment — fine.)

## Testing strategy

- **`src/lib/snippet.test.ts` (pure):** `splitSnippet` — no markers (single unmarked segment), one match (text/mark/text), multiple matches, leading/trailing match, empty string.
- **`uiStore` / `sessionService`:** `selectSession(id, messageId)` sets `activeSessionId` + `scrollTargetMessageId`; `selectSession(id)` (no messageId) clears the target. Lazy-load path unchanged.
- **sidecar `store.test.ts`:** a content search hit's `snippet` contains the sentinel markers around the matched term (assert on `\u0001`/`\u0002` presence for an FTS match).
- **Presentational** (ChatPane jump/highlight/coordination, SessionItem `<mark>`): `yarn type-check` + manual GUI acceptance (no DOM tests, per convention).

## Risks & deferred validations

- **Jump vs bottom-autoscroll race** (D4): the suppression must hold until the target is consumed; covered by gating both the autoscroll effect and the session-switch reset on `scrollTargetMessageId`. The trickiest integration point — verify in GUI with a jump into long history.
- **Target not yet loaded:** clicking a hit for an unloaded session triggers `session:load`; the target effect re-runs when `messages` arrive and finds the anchor then. If the message somehow isn't present after load (deleted/regenerated since indexing), the target is cleared on the first effect run that can't find it after messages settle — acceptable (no-op jump). *Plan note:* clear a stale target if messages are loaded and the anchor is absent, so it doesn't linger.
- **Sentinel chars in snippet:** `\u0001`/`\u0002` are control chars that never appear in normal message text; safe as delimiters over the wire.
- **GUI acceptance pending** (project convention) for the visual jump/highlight.

## Out of scope (YAGNI)

- In-conversation find (Cmd/Ctrl+F) + result navigation.
- Navigating multiple hits within one session.
- Highlighting the matched substring inside the opened message body (only the message block flashes).
- Keyboard navigation of the sidebar hit list.
