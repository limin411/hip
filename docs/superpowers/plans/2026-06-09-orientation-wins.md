# Conversation Orientation Wins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Four small conversation-readability wins — GFM rendering, per-message timestamps, localized/live sidebar relative time, and at-bottom-aware autoscroll with a jump-to-latest button — built on a shared `Intl`-based date/time lib.

**Architecture:** A new pure `src/lib/datetime.ts` (built-in `Intl`, zero new deps, unit-tested) is the single date/time formatter. `MessageBubble` gains `remark-gfm` + a header timestamp; `SessionItem` formats relative time at render from `updatedAtMs` (and the frozen `SessionVM.updatedAt` string + `formatRelative` are removed); `ChatPane` only auto-scrolls when near the bottom and shows a jump-to-latest button otherwise.

**Tech Stack:** React, react-markdown@9 + `remark-gfm` (new dep), built-in `Intl.{RelativeTimeFormat,DateTimeFormat}`, Zustand, vitest. Locale from i18next (`i18n.resolvedLanguage`).

**Green-increment ordering:** lib first (foundation), then i18n key, then the consumers. Each task type-checks + tests green on its own.

---

## File Structure

| File | Change | Responsibility |
|------|--------|----------------|
| `src/lib/datetime.ts` | Create | `formatClockTime` / `formatAbsolute` / `formatRelativeTime` (Intl, pure) |
| `src/lib/datetime.test.ts` | Create | unit tests (injected `now`) |
| `src/i18n/{en,zh-CN,zh-TW}.ts` | Modify | `chat.jumpToLatest` |
| `package.json` | Modify | add `remark-gfm` |
| `src/components/chat/MessageBubble.tsx` | Modify | GFM plugin + header timestamp |
| `src/components/sidebar/SessionItem.tsx` | Modify | relative time from `updatedAtMs` |
| `src/domain/sessionStore.ts` | Modify | remove `SessionVM.updatedAt` + `formatRelative` |
| `src/domain/sessionStore.test.ts` | Modify | drop `updatedAt` from fixtures/asserts |
| `src/components/chat/ChatPane.tsx` | Modify | at-bottom autoscroll + jump-to-latest |

---

## Task 1: `src/lib/datetime.ts` (Intl date/time, pure)

**Files:** Create `src/lib/datetime.ts`, `src/lib/datetime.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `src/lib/datetime.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatClockTime, formatAbsolute, formatRelativeTime } from './datetime'

const NOW = Date.UTC(2026, 5, 9, 12, 0, 0) // 2026-06-09T12:00:00Z

describe('formatRelativeTime', () => {
  it('"now" for <1s, seconds for <1m (en)', () => {
    expect(formatRelativeTime(NOW, 'en', NOW)).toBe('now')
    expect(formatRelativeTime(NOW - 30_000, 'en', NOW)).toBe('30 seconds ago')
  })
  it('minutes / hours / yesterday (en)', () => {
    expect(formatRelativeTime(NOW - 2 * 60_000, 'en', NOW)).toBe('2 minutes ago')
    expect(formatRelativeTime(NOW - 3 * 3_600_000, 'en', NOW)).toBe('3 hours ago')
    expect(formatRelativeTime(NOW - 25 * 3_600_000, 'en', NOW)).toBe('yesterday')
  })
  it('localizes to zh-CN (differs from en, contains CJK)', () => {
    const zh = formatRelativeTime(NOW - 2 * 60_000, 'zh-CN', NOW)
    expect(zh).not.toBe('2 minutes ago')
    expect(zh).toContain('分钟')
  })
})

describe('formatClockTime / formatAbsolute', () => {
  it('clock time contains an H:MM pattern', () => {
    expect(formatClockTime(NOW, 'en')).toMatch(/\d{1,2}:\d{2}/)
  })
  it('absolute contains the year', () => {
    expect(formatAbsolute(NOW, 'en')).toContain('2026')
  })
})
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `yarn vitest run src/lib/datetime.test.ts`
Expected: FAIL — cannot resolve `./datetime`.

- [ ] **Step 3: Implement**

Create `src/lib/datetime.ts`:

```ts
/** Largest-fitting relative unit, smallest first. */
const REL_UNITS: { limit: number; div: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { limit: 60_000, div: 1_000, unit: 'second' },
  { limit: 3_600_000, div: 60_000, unit: 'minute' },
  { limit: 86_400_000, div: 3_600_000, unit: 'hour' },
  { limit: Infinity, div: 86_400_000, unit: 'day' },
]

/** Locale-aware time-of-day, e.g. "14:30". */
export function formatClockTime(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(ms)
}

/** Full date + short time for a tooltip, e.g. "Jun 9, 2026, 2:30 PM". */
export function formatAbsolute(ms: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(ms)
}

/** Relative time, e.g. "now" / "2 minutes ago" / "yesterday". `now` injectable for tests. */
export function formatRelativeTime(ms: number, locale: string, now: number = Date.now()): string {
  const diff = Math.max(0, now - ms)
  const u = REL_UNITS.find((x) => diff < x.limit)!
  const value = Math.floor(diff / u.div)
  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-value, u.unit)
}
```

- [ ] **Step 4: Run, confirm PASS**

Run: `yarn vitest run src/lib/datetime.test.ts`
Expected: PASS (all). If a relative-string assertion differs under the local ICU (e.g. "1 day ago" vs "yesterday"), the `numeric:'auto'` + en path should give "yesterday"; if the runner's ICU lacks it, adjust the en assertions to the actual stable output — do NOT loosen to a tautology.

- [ ] **Step 5: Commit**

```bash
git add src/lib/datetime.ts src/lib/datetime.test.ts
git commit -m "feat(ui): Intl date/time helpers (clock, absolute, relative)"
```

---

## Task 2: i18n `chat.jumpToLatest`

**Files:** Modify `src/i18n/en.ts`, `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`.

- [ ] **Step 1: Add the key to each locale's `chat` section**

After the `chat.errorTimeout` key added previously:
- `en.ts`: `jumpToLatest: 'Jump to latest',`
- `zh-CN.ts`: `jumpToLatest: '回到最新',`
- `zh-TW.ts`: `jumpToLatest: '回到最新',`

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "feat(i18n): jumpToLatest"
```

---

## Task 3: MessageBubble — GFM + per-message timestamp

**Files:** Modify `package.json` (add `remark-gfm`), `src/components/chat/MessageBubble.tsx`. (Presentational; verified by `yarn type-check` + GUI.)

- [ ] **Step 1: Install remark-gfm**

Run: `yarn add remark-gfm`
Expected: adds `remark-gfm` to `package.json` dependencies; `yarn.lock` updated.

- [ ] **Step 2: Add the GFM plugin + locale + timestamp to MessageBubble**

In `MessageBubble.tsx`:
- Add imports: `import remarkGfm from 'remark-gfm'` and `import { formatClockTime, formatAbsolute } from '@/lib/datetime'`.
- Change `const { t } = useTranslation()` → `const { t, i18n } = useTranslation()`, and add `const locale = i18n.resolvedLanguage ?? 'en'`.
- In the header row, add a timestamp span after the author `<span>` (keep the Stopped badge after it):

```tsx
        <div className="mb-1 flex items-center gap-2 text-[12px] font-medium text-ink-secondary">
          <span>{isUser ? t('chat.you') : 'hip'}</span>
          <span
            className="text-[11px] font-normal text-ink-tertiary"
            title={formatAbsolute(message.timestamp, locale)}
            data-testid="message-time"
          >
            {formatClockTime(message.timestamp, locale)}
          </span>
          {message.stopped && (
            <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[11px] font-normal text-ink-tertiary" data-testid="stopped-badge">
              {t('chat.stopped')}
            </span>
          )}
        </div>
```
- Enable GFM on the markdown renderer (the existing line `<ReactMarkdown components={{ pre: CodeBlock }}>{message.content}</ReactMarkdown>`):

```tsx
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ pre: CodeBlock }}>{message.content}</ReactMarkdown>
```

- [ ] **Step 3: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add package.json yarn.lock src/components/chat/MessageBubble.tsx
git commit -m "feat(ui): GFM markdown + per-message timestamp in the bubble header"
```

---

## Task 4: Sidebar relative time + remove the frozen `SessionVM.updatedAt`

**Files:** Modify `src/components/sidebar/SessionItem.tsx`, `src/domain/sessionStore.ts`, `src/domain/sessionStore.test.ts`.

- [ ] **Step 1: Update the reducer test fixtures first (they'll fail to compile once the field is removed)**

In `src/domain/sessionStore.test.ts`: find the `baseSession` helper and any literal `SessionVM`/expectation that includes `updatedAt:` (the string field). Remove the `updatedAt: '...'` property from `baseSession` and from any `session:list:result` test that asserts `updatedAt`. Keep `updatedAtMs`. (Run `grep -n "updatedAt\b" src/domain/sessionStore.test.ts` to find them; `updatedAtMs` stays.)

- [ ] **Step 2: Remove `updatedAt` from the store**

In `sessionStore.ts`:
- `SessionVM` interface: delete the line `updatedAt: string    // 展示字符串（'2m ago' / 'now'）`.
- Delete the `formatRelative` function (the `function formatRelative(ms: number): string { ... }` block).
- `summaryToVM`: change the return to drop `updatedAt`:
  ```ts
  function summaryToVM(s: SessionSummary): SessionVM {
    return { id: s.id, config: DEFAULT_CONFIG, title: s.title, preview: s.preview, updatedAtMs: s.updatedAt, loaded: false, messages: [], status: 'idle', error: null }
  }
  ```
- `emptySession`: remove the `updatedAt: 'now',` property (keep `updatedAtMs: Date.now()`).
- `session:list:result` merge: change the preserve-loaded branch to drop `updatedAt`:
  ```ts
  byId.set(vm.id, prev?.loaded ? { ...prev, title: vm.title, preview: vm.preview, updatedAtMs: vm.updatedAtMs } : vm)
  ```

- [ ] **Step 3: Render relative time in SessionItem from `updatedAtMs`**

In `SessionItem.tsx`:
- Add `import { formatRelativeTime, formatAbsolute } from '@/lib/datetime'`.
- Change `const { t } = useTranslation()` → `const { t, i18n } = useTranslation()`, add `const locale = i18n.resolvedLanguage ?? 'en'`.
- Replace the time span (currently `<span className="shrink-0 text-[11px] text-ink-tertiary">{session.updatedAt}</span>`) with:
  ```tsx
                <span className="shrink-0 text-[11px] text-ink-tertiary" title={formatAbsolute(session.updatedAtMs, locale)}>
                  {formatRelativeTime(session.updatedAtMs, locale)}
                </span>
  ```

- [ ] **Step 4: Find any other reader of the removed field**

Run: `grep -rn "\.updatedAt\b" src --include=*.ts --include=*.tsx | grep -v updatedAtMs`
Expected: no remaining references (other than the ones just edited). If any surface, switch them to `updatedAtMs` + a `lib/datetime` formatter.

- [ ] **Step 5: Type-check + tests**

Run: `yarn type-check && yarn vitest run src/domain/sessionStore.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/SessionItem.tsx src/domain/sessionStore.ts src/domain/sessionStore.test.ts
git commit -m "feat(ui): localized live sidebar relative time; drop frozen SessionVM.updatedAt"
```

---

## Task 5: ChatPane — at-bottom autoscroll + jump-to-latest

**Files:** Modify `src/components/chat/ChatPane.tsx`. (Presentational; verified by `yarn type-check` + GUI.)

- [ ] **Step 1: Restructure the pane + track at-bottom + gate autoscroll + add the button**

In `ChatPane.tsx`:
- Add `useState` to the React import and `ChevronDown` to the lucide import: `import { useEffect, useRef, useState } from 'react'` and `import { ChevronDown } from 'lucide-react'`.
- Add state + a scroll-container ref and an at-bottom tracker; reset to bottom on session switch; gate the existing autoscroll on `atBottom`:

```tsx
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)

  // Reset to "follow" when switching sessions so a freshly opened thread starts pinned to the latest.
  useEffect(() => { setAtBottom(true) }, [activeSessionId])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }
```
- Change the autoscroll effect to only fire when at the bottom:
```tsx
  useEffect(() => {
    if (!atBottom) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, error, lastActivity, atBottom])
```
- Replace the outer render wrapper. The current return is `<div className="flex-1 overflow-y-auto"> <div className="mx-auto ...">...</div> </div>`. Make the scroll container an inner element of a `relative` parent so the jump button floats:

```tsx
  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-6">
          {/* ...existing messages.map(...), showThinking, error banner, and <div ref={bottomRef} /> unchanged... */}
        </div>
      </div>
      {!atBottom && (
        <button
          onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' })}
          data-testid="jump-to-latest"
          title={t('chat.jumpToLatest')}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] text-ink-secondary shadow-pop transition-colors hover:bg-surface-muted"
        >
          <ChevronDown size={14} />
          {t('chat.jumpToLatest')}
        </button>
      )}
    </div>
  )
```
(Keep the inner content — `messages.map`, `showThinking`, the `error` banner, and `<div ref={bottomRef} />` — exactly as it is today; only the two wrapper divs change and the button is added.)

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ChatPane.tsx
git commit -m "feat(ui): at-bottom-aware autoscroll + jump-to-latest button"
```

---

## Task 6: Final verification gate

- [ ] **Step 1: Type-check + tests + build**

Run: `yarn type-check && yarn workspace @hip/sidecar type-check && yarn test && yarn build`
Expected: both type-checks PASS; vitest all green (live-LLM suites run if a key is present, else skip); `vite build` succeeds.

- [ ] **Step 2: Confirm the frozen string is fully gone**

Run: `grep -rn "formatRelative\b\|\.updatedAt\b" src --include=*.ts --include=*.tsx | grep -v updatedAtMs`
Expected: no matches (the old `formatRelative` and the `updatedAt` string field are gone).

- [ ] **Step 3: Manual GUI acceptance (user, per project convention)**

- Send a message containing a GFM table, a `~~strikethrough~~`, and a `- [ ]` task list → confirm they render (not as raw text).
- Confirm each message shows a time-of-day in its header, with a full date+time on hover.
- Switch the UI language to 简体中文 → confirm sidebar times read "X分钟前" (not "Xm ago") and update on reload.
- Scroll up mid-stream → confirm the view no longer yanks down and a "回到最新 / Jump to latest" button appears; click it → scrolls to the latest; confirm it disappears at the bottom.

---

## Self-Review

**Spec coverage:**
- Intl date/time lib (D1) → Task 1. ✅
- GFM (D5) → Task 3. ✅
- Per-message time-of-day + hover (D2) → Task 3. ✅
- Sidebar relative time from `updatedAtMs`, localized + live (D3) + remove frozen `updatedAt`/`formatRelative` (D4) → Task 4. ✅
- At-bottom autoscroll + jump-to-latest (D6) → Task 5. ✅
- i18n `jumpToLatest` → Task 2. ✅
- Tests: `lib/datetime` unit (Task 1); reducer fixture updates (Task 4); presentational via type-check + GUI (Tasks 3/5). ✅

**Placeholder scan:** No TBD/TODO; every code step shows real code; the one note (Task 1 Step 4 ICU fallback) gives a concrete adjust-don't-loosen instruction, not a missing impl.

**Type consistency:** `formatClockTime(ms, locale)` / `formatAbsolute(ms, locale)` / `formatRelativeTime(ms, locale, now?)` signatures consistent across Tasks 1/3/4. `locale = i18n.resolvedLanguage ?? 'en'` consistent in MessageBubble (Task 3) + SessionItem (Task 4). `SessionVM.updatedAt` removed in Task 4 and not referenced by any later task. `chat.jumpToLatest` (Task 2) consumed in Task 5. `data-testid` hooks (`message-time`, `jump-to-latest`) are new, no collisions.
