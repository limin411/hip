# Conversation Orientation Wins — Design

**Status:** Approved (2026-06-09)
**Theme:** The high-leverage / small-effort "orientation wins" cluster from the 2026-06-09 audit — the next quick-win after themes 1, 2 & 7 shipped.

## Motivation — four small, independent readability gaps

All verified against current code (post slices 1–3):

1. **GFM not enabled.** `remark-gfm` is not installed; `react-markdown@9.1.0` renders with no `remarkPlugins`, so pipe tables / `~~strikethrough~~` / `- [ ]` task-lists / autolinks render as raw source. The `[&_table]` CSS already in `MessageBubble.tsx` is dead weight until GFM is on.
2. **Message timestamp captured but never rendered.** `Message.timestamp` is set + persisted, but `MessageBubble.tsx` never references it (header shows only author + the Stopped badge).
3. **Sidebar relative time is hardcoded-English *and* frozen.** `formatRelative` (`sessionStore.ts:123`) is used only in `summaryToVM` to produce a **static string** stored as `SessionVM.updatedAt`, which `SessionItem.tsx:77` renders verbatim. So zh users see "2m ago", and the value never updates as time passes (computed once when the session list is built). `SessionVM` already carries the numeric `updatedAtMs`.
4. **Auto-scroll fights the user.** `ChatPane.tsx` `scrollIntoView` fires on `lastActivity` (changes every token) with no at-bottom guard and no jump-to-latest affordance, yanking the view down while the user reads history mid-stream.

These are four independent S-effort changes, cohesive under "conversation orientation" — one slice, no decomposition.

## Locked decisions

- **D1 — Built-in `Intl` for all date/time, centralized in a pure `src/lib/datetime.ts`.** Zero new deps for dates (locale comes from i18next). Only `remark-gfm` is a new dependency.
- **D2 — Per-message time = locale time-of-day** (e.g. `14:30`) in the bubble header, with a full date+time `title` tooltip.
- **D3 — Relative time formatted at render from `updatedAtMs`** (not a frozen string); render-only liveness (no per-minute ticking interval — the list re-renders on activity).
- **D4 — Remove the redundant frozen `updatedAt` string** from `SessionVM` once `SessionItem` formats from `updatedAtMs`; `formatRelative` in `sessionStore.ts` is deleted. `updatedAtMs` is the single source of truth.
- **D5 — GFM via `remark-gfm`** passed to `<ReactMarkdown remarkPlugins={[remarkGfm]}>`.
- **D6 — Auto-scroll only when near the bottom; a floating "jump to latest" button when scrolled up.**

## Architecture overview

Four mostly-independent units:
1. **`src/lib/datetime.ts`** (new, pure) — the single place that turns an epoch-ms + locale into display strings (clock, absolute, relative). Unit-tested.
2. **`MessageBubble.tsx`** — consumes `formatClockTime`/`formatAbsolute` for the header timestamp; gains the `remark-gfm` plugin.
3. **`SessionItem.tsx` + `sessionStore.ts`** — sidebar relative time moves to render-time via `formatRelativeTime(updatedAtMs, locale)`; the frozen `updatedAt` string + `formatRelative` are removed.
4. **`ChatPane.tsx`** — at-bottom-aware autoscroll + a jump-to-latest button.

Locale resolution: components read `const { i18n } = useTranslation(); const locale = i18n.resolvedLanguage ?? 'en'` (already one of `en`/`zh-CN`/`zh-TW`, all valid BCP-47 tags for `Intl`). The lib functions take `locale` as a param (kept pure/testable).

## `src/lib/datetime.ts` (new, pure)

```ts
/** Locale-aware time-of-day, e.g. "14:30". */
export function formatClockTime(ms: number, locale: string): string

/** Full date + short time for a tooltip, e.g. "Jun 9, 2026, 2:30 PM". */
export function formatAbsolute(ms: number, locale: string): string

/** Relative time, e.g. "now" / "2 minutes ago" / "yesterday". `now` injectable for tests. */
export function formatRelativeTime(ms: number, locale: string, now?: number): string
```

- `formatClockTime`: `new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(ms)`.
- `formatAbsolute`: `new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ms)`.
- `formatRelativeTime`: compute `diff = (now ?? Date.now()) - ms`; pick the largest unit that fits (`< 60s` → seconds, `< 60m` → minutes, `< 24h` → hours, else days) and return `new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-value, unit)`. `numeric:'auto'` yields niceties like "now" / "yesterday". Negative value because the timestamp is in the past.

No memoization needed (formatters are cheap; if profiling ever shows cost, cache `Intl` instances by locale — out of scope now).

## Per-feature changes

### GFM (`MessageBubble.tsx`)
- `yarn add remark-gfm` (workspace root). Import `remarkGfm from 'remark-gfm'`. Change `<ReactMarkdown components={{ pre: CodeBlock }}>` → `<ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock }}>`. No CSS change (the `[&_table]` rules already exist).

### Message timestamp (`MessageBubble.tsx`)
- In the header row (currently `<span>{author}</span>` + optional Stopped badge), add after the author:
  `<span className="text-[11px] font-normal text-ink-tertiary" title={formatAbsolute(message.timestamp, locale)}>{formatClockTime(message.timestamp, locale)}</span>`.
- Applies to both user and assistant messages (both carry `timestamp`).

### Sidebar relative time (`SessionItem.tsx`, `sessionStore.ts`)
- `SessionItem.tsx`: replace `{session.updatedAt}` (line 77) with `{formatRelativeTime(session.updatedAtMs, locale)}`. Add a `title={formatAbsolute(session.updatedAtMs, locale)}` for the full timestamp on hover.
- `sessionStore.ts`: delete `formatRelative`; remove the `updatedAt: string` field from the `SessionVM` interface; remove `updatedAt` from `summaryToVM`, `emptySession`, and the `session:list:result` merge (keep `updatedAtMs` everywhere). 

### Autoscroll + jump-to-latest (`ChatPane.tsx`)
- Add a ref on the scroll container (the `flex-1 overflow-y-auto` div) and an `onScroll` handler computing `atBottom = scrollHeight - scrollTop - clientHeight < 80`, stored in component state (default `true`).
- Gate the existing `scrollIntoView` effect on `atBottom` (only auto-scroll when the user is already at/near the bottom).
- When `!atBottom`, render a floating button (absolute, bottom-center of the pane) labelled with a down-chevron + `t('chat.jumpToLatest')` that calls `bottomRef.current?.scrollIntoView()` and is hidden once back at bottom.

## i18n (`src/i18n/{en,zh-CN,zh-TW}.ts`)
- Add `chat.jumpToLatest` — e.g. "Jump to latest" / "回到最新" / "回到最新". Relative/clock/absolute strings are produced by `Intl`, not i18n keys.

## Testing strategy

- **`src/lib/datetime.test.ts` (pure, injected `now`):** `formatRelativeTime` boundaries — `now` (0s), minutes, hours, "yesterday" (>24h) — asserted for `en` (exact, e.g. "2 minutes ago", "yesterday") and `zh-CN` (assert it differs from the en string / contains expected CJK, robust to ICU). `formatClockTime` contains a time separator and the right hour/minute; `formatAbsolute` is non-empty and contains the year. (Vitest runs on Node with full ICU.)
- **Reducer (`sessionStore.test.ts`):** update fixtures/asserts that referenced `SessionVM.updatedAt` (now removed) — e.g. `session:list:result` merge tests assert on `updatedAtMs` only.
- **Presentational** (GFM render, message timestamp, sidebar time, jump button): `yarn type-check` + manual GUI acceptance (project convention — no DOM/RTL tests).

## Risks & deferred validations

- **ICU/locale output variance:** `Intl` output can differ slightly by Node/ICU version; tests assert structurally (separators, CJK presence, en exact for stable phrases) rather than brittle full-string equality for every locale.
- **`SessionVM.updatedAt` removal ripple:** a few reducer tests + any other reader must move to `updatedAtMs`; `grep` for `.updatedAt` (non-`Ms`) before finishing.
- **GFM + raw HTML:** `remark-gfm` does NOT enable raw HTML rendering (that needs `rehype-raw`), so this introduces no XSS surface beyond react-markdown's defaults — good, keep it that way.
- **GUI acceptance pending** (project convention) for the visual changes.

## Out of scope (YAGNI)

- Day-divider separators ("Today"/"Yesterday") between messages.
- A ticking interval to refresh relative times live every minute (render-on-refresh suffices).
- Caching `Intl` formatter instances (premature optimization).
- Markdown features beyond GFM (raw HTML, math, mermaid, etc.).
