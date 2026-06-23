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
  const activeId =
    selected ?? config.activeModel?.providerID ?? groups.configured[0]?.id ?? groups.available[0]?.id ?? null
  const active = activeId ? catalog[activeId] : undefined
  const am = config.activeModel
  const activeModelMeta = am ? catalog[am.providerID]?.models[am.modelID] : undefined

  if (!loaded) return <div className="p-6 text-meta text-ink-tertiary">…</div>

  return (
    <div className="flex h-full flex-col p-6">
      <h2 className="text-title font-semibold text-ink">{t('settings.model')}</h2>
      <p className="mt-1 text-body text-ink-secondary">{t('settings.modelConfig.intro')}</p>

      <div className="mt-5 flex min-h-0 flex-1 flex-col gap-5">
        <CurrentModelHero
          providerName={am ? (catalog[am.providerID]?.name ?? am.providerID) : null}
          modelID={am?.modelID ?? null}
          model={activeModelMeta}
          keyConfigured={am ? !!keyConfigured[am.providerID] : false}
          onLocate={am ? () => setSelected(am.providerID) : undefined}
        />

        <div className="flex min-h-0 flex-1 gap-5">
          <div className="flex w-[280px] min-w-[240px] max-w-[360px] shrink-0 flex-col">
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

          {active ? (
            <ProviderDetail
              key={active.id}
              provider={active}
              configured={!!keyConfigured[active.id]}
              enabled={config.providers[active.id]?.enabled ?? false}
              baseURL={config.providers[active.id]?.baseURL ?? active.api ?? ''}
              isActive={(modelID) => am?.providerID === active.id && am?.modelID === modelID}
              onSaveKey={(v) => saveKey(active.id, v)}
              onClearKey={() => clearKey(active.id)}
              onSaveBaseURL={(v) => setBaseURL(active.id, v)}
              onSetEnabled={(v) => setEnabled(active.id, v)}
              onSetCurrent={(modelID) => setActiveModel(active.id, modelID)}
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
