# 智能体管理 UI redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the *智能体管理* settings page so each agent is a polished card (avatar, badges, quiet command subline, inline enable toggle, kebab menu) and the add/edit flow is a clean sectioned modal, with a confirmation dialog before delete.

**Architecture:** Pure presentational/interaction polish over the existing list + modal structure. Two pure helpers (`groupModelOptions`, `buildAgentDraft`) are extracted and TDD'd in `*.test.ts`; the UI is split into focused files (`AgentCard`, `AgentEditor`, `DeleteAgentDialog`) orchestrated by `AgentManagement`, and verified via type-check + manual GUI (the repo has **no** component-test harness — `vitest` runs in `node`, no jsdom/RTL — so we do not add render tests). No store/IPC/protocol changes.

**Tech Stack:** React 18 + TypeScript, Tailwind (CSS-var tokens), Radix (`react-dropdown-menu`, `react-dialog`), lucide-react, react-i18next, zustand, vitest (node).

**Spec:** `docs/superpowers/specs/2026-06-15-agent-config-ui-redesign-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `src/components/ui/Switch.tsx` | Create | Reusable accessible toggle |
| `src/components/ui/Avatar.tsx` | Modify | Add `shape?: 'circle' \| 'square'` |
| `src/components/ui/Button.tsx` | Modify | Add `danger` variant |
| `src/lib/agentModelOptions.ts` (+ `.test.ts`) | Create | Group enabled providers' models for the picker |
| `src/lib/agentDraft.ts` (+ `.test.ts`) | Create | Build/validate the editor save payload |
| `src/i18n/zh-CN.ts`, `zh-TW.ts`, `en.ts` | Modify | New `settings.agents.*` keys |
| `src/components/account/AgentCard.tsx` | Create | `BuiltinCard` + `AgentCard` (toggle, kebab) |
| `src/components/account/DeleteAgentDialog.tsx` | Create | Delete confirmation dialog |
| `src/components/account/AgentEditor.tsx` | Create | Sectioned add/edit modal |
| `src/components/account/AgentManagement.tsx` | Rewrite | List orchestrator + empty state + add tile |

Verification gates used throughout: `yarn type-check` (tsc --noEmit) and `yarn test` (vitest, paid-free for these files).

---

### Task 1: `Switch` primitive

**Files:**
- Create: `src/components/ui/Switch.tsx`

- [ ] **Step 1: Implement the Switch**

```tsx
import { cn } from '@/lib/utils'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
  id?: string
  ariaLabel?: string
}

/** Controlled on/off toggle. Native <button role="switch"> → Space/Enter toggle for free. */
export function Switch({ checked, onCheckedChange, disabled, id, ariaLabel }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-border',
      )}
    >
      <span
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white transition-transform',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS (no errors).

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/Switch.tsx
git commit -m "feat(ui): add Switch toggle primitive"
```

---

### Task 2: `Avatar` square shape

**Files:**
- Modify: `src/components/ui/Avatar.tsx`

- [ ] **Step 1: Add the `shape` prop**

Replace the file body with (keeps the existing `initials()` helper and circle default):

```tsx
import { cn } from '@/lib/utils'

interface AvatarProps {
  name: string
  src?: string
  size?: number
  shape?: 'circle' | 'square'
  className?: string
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const chars = parts.length >= 2 ? parts[0][0] + parts[1][0] : name.slice(0, 2)
  return chars.toUpperCase()
}

export function Avatar({ name, src, size = 32, shape = 'circle', className }: AvatarProps) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center justify-center overflow-hidden bg-accent-subtle text-meta font-semibold text-accent-strong',
        shape === 'circle' ? 'rounded-full' : 'rounded-lg',
        className,
      )}
      style={{ width: size, height: size }}
    >
      {src ? (
        <img src={src} alt={name} className="h-full w-full object-cover" />
      ) : (
        initials(name)
      )}
    </span>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS. (Existing call sites omit `shape` → default `'circle'`, unchanged.)

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/Avatar.tsx
git commit -m "feat(ui): add square shape to Avatar"
```

---

### Task 3: `Button` danger variant

**Files:**
- Modify: `src/components/ui/Button.tsx:9-14`

- [ ] **Step 1: Add the `danger` variant**

In `buttonVariants` → `variants.variant`, add a `danger` entry after `outline`:

```tsx
      variant: {
        primary: 'bg-accent text-white hover:bg-accent-hover',
        secondary: 'bg-surface-muted text-ink hover:bg-border',
        ghost: 'text-ink-secondary hover:bg-accent-subtle hover:text-ink',
        outline: 'border border-border bg-surface text-ink hover:bg-surface-muted',
        danger: 'bg-danger text-white hover:bg-danger/90',
      },
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/Button.tsx
git commit -m "feat(ui): add danger Button variant"
```

---

### Task 4: `groupModelOptions` helper (TDD)

**Files:**
- Create: `src/lib/agentModelOptions.ts`
- Test: `src/lib/agentModelOptions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import type { CatalogProvider } from '@/ipc/catalog'
import { groupModelOptions } from './agentModelOptions'

const provider = (name: string, models: string[]): CatalogProvider =>
  ({ name, models: Object.fromEntries(models.map((m) => [m, { id: m, name: m }])) } as unknown as CatalogProvider)

const catalog = {
  anthropic: provider('Anthropic', ['claude-opus-4', 'claude-sonnet-4']),
  openai: provider('OpenAI', ['gpt-5']),
  empty: provider('Empty', []),
}

describe('groupModelOptions', () => {
  it('includes only enabled providers, grouped, keyed providerID/modelID', () => {
    const groups = groupModelOptions(catalog, { providers: { anthropic: { enabled: true } } })
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ providerID: 'anthropic', providerName: 'Anthropic' })
    expect(groups[0].models).toEqual([
      { key: 'anthropic/claude-opus-4', modelID: 'claude-opus-4' },
      { key: 'anthropic/claude-sonnet-4', modelID: 'claude-sonnet-4' },
    ])
  })

  it('drops disabled and model-less providers', () => {
    const groups = groupModelOptions(catalog, {
      providers: { anthropic: { enabled: true }, openai: { enabled: false }, empty: { enabled: true } },
    })
    expect(groups.map((g) => g.providerID)).toEqual(['anthropic'])
  })
})
```

- [ ] **Step 2: Run the test (fails — module missing)**

Run: `yarn test src/lib/agentModelOptions.test.ts`
Expected: FAIL — cannot resolve `./agentModelOptions`.

- [ ] **Step 3: Implement**

```ts
import type { CatalogProvider } from '@/ipc/catalog'

export interface ProviderEnablement {
  providers: Record<string, { enabled?: boolean } | undefined>
}

export interface AgentModelGroup {
  providerID: string
  providerName: string
  models: Array<{ key: string; modelID: string }>
}

/** Enabled providers' models, grouped for the agent editor's <optgroup> picker. */
export function groupModelOptions(
  catalog: Record<string, CatalogProvider>,
  config: ProviderEnablement,
): AgentModelGroup[] {
  return Object.entries(catalog)
    .filter(([id]) => config.providers[id]?.enabled)
    .map(([id, p]) => ({
      providerID: id,
      providerName: p.name,
      models: Object.keys(p.models ?? {}).map((m) => ({ key: `${id}/${m}`, modelID: m })),
    }))
    .filter((g) => g.models.length > 0)
}
```

- [ ] **Step 4: Run the test (passes)**

Run: `yarn test src/lib/agentModelOptions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentModelOptions.ts src/lib/agentModelOptions.test.ts
git commit -m "feat(agents): groupModelOptions helper for the model picker"
```

---

### Task 5: `buildAgentDraft` + `isAgentDraftValid` (TDD)

**Files:**
- Create: `src/lib/agentDraft.ts`
- Test: `src/lib/agentDraft.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { buildAgentDraft, isAgentDraftValid, type AgentForm } from './agentDraft'

const base: AgentForm = {
  name: 'Claude Code',
  command: 'claude',
  args: '--loop --json',
  transport: 'rich',
  acceptsModelConfig: false,
  boundModelKey: '',
  enabled: true,
}

describe('isAgentDraftValid', () => {
  it('requires name and command', () => {
    expect(isAgentDraftValid(base)).toBe(true)
    expect(isAgentDraftValid({ ...base, name: '  ' })).toBe(false)
    expect(isAgentDraftValid({ ...base, command: '' })).toBe(false)
  })
  it('requires a model when acceptsModelConfig is on', () => {
    expect(isAgentDraftValid({ ...base, acceptsModelConfig: true, boundModelKey: '' })).toBe(false)
    expect(isAgentDraftValid({ ...base, acceptsModelConfig: true, boundModelKey: 'anthropic/claude-opus-4' })).toBe(true)
  })
})

describe('buildAgentDraft', () => {
  it('trims fields and whitespace-splits args', () => {
    const d = buildAgentDraft({ ...base, name: '  X ', command: '  bin ', args: '  --a   --b ' })
    expect(d).toMatchObject({ name: 'X', kind: 'custom', command: 'bin', args: ['--a', '--b'], enabled: true })
  })
  it('empty args → []', () => {
    expect(buildAgentDraft({ ...base, args: '   ' }).args).toEqual([])
  })
  it('omits boundModel when acceptsModelConfig is off, even if a key is set', () => {
    expect(buildAgentDraft({ ...base, acceptsModelConfig: false, boundModelKey: 'anthropic/x' }).boundModel).toBeUndefined()
  })
  it('splits boundModel on the FIRST slash (modelID may contain slashes)', () => {
    const d = buildAgentDraft({ ...base, acceptsModelConfig: true, boundModelKey: 'openrouter/meta/llama-3' })
    expect(d.boundModel).toEqual({ providerID: 'openrouter', modelID: 'meta/llama-3' })
  })
})
```

- [ ] **Step 2: Run the test (fails — module missing)**

Run: `yarn test src/lib/agentDraft.test.ts`
Expected: FAIL — cannot resolve `./agentDraft`.

- [ ] **Step 3: Implement**

```ts
import type { AgentConfig } from '@hip/protocol'

export interface AgentForm {
  name: string
  command: string
  args: string
  transport: AgentConfig['transport']
  acceptsModelConfig: boolean
  boundModelKey: string
  enabled: boolean
}

export function isAgentDraftValid(form: AgentForm): boolean {
  return (
    form.name.trim() !== '' &&
    form.command.trim() !== '' &&
    (!form.acceptsModelConfig || form.boundModelKey !== '')
  )
}

export function buildAgentDraft(form: AgentForm): Omit<AgentConfig, 'id'> {
  const useModel = form.acceptsModelConfig && form.boundModelKey !== ''
  const slash = form.boundModelKey.indexOf('/')
  return {
    name: form.name.trim(),
    kind: 'custom',
    command: form.command.trim(),
    args: form.args.trim() ? form.args.trim().split(/\s+/) : [],
    transport: form.transport,
    acceptsModelConfig: form.acceptsModelConfig,
    boundModel: useModel
      ? { providerID: form.boundModelKey.slice(0, slash), modelID: form.boundModelKey.slice(slash + 1) }
      : undefined,
    enabled: form.enabled,
  }
}
```

- [ ] **Step 4: Run the test (passes)**

Run: `yarn test src/lib/agentDraft.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentDraft.ts src/lib/agentDraft.test.ts
git commit -m "feat(agents): buildAgentDraft/isAgentDraftValid form helpers"
```

---

### Task 6: i18n keys

**Files:**
- Modify: `src/i18n/zh-CN.ts`, `src/i18n/zh-TW.ts`, `src/i18n/en.ts`

Add the following keys **inside the existing `settings.agents` object** in each locale (keep all existing keys). Existing `name`, `command`, `args`, `transportThin`, `transportRich`, `acceptsModel`, `edit`, `delete`, `cancel`, `save`, `error`, `editTitle`, `addCustom`, `add`, `empty`, `builtinName`, `builtinDesc`, `title`, `intro` are reused as-is.

- [ ] **Step 1: zh-CN** — add to `settings.agents`:

```ts
      builtin: '内置',
      emptyHint: '接入 Claude Code、Codex 等命令行智能体',
      transportThinDesc: '纯文本流，兼容任何 CLI',
      transportRichDesc: 'JSON 事件流，显示思考过程',
      acceptsModelDesc: '把所选模型与 API 密钥传给该智能体',
      enableThis: '启用此智能体',
      sectionCommand: '启动命令',
      sectionTransport: '协议',
      sectionModel: '模型',
      menuMore: '更多操作',
      deleteConfirmTitle: '删除智能体“{{name}}”？',
      deleteConfirmBody: '此操作无法撤销。',
```

- [ ] **Step 2: zh-TW** — add to `settings.agents`:

```ts
      builtin: '內建',
      emptyHint: '接入 Claude Code、Codex 等命令列智能體',
      transportThinDesc: '純文字流，相容任何 CLI',
      transportRichDesc: 'JSON 事件流，顯示思考過程',
      acceptsModelDesc: '把所選模型與 API 金鑰傳給該智能體',
      enableThis: '啟用此智能體',
      sectionCommand: '啟動命令',
      sectionTransport: '協議',
      sectionModel: '模型',
      menuMore: '更多操作',
      deleteConfirmTitle: '刪除智能體「{{name}}」？',
      deleteConfirmBody: '此操作無法復原。',
```

- [ ] **Step 3: en** — add to `settings.agents`:

```ts
      builtin: 'Built-in',
      emptyHint: 'Connect CLI agents like Claude Code or Codex',
      transportThinDesc: 'Plain-text stream, works with any CLI',
      transportRichDesc: 'JSON event stream, shows reasoning',
      acceptsModelDesc: 'Push the selected model and API key to this agent',
      enableThis: 'Enable this agent',
      sectionCommand: 'Launch command',
      sectionTransport: 'Protocol',
      sectionModel: 'Model',
      menuMore: 'More actions',
      deleteConfirmTitle: 'Delete agent “{{name}}”?',
      deleteConfirmBody: 'This action cannot be undone.',
```

- [ ] **Step 4: Type-check** (catches any locale-shape mismatch against `i18next.d.ts`)

Run: `yarn type-check`
Expected: PASS. (All three locales got the same keys → shapes stay equal.)

- [ ] **Step 5: Commit**

```bash
git add src/i18n/zh-CN.ts src/i18n/zh-TW.ts src/i18n/en.ts
git commit -m "i18n(agents): keys for redesigned agent management UI"
```

---

### Task 7: `AgentCard.tsx` — built-in + external cards

**Files:**
- Create: `src/components/account/AgentCard.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useTranslation } from 'react-i18next'
import { Bot, Lock, Cpu, Terminal, Pencil, Trash2, MoreVertical } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { Avatar } from '@/components/ui/Avatar'
import { Badge } from '@/components/ui/Badge'
import { Switch } from '@/components/ui/Switch'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu'

/** Pinned, non-editable built-in agent. */
export function BuiltinCard() {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3.5 rounded-lg border border-border bg-surface-subtle px-4 py-3.5">
      <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-accent text-white">
        <Bot size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-body font-medium text-ink">{t('settings.agents.builtinName')}</span>
          <Badge className="bg-accent-subtle text-accent-strong">{t('settings.agents.builtin')}</Badge>
        </div>
        <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.agents.builtinDesc')}</div>
      </div>
      <Lock size={15} className="shrink-0 text-ink-tertiary" />
    </div>
  )
}

export function AgentCard({
  agent,
  onToggle,
  onEdit,
  onDelete,
}: {
  agent: AgentConfig
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation()
  const cmdline = [agent.command, ...agent.args].join(' ')
  return (
    <div className="flex items-center gap-3.5 rounded-lg border border-border bg-surface px-4 py-3.5">
      <Avatar name={agent.name} shape="square" size={38} className={cn(!agent.enabled && 'opacity-60')} />
      <div className={cn('min-w-0 flex-1', !agent.enabled && 'opacity-60')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-medium text-ink">{agent.name}</span>
          <Badge className={agent.transport === 'rich' ? 'bg-accent-subtle text-accent-strong' : undefined}>
            {t(agent.transport === 'rich' ? 'settings.agents.transportRich' : 'settings.agents.transportThin')}
          </Badge>
          {agent.boundModel && (
            <Badge>
              <Cpu size={11} />
              {agent.boundModel.modelID}
            </Badge>
          )}
        </div>
        <div className="mt-1 flex items-center gap-1 truncate font-mono text-caption text-ink-tertiary">
          <Terminal size={12} className="shrink-0 text-ink-tertiary/70" />
          <span className="truncate">{cmdline}</span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <Switch checked={agent.enabled} onCheckedChange={onToggle} ariaLabel={t('settings.agents.enableThis')} />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary transition-colors hover:bg-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
              aria-label={t('settings.agents.menuMore')}
            >
              <MoreVertical size={16} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={onEdit}>
              <Pencil size={14} /> {t('settings.agents.edit')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-danger focus:bg-danger/10" onSelect={onDelete}>
              <Trash2 size={14} /> {t('settings.agents.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS. (Will be wired into `AgentManagement` in Task 10; unused-import errors are not raised for this file since both exports are used externally — if your tsconfig flags unused locals here, it won't, because nothing is locally unused.)

- [ ] **Step 3: Commit**

```bash
git add src/components/account/AgentCard.tsx
git commit -m "feat(agents): AgentCard + BuiltinCard with toggle and kebab menu"
```

---

### Task 8: `DeleteAgentDialog.tsx`

**Files:**
- Create: `src/components/account/DeleteAgentDialog.tsx`

- [ ] **Step 1: Implement**

```tsx
import { useTranslation } from 'react-i18next'
import type { AgentConfig } from '@hip/protocol'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

export function DeleteAgentDialog({
  agent,
  onConfirm,
  onCancel,
}: {
  agent: AgentConfig
  onConfirm: () => void
  onCancel: () => void
}) {
  const { t } = useTranslation()
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
      title={t('settings.agents.deleteConfirmTitle', { name: agent.name })}
      className="max-w-sm"
    >
      <div className="p-5">
        <p className="text-body text-ink-secondary">{t('settings.agents.deleteConfirmBody')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t('settings.agents.cancel')}
          </Button>
          <Button variant="danger" size="sm" onClick={onConfirm}>
            {t('settings.agents.delete')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/account/DeleteAgentDialog.tsx
git commit -m "feat(agents): delete confirmation dialog"
```

---

### Task 9: `AgentEditor.tsx` — sectioned modal

**Files:**
- Create: `src/components/account/AgentEditor.tsx`

Note: `Modal` already renders the header (title + close X) and, when non-resizable, clamps to `max-w-lg` with a scrolling body — so this component supplies only the form sections + footer and relies on the Modal `title`.

- [ ] **Step 1: Implement**

```tsx
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { useProvidersStore } from '@/store/providersStore'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Switch } from '@/components/ui/Switch'
import { cn } from '@/lib/utils'
import { groupModelOptions } from '@/lib/agentModelOptions'
import { buildAgentDraft, isAgentDraftValid, type AgentForm } from '@/lib/agentDraft'

const inputCls =
  'h-9 w-full rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

export function AgentEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: AgentConfig | null
  onSave: (draft: Omit<AgentConfig, 'id'>) => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { config, catalog } = useProvidersStore()
  const [form, setForm] = useState<AgentForm>({
    name: initial?.name ?? '',
    command: initial?.command ?? '',
    args: (initial?.args ?? []).join(' '),
    transport: initial?.transport ?? 'thin',
    acceptsModelConfig: initial?.acceptsModelConfig ?? false,
    boundModelKey: initial?.boundModel
      ? `${initial.boundModel.providerID}/${initial.boundModel.modelID}`
      : '',
    enabled: initial?.enabled ?? true,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const groups = groupModelOptions(catalog, config)
  const patch = (p: Partial<AgentForm>) => setForm((f) => ({ ...f, ...p }))

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await onSave(buildAgentDraft(form))
    } catch {
      setError(t('settings.agents.error'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
      title={initial ? t('settings.agents.editTitle') : t('settings.agents.addCustom')}
    >
      <div className="flex flex-col">
        <div className="space-y-5 p-5">
          <Field label={t('settings.agents.name')}>
            <input className={inputCls} value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="My Agent" />
          </Field>

          <Section label={t('settings.agents.sectionCommand')}>
            <Field label={t('settings.agents.command')}>
              <input
                className={cn(inputCls, 'font-mono')}
                value={form.command}
                onChange={(e) => patch({ command: e.target.value })}
                placeholder="/usr/local/bin/my-agent"
              />
            </Field>
            <Field label={t('settings.agents.args')}>
              <input
                className={cn(inputCls, 'font-mono')}
                value={form.args}
                onChange={(e) => patch({ args: e.target.value })}
                placeholder="--loop --json"
              />
            </Field>
          </Section>

          <Section label={t('settings.agents.sectionTransport')}>
            <div role="radiogroup" aria-label={t('settings.agents.sectionTransport')} className="flex gap-2">
              <TransportCard
                selected={form.transport === 'thin'}
                title={t('settings.agents.transportThin')}
                desc={t('settings.agents.transportThinDesc')}
                onClick={() => patch({ transport: 'thin' })}
              />
              <TransportCard
                selected={form.transport === 'rich'}
                title={t('settings.agents.transportRich')}
                desc={t('settings.agents.transportRichDesc')}
                onClick={() => patch({ transport: 'rich' })}
              />
            </div>
          </Section>

          <Section label={t('settings.agents.sectionModel')}>
            <div className="flex items-start gap-3 rounded-lg border border-border px-3 py-2.5">
              <div className="flex-1">
                <div className="text-body text-ink">{t('settings.agents.acceptsModel')}</div>
                <div className="mt-0.5 text-caption text-ink-tertiary">{t('settings.agents.acceptsModelDesc')}</div>
              </div>
              <Switch
                checked={form.acceptsModelConfig}
                onCheckedChange={(v) => patch({ acceptsModelConfig: v, boundModelKey: v ? form.boundModelKey : '' })}
                ariaLabel={t('settings.agents.acceptsModel')}
              />
            </div>
            {form.acceptsModelConfig && (
              <select
                className={cn(inputCls, 'mt-2')}
                value={form.boundModelKey}
                onChange={(e) => patch({ boundModelKey: e.target.value })}
              >
                <option value="">—</option>
                {groups.map((g) => (
                  <optgroup key={g.providerID} label={g.providerName}>
                    {g.models.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.modelID}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            )}
          </Section>

          {error && <div className="text-meta text-danger">{error}</div>}
        </div>

        <div className="flex items-center gap-2 border-t border-border bg-surface-subtle px-5 py-3">
          <div className="flex flex-1 items-center gap-2">
            <Switch
              checked={form.enabled}
              onCheckedChange={(v) => patch({ enabled: v })}
              ariaLabel={t('settings.agents.enableThis')}
            />
            <span className="text-body text-ink-secondary">{t('settings.agents.enableThis')}</span>
          </div>
          <Button variant="outline" size="sm" onClick={onCancel}>
            {t('settings.agents.cancel')}
          </Button>
          <Button variant="primary" size="sm" disabled={busy || !isAgentDraftValid(form)} onClick={() => void submit()}>
            {t('settings.agents.save')}
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

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-caption font-medium uppercase tracking-wide text-ink-tertiary">{label}</div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function TransportCard({
  selected,
  title,
  desc,
  onClick,
}: {
  selected: boolean
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      className={cn(
        'flex-1 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        selected ? 'border-accent bg-accent-subtle' : 'border-border hover:bg-surface-muted',
      )}
    >
      <div className="flex items-center justify-between">
        <span className={cn('text-body font-medium', selected ? 'text-accent-strong' : 'text-ink')}>{title}</span>
        <span
          className={cn(
            'flex h-4 w-4 items-center justify-center rounded-full border',
            selected ? 'border-accent bg-accent text-white' : 'border-border',
          )}
        >
          {selected && <Check size={11} />}
        </span>
      </div>
      <div className={cn('mt-1 text-caption', selected ? 'text-accent-strong/80' : 'text-ink-tertiary')}>{desc}</div>
    </button>
  )
}
```

- [ ] **Step 2: Type-check**

Run: `yarn type-check`
Expected: PASS. (If `useProvidersStore`'s `config` type is not structurally assignable to `ProviderEnablement`, widen `groupModelOptions`'s `config` param or cast at the call site — but the structural `{ providers: Record<string, { enabled?: boolean }> }` shape should accept it.)

- [ ] **Step 3: Commit**

```bash
git add src/components/account/AgentEditor.tsx
git commit -m "feat(agents): sectioned AgentEditor modal (radio cards, toggles, grouped model picker)"
```

---

### Task 10: Rewrite `AgentManagement.tsx` orchestrator

**Files:**
- Modify (full rewrite): `src/components/account/AgentManagement.tsx`

- [ ] **Step 1: Replace the whole file**

```tsx
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Bot, Plus } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import { useAgentsStore } from '@/store/agentsStore'
import { BuiltinCard, AgentCard } from './AgentCard'
import { AgentEditor } from './AgentEditor'
import { DeleteAgentDialog } from './DeleteAgentDialog'

type Editing = { mode: 'add' } | { mode: 'edit'; agent: AgentConfig } | null

export function AgentManagement() {
  const { t } = useTranslation()
  const { agents, loaded, load, addAgent, updateAgent, removeAgent } = useAgentsStore()
  const [editing, setEditing] = useState<Editing>(null)
  const [deleting, setDeleting] = useState<AgentConfig | null>(null)

  useEffect(() => {
    if (!loaded) void load()
  }, [loaded, load])

  return (
    <div className="p-6">
      <h2 className="text-title font-semibold text-ink">{t('settings.agents.title')}</h2>
      <p className="mt-1 text-body text-ink-secondary">{t('settings.agents.intro')}</p>

      <div className="mt-5 space-y-2">
        <BuiltinCard />

        {agents.map((a) => (
          <AgentCard
            key={a.id}
            agent={a}
            onToggle={(enabled) => void updateAgent(a.id, { enabled })}
            onEdit={() => setEditing({ mode: 'edit', agent: a })}
            onDelete={() => setDeleting(a)}
          />
        ))}

        {agents.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 rounded-lg border border-dashed border-border py-8 text-center">
            <Bot size={22} className="text-ink-tertiary" />
            <div className="text-body text-ink-secondary">{t('settings.agents.empty')}</div>
            <div className="text-meta text-ink-tertiary">{t('settings.agents.emptyHint')}</div>
          </div>
        )}

        <button
          onClick={() => setEditing({ mode: 'add' })}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-3 text-body font-medium text-accent-strong transition-colors hover:bg-accent-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
        >
          <Plus size={15} /> {t('settings.agents.add')}
        </button>
      </div>

      {editing && (
        <AgentEditor
          initial={editing.mode === 'edit' ? editing.agent : null}
          onCancel={() => setEditing(null)}
          onSave={async (draft) => {
            if (editing.mode === 'edit') await updateAgent(editing.agent.id, draft)
            else await addAgent(draft)
            setEditing(null)
          }}
        />
      )}

      {deleting && (
        <DeleteAgentDialog
          agent={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            void removeAgent(deleting.id)
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: Type-check + full test run**

Run: `yarn type-check && yarn test`
Expected: type-check PASS; vitest PASS (existing suites + the two new helper suites). Paid-free.

- [ ] **Step 3: Commit**

```bash
git add src/components/account/AgentManagement.tsx
git commit -m "feat(agents): redesigned agent management list (cards, empty state, add tile, delete dialog)"
```

---

### Task 11: Verification & GUI acceptance

**Files:** none (verification only)

- [ ] **Step 1: Full gates green**

Run: `yarn type-check && yarn test`
Expected: both PASS, paid-free. (If a real-LLM suite runs, follow the project's auth-aside trap to stay paid-free — but these changes touch no sidecar code.)

- [ ] **Step 2: Manual GUI acceptance** (`yarn tauri dev`; browser preview of the React tree is also acceptable for the visual pass)

Walk this checklist in 智能体管理:
  - Built-in `hip` card: tinted bg, robot tile, `内置` badge, lock icon; no toggle/kebab.
  - External card: square avatar initials, name, transport badge (丰富 accented / 精简 neutral), model chip only when bound, quiet mono command subline truncates.
  - Inline toggle flips enabled and persists (reopen settings → state kept); disabled card dims, toggle/kebab stay usable.
  - Kebab → 编辑 opens the editor with values prefilled; 删除 opens the confirm dialog.
  - Delete dialog: 取消 closes without deleting; 删除 removes the agent.
  - Editor: section labels render; transport radio cards select exclusively; model toggle reveals a provider-grouped picker and hides+clears it when off; 启用 toggle in footer; 保存 disabled until name+command (and a model when push is on) are set; save persists.
  - Empty state: with no external agents, the centered empty card + hint + dashed add tile show.

- [ ] **Step 3: Final commit (if any GUI fixes were needed)**

```bash
git add -A
git commit -m "fix(agents): GUI acceptance polish"
```

---

## Self-review notes

- **Spec coverage:** cards/avatar/badges/command-subline/toggle/kebab (Tasks 7, 10) ✓; editor sections/radio-cards/toggles/grouped-picker (Tasks 5, 4, 9) ✓; delete dialog (Task 8) ✓; Switch primitive (Task 1) ✓; Avatar square (Task 2) ✓; Button danger (Task 3) ✓; i18n all locales (Task 6) ✓; empty state + add tile (Task 10) ✓; testing approach matches repo (Tasks 4–5 logic, Task 11 GUI) ✓.
- **Type consistency:** `AgentForm` shape is defined once (Task 5) and consumed in Task 9; `groupModelOptions` return (`{providerID, providerName, models:[{key, modelID}]}`) matches the `<optgroup>` usage in Task 9; `Switch` `ariaLabel`/`onCheckedChange` props match all call sites; `Button variant="danger"` (Task 3) matches the delete dialog (Task 8).
- **Deviation from mockup:** the shared `Modal` owns the header (title + close), so the editor drops the in-header avatar shown in the mockup and uses the Modal title. Footer sits at the end of the scrollable body (acceptable for this short form).
