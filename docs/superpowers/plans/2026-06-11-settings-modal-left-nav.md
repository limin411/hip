# Settings Modal Left-Nav + 通用设置 Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the settings modal into a two-pane shell — an extensible left navigation rail with a single 通用设置 page today, holding the existing API Key + 界面语言 settings unchanged.

**Architecture:** The generic `Modal` is untouched except for a wider `className`. `SettingsPanel` is rewritten from a flat list into a two-pane shell built on Radix `Tabs` (vertical), driven by a small page registry. The current settings content is extracted verbatim into a self-contained `GeneralSettings` page component. Adding a future page = one registry entry + one component.

**Tech Stack:** React 18, TypeScript (strict), Tailwind (CSS-var design tokens), `@radix-ui/react-tabs` (already a dependency), `react-i18next`, lucide-react.

---

## Verification model (read before starting)

This repo has **no `.tsx` component test harness** — `vitest` runs in `node` and existing tests cover store logic + wdio/tauri E2E only. Per the project's established convention (and the approved spec), this UI restructure is **not** unit-tested with a new component harness. Each code task is verified by:

1. **TypeScript typecheck:** `npx tsc --noEmit` → Expected: no errors.

…and the whole feature is verified at the end by:

2. **Production build:** `npm run build` (runs `tsc && vite build`) → Expected: build succeeds.
3. **GUI acceptance** in the real app (manual, per project preference) — Task 4.

Do **not** invent a `.tsx` unit-test harness for these tasks. The changes are presentational; behavior (API-key save/clear, language switch) is moved verbatim and unchanged.

## File structure

- **Modify** `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`, `src/i18n/en.ts` — add `settings.general`.
- **Create** `src/components/account/GeneralSettings.tsx` — the current settings content (API Key + 界面语言), moved verbatim; one self-contained page, no knowledge of the rail.
- **Rewrite** `src/components/account/SettingsPanel.tsx` — two-pane shell: vertical Radix Tabs rail + page registry + content pane.
- **Modify** `src/components/sidebar/UserMenu.tsx` — pass `className="max-w-2xl"` to `<Modal>`.
- **Untouched** `src/components/ui/Modal.tsx` — already merges `className` via `cn` (tailwind-merge).

---

### Task 1: Add the `settings.general` i18n key (all three locales)

**Files:**
- Modify: `src/i18n/zh-CN.ts:108`
- Modify: `src/i18n/zh-TW.ts:108`
- Modify: `src/i18n/en.ts:108`

- [ ] **Step 1: Add the key to zh-CN**

In `src/i18n/zh-CN.ts`, replace:

```ts
      title: '设置',
      language: '界面语言',
```

with:

```ts
      title: '设置',
      general: '通用设置',
      language: '界面语言',
```

- [ ] **Step 2: Add the key to zh-TW**

In `src/i18n/zh-TW.ts`, replace:

```ts
      title: '設置',
      language: '界面語言',
```

with:

```ts
      title: '設置',
      general: '通用設置',
      language: '界面語言',
```

- [ ] **Step 3: Add the key to en**

In `src/i18n/en.ts`, replace:

```ts
      title: 'Settings',
      language: 'Interface Language',
```

with:

```ts
      title: 'Settings',
      general: 'General Settings',
      language: 'Interface Language',
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (all three locale objects stay structurally consistent — the same key added to each).

- [ ] **Step 5: Commit**

```bash
git add src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/i18n/en.ts
git commit -m "i18n: add settings.general (通用设置) for the settings nav"
```

---

### Task 2: Extract `GeneralSettings` page + rewrite `SettingsPanel` as the two-pane shell

These two files are one logical change (the move + the new shell that consumes it), so they share a commit.

**Files:**
- Create: `src/components/account/GeneralSettings.tsx`
- Rewrite: `src/components/account/SettingsPanel.tsx`

- [ ] **Step 1: Create `GeneralSettings.tsx` with the current settings content, moved verbatim**

Create `src/components/account/GeneralSettings.tsx` with this exact content (it is today's `SettingsPanel` body, with the component renamed to `GeneralSettings` — behavior is identical):

```tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { isApiKeyConfigured, saveApiKey, clearApiKey, restartSidecar } from '@/ipc/secrets'

const LANGUAGE_KEYS = ['zh-CN', 'zh-TW', 'en'] as const
type LanguageKey = (typeof LANGUAGE_KEYS)[number]

export function GeneralSettings() {
  const { t, i18n } = useTranslation()
  const currentLang: LanguageKey = LANGUAGE_KEYS.includes(i18n.language as LanguageKey)
    ? (i18n.language as LanguageKey)
    : LANGUAGE_KEYS[0]

  const [configured, setConfigured] = useState<boolean | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    isApiKeyConfigured().then(setConfigured).catch(() => setConfigured(false))
  }, [])

  async function onSave() {
    if (!value.trim()) return
    setBusy(true)
    setError(null)
    try {
      await saveApiKey(value.trim())
      await restartSidecar()
      setConfigured(true)
      setValue('')
    } catch (e) {
      console.error('[settings] save api key failed', e)
      setError(t('settings.apiKeyError'))
    } finally {
      setBusy(false)
    }
  }

  async function onClear() {
    setBusy(true)
    setError(null)
    try {
      await clearApiKey()
      await restartSidecar()
      setConfigured(false)
    } catch (e) {
      console.error('[settings] clear api key failed', e)
      setError(t('settings.apiKeyError'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col">
      {/* API key */}
      <div className="px-6 py-5">
        <div className="text-prose font-medium text-ink">{t('settings.apiKey')}</div>
        <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.apiKeyDesc')}</div>
        <div className="mt-1 text-meta">
          {configured
            ? <span className="text-success">{t('settings.apiKeyConfigured')}</span>
            : <span className="text-ink-tertiary">{t('settings.apiKeyNotConfigured')}</span>}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t('settings.apiKeyPlaceholder')}
            className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-body text-ink transition-shadow focus:outline-none focus:ring-2 focus:ring-accent/60"
          />
          <button
            onClick={onSave}
            disabled={busy || !value.trim()}
            className="rounded-md bg-accent px-3 py-1.5 text-body font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
          >
            {t('settings.apiKeySave')}
          </button>
          <button
            onClick={onClear}
            disabled={busy || !configured}
            className="rounded-md border border-border px-3 py-1.5 text-body text-ink-secondary transition-colors hover:bg-surface-muted disabled:opacity-40"
          >
            {t('settings.apiKeyClear')}
          </button>
        </div>
        {error && <div className="mt-2 text-meta text-danger">{error}</div>}
      </div>

      {/* Language */}
      <div className="flex items-center justify-between px-6 py-5">
        <div className="min-w-0 flex-1">
          <div className="text-prose font-medium text-ink">{t('settings.language')}</div>
          <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.languageDesc')}</div>
        </div>
        <div className="relative ml-4 shrink-0">
          <select
            value={currentLang}
            onChange={(e) => i18n.changeLanguage(e.target.value)}
            className="cursor-pointer appearance-none rounded-md border border-border bg-surface py-1.5 pl-2.5 pr-8 text-body text-ink-secondary transition-colors hover:bg-surface-muted hover:text-ink focus:outline-none focus:ring-2 focus:ring-accent/60"
          >
            {LANGUAGE_KEYS.map((lang) => (
              <option key={lang} value={lang}>
                {t(`settings.languages.${lang}`)}
              </option>
            ))}
          </select>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-tertiary"
          />
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Rewrite `SettingsPanel.tsx` as the two-pane shell**

Replace the entire contents of `src/components/account/SettingsPanel.tsx` with:

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { SlidersHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { GeneralSettings } from './GeneralSettings'

const PAGES = [
  { id: 'general', icon: SlidersHorizontal, labelKey: 'settings.general', Component: GeneralSettings },
] as const

type PageId = (typeof PAGES)[number]['id']

export function SettingsPanel() {
  const { t } = useTranslation()
  const [active, setActive] = useState<PageId>('general')

  return (
    <TabsPrimitive.Root
      orientation="vertical"
      value={active}
      onValueChange={(v) => setActive(v as PageId)}
      className="flex min-h-[400px]"
    >
      <TabsPrimitive.List
        aria-label={t('settings.title')}
        className="flex w-[168px] shrink-0 flex-col gap-1 border-r border-border bg-surface-subtle p-2"
      >
        {PAGES.map((page) => {
          const Icon = page.icon
          return (
            <TabsPrimitive.Trigger
              key={page.id}
              value={page.id}
              className={cn(
                'flex items-center gap-2 rounded-md px-2.5 py-2 text-body transition-colors',
                'text-ink-secondary hover:bg-surface-muted',
                'data-[state=active]:bg-accent-active data-[state=active]:font-medium data-[state=active]:text-accent-strong',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              )}
            >
              <Icon size={16} className="shrink-0" />
              {t(page.labelKey)}
            </TabsPrimitive.Trigger>
          )
        })}
      </TabsPrimitive.List>

      {PAGES.map((page) => {
        const Page = page.Component
        return (
          <TabsPrimitive.Content
            key={page.id}
            value={page.id}
            className="min-w-0 flex-1 overflow-y-auto focus-visible:outline-none"
          >
            <Page />
          </TabsPrimitive.Content>
        )
      })}
    </TabsPrimitive.Root>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `tsc` complains that `Component`/`icon` aren't callable as JSX, confirm the `as const` is present on `PAGES` and that `Page`/`Icon` are assigned to capitalized local consts before use — they are above.)

- [ ] **Step 4: Commit**

```bash
git add src/components/account/GeneralSettings.tsx src/components/account/SettingsPanel.tsx
git commit -m "feat(settings): two-pane settings modal with left nav + 通用设置 page"
```

---

### Task 3: Widen the modal in `UserMenu`

**Files:**
- Modify: `src/components/sidebar/UserMenu.tsx:62-68`

- [ ] **Step 1: Add the wider `className` to the Modal**

In `src/components/sidebar/UserMenu.tsx`, replace:

```tsx
      <Modal
        open={settingsOpen}
        onOpenChange={(open) => !open && setSettingsOpen(false)}
        title={t('settings.title')}
      >
        <SettingsPanel />
      </Modal>
```

with:

```tsx
      <Modal
        open={settingsOpen}
        onOpenChange={(open) => !open && setSettingsOpen(false)}
        title={t('settings.title')}
        className="max-w-2xl"
      >
        <SettingsPanel />
      </Modal>
```

(`Modal` merges this via `cn`/tailwind-merge, so `max-w-2xl` cleanly overrides the default `max-w-lg`.)

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/sidebar/UserMenu.tsx
git commit -m "feat(settings): widen settings modal to fit the left nav"
```

---

### Task 4: Whole-feature verification (build + GUI acceptance)

No code changes — this is the verification gate. Nothing to commit.

- [ ] **Step 1: Production build**

Run: `npm run build`
Expected: `tsc` passes and `vite build` completes without errors.

- [ ] **Step 2: Launch the app for GUI acceptance**

Run the app the project's normal way (e.g. `npm run dev` for the Tauri dev shell). Then open settings: bottom-left user menu → 设置.

- [ ] **Step 3: Confirm the layout**

Verify:
- The modal is noticeably wider than before.
- The body is split: a left rail (surface-tinted, with a right border) holding a **single** active item — `SlidersHorizontal` icon + 通用设置 — styled with the accent-active highlight; no greyed placeholder items.
- The right pane shows DeepSeek API Key (status, password input, 保存 / 清除) and 界面语言 (select), identical to before.
- The header still shows 设置 on the left and the close ✕ on the right.

- [ ] **Step 4: Confirm behavior is unchanged**

Verify:
- API Key 保存 with a value flips the status to 已配置; 清除 flips it back to 未配置 (same as before — logic moved verbatim).
- Switching 界面语言 re-renders the UI in the chosen language, and the 通用设置 nav label updates to the matching locale (通用设置 / 通用設置 / General Settings).

- [ ] **Step 5: Confirm responsiveness**

Narrow the window — the modal still respects the `w-[calc(100vw-2rem)]` cap and does not overflow the viewport.

---

## Self-Review (completed during planning)

- **Spec coverage:** two-pane shell (Task 2) ✓; extensible page registry, no placeholders (Task 2) ✓; current settings moved verbatim into 通用设置 (Task 2, GeneralSettings) ✓; modal widened to `max-w-2xl` (Task 3) ✓; `settings.general` in all three locales (Task 1) ✓; header unchanged (Task 3 keeps `title`) ✓; GUI acceptance, no test-selector risk (Task 4) ✓.
- **Placeholder scan:** no TBD/TODO; every code step shows complete code.
- **Type consistency:** `PageId` is derived from `PAGES`; `active` state, `value`, and `onValueChange` cast all use `PageId`; `GeneralSettings` export name matches its import in `SettingsPanel`; i18n key `settings.general` matches `labelKey: 'settings.general'`.
- **Token check:** `surface-subtle`, `surface-muted`, `ink-secondary`, `accent-active`, `accent-strong`, `accent/60` all exist in `tailwind.config.js`.

---

## Addendum tasks: resizable, larger settings window

Same verification model (typecheck + build + GUI acceptance; no `.tsx` unit harness).

### Task 5: `useResizableBox` hook + resizable `Modal`

These compose as one logical change (the hook only exists to drive `Modal`), so one commit.

**Files:**
- Create: `src/components/ui/useResizableBox.ts`
- Rewrite: `src/components/ui/Modal.tsx`

- [ ] **Step 1: Create the hook `src/components/ui/useResizableBox.ts`**

```ts
import { useCallback, useEffect, useRef, useState } from 'react'

export type Size = { width: number; height: number }
export type ResizeDir =
  | 'top' | 'bottom' | 'left' | 'right'
  | 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'

const SENSE: Record<ResizeDir, { hx: number; hy: number }> = {
  right: { hx: 1, hy: 0 },
  left: { hx: -1, hy: 0 },
  bottom: { hx: 0, hy: 1 },
  top: { hx: 0, hy: -1 },
  'bottom-right': { hx: 1, hy: 1 },
  'bottom-left': { hx: -1, hy: 1 },
  'top-right': { hx: 1, hy: -1 },
  'top-left': { hx: -1, hy: -1 },
}

function clampToViewport(s: Size, min: Size): Size {
  const maxW = Math.max(min.width, Math.round(window.innerWidth * 0.96))
  const maxH = Math.max(min.height, Math.round(window.innerHeight * 0.92))
  return {
    width: Math.max(min.width, Math.min(s.width, maxW)),
    height: Math.max(min.height, Math.min(s.height, maxH)),
  }
}

interface Options {
  enabled: boolean
  defaultSize: Size
  minSize: Size
  storageKey?: string
}

export function useResizableBox({ enabled, defaultSize, minSize, storageKey }: Options) {
  const [size, setSize] = useState<Size>(defaultSize)
  const latest = useRef<Size>(defaultSize)
  const drag = useRef<{ dir: ResizeDir; x: number; y: number; w: number; h: number } | null>(null)

  const apply = useCallback((s: Size) => {
    latest.current = s
    setSize(s)
  }, [])

  useEffect(() => {
    if (!enabled) return
    let initial = defaultSize
    if (storageKey) {
      try {
        const raw = localStorage.getItem(storageKey)
        const parsed = raw ? JSON.parse(raw) : null
        if (typeof parsed?.width === 'number' && typeof parsed?.height === 'number') {
          initial = { width: parsed.width, height: parsed.height }
        }
      } catch {
        /* ignore malformed storage */
      }
    }
    apply(clampToViewport(initial, minSize))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])

  const onResizeStart = useCallback(
    (dir: ResizeDir, e: React.PointerEvent) => {
      if (!enabled) return
      e.preventDefault()
      drag.current = { dir, x: e.clientX, y: e.clientY, w: latest.current.width, h: latest.current.height }
      const onMove = (ev: PointerEvent) => {
        const d = drag.current
        if (!d) return
        const { hx, hy } = SENSE[d.dir]
        apply(
          clampToViewport(
            { width: d.w + 2 * hx * (ev.clientX - d.x), height: d.h + 2 * hy * (ev.clientY - d.y) },
            minSize,
          ),
        )
      }
      const onUp = () => {
        drag.current = null
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
        document.body.style.userSelect = ''
        if (storageKey) {
          try {
            localStorage.setItem(storageKey, JSON.stringify(latest.current))
          } catch {
            /* ignore quota errors */
          }
        }
      }
      document.body.style.userSelect = 'none'
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [enabled, minSize, storageKey, apply],
  )

  return { size, onResizeStart }
}
```

- [ ] **Step 2: Rewrite `src/components/ui/Modal.tsx`**

Replace the entire file with:

```tsx
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useResizableBox, type Size, type ResizeDir } from './useResizableBox'

interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  children: React.ReactNode
  className?: string
  resizable?: boolean
  defaultSize?: Size
  minSize?: Size
  storageKey?: string
}

const DEFAULT_SIZE: Size = { width: 960, height: 700 }
const DEFAULT_MIN: Size = { width: 600, height: 440 }

const RESIZE_HANDLES: { dir: ResizeDir; className: string }[] = [
  { dir: 'top', className: 'inset-x-0 top-0 h-1.5 cursor-ns-resize' },
  { dir: 'bottom', className: 'inset-x-0 bottom-0 h-1.5 cursor-ns-resize' },
  { dir: 'left', className: 'inset-y-0 left-0 w-1.5 cursor-ew-resize' },
  { dir: 'right', className: 'inset-y-0 right-0 w-1.5 cursor-ew-resize' },
  { dir: 'top-left', className: 'top-0 left-0 h-3 w-3 cursor-nwse-resize' },
  { dir: 'top-right', className: 'top-0 right-0 h-3 w-3 cursor-nesw-resize' },
  { dir: 'bottom-left', className: 'bottom-0 left-0 h-3 w-3 cursor-nesw-resize' },
  { dir: 'bottom-right', className: 'bottom-0 right-0 h-3 w-3 cursor-nwse-resize' },
]

export function Modal({
  open,
  onOpenChange,
  title,
  children,
  className,
  resizable,
  defaultSize,
  minSize,
  storageKey,
}: ModalProps) {
  const { t } = useTranslation()
  const { size, onResizeStart } = useResizableBox({
    enabled: !!resizable,
    defaultSize: defaultSize ?? DEFAULT_SIZE,
    minSize: minSize ?? DEFAULT_MIN,
    storageKey,
  })

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-ink/40" />
        <DialogPrimitive.Content
          className={cn(
            'fixed left-1/2 top-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-lg border border-border bg-white shadow-overlay outline-none animate-menu-in',
            !resizable && 'max-h-[85vh] w-[calc(100vw-2rem)] max-w-lg',
            className,
          )}
          style={resizable ? { width: size.width, height: size.height } : undefined}
        >
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
            <DialogPrimitive.Title className="text-title font-bold tracking-tight text-ink">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="flex h-8 w-8 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-muted"
              title={t('common.close')}
            >
              <X size={18} />
            </DialogPrimitive.Close>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
          {resizable &&
            RESIZE_HANDLES.map((h) => (
              <div
                key={h.dir}
                onPointerDown={(e) => onResizeStart(h.dir, e)}
                className={cn('absolute select-none', h.dir.includes('-') ? 'z-20' : 'z-10', h.className)}
              />
            ))}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
```

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` → no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/useResizableBox.ts src/components/ui/Modal.tsx
git commit -m "feat(ui): opt-in resizable Modal (centered, symmetric drag-resize)"
```

### Task 6: Wire the settings modal (UserMenu + SettingsPanel)

**Files:**
- Modify: `src/components/sidebar/UserMenu.tsx`
- Modify: `src/components/account/SettingsPanel.tsx`

- [ ] **Step 1: `UserMenu.tsx` — enable resizing on the settings Modal**

At the top of `src/components/sidebar/UserMenu.tsx`, after the imports, add module-level size constants (stable refs):

```tsx
const SETTINGS_DEFAULT_SIZE = { width: 960, height: 700 }
const SETTINGS_MIN_SIZE = { width: 600, height: 440 }
```

Then replace the settings `<Modal>` block:

```tsx
      <Modal
        open={settingsOpen}
        onOpenChange={(open) => !open && setSettingsOpen(false)}
        title={t('settings.title')}
        className="max-w-2xl"
      >
        <SettingsPanel />
      </Modal>
```

with:

```tsx
      <Modal
        open={settingsOpen}
        onOpenChange={(open) => !open && setSettingsOpen(false)}
        title={t('settings.title')}
        resizable
        defaultSize={SETTINGS_DEFAULT_SIZE}
        minSize={SETTINGS_MIN_SIZE}
        storageKey="hip.ui.settingsModalSize"
      >
        <SettingsPanel />
      </Modal>
```

(The `max-w-2xl` is removed — size is now controlled by `resizable`.)

- [ ] **Step 2: `SettingsPanel.tsx` — fill the (now fixed-height) window**

In `src/components/account/SettingsPanel.tsx`, change the `TabsPrimitive.Root` className:

```tsx
      className="flex max-h-[70vh] min-h-[400px]"
```

to:

```tsx
      className="flex h-full"
```

The shell now fills the modal body, so the rail spans the full window height and the content pane (`flex-1 overflow-y-auto`) scrolls within it.

- [ ] **Step 3: Typecheck** — `npx tsc --noEmit` → no errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/sidebar/UserMenu.tsx src/components/account/SettingsPanel.tsx
git commit -m "feat(settings): open the settings window larger and resizable"
```

### Task 7: Verification (build + GUI acceptance)

- [ ] **Step 1:** `npm run build` → succeeds.
- [ ] **Step 2:** Launch the app, open 设置.
  - Opens noticeably larger (≈960×700), centered.
  - Drag the right edge / bottom edge / a corner → the window grows/shrinks smoothly, staying centered, and the handle tracks the pointer (no half-speed lag).
  - It won't shrink below ≈600×440, and won't exceed the viewport.
  - The left rail spans the full window height; the content pane scrolls if needed.
  - Close and reopen → the window reopens at the size you left it (also after restarting the app).
  - The API Key save/clear and language switch still work.
