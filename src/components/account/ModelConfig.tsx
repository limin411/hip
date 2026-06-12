import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, Plus, Ban, Check } from 'lucide-react'
import { useProvidersStore } from '@/store/providersStore'
import { isCompatible, type CatalogProvider } from '@/ipc/catalog'
import { cn } from '@/lib/utils'

export function ModelConfig() {
  const { t } = useTranslation()
  const { catalog, config, keyConfigured, loaded, load, saveKey, clearKey, setActiveModel } = useProvidersStore()
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('')

  useEffect(() => { void load() }, [load])

  const providers = Object.values(catalog)
    .filter((p) => p.name.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => Number(isCompatible(b)) - Number(isCompatible(a)) || a.name.localeCompare(b.name))

  const activeId = selected ?? config.activeModel?.providerID ?? providers.find((p) => isCompatible(p))?.id ?? null
  const active = activeId ? catalog[activeId] : undefined
  const am = config.activeModel
  const activeModelMeta = am ? catalog[am.providerID]?.models[am.modelID] : undefined

  if (!loaded) return <div className="px-6 py-5 text-meta text-ink-tertiary">…</div>

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
        <div className="w-[158px] shrink-0 overflow-hidden rounded-md border border-border">
          <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-2">
            <Search size={13} className="text-ink-tertiary" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('settings.modelConfig.searchProviders')}
              className="w-full bg-transparent text-meta text-ink placeholder:text-ink-tertiary focus:outline-none"
            />
          </div>
          {providers.map((p) => {
            const compat = isCompatible(p)
            return (
              <button
                key={p.id}
                disabled={!compat}
                onClick={() => setSelected(p.id)}
                className={cn(
                  'flex w-full items-center justify-between px-2.5 py-2 text-left text-body transition-colors',
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
          })}
          <div className="flex items-center gap-1.5 border-t border-border px-2.5 py-2 text-body text-accent-strong">
            <Plus size={14} /> {t('settings.modelConfig.addCustom')}
          </div>
        </div>

        {/* Detail */}
        <div className="min-w-0 flex-1">
          {active ? <ProviderDetail key={active.id} provider={active}
            configured={!!keyConfigured[active.id]}
            isActive={(modelID) => am?.providerID === active.id && am?.modelID === modelID}
            onSaveKey={(v) => saveKey(active.id, v)}
            onClearKey={() => clearKey(active.id)}
            onSetCurrent={(modelID) => setActiveModel(active.id, modelID)} />
            : <div className="text-meta text-ink-tertiary">…</div>}
        </div>
      </div>
    </div>
  )
}

function ProviderDetail({ provider, configured, isActive, onSaveKey, onClearKey, onSetCurrent }: {
  provider: CatalogProvider
  configured: boolean
  isActive: (modelID: string) => boolean
  onSaveKey: (value: string) => Promise<void>
  onClearKey: () => Promise<void>
  onSetCurrent: (modelID: string) => Promise<void>
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn(); setValue('') }
    catch (e) { console.error('[modelConfig]', e); setError(t('settings.modelConfig.error')) }
    finally { setBusy(false) }
  }

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
      <div className="flex h-8 items-center rounded-md border border-border bg-surface px-2.5 font-mono text-meta text-ink-secondary">
        {provider.api ?? '—'}
      </div>

      <div className="mt-4 mb-1.5 text-meta text-ink-tertiary">{t('settings.modelConfig.models')}</div>
      <div className="flex flex-col gap-1.5">
        {Object.values(provider.models).map((m) => {
          const current = isActive(m.id)
          return (
            <button key={m.id} disabled={busy} onClick={() => void run(() => onSetCurrent(m.id))}
              className={cn('flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left disabled:opacity-60',
                current ? 'border-accent bg-accent-active' : 'border-border hover:bg-surface-muted')}>
              <div className="min-w-0 flex-1">
                <div className={cn('text-body', current && 'font-medium text-accent-strong')}>{m.name}</div>
                <div className="mt-0.5 flex gap-1.5">
                  {m.limit?.context && <span className="rounded bg-surface px-1.5 text-caption text-ink-secondary">{Math.round(m.limit.context / 1000)}K</span>}
                  {m.reasoning && <span className="rounded bg-surface px-1.5 text-caption text-ink-secondary">{t('settings.modelConfig.reasoning')}</span>}
                  {m.tool_call && <span className="rounded bg-surface px-1.5 text-caption text-ink-secondary">{t('settings.modelConfig.tools')}</span>}
                </div>
              </div>
              <span className="shrink-0 text-caption text-accent-strong">
                {current ? t('settings.modelConfig.current') : t('settings.modelConfig.setCurrent')}
              </span>
            </button>
          )
        })}
      </div>
    </>
  )
}
