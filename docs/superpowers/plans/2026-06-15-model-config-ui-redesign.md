# 模型配置 UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restyle the 模型配置 settings page into the new design language (page header + rich current-model hero + sectioned right pane + add-custom modal), keeping the master-detail structure and changing no backend.

**Architecture:** Decompose the 327-line `ModelConfig.tsx` monolith into a slim orchestrator plus focused presentational components (`CurrentModelHero`, `ProviderList`, `ProviderDetail`, `AddProviderDialog`), reusing existing primitives (`Avatar`/`Badge`/`Button`/`Modal`) and one new TDD pure helper (`modelBadges`). The `providersStore`/IPC/protocol layers are untouched — data flow is identical to today.

**Tech Stack:** React 18 + TypeScript + Tailwind (CSS-var tokens) + Radix Dialog + zustand + react-i18next + lucide-react + vitest (node env, pure-logic tests only).

**Spec:** `docs/superpowers/specs/2026-06-15-model-config-ui-redesign-design.md`

**Branch:** `feat/model-config-ui-redesign` (already created; spec committed at 20a8910).

---

## Reference: existing facts the implementer needs

- **No component-test harness.** vitest is `environment: 'node'`, `include: ['src/**/*.test.ts', 'packages/sidecar/src/**/*.test.ts']`. Only pure `*.test.ts` logic tests exist. Do NOT add jsdom/RTL. Components are verified by `yarn type-check` + `yarn build` + browser preview.
- **Paid-test trap:** `yarn test` is safe (node env, no sidecar spawn). If you ever run a filtered `vitest run src ...`, it substring-matches `packages/sidecar/src` and fires paid real-LLM suites — so always use plain `yarn test`.
- **Token classes available** (from `tailwind.config`): `accent`, `accent-hover`, `accent-strong`, `accent-subtle`, `accent-active`, `surface`, `surface-subtle`, `surface-muted`, `border`, `ink`, `ink-secondary`, `ink-tertiary`, `success`, `danger`, `warning`. Opacity modifiers work (`bg-success/10`, `bg-warning/10`, `bg-danger/10` — the last is already used in `BranchSwitcher.tsx`).
- **`Avatar`** (`src/components/ui/Avatar.tsx`): `<Avatar name={string} shape="square" size={40} className?/>` — default fill is `bg-accent-subtle text-accent-strong`, square → `rounded-lg`.
- **`Badge`** (`src/components/ui/Badge.tsx`): `<Badge className?>{children}</Badge>` — default `bg-surface-muted text-caption text-ink-tertiary`.
- **`Button`** (`src/components/ui/Button.tsx`): `variant` ∈ `primary|secondary|ghost|outline|danger`, `size` ∈ `sm|md|lg|icon`. `sm` = `h-8 px-3 text-body`.
- **`Modal`** (`src/components/ui/Modal.tsx`): `<Modal open onOpenChange title className?>…</Modal>` — renders its own 14h header with title + close X; default width `max-w-lg`. Children are the body. (Opened from a plain button, not a menu item — no `modal={false}` pointer-events concern; that bug only affects `DropdownMenu`/`ContextMenu` items opening a Modal, and this page has no menus.)
- **`CatalogModel`** (`src/ipc/catalog.ts`): `{ id, name, family?, reasoning?, tool_call?, attachment?, cost?, limit?: { context: number; output: number } }`.
- **`ProviderGroups`** (`src/lib/providerGroups.ts`): `{ configured: CatalogProvider[]; available: CatalogProvider[]; incompatible: CatalogProvider[] }` from `groupProviders(catalog, filter, keyConfigured)`.
- **`filterModels`** (`src/lib/modelFilter.ts`): `filterModels(models, query, caps)`; `ModelCaps = { reasoning, tool_call, attachment }`; `NO_CAPS`.

---

## Task 1: `modelBadges` pure helper (TDD)

The hero and the model cards both need "context window (rounded to K) + capability flags in a stable order". Extract it to a pure, tested helper so both render identically.

**Files:**
- Create: `src/lib/modelBadges.ts`
- Test: `src/lib/modelBadges.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/modelBadges.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { modelBadges } from './modelBadges'
import type { CatalogModel } from '@/ipc/catalog'

const base: CatalogModel = { id: 'm', name: 'M' }

describe('modelBadges', () => {
  it('rounds the context window to thousands', () => {
    expect(modelBadges({ ...base, limit: { context: 128000, output: 4096 } }).contextK).toBe(128)
    expect(modelBadges({ ...base, limit: { context: 63500, output: 8192 } }).contextK).toBe(64)
  })

  it('returns null context when the model has no limit', () => {
    expect(modelBadges(base).contextK).toBeNull()
  })

  it('lists capabilities in reasoning → tool → attachment order regardless of input order', () => {
    const m: CatalogModel = { ...base, attachment: true, reasoning: true, tool_call: true }
    expect(modelBadges(m).caps).toEqual(['reasoning', 'tool_call', 'attachment'])
  })

  it('omits absent capabilities', () => {
    expect(modelBadges({ ...base, tool_call: true }).caps).toEqual(['tool_call'])
    expect(modelBadges(base).caps).toEqual([])
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `yarn test src/lib/modelBadges.test.ts`
Expected: FAIL — `Failed to resolve import "./modelBadges"` / `modelBadges is not a function`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/lib/modelBadges.ts`:
```ts
import type { CatalogModel } from '@/ipc/catalog'

export type ModelCapKey = 'reasoning' | 'tool_call' | 'attachment'

export interface ModelBadges {
  /** Context window in thousands (rounded), or null when the model omits a limit. */
  contextK: number | null
  /** Capability flags present on the model, in a stable display order. */
  caps: ModelCapKey[]
}

const CAP_ORDER: ModelCapKey[] = ['reasoning', 'tool_call', 'attachment']

export function modelBadges(m: CatalogModel): ModelBadges {
  return {
    contextK: m.limit?.context ? Math.round(m.limit.context / 1000) : null,
    caps: CAP_ORDER.filter((k) => m[k]),
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `yarn test src/lib/modelBadges.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/modelBadges.ts src/lib/modelBadges.test.ts
git commit -m "$(cat <<'EOF'
feat(model-config): modelBadges pure helper (context K + capability order)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: i18n keys (all three locales)

Repurpose the over-long `models` value into a clean section title, and add the five new keys the redesign needs. Touch all three locale files so they stay in sync.

**Files:**
- Modify: `src/i18n/zh-CN.ts` (the `settings.modelConfig` block)
- Modify: `src/i18n/zh-TW.ts` (the `settings.modelConfig` block)
- Modify: `src/i18n/en.ts` (the `settings.modelConfig` block)

- [ ] **Step 1: zh-CN — change `models` value and add five keys**

In `src/i18n/zh-CN.ts`, inside `settings.modelConfig`, change the `models` line:
```ts
        models: '模型',
```
(was `'模型 · 来自 models.dev'`). Then add these five keys to the same `modelConfig` object (anywhere inside it, e.g. right after `currentModel`):
```ts
        intro: '配置提供商的 API 密钥与可用模型，并选择对话使用的当前模型。',
        noModel: '未选择模型',
        noModelHint: '在下方选择一个提供商并设为当前模型',
        ready: '已就绪',
        keyMissing: '密钥缺失',
```

- [ ] **Step 2: zh-TW — change `models` value and add five keys**

In `src/i18n/zh-TW.ts`, inside `settings.modelConfig`, change:
```ts
        models: '模型',
```
(was `'模型 · 來自 models.dev'`). Add:
```ts
        intro: '設定提供商的 API 金鑰與可用模型，並選擇對話使用的當前模型。',
        noModel: '未選擇模型',
        noModelHint: '在下方選擇一個提供商並設為當前模型',
        ready: '已就緒',
        keyMissing: '金鑰缺失',
```

- [ ] **Step 3: en — change `models` value and add five keys**

Open `src/i18n/en.ts`, find `settings.modelConfig`, change its `models` value to:
```ts
        models: 'Models',
```
(it is currently `models: 'Models · from models.dev'`). Add:
```ts
        intro: 'Configure provider API keys and available models, and pick the current model for chat.',
        noModel: 'No model selected',
        noModelHint: 'Pick a provider below and set a current model',
        ready: 'Ready',
        keyMissing: 'Key missing',
```

- [ ] **Step 4: Type-check**

Run: `yarn type-check`
Expected: PASS. (The locale objects are `as const`; the three must keep identical shapes — adding the same keys to all three keeps them consistent.)

- [ ] **Step 5: Commit**

```bash
git add src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/i18n/en.ts
git commit -m "$(cat <<'EOF'
i18n(model-config): hero/intro keys + tidy models section label

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `CurrentModelHero.tsx`

The rich hero card for the active model, plus the "未选择模型" empty state. Pure presentational; honest status (key-configured → 已就绪, missing → 密钥缺失). No liveness claim.

**Files:**
- Create: `src/components/account/CurrentModelHero.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/account/CurrentModelHero.tsx`:
```tsx
import { useTranslation } from 'react-i18next'
import { Check, AlertTriangle } from 'lucide-react'
import type { CatalogModel } from '@/ipc/catalog'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { modelBadges, type ModelCapKey } from '@/lib/modelBadges'

const CAP_I18N: Record<ModelCapKey, string> = {
  reasoning: 'settings.modelConfig.reasoning',
  tool_call: 'settings.modelConfig.tools',
  attachment: 'settings.modelConfig.vision',
}

/** Hero card summarising the current (active) model. Renders an empty state when none is set. */
export function CurrentModelHero({
  providerName,
  modelID,
  model,
  keyConfigured,
}: {
  providerName: string | null
  modelID: string | null
  model: CatalogModel | undefined
  keyConfigured: boolean
}) {
  const { t } = useTranslation()

  if (!modelID || !providerName) {
    return (
      <div className="mb-4 rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-3.5">
        <div className="text-body text-ink-secondary">{t('settings.modelConfig.noModel')}</div>
        <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.modelConfig.noModelHint')}</div>
      </div>
    )
  }

  const badges = model ? modelBadges(model) : null
  return (
    <div className="mb-4 flex items-center gap-3.5 rounded-lg border border-border bg-surface px-4 py-3">
      <Avatar name={providerName} shape="square" size={40} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-body font-medium text-ink">{modelID}</div>
        <div className="mt-0.5 text-meta text-ink-tertiary">
          {providerName} · {t('settings.modelConfig.currentModel')}
        </div>
        {badges && (badges.contextK !== null || badges.caps.length > 0) && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {badges.caps.map((c) => (
              <Badge key={c} className={c === 'reasoning' ? 'bg-accent-subtle text-accent-strong' : undefined}>
                {t(CAP_I18N[c])}
              </Badge>
            ))}
            {badges.contextK !== null && <Badge>{badges.contextK}K</Badge>}
          </div>
        )}
      </div>
      {keyConfigured ? (
        <span className="flex shrink-0 items-center gap-1 rounded-md bg-success/10 px-2 py-1 text-caption text-success">
          <Check size={12} /> {t('settings.modelConfig.ready')}
        </span>
      ) : (
        <span className="flex shrink-0 items-center gap-1 rounded-md bg-warning/10 px-2 py-1 text-caption text-warning">
          <AlertTriangle size={12} /> {t('settings.modelConfig.keyMissing')}
        </span>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS. (Component is not imported yet — an unused module still type-checks.)

- [ ] **Step 3: Commit**

```bash
git add src/components/account/CurrentModelHero.tsx
git commit -m "$(cat <<'EOF'
feat(model-config): CurrentModelHero card + empty state

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `ProviderList.tsx`

The left master pane: search, the three groups with counts, restyled provider rows (square mini-avatar + status), collapsible incompatible group, and the add-custom footer. Logic (grouping, incompatible-auto-open on filter) is preserved from today's inline `renderRow`.

**Files:**
- Create: `src/components/account/ProviderList.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/account/ProviderList.tsx`:
```tsx
import { useTranslation } from 'react-i18next'
import { Search, Plus, Ban, ChevronRight } from 'lucide-react'
import { isCompatible, type CatalogProvider } from '@/ipc/catalog'
import type { ProviderGroups } from '@/lib/providerGroups'
import { cn } from '@/lib/utils'

/** Left master pane: searchable, grouped provider list + add-custom footer. */
export function ProviderList({
  groups,
  activeId,
  keyConfigured,
  filter,
  onFilter,
  showIncompatible,
  onToggleIncompatible,
  onSelect,
  onAddCustom,
}: {
  groups: ProviderGroups
  activeId: string | null
  keyConfigured: Record<string, boolean>
  filter: string
  onFilter: (value: string) => void
  showIncompatible: boolean
  onToggleIncompatible: () => void
  onSelect: (id: string) => void
  onAddCustom: () => void
}) {
  const { t } = useTranslation()
  const hasMatches =
    groups.configured.length + groups.available.length + groups.incompatible.length > 0
  // A filter search should reach incompatible matches too, even while the group is collapsed.
  const incompatibleOpen = showIncompatible || filter.trim() !== ''

  const renderRow = (p: CatalogProvider) => {
    const compat = isCompatible(p)
    const isActive = p.id === activeId
    return (
      <button
        key={p.id}
        disabled={!compat}
        onClick={() => onSelect(p.id)}
        className={cn(
          'flex w-full items-center gap-2 px-2.5 py-2 text-left text-body transition-colors',
          compat ? 'hover:bg-surface-muted' : 'cursor-not-allowed opacity-55',
          isActive && 'bg-accent-active',
        )}
      >
        <span
          className={cn(
            'flex h-5 w-5 shrink-0 items-center justify-center rounded text-caption',
            isActive ? 'bg-accent-subtle text-accent-strong' : 'bg-surface-muted text-ink-secondary',
          )}
        >
          {p.name.charAt(0).toUpperCase()}
        </span>
        <span className={cn('truncate', isActive ? 'font-medium text-accent-strong' : 'text-ink-secondary')}>
          {p.name}
        </span>
        {!compat ? (
          <Ban size={13} className="ml-auto shrink-0 text-ink-tertiary" />
        ) : keyConfigured[p.id] ? (
          <span className="ml-auto h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
        ) : (
          <span className="ml-auto shrink-0 text-caption text-ink-tertiary">
            {t('settings.modelConfig.notConfigured')}
          </span>
        )}
      </button>
    )
  }

  return (
    <div className="w-[200px] shrink-0 self-start overflow-hidden rounded-lg border border-border">
      <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
        <Search size={13} className="text-ink-tertiary" />
        <input
          value={filter}
          onChange={(e) => onFilter(e.target.value)}
          placeholder={t('settings.modelConfig.searchProviders')}
          className="w-full bg-transparent text-meta text-ink placeholder:text-ink-tertiary focus:outline-none"
        />
      </div>
      <div className="max-h-[340px] overflow-y-auto py-1">
        {groups.configured.length > 0 && (
          <>
            <div className="px-2.5 pb-0.5 pt-2 text-caption text-ink-tertiary">
              {t('settings.modelConfig.configured')} · {groups.configured.length}
            </div>
            {groups.configured.map(renderRow)}
          </>
        )}
        {groups.available.length > 0 && (
          <>
            <div className="px-2.5 pb-0.5 pt-2 text-caption text-ink-tertiary">
              {t('settings.modelConfig.available')} · {groups.available.length}
            </div>
            {groups.available.map(renderRow)}
          </>
        )}
        {groups.incompatible.length > 0 && (
          <>
            <button
              onClick={onToggleIncompatible}
              className="flex w-full items-center gap-1 px-2.5 pb-0.5 pt-2 text-left text-caption text-ink-tertiary transition-colors hover:text-ink-secondary"
            >
              <ChevronRight size={11} className={cn('shrink-0 transition-transform', incompatibleOpen && 'rotate-90')} />
              {t('settings.modelConfig.incompatibleGroup')} · {groups.incompatible.length}
            </button>
            {incompatibleOpen && groups.incompatible.map(renderRow)}
          </>
        )}
        {!hasMatches && (
          <div className="px-2.5 py-3 text-center text-meta text-ink-tertiary">
            {t('settings.modelConfig.noMatches')}
          </div>
        )}
      </div>
      <button
        onClick={onAddCustom}
        className="flex w-full items-center gap-1.5 border-t border-border px-2.5 py-2.5 text-body text-accent-strong transition-colors hover:bg-surface-muted"
      >
        <Plus size={14} /> {t('settings.modelConfig.addCustom')}
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
git add src/components/account/ProviderList.tsx
git commit -m "$(cat <<'EOF'
feat(model-config): ProviderList left pane (grouped, restyled rows)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `ProviderDetail.tsx` (with `ModelCard`)

The right detail pane, reorganised into three bordered section cards (API 密钥 / Base URL / 模型). The key/baseURL/set-current logic moves verbatim from today's `ProviderDetail` — only the markup changes. `ModelCard` is a small local component using `modelBadges` for the meta line.

**Files:**
- Create: `src/components/account/ProviderDetail.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/account/ProviderDetail.tsx`:
```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Check } from 'lucide-react'
import type { CatalogProvider, CatalogModel } from '@/ipc/catalog'
import { filterModels, NO_CAPS, type ModelCaps } from '@/lib/modelFilter'
import { modelBadges, type ModelCapKey } from '@/lib/modelBadges'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

/** The capability toggles shown above the model list; each maps to a ModelCaps key + an i18n label. */
const CAP_FILTERS = [
  { key: 'reasoning', i18n: 'reasoning' },
  { key: 'tool_call', i18n: 'tools' },
  { key: 'attachment', i18n: 'vision' },
] as const

const CAP_I18N: Record<ModelCapKey, string> = {
  reasoning: 'settings.modelConfig.reasoning',
  tool_call: 'settings.modelConfig.tools',
  attachment: 'settings.modelConfig.vision',
}

const inputCls =
  'h-8 flex-1 rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

/** Right detail pane: API key, base URL, and model selection for one provider. */
export function ProviderDetail({
  provider,
  configured,
  baseURL,
  isActive,
  onSaveKey,
  onClearKey,
  onSaveBaseURL,
  onSetCurrent,
}: {
  provider: CatalogProvider
  configured: boolean
  baseURL: string
  isActive: (modelID: string) => boolean
  onSaveKey: (value: string) => Promise<void>
  onClearKey: () => Promise<void>
  onSaveBaseURL: (value: string) => Promise<void>
  onSetCurrent: (modelID: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [baseURLValue, setBaseURLValue] = useState(baseURL)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [modelQuery, setModelQuery] = useState('')
  const [caps, setCaps] = useState<ModelCaps>(NO_CAPS)

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await fn()
      setValue('')
    } catch (e) {
      console.error('[modelConfig]', e)
      setError(t('settings.modelConfig.error'))
    } finally {
      setBusy(false)
    }
  }

  // Separate from run(): saving the base URL must NOT clear the API-key draft (`value`).
  async function saveBaseURL() {
    setBusy(true)
    setError(null)
    try {
      await onSaveBaseURL(baseURLValue.trim())
    } catch (e) {
      console.error('[modelConfig]', e)
      setError(t('settings.modelConfig.error'))
    } finally {
      setBusy(false)
    }
  }

  const allModels = Object.values(provider.models)
  const current = allModels.find((m) => isActive(m.id))
  const rest = current ? allModels.filter((m) => m.id !== current.id) : allModels
  const filtered = filterModels(rest, modelQuery, caps)

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
      <section className="rounded-lg border border-border bg-surface p-3.5">
        <div className="mb-2 flex items-center text-body font-medium text-ink">
          {t('settings.modelConfig.apiKey')}
          {configured && (
            <span className="ml-auto flex items-center gap-1 text-caption font-normal text-success">
              <Check size={12} /> {t('settings.modelConfig.keyStored')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sk-..."
            className={inputCls}
          />
          <Button size="sm" disabled={busy || !value.trim()} onClick={() => run(() => onSaveKey(value.trim()))}>
            {configured ? t('settings.modelConfig.change') : t('settings.modelConfig.save')}
          </Button>
          <Button variant="outline" size="sm" disabled={busy || !configured} onClick={() => run(onClearKey)}>
            {t('settings.modelConfig.clear')}
          </Button>
        </div>
        {error && <div className="mt-1.5 text-meta text-danger">{error}</div>}
      </section>

      <section className="rounded-lg border border-border bg-surface p-3.5">
        <div className="mb-2 text-body font-medium text-ink">{t('settings.modelConfig.baseUrl')}</div>
        <div className="flex items-center gap-2">
          <input
            value={baseURLValue}
            onChange={(e) => setBaseURLValue(e.target.value)}
            placeholder={provider.api ?? 'https://...'}
            className={cn(inputCls, 'font-mono text-meta')}
          />
          <Button
            size="sm"
            disabled={busy || !baseURLValue.trim() || baseURLValue.trim() === baseURL}
            onClick={() => void saveBaseURL()}
          >
            {t('settings.modelConfig.save')}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-border bg-surface p-3.5">
        <div className="mb-2.5 flex items-center text-body font-medium text-ink">
          {t('settings.modelConfig.models')}
          {allModels.length > 0 && (
            <span className="ml-auto text-caption font-normal text-ink-tertiary">
              {allModels.length} {t('settings.modelConfig.modelsUnit')}
            </span>
          )}
        </div>
        <div className="mb-2.5 flex items-center gap-2">
          <div className="flex h-8 flex-1 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5">
            <Search size={13} className="shrink-0 text-ink-tertiary" />
            <input
              value={modelQuery}
              onChange={(e) => setModelQuery(e.target.value)}
              placeholder={t('settings.modelConfig.searchModels')}
              className="w-full bg-transparent text-body text-ink placeholder:text-ink-tertiary focus:outline-none"
            />
          </div>
          {CAP_FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setCaps((c) => ({ ...c, [f.key]: !c[f.key] }))}
              className={cn(
                'h-8 shrink-0 rounded-md px-2.5 text-caption transition-colors',
                caps[f.key] ? 'bg-accent text-white' : 'border border-border text-ink-secondary hover:bg-surface-muted',
              )}
            >
              {t(`settings.modelConfig.${f.i18n}`)}
            </button>
          ))}
        </div>

        {current && (
          <div className="mb-1.5">
            <ModelCard model={current} isCurrent busy={busy} onClick={() => void run(() => onSetCurrent(current.id))} />
          </div>
        )}

        <div className="flex max-h-[280px] flex-col gap-1.5 overflow-y-auto">
          {filtered.length > 0 ? (
            filtered.map((m) => (
              <ModelCard key={m.id} model={m} isCurrent={false} busy={busy} onClick={() => void run(() => onSetCurrent(m.id))} />
            ))
          ) : (
            <div className="px-2.5 py-3 text-center text-meta text-ink-tertiary">
              {t('settings.modelConfig.noMatches')}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

function ModelCard({
  model,
  isCurrent,
  busy,
  onClick,
}: {
  model: CatalogModel
  isCurrent: boolean
  busy: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  const { contextK, caps } = modelBadges(model)
  const meta = [contextK !== null ? `${contextK}K` : null, ...caps.map((c) => t(CAP_I18N[c]))].filter(Boolean)
  return (
    <button
      disabled={busy}
      onClick={onClick}
      className={cn(
        'flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left disabled:opacity-60',
        isCurrent ? 'border-accent bg-accent-active' : 'border-border hover:bg-surface-muted',
      )}
    >
      <div className="min-w-0 flex-1">
        <div className={cn('truncate text-body', isCurrent && 'font-medium text-accent-strong')}>{model.name}</div>
        {meta.length > 0 && <div className="mt-0.5 text-caption text-ink-tertiary">{meta.join(' · ')}</div>}
      </div>
      <span className="shrink-0 text-caption text-accent-strong">
        {isCurrent ? t('settings.modelConfig.current') : t('settings.modelConfig.setCurrent')}
      </span>
    </button>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/account/ProviderDetail.tsx
git commit -m "$(cat <<'EOF'
feat(model-config): sectioned ProviderDetail + ModelCard

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `AddProviderDialog.tsx`

The add-custom-provider form, moved from an inline pane into a `Modal` (consistent with `AgentEditor`). Submit logic is identical to today's `AddCustomProvider.submit()`.

**Files:**
- Create: `src/components/account/AddProviderDialog.tsx`

- [ ] **Step 1: Create the component**

Create `src/components/account/AddProviderDialog.tsx`:
```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProvidersStore } from '@/store/providersStore'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

const inputCls =
  'h-9 w-full rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

/** Modal form to register a custom OpenAI-compatible provider. */
export function AddProviderDialog({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
  const { t } = useTranslation()
  const addCustom = useProvidersStore((s) => s.addCustom)
  const [name, setName] = useState('')
  const [baseURL, setBaseURL] = useState('')
  const [key, setKey] = useState('')
  const [models, setModels] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    const id = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    if (!id || !baseURL.trim()) return
    setBusy(true)
    setError(null)
    try {
      const ids = models.split(',').map((m) => m.trim()).filter(Boolean)
      await addCustom(id, name.trim(), baseURL.trim(), ids)
      if (key.trim()) await useProvidersStore.getState().saveKey(id, key.trim())
      onDone(id)
    } catch (e) {
      console.error('[modelConfig]', e)
      setError(t('settings.modelConfig.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onOpenChange={(o) => { if (!o) onCancel() }} title={t('settings.modelConfig.addCustom')}>
      <div className="flex flex-col">
        <div className="space-y-3 p-5">
          <Field label={t('settings.modelConfig.customName')}>
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="My Provider" />
          </Field>
          <Field label={t('settings.modelConfig.baseUrl')}>
            <input className={cn(inputCls, 'font-mono')} value={baseURL} onChange={(e) => setBaseURL(e.target.value)} placeholder="https://..." />
          </Field>
          <Field label={t('settings.modelConfig.apiKey')}>
            <input className={inputCls} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-..." />
          </Field>
          <Field label={t('settings.modelConfig.customModels')}>
            <input className={inputCls} value={models} onChange={(e) => setModels(e.target.value)} placeholder="gpt-4o, gpt-4o-mini" />
          </Field>
          {error && <div className="text-meta text-danger">{error}</div>}
        </div>
        <div className="flex justify-end gap-2 border-t border-border bg-surface-subtle px-5 py-3">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" size="sm" disabled={busy || !name.trim() || !baseURL.trim()} onClick={() => void submit()}>
            {t('settings.modelConfig.addProvider')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1.5 block text-meta text-ink-tertiary">{label}</label>
      {children}
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/account/AddProviderDialog.tsx
git commit -m "$(cat <<'EOF'
feat(model-config): AddProviderDialog modal (replaces inline add form)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Rewrite `ModelConfig.tsx` orchestrator

Replace the monolith with a slim orchestrator: page header, hero, two-pane (`ProviderList` + `ProviderDetail`), and the `AddProviderDialog` modal. All `activeId`/`active`/store wiring is preserved; the old inline `adding` mode is replaced by `addOpen` + the modal.

**Files:**
- Modify (full rewrite): `src/components/account/ModelConfig.tsx`

- [ ] **Step 1: Replace the file contents**

Overwrite `src/components/account/ModelConfig.tsx` with:
```tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProvidersStore } from '@/store/providersStore'
import { groupProviders } from '@/lib/providerGroups'
import { CurrentModelHero } from './CurrentModelHero'
import { ProviderList } from './ProviderList'
import { ProviderDetail } from './ProviderDetail'
import { AddProviderDialog } from './AddProviderDialog'

export function ModelConfig() {
  const { t } = useTranslation()
  const { catalog, config, keyConfigured, loaded, load, saveKey, clearKey, setBaseURL, setActiveModel } =
    useProvidersStore()
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [showIncompatible, setShowIncompatible] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const groups = groupProviders(catalog, filter, keyConfigured)
  const activeId =
    selected ?? config.activeModel?.providerID ?? groups.configured[0]?.id ?? groups.available[0]?.id ?? null
  const active = activeId ? catalog[activeId] : undefined
  const am = config.activeModel
  const activeModelMeta = am ? catalog[am.providerID]?.models[am.modelID] : undefined

  if (!loaded) return <div className="p-6 text-meta text-ink-tertiary">…</div>

  return (
    <div className="p-6">
      <h2 className="text-title font-semibold text-ink">{t('settings.model')}</h2>
      <p className="mt-1 text-body text-ink-secondary">{t('settings.modelConfig.intro')}</p>

      <div className="mt-5">
        <CurrentModelHero
          providerName={am ? (catalog[am.providerID]?.name ?? am.providerID) : null}
          modelID={am?.modelID ?? null}
          model={activeModelMeta}
          keyConfigured={am ? !!keyConfigured[am.providerID] : false}
        />

        <div className="flex gap-3.5">
          <ProviderList
            groups={groups}
            activeId={activeId}
            keyConfigured={keyConfigured}
            filter={filter}
            onFilter={setFilter}
            showIncompatible={showIncompatible}
            onToggleIncompatible={() => setShowIncompatible((v) => !v)}
            onSelect={setSelected}
            onAddCustom={() => setAddOpen(true)}
          />

          {active ? (
            <ProviderDetail
              key={active.id}
              provider={active}
              configured={!!keyConfigured[active.id]}
              baseURL={config.providers[active.id]?.baseURL ?? active.api ?? ''}
              isActive={(modelID) => am?.providerID === active.id && am?.modelID === modelID}
              onSaveKey={(v) => saveKey(active.id, v)}
              onClearKey={() => clearKey(active.id)}
              onSaveBaseURL={(v) => setBaseURL(active.id, v)}
              onSetCurrent={(modelID) => setActiveModel(active.id, modelID)}
            />
          ) : (
            <div className="min-w-0 flex-1 text-meta text-ink-tertiary">…</div>
          )}
        </div>
      </div>

      {addOpen && (
        <AddProviderDialog
          onDone={(id) => {
            setAddOpen(false)
            setSelected(id)
          }}
          onCancel={() => setAddOpen(false)}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check and build**

Run: `yarn type-check && yarn build`
Expected: both PASS. (`ModelConfig` is imported by `src/components/account/SettingsPanel.tsx`; its export name is unchanged, so no other edits are needed.)

- [ ] **Step 3: Commit**

```bash
git add src/components/account/ModelConfig.tsx
git commit -m "$(cat <<'EOF'
feat(model-config): slim ModelConfig orchestrator (hero + two-pane + add modal)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Prune dead i18n + full verification

Remove any i18n key the rewrite orphaned, then run the full gate set and verify the screen in the browser preview.

**Files:**
- Modify (if dead keys found): `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`, `src/i18n/en.ts`

- [ ] **Step 1: Find dead `settings.modelConfig` keys**

Run this for each candidate to see if it is still referenced anywhere in `src`:
```bash
for k in incompatible vision reasoning tools current setCurrent modelsUnit keyStored; do
  echo "== $k =="; grep -rn "modelConfig.$k\|'$k'" src/components src/lib | grep -v i18n || echo "  (no direct usage — check carefully)"
done
grep -rn "modelConfig.incompatible\b" src | grep -v "incompatibleGroup"
```
The known dead one is `incompatible` (the standalone "非 OpenAI 兼容…" string — the list uses `incompatibleGroup`, not `incompatible`). Confirm it has zero references in `src/components`/`src/lib`, then delete the `incompatible:` line from all three locale files. Do NOT delete `incompatibleGroup`. Leave every key that is still referenced (the loop above will show usages for the capability/label keys).

- [ ] **Step 2: Full gate set**

Run: `yarn type-check && yarn test && yarn build`
Expected: type-check PASS; tests PASS (full suite green, including the new `modelBadges` tests; paid-free — node env); build PASS.

- [ ] **Step 3: Browser-preview verification**

Start/confirm the hip-web preview (`preview_start` if needed; Vite dev server). Then:
1. `preview_eval`: `window.location.reload()` if HMR didn't pick up the changes.
2. Navigate: skip login → 设置 → 模型配置 (click the Cpu/"模型配置" tab in `SettingsPanel`).
3. `preview_snapshot` to confirm structure renders: page header (模型配置 + intro), current-model hero OR the "未选择模型" empty state, the provider list (search + group headers + "+ 自定义提供商" footer), and the right-pane section cards (API 密钥 / Base URL / 模型).
4. `preview_click` the "+ 自定义提供商" footer → `preview_snapshot` to confirm the `AddProviderDialog` modal opens with the four fields, then close it (ESC or the X) and confirm the app is still interactive (click a provider row).
5. `preview_console_logs` → confirm no errors.
6. `preview_screenshot` to capture the redesigned screen as proof.

Note: the browser preview has no Tauri IPC, so the real models.dev catalog and stored keys are absent — the list/detail may be sparse or empty. Structure, empty-states, the cap-filter chips, and the modal open/close are what to verify here. Populated provider detail + live set-current (which restarts the sidecar) is deferred to manual `yarn tauri dev` acceptance by the user.

- [ ] **Step 4: Commit (if Step 1 changed files)**

```bash
git add src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/i18n/en.ts
git commit -m "$(cat <<'EOF'
i18n(model-config): prune dead 'incompatible' key after redesign

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Final review (after all tasks)

Dispatch a holistic code reviewer over `git diff main...HEAD` (without switching branches) covering: spec compliance, the four new components + helper, the orchestrator rewrite, i18n sync across all three locales, and that no `providersStore`/IPC behavior changed. Then use `superpowers:finishing-a-development-branch`.

---

## Self-review notes (plan author)

- **Spec coverage:** §5 file structure → Tasks 3–7; §6 helper → Task 1; §7.1 header → Task 7; §7.2 hero → Task 3; §7.3 list → Task 4; §7.4 detail → Task 5; §7.5 add modal → Task 6; §10 i18n → Tasks 2 & 8; §12 testing → Task 1 + Task 8. All spec sections map to a task.
- **`ModelList` split:** the spec marked it optional. The model list stayed inside `ProviderDetail` as a local `ModelCard` (the file is ~210 lines but expresses one cohesive "configure this provider" responsibility); no separate `ModelList.tsx`. This is the deliberate, allowed choice from spec §5.
- **Type consistency:** `modelBadges` returns `{ contextK: number | null, caps: ModelCapKey[] }` — consumed identically in `CurrentModelHero` (Task 3) and `ModelCard` (Task 5). `CAP_I18N` map is duplicated in both (3 entries) rather than exported, matching the existing `CAP_FILTERS` local-const pattern in the codebase. Store action signatures (`saveKey`/`clearKey`/`setBaseURL`/`setActiveModel`/`addCustom`) are passed through unchanged from `useProvidersStore`.
