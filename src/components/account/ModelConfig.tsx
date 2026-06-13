import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Plus, Ban, Check, ChevronRight } from 'lucide-react'
import { useProvidersStore } from '@/store/providersStore'
import { isCompatible, type CatalogProvider, type CatalogModel } from '@/ipc/catalog'
import { groupProviders } from '@/lib/providerGroups'
import { filterModels, NO_CAPS, type ModelCaps } from '@/lib/modelFilter'
import { cn } from '@/lib/utils'

/** The capability toggles shown above the model list; each maps to a ModelCaps key + an i18n label. */
const CAP_FILTERS = [
  { key: 'reasoning', i18n: 'reasoning' },
  { key: 'tool_call', i18n: 'tools' },
  { key: 'attachment', i18n: 'vision' },
] as const

export function ModelConfig() {
  const { t } = useTranslation()
  const { catalog, config, keyConfigured, loaded, load, saveKey, clearKey, setBaseURL, setActiveModel } = useProvidersStore()
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [adding, setAdding] = useState(false)
  const [showIncompatible, setShowIncompatible] = useState(false)

  useEffect(() => { void load() }, [load])

  const groups = groupProviders(catalog, filter, keyConfigured)
  const hasMatches = groups.configured.length + groups.available.length + groups.incompatible.length > 0
  // A filter search should reach incompatible matches too, even while the group is collapsed.
  const incompatibleOpen = showIncompatible || filter.trim() !== ''

  const activeId = selected ?? config.activeModel?.providerID ?? groups.configured[0]?.id ?? groups.available[0]?.id ?? null
  const active = activeId ? catalog[activeId] : undefined
  const am = config.activeModel
  const activeModelMeta = am ? catalog[am.providerID]?.models[am.modelID] : undefined

  if (!loaded) return <div className="px-6 py-5 text-meta text-ink-tertiary">…</div>

  const renderRow = (p: CatalogProvider) => {
    const compat = isCompatible(p)
    return (
      <button
        key={p.id}
        disabled={!compat}
        onClick={() => { setAdding(false); setSelected(p.id) }}
        className={cn(
          'flex w-full items-center justify-between px-2.5 py-1.5 text-left text-body transition-colors',
          compat ? 'hover:bg-surface-muted' : 'cursor-not-allowed opacity-55',
          p.id === activeId && 'bg-accent-active',
        )}
      >
        <span className={cn('flex items-center gap-2 truncate', p.id === activeId ? 'font-medium text-accent-strong' : 'text-ink-secondary')}>
          <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded bg-surface-muted text-caption text-ink-secondary">
            {p.name.charAt(0)}
          </span>
          <span className="truncate">{p.name}</span>
        </span>
        {!compat ? <Ban size={13} className="shrink-0 text-ink-tertiary" />
          : keyConfigured[p.id] ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-success" />
          : <span className="shrink-0 text-caption text-ink-tertiary">{t('settings.modelConfig.notConfigured')}</span>}
      </button>
    )
  }

  return (
    <div className="flex flex-col px-5 py-4">
      {/* Current model */}
      <div className="mb-4 flex items-center justify-between rounded-md bg-surface-subtle px-3.5 py-2.5">
        <div>
          <div className="text-meta text-ink-tertiary">{t('settings.modelConfig.currentModel')}</div>
          <div className="text-body font-medium text-ink">
            {am ? `${catalog[am.providerID]?.name ?? am.providerID} · ${am.modelID}` : '—'}
          </div>
        </div>
        {activeModelMeta?.reasoning && (
          <span className="rounded-full bg-accent-active px-2 py-0.5 text-caption text-accent-strong">{t('settings.modelConfig.reasoning')}</span>
        )}
      </div>

      <div className="flex min-h-[270px] gap-3.5">
        {/* Provider list */}
        <div className="w-[192px] shrink-0 self-start overflow-hidden rounded-md border border-border">
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
            <Search size={13} className="text-ink-tertiary" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('settings.modelConfig.searchProviders')}
              className="w-full bg-transparent text-meta text-ink placeholder:text-ink-tertiary focus:outline-none"
            />
          </div>
          <div className="max-h-[320px] overflow-y-auto">
            {groups.configured.length > 0 && (
              <>
                <div className="px-2.5 pb-0.5 pt-2 text-caption text-ink-tertiary">{t('settings.modelConfig.configured')} · {groups.configured.length}</div>
                {groups.configured.map(renderRow)}
              </>
            )}
            {groups.available.length > 0 && (
              <>
                <div className="px-2.5 pb-0.5 pt-2 text-caption text-ink-tertiary">{t('settings.modelConfig.available')} · {groups.available.length}</div>
                {groups.available.map(renderRow)}
              </>
            )}
            {groups.incompatible.length > 0 && (
              <>
                <button
                  onClick={() => setShowIncompatible((v) => !v)}
                  className="flex w-full items-center gap-1 px-2.5 pb-0.5 pt-2 text-left text-caption text-ink-tertiary transition-colors hover:text-ink-secondary"
                >
                  <ChevronRight size={11} className={cn('shrink-0 transition-transform', incompatibleOpen && 'rotate-90')} />
                  {t('settings.modelConfig.incompatibleGroup')} · {groups.incompatible.length}
                </button>
                {incompatibleOpen && groups.incompatible.map(renderRow)}
              </>
            )}
            {!hasMatches && (
              <div className="px-2.5 py-3 text-center text-meta text-ink-tertiary">{t('settings.modelConfig.noMatches')}</div>
            )}
          </div>
          <button
            onClick={() => setAdding(true)}
            className="flex w-full items-center gap-1.5 border-t border-border px-2.5 py-2 text-body text-accent-strong hover:bg-surface-muted"
          >
            <Plus size={14} /> {t('settings.modelConfig.addCustom')}
          </button>
        </div>

        {/* Detail */}
        <div className="min-w-0 flex-1">
          {adding
            ? <AddCustomProvider onDone={(id) => { setAdding(false); setSelected(id) }} onCancel={() => setAdding(false)} />
            : active ? <ProviderDetail key={active.id} provider={active}
              configured={!!keyConfigured[active.id]}
              baseURL={config.providers[active.id]?.baseURL ?? active.api ?? ''}
              isActive={(modelID) => am?.providerID === active.id && am?.modelID === modelID}
              onSaveKey={(v) => saveKey(active.id, v)}
              onClearKey={() => clearKey(active.id)}
              onSaveBaseURL={(v) => setBaseURL(active.id, v)}
              onSetCurrent={(modelID) => setActiveModel(active.id, modelID)} />
            : <div className="text-meta text-ink-tertiary">…</div>}
        </div>
      </div>
    </div>
  )
}

function ProviderDetail({ provider, configured, baseURL, isActive, onSaveKey, onClearKey, onSaveBaseURL, onSetCurrent }: {
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
    setBusy(true); setError(null)
    try { await fn(); setValue('') }
    catch (e) { console.error('[modelConfig]', e); setError(t('settings.modelConfig.error')) }
    finally { setBusy(false) }
  }

  // Separate from run(): saving the base URL must NOT clear the API-key draft (`value`).
  async function saveBaseURL() {
    setBusy(true); setError(null)
    try { await onSaveBaseURL(baseURLValue.trim()) }
    catch (e) { console.error('[modelConfig]', e); setError(t('settings.modelConfig.error')) }
    finally { setBusy(false) }
  }

  const allModels = Object.values(provider.models)
  const current = allModels.find((m) => isActive(m.id))
  const rest = current ? allModels.filter((m) => m.id !== current.id) : allModels
  const filtered = filterModels(rest, modelQuery, caps)

  const renderModelCard = (m: CatalogModel, isCurrent: boolean) => (
    <button key={m.id} disabled={busy} onClick={() => void run(() => onSetCurrent(m.id))}
      className={cn('flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left disabled:opacity-60',
        isCurrent ? 'border-accent bg-accent-active' : 'border-border hover:bg-surface-muted')}>
      <div className="min-w-0 flex-1">
        <div className={cn('text-body', isCurrent && 'font-medium text-accent-strong')}>{m.name}</div>
        <div className="mt-0.5 flex gap-1.5">
          {m.limit?.context && <span className="rounded bg-surface px-1.5 text-caption text-ink-secondary">{Math.round(m.limit.context / 1000)}K</span>}
          {m.reasoning && <span className="rounded bg-surface px-1.5 text-caption text-ink-secondary">{t('settings.modelConfig.reasoning')}</span>}
          {m.tool_call && <span className="rounded bg-surface px-1.5 text-caption text-ink-secondary">{t('settings.modelConfig.tools')}</span>}
          {m.attachment && <span className="rounded bg-surface px-1.5 text-caption text-ink-secondary">{t('settings.modelConfig.vision')}</span>}
        </div>
      </div>
      <span className="shrink-0 text-caption text-accent-strong">
        {isCurrent ? t('settings.modelConfig.current') : t('settings.modelConfig.setCurrent')}
      </span>
    </button>
  )

  return (
    <>
      <div className="mb-1 text-meta text-ink-tertiary">{t('settings.modelConfig.apiKey')}</div>
      <div className="flex items-center gap-2">
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="sk-..."
          className="h-8 flex-1 rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60"
        />
        <button onClick={() => run(() => onSaveKey(value.trim()))} disabled={busy || !value.trim()}
          className="h-8 rounded-md bg-accent px-3 text-body font-medium text-white hover:bg-accent-hover disabled:opacity-50">
          {configured ? t('settings.modelConfig.change') : t('settings.modelConfig.save')}
        </button>
        <button onClick={() => run(onClearKey)} disabled={busy || !configured}
          className="h-8 rounded-md border border-border px-3 text-body text-ink-secondary hover:bg-surface-muted disabled:opacity-50">
          {t('settings.modelConfig.clear')}
        </button>
      </div>
      {configured && <div className="mt-1 text-meta text-success"><Check size={12} className="-mt-0.5 mr-0.5 inline" />{t('settings.modelConfig.keyStored')}</div>}
      {error && <div className="mt-1 text-meta text-danger">{error}</div>}

      <div className="mt-4 mb-1 text-meta text-ink-tertiary">{t('settings.modelConfig.baseUrl')}</div>
      <div className="flex items-center gap-2">
        <input
          value={baseURLValue}
          onChange={(e) => setBaseURLValue(e.target.value)}
          placeholder={provider.api ?? 'https://...'}
          className="h-8 flex-1 rounded-md border border-border bg-surface px-2.5 font-mono text-meta text-ink focus:outline-none focus:ring-2 focus:ring-accent/60"
        />
        <button onClick={() => void saveBaseURL()} disabled={busy || !baseURLValue.trim() || baseURLValue.trim() === baseURL}
          className="h-8 rounded-md bg-accent px-3 text-body font-medium text-white hover:bg-accent-hover disabled:opacity-50">
          {t('settings.modelConfig.save')}
        </button>
      </div>

      <div className="mt-4 mb-1.5 flex items-center justify-between">
        <span className="text-meta text-ink-tertiary">{t('settings.modelConfig.models')}</span>
        {allModels.length > 0 && <span className="text-caption text-ink-tertiary">{allModels.length} {t('settings.modelConfig.modelsUnit')}</span>}
      </div>

      <div className="mb-2 flex items-center gap-2">
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
            className={cn('h-8 shrink-0 rounded-md px-2.5 text-caption transition-colors',
              caps[f.key] ? 'bg-accent text-white' : 'border border-border text-ink-secondary hover:bg-surface-muted')}
          >
            {t(`settings.modelConfig.${f.i18n}`)}
          </button>
        ))}
      </div>

      {current && (
        <div className="mb-2">
          <div className="mb-1 text-caption text-ink-tertiary">{t('settings.modelConfig.current')}</div>
          {renderModelCard(current, true)}
        </div>
      )}

      <div className="flex max-h-[300px] flex-col gap-1.5 overflow-y-auto">
        {filtered.length > 0
          ? filtered.map((m) => renderModelCard(m, false))
          : <div className="px-2.5 py-3 text-center text-meta text-ink-tertiary">{t('settings.modelConfig.noMatches')}</div>}
      </div>
    </>
  )
}

function AddCustomProvider({ onDone, onCancel }: { onDone: (id: string) => void; onCancel: () => void }) {
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
    setBusy(true); setError(null)
    try {
      const ids = models.split(',').map((m) => m.trim()).filter(Boolean)
      await addCustom(id, name.trim(), baseURL.trim(), ids)
      if (key.trim()) await useProvidersStore.getState().saveKey(id, key.trim())
      onDone(id)
    } catch (e) { console.error('[modelConfig]', e); setError(t('settings.modelConfig.error')) }
    finally { setBusy(false) }
  }

  const field = 'h-8 w-full rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'
  return (
    <div className="flex flex-col gap-2">
      <input className={field} placeholder={t('settings.modelConfig.customName')} value={name} onChange={(e) => setName(e.target.value)} />
      <input className={field} placeholder={t('settings.modelConfig.baseUrl')} value={baseURL} onChange={(e) => setBaseURL(e.target.value)} />
      <input className={field} type="password" placeholder="sk-..." value={key} onChange={(e) => setKey(e.target.value)} />
      <input className={field} placeholder={t('settings.modelConfig.customModels')} value={models} onChange={(e) => setModels(e.target.value)} />
      {error && <div className="text-meta text-danger">{error}</div>}
      <div className="flex gap-2">
        <button onClick={() => void submit()} disabled={busy || !name.trim() || !baseURL.trim()}
          className="h-8 rounded-md bg-accent px-3 text-body font-medium text-white hover:bg-accent-hover disabled:opacity-50">
          {t('settings.modelConfig.addProvider')}
        </button>
        <button onClick={onCancel} className="h-8 rounded-md border border-border px-3 text-body text-ink-secondary hover:bg-surface-muted">
          {t('common.close')}
        </button>
      </div>
    </div>
  )
}
