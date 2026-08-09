import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Plus } from 'lucide-react'
import { useProvidersStore } from '@/store/providersStore'
import { groupProviders } from '@/lib/providerGroups'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
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
  const [dialog, setDialog] = useState<'base' | null>(null)

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

  return (
    <div className="flex h-full flex-col p-6" data-testid="model-config-cards">
      <h2 className="text-title font-semibold text-ink">{t('settings.model')}</h2>
      <p className="mt-1 text-body text-ink-secondary">{t('settings.modelConfig.intro')}</p>

      <div className="mt-5 flex flex-col gap-3">
        <ModelPurposeCard
          testId="model-card-base"
          label={t('settings.modelConfig.tabs.base')}
          title={am?.modelID ?? t('settings.modelConfig.purpose.base.noModel')}
          subtitle={
            am
              ? `${catalog[am.providerID]?.name ?? am.providerID} · ${t('settings.modelConfig.purpose.base.currentModel')}`
              : t('settings.modelConfig.purpose.base.noModelHint')
          }
          ready={baseReady}
          configured={!!am}
          onEdit={() => setDialog('base')}
          editLabel={am ? t('settings.modelConfig.edit') : t('settings.modelConfig.configure')}
        />
      </div>

      {dialog === 'base' && (
        <Modal
          open
          onOpenChange={(o) => { if (!o) setDialog(null) }}
          title={t('settings.modelConfig.baseDialogTitle')}
          resizable
          defaultSize={{ width: 960, height: 640 }}
          minSize={{ width: 720, height: 480 }}
          storageKey="model-config-base-dialog"
        >
          <div className="flex h-full min-h-[420px] flex-col gap-3 p-4" data-testid="base-model-dialog">
            <p className="text-meta text-ink-tertiary">{t('settings.modelConfig.baseDialogIntro')}</p>
            <div className="flex min-h-0 flex-1 gap-4">
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
        </Modal>
      )}

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

function ModelPurposeCard({
  testId,
  label,
  title,
  subtitle,
  ready,
  configured,
  onEdit,
  editLabel,
}: {
  testId: string
  label: string
  title: string
  subtitle: string
  ready: boolean
  configured: boolean
  onEdit: () => void
  editLabel: string
}) {
  const { t } = useTranslation()
  return (
    <div
      className="rounded-lg border border-border bg-surface px-4 py-3.5"
      data-testid={testId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-caption font-medium text-ink-tertiary">
            {label}
          </div>
          <div className="mt-1 truncate text-prose font-medium text-ink">{title}</div>
          <div className="mt-0.5 truncate text-meta text-ink-tertiary">{subtitle}</div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {configured ? (
            ready ? (
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
          <Button size="sm" variant="secondary" onClick={onEdit} data-testid={`${testId}-edit`}>
            {configured ? <Pencil size={14} /> : <Plus size={14} />}
            <span className="ml-1">{editLabel}</span>
          </Button>
        </div>
      </div>
    </div>
  )
}
