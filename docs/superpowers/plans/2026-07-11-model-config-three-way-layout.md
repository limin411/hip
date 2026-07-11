# Model Config Three-Way Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split Settings → Model Configuration into three page tabs (base / embedding / rerank) with full provider management on each tab, remove the mixed role-models block, and keep memory extract as a pool picker on the Memory page only.

**Architecture:** Keep a single settings nav item `model`. `ModelConfig` hosts a `SegmentedControl` for `base | embedding | rerank`. All three tabs reuse the existing ProviderList + ProviderDetail workspace against the **shared** providers registry and keys; only the “active selection” write path differs (`activeModel` vs `memory.embeddingModel` vs `memory.rerankModel`). Memory extract stays on `MemoryConfig` (already present) as a chat-model dropdown from `groupModelOptions`; remove the duplicate extract UI from ModelConfig. No storage path migration.

**Tech Stack:** React 18, TypeScript, Zustand (`providersStore`), i18next, Vitest + Testing Library, existing `SegmentedControl`, `@hip/protocol` `MemoryFileConfig` / `MemoryModelRef`.

**Spec:** `docs/superpowers/specs/2026-07-11-model-config-three-way-layout-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `src/components/account/ModelConfig.tsx` | Tab state, hero per tab, memory load/save for embed/rerank, shared list+detail wiring; **delete** `role-models-section` |
| `src/components/account/CurrentModelHero.tsx` | Purpose-aware empty/filled copy (`base` / `embedding` / `rerank`) |
| `src/components/account/ProviderDetail.tsx` | Parameterize “Set as current” labels; optional clear / recommend actions for role tabs |
| `src/components/account/MemoryConfig.tsx` | Already has extract picker — **only** update hybrid-needs-embedding copy if needed; no new extract UI |
| `src/i18n/en.ts`, `zh-CN.ts`, `zh-TW.ts` | Tabs, hero, set-as labels, hybrid pointer text; retire unused `roleModels.*` keys or leave unused until cleanup |
| `src/components/account/ModelConfig.test.tsx` | **Create** — tab switch, no role-models section, set embedding/rerank |
| `src/components/account/CurrentModelHero.test.tsx` | **Create** — purpose empty states |
| `src/i18n/translation-keys.test.ts` | Must stay green if it asserts key parity |

**Out of scope files:** sidecar, protocol storage shapes, `providersStore` schema (no new fields).

---

### Task 1: i18n keys for tabs and purpose-specific copy

**Files:**
- Modify: `src/i18n/en.ts` (`settings.modelConfig`)
- Modify: `src/i18n/zh-CN.ts`
- Modify: `src/i18n/zh-TW.ts`
- Modify: `src/i18n/en.ts` / `zh-CN.ts` / `zh-TW.ts` — `settings.memory.hybridSearchNeedsEmbedding`

- [ ] **Step 1: Add English keys** under `settings.modelConfig` (keep existing keys; extend):

```ts
// Inside settings.modelConfig in en.ts — add:
intro: 'Configure providers and pick models by purpose: chat, embedding, or rerank.',
tabs: {
  base: 'Base models',
  embedding: 'Embedding',
  rerank: 'Rerank',
  ariaLabel: 'Model purpose',
},
purpose: {
  base: {
    currentModel: 'Current chat model',
    noModel: 'No chat model selected',
    noModelHint: 'Pick a provider below and set a current chat model',
    setCurrent: 'Set as current',
    current: 'Current',
  },
  embedding: {
    currentModel: 'Current embedding model',
    noModel: 'No embedding model',
    noModelHint: 'Required for hybrid search. Pick a provider and set an embedding model.',
    setCurrent: 'Set as embedding',
    current: 'Embedding',
    clear: 'Clear embedding',
    privacyNote:
      'Embeddings send memory text to the chosen provider API. Hybrid search stays off until you enable it under Memory.',
  },
  rerank: {
    currentModel: 'Current rerank model',
    noModel: 'No rerank model (optional)',
    noModelHint: 'Leave unset to skip rerank. Pick a provider to configure a dedicated rerank endpoint.',
    setCurrent: 'Set as rerank',
    current: 'Rerank',
    clear: 'Clear rerank',
    privacyNote:
      'Rerank may send query and memory snippets to the chosen provider API when hybrid search is enabled.',
  },
},
// Keep roleModels.useRecommended + recommendEmbeddingUnavailable for the recommend button;
// or move under purpose.embedding:
useRecommended: 'Use recommended',
recommendEmbeddingUnavailable:
  'Recommended embedding is only available when the active chat provider is OpenAI-compatible. Pick a model manually, or switch the active provider.',
```

Update `settings.memory.hybridSearchNeedsEmbedding` in **en**:

```ts
hybridSearchNeedsEmbedding: 'Set an embedding model under Models → Embedding first.',
```

- [ ] **Step 2: Mirror in zh-CN and zh-TW**

zh-CN examples:

```ts
intro: '按用途配置提供商与模型：对话基础模型、嵌入、重排。',
tabs: { base: '基础模型', embedding: '嵌入', rerank: '重排', ariaLabel: '模型用途' },
// purpose.* 中文对齐 design spec 用语
hybridSearchNeedsEmbedding: '请先在「模型 → 嵌入」中配置嵌入模型。',
```

zh-TW: 基礎模型 / 嵌入 / 重排；混合檢索提示改為「模型 → 嵌入」。

- [ ] **Step 3: Run translation key parity test**

```bash
yarn vitest run src/i18n/translation-keys.test.ts
```

Expected: PASS (all three locales share the same key tree for new keys).

- [ ] **Step 4: Commit**

```bash
git add src/i18n/en.ts src/i18n/zh-CN.ts src/i18n/zh-TW.ts
git commit -m "i18n: model config purpose tabs and hybrid embed pointer"
```

---

### Task 2: Purpose-aware `CurrentModelHero`

**Files:**
- Modify: `src/components/account/CurrentModelHero.tsx`
- Create: `src/components/account/CurrentModelHero.test.tsx`

- [ ] **Step 1: Write failing tests**

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { CurrentModelHero } from './CurrentModelHero'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

afterEach(() => cleanup())

describe('CurrentModelHero', () => {
  it('uses base empty-state keys by default', () => {
    const { getByText } = render(
      <CurrentModelHero providerName={null} modelID={null} model={undefined} keyConfigured={false} purpose="base" />,
    )
    expect(getByText('settings.modelConfig.purpose.base.noModel')).toBeInTheDocument()
    expect(getByText('settings.modelConfig.purpose.base.noModelHint')).toBeInTheDocument()
  })

  it('uses embedding empty-state keys', () => {
    const { getByText } = render(
      <CurrentModelHero
        providerName={null}
        modelID={null}
        model={undefined}
        keyConfigured={false}
        purpose="embedding"
      />,
    )
    expect(getByText('settings.modelConfig.purpose.embedding.noModel')).toBeInTheDocument()
  })

  it('shows purpose currentModel label when filled', () => {
    const { getByText } = render(
      <CurrentModelHero
        providerName="OpenAI"
        modelID="text-embedding-3-small"
        model={undefined}
        keyConfigured={true}
        purpose="embedding"
      />,
    )
    expect(getByText(/settings.modelConfig.purpose.embedding.currentModel/)).toBeInTheDocument()
    expect(getByText('text-embedding-3-small')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
yarn vitest run src/components/account/CurrentModelHero.test.tsx
```

Expected: FAIL (`purpose` prop not accepted / old keys).

- [ ] **Step 3: Implement minimal hero API**

```tsx
export type ModelPurpose = 'base' | 'embedding' | 'rerank'

export function CurrentModelHero({
  providerName,
  modelID,
  model,
  keyConfigured,
  onLocate,
  purpose = 'base',
}: {
  providerName: string | null
  modelID: string | null
  model: CatalogModel | undefined
  keyConfigured: boolean
  onLocate?: () => void
  purpose?: ModelPurpose
}) {
  const { t } = useTranslation()
  const p = `settings.modelConfig.purpose.${purpose}` as const

  if (!modelID || !providerName) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface-subtle px-4 py-3.5">
        <div className="text-body text-ink-secondary">{t(`${p}.noModel`)}</div>
        <div className="mt-0.5 text-meta text-ink-tertiary">{t(`${p}.noModelHint`)}</div>
      </div>
    )
  }
  // ... existing layout, but replace:
  // {providerName} · {t(`${p}.currentModel`)}
  // keep ready / keyMissing / badges as today
}
```

Keep capability badges only useful for base; for embedding/rerank showing contextK/caps is fine if present, otherwise omit empty row (existing logic already guards).

- [ ] **Step 4: Run tests — expect PASS**

```bash
yarn vitest run src/components/account/CurrentModelHero.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/account/CurrentModelHero.tsx src/components/account/CurrentModelHero.test.tsx
git commit -m "feat(ui): purpose-aware current model hero"
```

---

### Task 3: Parameterize `ProviderDetail` set-current labels + optional clear

**Files:**
- Modify: `src/components/account/ProviderDetail.tsx`
- Create or extend test if none exists: prefer a focused unit test on ModelRow labels via ProviderDetail render

`ProviderDetail` currently hardcodes:

```tsx
{isCurrent ? t('settings.modelConfig.current') : t('settings.modelConfig.setCurrent')}
```

- [ ] **Step 1: Extend props**

```tsx
export function ProviderDetail({
  // ...existing
  isActive,
  onSetCurrent,
  setCurrentLabel,
  currentLabel,
  // optional footer actions for role tabs
  roleActions,
}: {
  // ...existing
  setCurrentLabel?: string
  currentLabel?: string
  roleActions?: React.ReactNode
}) {
  // pass labels into ModelRow
}
```

Inside `ModelRow`:

```tsx
<span className="shrink-0 text-caption text-accent-strong">
  {isCurrent
    ? (currentLabel ?? t('settings.modelConfig.current'))
    : (setCurrentLabel ?? t('settings.modelConfig.setCurrent'))}
</span>
```

Render `roleActions` above or below the models list when provided (e.g. Clear + Recommend buttons from parent).

- [ ] **Step 2: Smoke-test by typecheck**

```bash
yarn tsc --noEmit 2>&1 | head -40
```

Expected: no new errors in ProviderDetail (or full pass).

- [ ] **Step 3: Commit**

```bash
git add src/components/account/ProviderDetail.tsx
git commit -m "feat(ui): parameterize provider detail set-current labels"
```

---

### Task 4: Restructure `ModelConfig` with SegmentedControl (remove role-models)

**Files:**
- Modify: `src/components/account/ModelConfig.tsx`
- Create: `src/components/account/ModelConfig.test.tsx`

**Important:** `MemoryConfig` already contains `memory-extract-model`. Do **not** re-add extract to ModelConfig. Delete the entire `role-models-section` block (extract + embedding + rerank selects).

- [ ] **Step 1: Write failing tests** (mock stores + sessionService)

```tsx
// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { ModelConfig } from './ModelConfig'

const setMemoryConfig = vi.fn(async (partial: Record<string, unknown>) => ({
  version: 1,
  useMemories: false,
  generateMemories: false,
  defaultScope: 'project',
  idleMinutes: 15,
  maxCoreSummaryChars: 1500,
  maxPrefetchChars: 2500,
  exportMarkdownMirror: true,
  maxUnusedDays: 90,
  hybridSearchEnabled: false,
  ...partial,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), message: vi.fn() } }))

vi.mock('@/domain', () => ({
  sessionService: {
    getMemoryConfig: vi.fn(async () => ({
      version: 1,
      useMemories: false,
      generateMemories: false,
      defaultScope: 'project',
      idleMinutes: 15,
      maxCoreSummaryChars: 1500,
      maxPrefetchChars: 2500,
      exportMarkdownMirror: true,
      maxUnusedDays: 90,
      hybridSearchEnabled: false,
    })),
    setMemoryConfig,
  },
}))

vi.mock('@/store/providersStore', () => ({
  useProvidersStore: () => ({
    catalog: {
      openai: {
        id: 'openai',
        name: 'OpenAI',
        env: ['OPENAI_API_KEY'],
        models: {
          'gpt-4o': { id: 'gpt-4o', name: 'gpt-4o' },
          'text-embedding-3-small': { id: 'text-embedding-3-small', name: 'text-embedding-3-small' },
        },
        api: 'https://api.openai.com/v1',
      },
    },
    config: {
      providers: { openai: { enabled: true, baseURL: 'https://api.openai.com/v1' } },
      activeModel: { providerID: 'openai', modelID: 'gpt-4o' },
    },
    keyConfigured: { openai: true },
    loaded: true,
    load: vi.fn(),
    saveKey: vi.fn(),
    clearKey: vi.fn(),
    setBaseURL: vi.fn(),
    setEnabled: vi.fn(),
    setActiveModel: vi.fn(),
  }),
}))

afterEach(() => {
  cleanup()
  setMemoryConfig.mockClear()
})

describe('ModelConfig layout', () => {
  it('renders purpose tabs and does not render role-models section', async () => {
    render(<ModelConfig />)
    expect(screen.getByTestId('model-purpose-tabs')).toBeInTheDocument()
    expect(screen.queryByTestId('role-models-section')).not.toBeInTheDocument()
    expect(screen.queryByTestId('role-extract-model')).not.toBeInTheDocument()
  })

  it('switches to embedding tab', async () => {
    render(<ModelConfig />)
    fireEvent.click(screen.getByRole('tab', { name: 'settings.modelConfig.tabs.embedding' }))
    await waitFor(() => {
      expect(screen.getByTestId('model-purpose-embedding')).toBeInTheDocument()
    })
  })
})
```

- [ ] **Step 2: Run — expect FAIL** (no tabs yet)

```bash
yarn vitest run src/components/account/ModelConfig.test.tsx
```

- [ ] **Step 3: Implement ModelConfig structure**

Core sketch (keep existing store/memory helpers; restructure JSX):

```tsx
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import type { ModelPurpose } from './CurrentModelHero'

type Purpose = ModelPurpose // 'base' | 'embedding' | 'rerank'

export function ModelConfig() {
  // ... existing store hooks
  const [purpose, setPurpose] = useState<Purpose>('base')
  // selected provider state can stay single shared selection across tabs (OK)
  // memoryCfg for embedding/rerank hero + writes

  const am = config.activeModel
  const emb = memoryCfg?.embeddingModel
  const rr = memoryCfg?.rerankModel

  const hero =
    purpose === 'base'
      ? {
          providerName: am ? catalog[am.providerID]?.name ?? am.providerID : null,
          modelID: am?.modelID ?? null,
          model: am ? catalog[am.providerID]?.models[am.modelID] : undefined,
          keyConfigured: am ? !!keyConfigured[am.providerID] : false,
          locateId: am?.providerID,
        }
      : purpose === 'embedding'
        ? {
            providerName: emb ? catalog[emb.providerID]?.name ?? emb.providerID : null,
            modelID: emb?.modelID ?? null,
            model: emb ? catalog[emb.providerID]?.models[emb.modelID] : undefined,
            keyConfigured: emb ? !!keyConfigured[emb.providerID] : false,
            locateId: emb?.providerID,
          }
        : {
            providerName: rr ? catalog[rr.providerID]?.name ?? rr.providerID : null,
            modelID: rr?.modelID ?? null,
            model: rr ? catalog[rr.providerID]?.models[rr.modelID] : undefined,
            keyConfigured: rr ? !!keyConfigured[rr.providerID] : false,
            locateId: rr?.providerID,
          }

  const onSetCurrent = async (modelID: string) => {
    if (!activeId) return
    if (purpose === 'base') {
      await setActiveModel(activeId, modelID)
      return
    }
    const baseURL = resolveBaseURL(activeId, catalog, config)
    const ref = { providerID: activeId, modelID, ...(baseURL ? { baseURL } : {}) }
    if (purpose === 'embedding') await applyMemory({ embeddingModel: ref })
    else await applyMemory({ rerankModel: ref })
  }

  const isActive = (modelID: string) => {
    if (purpose === 'base') return am?.providerID === activeId && am?.modelID === modelID
    if (purpose === 'embedding') return emb?.providerID === activeId && emb?.modelID === modelID
    return rr?.providerID === activeId && rr?.modelID === modelID
  }

  // DELETE entire role-models-section JSX and extract-related select handlers
  // Keep onRecommendEmbedding for embedding roleActions

  return (
    <div className="flex h-full flex-col p-6">
      <h2>...</h2>
      <p>...intro...</p>

      <div className="mt-4">
        <SegmentedControl
          data-testid="model-purpose-tabs"
          aria-label={t('settings.modelConfig.tabs.ariaLabel')}
          size="md"
          value={purpose}
          onChange={setPurpose}
          options={[
            { value: 'base', label: t('settings.modelConfig.tabs.base') },
            { value: 'embedding', label: t('settings.modelConfig.tabs.embedding') },
            { value: 'rerank', label: t('settings.modelConfig.tabs.rerank') },
          ]}
        />
      </div>

      <div className="mt-5 flex min-h-0 flex-1 flex-col gap-5" data-testid={`model-purpose-${purpose}`}>
        <CurrentModelHero
          purpose={purpose}
          providerName={hero.providerName}
          modelID={hero.modelID}
          model={hero.model}
          keyConfigured={hero.keyConfigured}
          onLocate={hero.locateId ? () => setSelected(hero.locateId!) : undefined}
        />

        {(purpose === 'embedding' || purpose === 'rerank') && (
          <p className="text-meta text-ink-tertiary">
            {t(`settings.modelConfig.purpose.${purpose}.privacyNote`)}
          </p>
        )}

        {/* ProviderList + ProviderDetail as today */}
        <ProviderDetail
          ...
          isActive={isActive}
          onSetCurrent={(modelID) => void onSetCurrent(modelID)}
          setCurrentLabel={t(`settings.modelConfig.purpose.${purpose}.setCurrent`)}
          currentLabel={t(`settings.modelConfig.purpose.${purpose}.current`)}
          roleActions={
            purpose === 'embedding' ? (
              <>
                <Button ... data-testid="role-embedding-recommend" onClick={() => void onRecommendEmbedding()}>
                  {t('settings.modelConfig.useRecommended')}
                </Button>
                {emb && (
                  <Button
                    data-testid="role-embedding-clear"
                    onClick={() => void applyMemory({ embeddingModel: null } as never)}
                  >
                    {t('settings.modelConfig.purpose.embedding.clear')}
                  </Button>
                )}
              </>
            ) : purpose === 'rerank' && rr ? (
              <Button
                data-testid="role-rerank-clear"
                onClick={() => void applyMemory({ rerankModel: null } as never)}
              >
                {t('settings.modelConfig.purpose.rerank.clear')}
              </Button>
            ) : null
          }
        />
      </div>
      {/* AddProviderDialog unchanged */}
    </div>
  )
}
```

Notes:
- `applyMemory({ embeddingModel: null })` — match existing null-delete cast pattern already used in ModelConfig for role fields.
- Remove unused imports: `groupModelOptions` if no longer needed in ModelConfig; keep `canRecommendEmbedding` etc. for recommend.
- `data-testid="model-purpose-tabs"`: `SegmentedControl` already supports `data-testid` prop — pass it.

- [ ] **Step 4: Run ModelConfig tests — expect PASS**

```bash
yarn vitest run src/components/account/ModelConfig.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/components/account/ModelConfig.tsx src/components/account/ModelConfig.test.tsx src/components/account/ProviderDetail.tsx
git commit -m "feat(settings): split model config into base, embedding, rerank tabs"
```

---

### Task 5: Memory page copy + extract stays pool-only

**Files:**
- Modify: `src/i18n/*` only if Task 1 missed hybrid string (already done)
- Verify: `src/components/account/MemoryConfig.tsx` — extract select already uses `groupModelOptions`; **no** API key UI for extract

- [ ] **Step 1: Confirm extract UI is pool-only**

In `MemoryConfig.tsx`, the block under `memory-extract-model` must remain a single `<select>` fed by `groupModelOptions(catalog, providersConfig)`. Do not add key/baseURL fields for extract.

- [ ] **Step 2: Optional MemoryConfig test assertion** (if `MemoryConfig.test.tsx` exists; else skip)

```bash
ls src/components/account/MemoryConfig.test.tsx
```

If present, add:

```tsx
it('points hybrid search at Models → Embedding copy key', () => {
  // render with no embeddingModel
  expect(screen.getByTestId('memory-hybrid-needs-embed').textContent).toContain(
    // with mocked t: key name
    'settings.memory.hybridSearchNeedsEmbedding',
  )
})
```

- [ ] **Step 3: Commit only if code/tests changed**

```bash
git add src/components/account/MemoryConfig.tsx src/components/account/MemoryConfig.test.tsx
git commit -m "fix(memory): align hybrid embedding pointer with model tabs"
```

---

### Task 6: Integration test — set embedding via ProviderDetail path

**Files:**
- Modify: `src/components/account/ModelConfig.test.tsx`

- [ ] **Step 1: Add test that selecting a model on embedding tab writes memory config**

Extend mocks so `ProviderDetail` is usable: ensure selected provider is openai and models render. Click embedding tab, then click the model row that triggers `onSetCurrent` for `text-embedding-3-small`.

```tsx
it('sets embedding model via setMemoryConfig when choosing a model on embedding tab', async () => {
  render(<ModelConfig />)
  fireEvent.click(screen.getByRole('tab', { name: 'settings.modelConfig.tabs.embedding' }))
  // Model rows show model name; click button containing text-embedding-3-small
  const row = await screen.findByText('text-embedding-3-small')
  fireEvent.click(row.closest('button') ?? row)
  await waitFor(() => {
    expect(setMemoryConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        embeddingModel: expect.objectContaining({
          providerID: 'openai',
          modelID: 'text-embedding-3-small',
        }),
      }),
    )
  })
})
```

If model list requires extra catalog shape fields (`tool_call`, etc.), copy minimal fields from existing catalog fixtures in `src/lib/*test*`.

- [ ] **Step 2: Run tests**

```bash
yarn vitest run src/components/account/ModelConfig.test.tsx src/components/account/CurrentModelHero.test.tsx src/i18n/translation-keys.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add src/components/account/ModelConfig.test.tsx
git commit -m "test(settings): embedding selection writes memory embeddingModel"
```

---

### Task 7: Final verification + cleanup

**Files:**
- Possibly remove dead `settings.modelConfig.roleModels` keys from three locales **only if** nothing references them (`grep roleModels`). Prefer remove in same commit if clean.

- [ ] **Step 1: Grep for stale selectors**

```bash
grep -r "role-models-section\|role-extract-model\|role-embedding-model\|role-rerank-model\|roleModels" src e2e packages --include='*.ts' --include='*.tsx' || true
```

Fix any remaining UI references (e2e helpers, etc.). Keep `role-embedding-recommend` testid if still used.

- [ ] **Step 2: Typecheck + targeted tests**

```bash
yarn tsc --noEmit
yarn vitest run src/components/account/ModelConfig.test.tsx src/components/account/CurrentModelHero.test.tsx src/i18n/translation-keys.test.ts
```

Expected: PASS / no errors.

- [ ] **Step 3: Manual checklist (human or dev build)**

1. Settings → Model: three tabs visible.  
2. Base: set current chat model works.  
3. Embedding: set model, clear, recommend (if OpenAI active).  
4. Rerank: set / clear.  
5. Memory: extract dropdown only; hybrid hint says Models → Embedding.  
6. No role-models block on Model page.

- [ ] **Step 4: Final commit if cleanup remaining**

```bash
git add -A
git status
git commit -m "chore(settings): remove obsolete roleModels i18n and stale refs"
```

---

## Self-review (plan vs spec)

| Spec requirement | Task |
|------------------|------|
| Page SegmentedControl A | Task 4 |
| Base / embedding / rerank not mixed | Task 4 |
| Full provider UI on embed/rerank | Task 4 (shared list+detail) |
| Shared provider registry | Task 4 (existing store) |
| extract on Memory, pool only | Task 5 (already in MemoryConfig; remove ModelConfig dup) |
| Storage unchanged | All tasks (no protocol/hip.toml migration) |
| i18n 3 locales | Task 1 |
| hybrid pointer text | Task 1 / 5 |
| Tests | Tasks 2, 4, 6, 7 |
| No rerank HTTP / no modality filter | Out of scope — not in tasks |

**Placeholder scan:** none intentional.  
**Type names:** `ModelPurpose` / `Purpose` = `'base' | 'embedding' | 'rerank'` consistently.

---

## Execution handoff

Plan saved to `docs/superpowers/plans/2026-07-11-model-config-three-way-layout.md`.
