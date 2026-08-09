import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProvidersStore } from '@/store/providersStore'
import { groupProviders } from '@/lib/providerGroups'
import { Badge } from '@/components/ui/Badge'
import { ProviderList } from './ProviderList'
import { ProviderDetail } from './ProviderDetail'
import { AddProviderDialog } from './AddProviderDialog'

export function ModelConfig() {
  const { t } = useTranslation()
  const {
    catalog,
    config,
    keyConfigured,
    loaded,
    load,
    saveKey,
    clearKey,
    setBaseURL,
    setEnabled,
    setApiKind,
    setActiveModel,
  } = useProvidersStore()
  const [selected, setSelected] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [showIncompatible, setShowIncompatible] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const groups = groupProviders(catalog, filter, keyConfigured)
  const am = config.activeModel
  const activeId =
    selected ?? am?.providerID ?? groups.configured[0]?.id ?? groups.available[0]?.id ?? null
  const active = activeId ? catalog[activeId] : undefined

  if (!loaded) return <div className="p-6 text-meta text-ink-tertiary">…</div>

  const baseReady = !!(am && keyConfigured[am.providerID])
  const currentProvider = am ? catalog[am.providerID] : undefined

  return (
    <div className="flex h-full min-h-0 flex-col p-6" data-testid="model-config-cards">
      <h2 className="text-title font-semibold text-ink">{t('settings.model')}</h2>
      <p className="mt-1 text-body text-ink-secondary">{t('settings.modelConfig.intro')}</p>

      <div
        className="mt-5 flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3"
        data-testid="model-current-summary"
      >
        <div className="min-w-0 flex-1">
          <div className="text-caption font-medium text-ink-tertiary">
            {t('settings.modelConfig.purpose.base.currentModel')}
          </div>
          <div className="mt-1 truncate text-prose font-medium text-ink">
            {am?.modelID ?? t('settings.modelConfig.purpose.base.noModel')}
          </div>
          <div className="mt-0.5 truncate text-meta text-ink-tertiary">
            {am
              ? `${currentProvider?.name ?? am.providerID} · ${t('settings.modelConfig.purpose.base.current')}`
              : t('settings.modelConfig.purpose.base.noModelHint')}
          </div>
        </div>
        <div className="shrink-0">
          {am ? (
            baseReady ? (
              <Badge variant="success" size="sm">
                {t('settings.modelConfig.ready')}
              </Badge>
            ) : (
              <Badge variant="warning" size="sm">
                {t('settings.modelConfig.keyMissing')}
              </Badge>
            )
          ) : (
            <Badge size="sm">{t('settings.modelConfig.notConfigured')}</Badge>
          )}
        </div>
      </div>

      <div className="mt-4 flex min-h-0 flex-1 gap-4">
        <div className="flex w-[260px] shrink-0 flex-col">
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
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          {active ? (
            <ProviderDetail
              key={active.id}
              provider={active}
              configured={!!keyConfigured[active.id]}
              enabled={config.providers[active.id]?.enabled ?? false}
              baseURL={config.providers[active.id]?.baseURL ?? active.api ?? ''}
              apiKind={config.providers[active.id]?.apiKind}
              isActive={(modelID) => am?.providerID === active.id && am?.modelID === modelID}
              onSaveKey={(v) => saveKey(active.id, v)}
              onClearKey={() => clearKey(active.id)}
              onSaveBaseURL={(v) => setBaseURL(active.id, v)}
              onSetEnabled={(v) => setEnabled(active.id, v)}
              onSetApiKind={(v) => setApiKind(active.id, v)}
              onSetCurrent={(modelID) => setActiveModel(active.id, modelID)}
              setCurrentLabel={t('settings.modelConfig.purpose.base.setCurrent')}
              currentLabel={t('settings.modelConfig.purpose.base.current')}
            />
          ) : (
            <div className="flex min-w-0 flex-1 items-center justify-center rounded-lg border border-dashed border-border text-meta text-ink-tertiary">
              {t('settings.modelConfig.noMatches')}
            </div>
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
