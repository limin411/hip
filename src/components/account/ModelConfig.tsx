import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { MemoryFileConfig, MemoryModelRef, ProvidersConfig } from '@hip/protocol'
import { useProvidersStore } from '@/store/providersStore'
import type { Catalog } from '@/ipc/catalog'
import { groupProviders } from '@/lib/providerGroups'
import {
  canRecommendEmbedding,
  RECOMMENDED_EMBEDDING_MODEL_ID,
} from '@/lib/memoryModelRef'
import { sessionService } from '@/domain'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { CurrentModelHero, type ModelPurpose } from './CurrentModelHero'
import { ProviderList } from './ProviderList'
import { ProviderDetail } from './ProviderDetail'
import { AddProviderDialog } from './AddProviderDialog'

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
  const [purpose, setPurpose] = useState<ModelPurpose>('base')
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
      // Memory role models are optional UI; leave unset on failure.
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
  const activeId =
    selected ?? config.activeModel?.providerID ?? groups.configured[0]?.id ?? groups.available[0]?.id ?? null
  const active = activeId ? catalog[activeId] : undefined
  const am = config.activeModel
  const emb = memoryCfg?.embeddingModel
  const rr = memoryCfg?.rerankModel

  const hero =
    purpose === 'base'
      ? {
          providerName: am ? (catalog[am.providerID]?.name ?? am.providerID) : null,
          modelID: am?.modelID ?? null,
          model: am ? catalog[am.providerID]?.models[am.modelID] : undefined,
          keyConfigured: am ? !!keyConfigured[am.providerID] : false,
          locateId: am?.providerID,
        }
      : purpose === 'embedding'
        ? {
            providerName: emb ? (catalog[emb.providerID]?.name ?? emb.providerID) : null,
            modelID: emb?.modelID ?? null,
            model: emb ? catalog[emb.providerID]?.models[emb.modelID] : undefined,
            keyConfigured: emb ? !!keyConfigured[emb.providerID] : false,
            locateId: emb?.providerID,
          }
        : {
            providerName: rr ? (catalog[rr.providerID]?.name ?? rr.providerID) : null,
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
    const ref: MemoryModelRef = {
      providerID: activeId,
      modelID,
      ...(baseURL ? { baseURL } : {}),
    }
    if (purpose === 'embedding') await applyMemory({ embeddingModel: ref })
    else await applyMemory({ rerankModel: ref })
  }

  const isActive = (modelID: string) => {
    if (purpose === 'base') return am?.providerID === activeId && am?.modelID === modelID
    if (purpose === 'embedding') return emb?.providerID === activeId && emb?.modelID === modelID
    return rr?.providerID === activeId && rr?.modelID === modelID
  }

  const onRecommendEmbedding = async () => {
    if (!am || !canRecommendEmbedding(am.providerID, catalog)) {
      toast.message(t('settings.modelConfig.recommendEmbeddingUnavailable'))
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

  const roleActions =
    purpose === 'embedding' ? (
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="secondary"
          disabled={memoryBusy || !memoryCfg}
          data-testid="role-embedding-recommend"
          onClick={() => void onRecommendEmbedding()}
        >
          {t('settings.modelConfig.useRecommended')}
        </Button>
        {emb && (
          <Button
            size="sm"
            variant="secondary"
            disabled={memoryBusy || !memoryCfg}
            data-testid="role-embedding-clear"
            onClick={() =>
              void applyMemory({ embeddingModel: null } as unknown as Partial<MemoryFileConfig>)
            }
          >
            {t('settings.modelConfig.purpose.embedding.clear')}
          </Button>
        )}
      </div>
    ) : purpose === 'rerank' && rr ? (
      <Button
        size="sm"
        variant="secondary"
        disabled={memoryBusy || !memoryCfg}
        data-testid="role-rerank-clear"
        onClick={() =>
          void applyMemory({ rerankModel: null } as unknown as Partial<MemoryFileConfig>)
        }
      >
        {t('settings.modelConfig.purpose.rerank.clear')}
      </Button>
    ) : null

  if (!loaded) return <div className="p-6 text-meta text-ink-tertiary">…</div>

  return (
    <div className="flex h-full flex-col p-6">
      <h2 className="text-title font-semibold text-ink">{t('settings.model')}</h2>
      <p className="mt-1 text-body text-ink-secondary">{t('settings.modelConfig.intro')}</p>

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

      <div
        className="mt-5 flex min-h-0 flex-1 flex-col gap-5"
        data-testid={`model-purpose-${purpose}`}
      >
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
              isActive={isActive}
              onSaveKey={(v) => saveKey(active.id, v)}
              onClearKey={() => clearKey(active.id)}
              onSaveBaseURL={(v) => setBaseURL(active.id, v)}
              onSetEnabled={(v) => setEnabled(active.id, v)}
              onSetCurrent={onSetCurrent}
              setCurrentLabel={t(`settings.modelConfig.purpose.${purpose}.setCurrent`)}
              currentLabel={t(`settings.modelConfig.purpose.${purpose}.current`)}
              roleActions={roleActions}
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
