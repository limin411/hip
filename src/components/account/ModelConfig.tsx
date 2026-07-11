import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { MemoryFileConfig, MemoryModelRef, ProvidersConfig } from '@hip/protocol'
import { useProvidersStore } from '@/store/providersStore'
import type { Catalog } from '@/ipc/catalog'
import { groupProviders } from '@/lib/providerGroups'
import { groupModelOptions } from '@/lib/agentModelOptions'
import {
  canRecommendEmbedding,
  memoryModelKey,
  memoryModelRefFromKey,
  RECOMMENDED_EMBEDDING_MODEL_ID,
} from '@/lib/memoryModelRef'
import { sessionService } from '@/domain'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { CurrentModelHero } from './CurrentModelHero'
import { ProviderList } from './ProviderList'
import { ProviderDetail } from './ProviderDetail'
import { AddProviderDialog } from './AddProviderDialog'

const selectCls =
  'h-9 w-full rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

function resolveBaseURL(
  providerID: string,
  catalog: Catalog,
  config: ProvidersConfig,
): string | undefined {
  return config.providers[providerID]?.baseURL ?? catalog[providerID]?.api ?? undefined
}

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
  const [memoryCfg, setMemoryCfg] = useState<MemoryFileConfig | null>(null)
  const [memoryBusy, setMemoryBusy] = useState(false)

  useEffect(() => {
    void load()
  }, [load])

  const refreshMemory = useCallback(async () => {
    try {
      const cfg = await sessionService.getMemoryConfig()
      setMemoryCfg(cfg)
    } catch {
      // Role models are optional UI; leave section empty on failure.
    }
  }, [])

  useEffect(() => {
    void refreshMemory()
  }, [refreshMemory])

  const applyMemory = async (partial: Partial<MemoryFileConfig>) => {
    setMemoryBusy(true)
    try {
      const cfg = await sessionService.setMemoryConfig(partial)
      setMemoryCfg(cfg)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t('settings.modelConfig.error'))
    } finally {
      setMemoryBusy(false)
    }
  }

  const groups = groupProviders(catalog, filter, keyConfigured)
  const modelGroups = groupModelOptions(catalog, config)
  const activeId =
    selected ?? config.activeModel?.providerID ?? groups.configured[0]?.id ?? groups.available[0]?.id ?? null
  const active = activeId ? catalog[activeId] : undefined
  const am = config.activeModel
  const activeModelMeta = am ? catalog[am.providerID]?.models[am.modelID] : undefined

  const onRoleModelChange = async (
    field: 'extractModel' | 'embeddingModel' | 'rerankModel',
    key: string,
  ) => {
    if (!key) {
      // Clear optional field via null (merge treats null as delete).
      await applyMemory({ [field]: null } as unknown as Partial<MemoryFileConfig>)
      return
    }
    const { providerID } = key.includes('/')
      ? { providerID: key.slice(0, key.indexOf('/')) }
      : { providerID: '' }
    const baseURL = providerID ? resolveBaseURL(providerID, catalog, config) : undefined
    const ref = memoryModelRefFromKey(key, baseURL)
    if (!ref) return
    await applyMemory({ [field]: ref })
  }

  const onRecommendEmbedding = async () => {
    if (!am || !canRecommendEmbedding(am.providerID, catalog)) {
      toast.message(t('settings.modelConfig.roleModels.recommendEmbeddingUnavailable'))
      return
    }
    const baseURL = resolveBaseURL(am.providerID, catalog, config)
    const ref: MemoryModelRef = {
      providerID: am.providerID,
      modelID: RECOMMENDED_EMBEDDING_MODEL_ID,
      ...(baseURL ? { baseURL } : {}),
    }
    await applyMemory({ embeddingModel: ref })
  }

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

        {/* Role models for memory extract / embed / rerank */}
        <section
          className="rounded-lg border border-border bg-surface px-4 py-3.5"
          data-testid="role-models-section"
        >
          <h3 className="text-prose font-medium text-ink">{t('settings.modelConfig.roleModels.title')}</h3>
          <p className="mt-0.5 text-meta text-ink-tertiary">{t('settings.modelConfig.roleModels.intro')}</p>
          <p className="mt-1.5 text-meta text-ink-tertiary">{t('settings.modelConfig.roleModels.privacyNote')}</p>

          <div className="mt-3 space-y-3">
            <div>
              <label className="mb-1 block text-meta text-ink-secondary" htmlFor="role-extract-model">
                {t('settings.modelConfig.roleModels.extract')}
              </label>
              <select
                id="role-extract-model"
                className={selectCls}
                data-testid="role-extract-model"
                disabled={memoryBusy || !memoryCfg}
                value={memoryModelKey(memoryCfg?.extractModel)}
                onChange={(e) => void onRoleModelChange('extractModel', e.target.value)}
              >
                <option value="">{t('settings.modelConfig.roleModels.defaultCheap')}</option>
                {modelGroups.map((g) => (
                  <optgroup key={g.providerID} label={g.providerName}>
                    {g.models.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.modelID}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-meta text-ink-secondary" htmlFor="role-embedding-model">
                {t('settings.modelConfig.roleModels.embedding')}
              </label>
              <div className="flex flex-wrap gap-2">
                <select
                  id="role-embedding-model"
                  className={cn(selectCls, 'min-w-0 flex-1')}
                  data-testid="role-embedding-model"
                  disabled={memoryBusy || !memoryCfg}
                  value={memoryModelKey(memoryCfg?.embeddingModel)}
                  onChange={(e) => void onRoleModelChange('embeddingModel', e.target.value)}
                >
                  <option value="">{t('settings.modelConfig.roleModels.none')}</option>
                  {modelGroups.map((g) => (
                    <optgroup key={g.providerID} label={g.providerName}>
                      {g.models.map((m) => (
                        <option key={m.key} value={m.key}>
                          {m.modelID}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                  {/* Ensure recommended id is selectable even if not in chat catalog */}
                  {memoryCfg?.embeddingModel &&
                    !modelGroups.some((g) =>
                      g.models.some((m) => m.key === memoryModelKey(memoryCfg.embeddingModel)),
                    ) && (
                      <option value={memoryModelKey(memoryCfg.embeddingModel)}>
                        {memoryCfg.embeddingModel.modelID}
                      </option>
                    )}
                </select>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={memoryBusy || !memoryCfg}
                  data-testid="role-embedding-recommend"
                  onClick={() => void onRecommendEmbedding()}
                >
                  {t('settings.modelConfig.roleModels.useRecommended')}
                </Button>
              </div>
              <p className="mt-1 text-caption text-ink-tertiary">
                {t('settings.modelConfig.roleModels.embeddingHint')}
              </p>
            </div>

            <div>
              <label className="mb-1 block text-meta text-ink-secondary" htmlFor="role-rerank-model">
                {t('settings.modelConfig.roleModels.rerank')}
              </label>
              <select
                id="role-rerank-model"
                className={selectCls}
                data-testid="role-rerank-model"
                disabled={memoryBusy || !memoryCfg}
                value={memoryModelKey(memoryCfg?.rerankModel)}
                onChange={(e) => void onRoleModelChange('rerankModel', e.target.value)}
              >
                <option value="">{t('settings.modelConfig.roleModels.noneOptional')}</option>
                {modelGroups.map((g) => (
                  <optgroup key={g.providerID} label={g.providerName}>
                    {g.models.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.modelID}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
        </section>

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
