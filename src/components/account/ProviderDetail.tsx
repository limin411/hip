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

const CAP_I18N = {
  reasoning: 'settings.modelConfig.reasoning',
  tool_call: 'settings.modelConfig.tools',
  attachment: 'settings.modelConfig.vision',
} as const satisfies Record<ModelCapKey, string>

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
