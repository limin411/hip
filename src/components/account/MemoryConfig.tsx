import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Brain,
  ChevronDown,
  ChevronRight,
  Download,
  Lightbulb,
  Pencil,
  Pin,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react'
import type {
  MemoryFileConfig,
  MemoryItem,
  MemoryKind,
  MemoryPipelineStatus,
  MemoryScope,
  MemoryStatus,
} from '@hip/protocol'
import { sessionService } from '@/domain'
import { useProvidersStore } from '@/store/providersStore'
import { groupModelOptions } from '@/lib/agentModelOptions'
import { memoryModelKey, memoryModelRefFromKey } from '@/lib/memoryModelRef'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Switch } from '@/components/ui/Switch'
import { cn } from '@/lib/utils'

const inputCls =
  'h-9 w-full rounded-md border border-border bg-surface px-2.5 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

const textareaCls =
  'w-full min-h-[120px] resize-y rounded-md border border-border bg-surface px-2.5 py-2 text-body text-ink focus:outline-none focus:ring-2 focus:ring-accent/60'

const KIND_OPTIONS: MemoryKind[] = [
  'preference',
  'convention',
  'lesson',
  'workflow',
  'profile',
]

function downloadText(filename: string, data: string, mime = 'application/x-ndjson') {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function formatRelativeTime(ts: number | undefined, t: (k: string, p?: Record<string, unknown>) => string): string {
  if (!ts) return t('settings.memory.healthNever')
  const mins = Math.max(0, Math.floor((Date.now() - ts) / 60_000))
  if (mins < 1) return t('settings.memory.healthJustNow')
  if (mins < 60) return t('settings.memory.healthMinsAgo', { n: mins })
  const hours = Math.floor(mins / 60)
  if (hours < 48) return t('settings.memory.healthHoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  return t('settings.memory.healthDaysAgo', { n: days })
}

function phase1HealthLabel(
  status: MemoryPipelineStatus,
  t: (k: string, p?: Record<string, unknown>) => string,
): string {
  const s = status.lastPhase1Status
  const reason = status.lastPhase1Reason
  if (!s) return t('settings.memory.healthNoExtractYet')
  if (s === 'succeeded') return t('settings.memory.healthExtractOk')
  if (s === 'succeeded_no_output') return t('settings.memory.healthExtractEmpty')
  if (s === 'failed') return t('settings.memory.healthExtractFailed', { reason: reason ?? 'error' })
  if (s === 'skipped') {
    if (reason === 'no_llm') return t('settings.memory.healthNoLlm')
    if (reason === 'rate_limited') return t('settings.memory.healthRateLimited')
    if (reason === 'interval_throttle') return t('settings.memory.healthInterval')
    if (reason === 'min_content') return t('settings.memory.healthMinContent')
    if (reason === 'incognito') return t('settings.memory.healthIncognito')
    if (reason === 'generate_disabled') return t('settings.memory.healthGenerateOff')
    return t('settings.memory.healthSkipped', { reason: reason ?? 'skipped' })
  }
  return t('settings.memory.healthUnknown')
}

export function MemoryConfig() {
  const { t } = useTranslation()
  const {
    catalog,
    config: providersConfig,
    keyConfigured,
    load: loadProviders,
  } = useProvidersStore()
  const [config, setConfig] = useState<MemoryFileConfig | null>(null)
  const [items, setItems] = useState<MemoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [listStatus, setListStatus] = useState<MemoryStatus>('active')
  const [editing, setEditing] = useState<MemoryItem | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [deleting, setDeleting] = useState<MemoryItem | null>(null)
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addTitle, setAddTitle] = useState('')
  const [addContent, setAddContent] = useState('')
  const [addKind, setAddKind] = useState<MemoryKind>('preference')
  const [addScope, setAddScope] = useState<MemoryScope>('global')
  const [indexStatus, setIndexStatus] = useState<{
    embedded: number
    total: number
    modelKey?: string
    vecEnabled?: boolean
  } | null>(null)
  const [reindexing, setReindexing] = useState(false)
  const [needEmbedOpen, setNeedEmbedOpen] = useState(false)
  const [pipelineStatus, setPipelineStatus] = useState<MemoryPipelineStatus | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showHowTo, setShowHowTo] = useState(true)
  const [consolidating, setConsolidating] = useState(false)
  const [consolidateMsg, setConsolidateMsg] = useState<{
    tone: 'ok' | 'warn' | 'err'
    text: string
  } | null>(null)
  /** Client-side filter over the loaded list (keeps layout stable when many items). */
  const [listQuery, setListQuery] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modelGroups = groupModelOptions(catalog, providersConfig, keyConfigured)
  const isTrash = listStatus === 'deleted'
  const hasEmbeddingModel = !!(
    config?.embeddingModel &&
    typeof config.embeddingModel === 'object' &&
    config.embeddingModel.providerID &&
    config.embeddingModel.modelID
  )

  const filteredItems = useMemo(() => {
    const q = listQuery.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => {
      const hay = `${it.title}\n${it.content}\n${it.kind}\n${it.scope}`.toLowerCase()
      return hay.includes(q)
    })
  }, [items, listQuery])

  const loadItems = useCallback(async (status: MemoryStatus) => {
    return sessionService.listMemories({ limit: 200, status })
  }, [])

  const refreshIndexStatus = useCallback(async () => {
    try {
      const status = await sessionService.getMemoryIndexStatus()
      setIndexStatus(status)
    } catch {
      setIndexStatus(null)
    }
  }, [])

  const refreshPipelineStatus = useCallback(async () => {
    try {
      const status = await sessionService.getMemoryStatus()
      setPipelineStatus(status)
    } catch {
      setPipelineStatus(null)
    }
  }, [])

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const cfg = await sessionService.getMemoryConfig()
      setConfig(cfg)
      if (cfg.useMemories || cfg.generateMemories) {
        const list = await loadItems(listStatus)
        setItems(list)
      } else {
        setItems([])
      }
      await refreshIndexStatus()
      await refreshPipelineStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [listStatus, loadItems, refreshIndexStatus, refreshPipelineStatus])

  const switchListStatus = async (status: MemoryStatus) => {
    if (status === listStatus) return
    setListStatus(status)
    setBusy(true)
    setError(null)
    try {
      const list = await loadItems(status)
      setItems(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
    void loadProviders()
  }, [refresh, loadProviders])

  useEffect(() => {
    if (!config?.generateMemories) return
    const id = window.setInterval(() => {
      void refreshPipelineStatus()
    }, 5000)
    return () => window.clearInterval(id)
  }, [config?.generateMemories, refreshPipelineStatus])

  const applyConfig = async (partial: Partial<MemoryFileConfig>) => {
    setBusy(true)
    setError(null)
    try {
      const cfg = await sessionService.setMemoryConfig(partial)
      setConfig(cfg)
      if (cfg.useMemories || cfg.generateMemories) {
        const list = await loadItems(listStatus)
        setItems(list)
      } else {
        setItems([])
      }
      await refreshPipelineStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onTogglePin = async (item: MemoryItem) => {
    setBusy(true)
    setError(null)
    try {
      const updated = await sessionService.upsertMemory({
        id: item.id,
        title: item.title,
        content: item.content,
        kind: item.kind,
        scope: item.scope,
        pinned: !item.pinned,
      })
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const openEdit = (item: MemoryItem) => {
    setEditing(item)
    setEditTitle(item.title)
    setEditContent(item.content)
  }

  const onSaveEdit = async () => {
    if (!editing) return
    const title = editTitle.trim()
    const content = editContent.trim()
    if (!title || !content) return
    setBusy(true)
    setError(null)
    try {
      const updated = await sessionService.upsertMemory({
        id: editing.id,
        title,
        content,
        kind: editing.kind,
        scope: editing.scope,
        pinned: editing.pinned,
      })
      setItems((prev) => prev.map((it) => (it.id === updated.id ? updated : it)))
      setEditing(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onSaveAdd = async () => {
    const title = addTitle.trim()
    const content = addContent.trim()
    if (!title || !content) return
    setBusy(true)
    setError(null)
    try {
      await sessionService.upsertMemory({
        title,
        content,
        kind: addKind,
        scope: addScope,
        source: 'user',
      })
      setAdding(false)
      setAddTitle('')
      setAddContent('')
      setAddKind('preference')
      setAddScope('global')
      if (listStatus !== 'active') setListStatus('active')
      const list = await loadItems('active')
      setItems(list)
      await refreshPipelineStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onConfirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    setError(null)
    try {
      await sessionService.deleteMemory(deleting.id)
      setItems((prev) => prev.filter((it) => it.id !== deleting.id))
      setDeleting(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onRestore = async (item: MemoryItem) => {
    setBusy(true)
    setError(null)
    try {
      await sessionService.restoreMemory(item.id)
      setItems((prev) => prev.filter((it) => it.id !== item.id))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onConfirmEmptyTrash = async () => {
    setBusy(true)
    setError(null)
    try {
      await sessionService.emptyMemoryTrash()
      setItems([])
      setConfirmEmptyTrash(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onExport = async () => {
    setBusy(true)
    setError(null)
    try {
      const data = await sessionService.exportMemories('jsonl')
      downloadText(`hip-memories-${new Date().toISOString().slice(0, 10)}.jsonl`, data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onImportFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const data = await file.text()
      await sessionService.importMemories(data)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const onConsolidate = async () => {
    setConsolidating(true)
    setConsolidateMsg(null)
    setError(null)
    try {
      const res = await sessionService.consolidateMemories()
      if (res.status === 'succeeded') {
        const upserted = /upserted=(\d+)/.exec(res.detail ?? '')?.[1] ?? '0'
        const archived = /archived=(\d+)/.exec(res.detail ?? '')?.[1] ?? '0'
        const extracted = /extracted=(\d+)/.exec(res.detail ?? '')?.[1]
        setConsolidateMsg({
          tone: 'ok',
          text:
            extracted && extracted !== '0'
              ? t('settings.memory.consolidateOkExtracted', {
                  upserted,
                  archived,
                  extracted,
                })
              : t('settings.memory.consolidateOk', { upserted, archived }),
        })
        // Always refresh so new items / status strip update after dogfood learn.
        await refresh()
      } else if (res.status === 'noop') {
        const detail = res.detail ?? 'skipped'
        // Detail may be "no_stage1;upserted=0;...;phase1Reason=no_eligible_session"
        const primary = detail.split(';')[0] ?? detail
        const phase1Reason = /phase1Reason=([^;]+)/.exec(detail)?.[1]
        let key: string
        if (primary === 'no_stage1' || detail.includes('no_stage1')) {
          if (phase1Reason === 'no_llm' || detail.includes('phase1Reason=no_llm')) {
            key = 'settings.memory.consolidateNoLlm'
          } else if (phase1Reason === 'no_eligible_session') {
            key = 'settings.memory.consolidateNoEligibleSession'
          } else if (phase1Reason === 'rate_limited') {
            key = 'settings.memory.consolidateRateLimited'
          } else {
            key = 'settings.memory.consolidateNoStage1'
          }
        } else if (primary === 'no_llm') {
          key = 'settings.memory.consolidateNoLlm'
        } else {
          key = 'settings.memory.consolidateNoop'
        }
        setConsolidateMsg({
          tone: 'warn',
          text: t(key, { reason: phase1Reason ?? primary }),
        })
        await refreshPipelineStatus()
      } else {
        setConsolidateMsg({
          tone: 'err',
          text: t('settings.memory.consolidateFailed', {
            reason: res.detail ?? 'error',
          }),
        })
        await refreshPipelineStatus()
      }
    } catch (e) {
      setConsolidateMsg({
        tone: 'err',
        text: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setConsolidating(false)
    }
  }

  const onReindex = async () => {
    if (!hasEmbeddingModel) {
      setNeedEmbedOpen(true)
      return
    }
    setReindexing(true)
    setError(null)
    try {
      await sessionService.reindexMemories()
      await refreshIndexStatus()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setReindexing(false)
    }
  }

  const onHybridChange = (v: boolean) => {
    if (v && !hasEmbeddingModel) {
      setNeedEmbedOpen(true)
      return
    }
    void applyConfig({ hybridSearchEnabled: v })
  }

  const onExtractModelChange = async (key: string) => {
    if (!key) {
      await applyConfig({ extractModel: null } as unknown as Partial<MemoryFileConfig>)
      return
    }
    const slash = key.indexOf('/')
    const providerID = slash > 0 ? key.slice(0, slash) : ''
    const baseURL =
      (providerID && providersConfig.providers[providerID]?.baseURL) ||
      (providerID && catalog[providerID]?.api) ||
      undefined
    const ref = memoryModelRefFromKey(key, baseURL)
    if (ref) await applyConfig({ extractModel: ref })
  }

  // Extra bottom padding: long / expanded content scrolls inside SettingsPanel;
  // plain p-6 leaves the last block flush against the pane edge.
  const rootCls = 'space-y-6 px-6 pt-6 pb-20'

  if (loading && !config) {
    return (
      <div className="px-6 pt-6 pb-20">
        <h2 className="text-title font-semibold text-ink">{t('settings.memory.title')}</h2>
        <p className="mt-2 text-body text-ink-secondary">{t('settings.memory.loading')}</p>
      </div>
    )
  }

  const bothOff = config !== null && !config.useMemories && !config.generateMemories

  if (bothOff) {
    return (
      <div className={rootCls} data-testid="memory-config-empty">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
            <Brain size={20} />
          </span>
          <div>
            <h2 className="text-title font-semibold text-ink">{t('settings.memory.title')}</h2>
            <p className="mt-1 text-body text-ink-secondary">{t('settings.memory.introPlain')}</p>
          </div>
        </div>

        <div
          className="rounded-xl border border-border bg-surface-muted/40 px-4 py-4"
          data-testid="memory-howto-empty"
        >
          <div className="mb-2 flex items-center gap-2 text-prose font-medium text-ink">
            <Lightbulb size={16} className="text-accent" />
            {t('settings.memory.howtoTitle')}
          </div>
          <ol className="list-decimal space-y-2 pl-5 text-body text-ink-secondary">
            <li>{t('settings.memory.howtoStep1')}</li>
            <li>{t('settings.memory.howtoStep2')}</li>
            <li>{t('settings.memory.howtoStep3')}</li>
          </ol>
          <p className="mt-3 text-meta text-ink-tertiary">{t('settings.memory.howtoTip')}</p>
        </div>

        {error && (
          <p className="text-body text-danger" role="alert">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            data-testid="memory-enable-both"
            onClick={() => void applyConfig({ useMemories: true, generateMemories: true })}
          >
            {t('settings.memory.enableBothRecommended')}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            data-testid="memory-enable-use-only"
            onClick={() => void applyConfig({ useMemories: true, generateMemories: false })}
          >
            {t('settings.memory.enableUseOnly')}
          </Button>
        </div>
        <p className="text-caption text-ink-tertiary">{t('settings.memory.enableBothHint')}</p>
      </div>
    )
  }

  return (
    <div className={rootCls} data-testid="memory-config">
      {/* Header */}
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Brain size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-title font-semibold text-ink">{t('settings.memory.title')}</h2>
          <p className="mt-1 text-body text-ink-secondary">{t('settings.memory.introPlain')}</p>
        </div>
      </div>

      {/* How to use (collapsible) */}
      <section
        className="rounded-xl border border-border bg-surface-muted/30"
        data-testid="memory-howto"
      >
        <button
          type="button"
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-prose font-medium text-ink"
          onClick={() => setShowHowTo((v) => !v)}
          data-testid="memory-howto-toggle"
        >
          {showHowTo ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Lightbulb size={16} className="text-accent" />
          {t('settings.memory.howtoTitle')}
        </button>
        {showHowTo && (
          <div className="space-y-3 border-t border-border px-4 py-3 text-body text-ink-secondary">
            <ol className="list-decimal space-y-2 pl-5">
              <li>{t('settings.memory.howtoStep1On')}</li>
              <li>{t('settings.memory.howtoStep2On')}</li>
              <li>{t('settings.memory.howtoStep3On')}</li>
            </ol>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="rounded-lg border border-border bg-surface px-3 py-2">
                <div className="text-meta font-medium text-ink">{t('settings.memory.useMemories')}</div>
                <p className="mt-0.5 text-caption text-ink-tertiary">{t('settings.memory.useMemoriesPlain')}</p>
              </div>
              <div className="rounded-lg border border-border bg-surface px-3 py-2">
                <div className="text-meta font-medium text-ink">{t('settings.memory.generateMemories')}</div>
                <p className="mt-0.5 text-caption text-ink-tertiary">{t('settings.memory.generateMemoriesPlain')}</p>
              </div>
            </div>
            <p className="text-caption text-ink-tertiary">{t('settings.memory.howtoTipOn')}</p>
          </div>
        )}
      </section>

      {/* Health / status in plain language */}
      {pipelineStatus && (
        <section
          className="rounded-xl border border-border bg-surface px-4 py-3"
          data-testid="memory-status-strip"
        >
          <div className="text-meta font-medium text-ink">{t('settings.memory.healthTitle')}</div>
          <ul className="mt-2 space-y-1.5 text-body text-ink-secondary">
            <li>
              {t('settings.memory.healthCount', {
                n: pipelineStatus.itemCounts.active,
              })}
            </li>
            {config?.generateMemories && (
              <>
                <li>{phase1HealthLabel(pipelineStatus, t)}</li>
                <li>
                  {t('settings.memory.healthLastRun', {
                    when: formatRelativeTime(pipelineStatus.lastPhase1At, t),
                  })}
                </li>
                <li>
                  {t('settings.memory.healthQuota', {
                    today: pipelineStatus.extractsToday,
                    max: pipelineStatus.maxExtractsPerDay,
                  })}
                </li>
              </>
            )}
          </ul>
          {!pipelineStatus.llmAvailable && config?.generateMemories && (
            <p className="mt-2 text-meta text-warning" data-testid="memory-no-llm-cta">
              {t('settings.memory.noLlmCta')}
            </p>
          )}
          {pipelineStatus.mirrorDesync && (
            <p className="mt-2 text-meta text-warning">{t('settings.memory.mirrorDesync')}</p>
          )}
        </section>
      )}

      {error && (
        <p className="text-body text-danger" role="alert">
          {error}
        </p>
      )}

      {/* Core switches */}
      <section className="divide-y divide-border rounded-xl border border-border">
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-prose font-medium text-ink">{t('settings.memory.useMemories')}</div>
            <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.memory.useMemoriesPlain')}</div>
          </div>
          <Switch
            checked={!!config?.useMemories}
            disabled={busy || !config}
            ariaLabel={t('settings.memory.useMemories')}
            data-testid="memory-switch-use"
            onCheckedChange={(v) => void applyConfig({ useMemories: v })}
          />
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0 flex-1">
            <div className="text-prose font-medium text-ink">{t('settings.memory.generateMemories')}</div>
            <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.memory.generateMemoriesPlain')}</div>
            <div className="mt-1 text-caption text-ink-tertiary" data-testid="memory-generate-cost-hint">
              {t('settings.memory.generateMemoriesCostHint', {
                max: config?.maxExtractsPerDay ?? 20,
              })}
            </div>
          </div>
          <Switch
            checked={!!config?.generateMemories}
            disabled={busy || !config}
            ariaLabel={t('settings.memory.generateMemories')}
            data-testid="memory-switch-generate"
            onCheckedChange={(v) => void applyConfig({ generateMemories: v })}
          />
        </div>
      </section>

      {/* Memory list — primary content (scrolls internally when long) */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-prose font-medium text-ink">
              {t('settings.memory.listTitle')}
              {items.length > 0 && (
                <span
                  className="ml-2 text-meta font-normal text-ink-tertiary"
                  data-testid="memory-list-count"
                >
                  {listQuery.trim()
                    ? t('settings.memory.listCountFiltered', {
                        shown: filteredItems.length,
                        total: items.length,
                      })
                    : t('settings.memory.listCount', { n: items.length })}
                </span>
              )}
            </h3>
            <p className="mt-0.5 text-caption text-ink-tertiary">{t('settings.memory.listHint')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {!isTrash && (
              <Button
                size="sm"
                disabled={busy}
                data-testid="memory-add"
                onClick={() => setAdding(true)}
              >
                <Plus size={14} />
                {t('settings.memory.add')}
              </Button>
            )}
            <div
              className="flex flex-wrap gap-1.5"
              data-testid="memory-list-filters"
              role="group"
              aria-label={t('settings.memory.listFilters')}
            >
              <button
                type="button"
                data-testid="memory-filter-active"
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-caption font-medium transition-colors',
                  listStatus === 'active'
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border bg-surface text-ink-secondary hover:bg-surface-muted',
                )}
                aria-pressed={listStatus === 'active'}
                disabled={busy}
                onClick={() => {
                  setListQuery('')
                  void switchListStatus('active')
                }}
              >
                {t('settings.memory.filterActive')}
              </button>
              <button
                type="button"
                data-testid="memory-filter-trash"
                className={cn(
                  'rounded-full border px-2.5 py-0.5 text-caption font-medium transition-colors',
                  isTrash
                    ? 'border-accent/40 bg-accent/10 text-accent'
                    : 'border-border bg-surface text-ink-secondary hover:bg-surface-muted',
                )}
                aria-pressed={isTrash}
                disabled={busy}
                onClick={() => {
                  setListQuery('')
                  void switchListStatus('deleted')
                }}
              >
                {t('settings.memory.filterTrash')}
              </button>
            </div>
            {isTrash && items.length > 0 && (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                data-testid="memory-empty-trash"
                onClick={() => setConfirmEmptyTrash(true)}
              >
                {t('settings.memory.emptyTrash')}
              </Button>
            )}
          </div>
        </div>

        {items.length > 0 && (
          <div className="relative mt-3">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary"
              aria-hidden
            />
            <input
              type="search"
              className={cn(inputCls, 'pl-8')}
              value={listQuery}
              data-testid="memory-list-search"
              placeholder={t('settings.memory.listSearchPlaceholder')}
              aria-label={t('settings.memory.listSearchPlaceholder')}
              onChange={(e) => setListQuery(e.target.value)}
            />
          </div>
        )}

        {items.length === 0 ? (
          <div
            className="mt-3 rounded-xl border border-dashed border-border bg-surface-muted/20 px-4 py-6 text-center"
            data-testid="memory-list-empty"
          >
            <p className="text-body text-ink-secondary">
              {isTrash ? t('settings.memory.listEmptyTrash') : t('settings.memory.listEmptyGuide')}
            </p>
            {!isTrash && (
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <Button size="sm" disabled={busy} onClick={() => setAdding(true)} data-testid="memory-add-empty">
                  <Plus size={14} />
                  {t('settings.memory.add')}
                </Button>
                {config?.generateMemories && (
                  <p className="w-full text-caption text-ink-tertiary">{t('settings.memory.listEmptyAutoHint')}</p>
                )}
              </div>
            )}
          </div>
        ) : filteredItems.length === 0 ? (
          <div
            className="mt-3 rounded-xl border border-dashed border-border px-4 py-5 text-center"
            data-testid="memory-list-no-match"
          >
            <p className="text-body text-ink-secondary">{t('settings.memory.listNoMatch')}</p>
          </div>
        ) : (
          <div
            className="mt-3 overflow-hidden rounded-xl border border-border"
            data-testid="memory-list-frame"
          >
            <ul
              className="max-h-[min(28rem,55vh)] divide-y divide-border overflow-y-auto overscroll-contain"
              data-testid="memory-list"
            >
              {filteredItems.map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-2 px-3 py-2.5"
                  data-testid={`memory-item-${item.id}`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {item.pinned && !isTrash && (
                        <Pin
                          size={12}
                          className="shrink-0 text-accent"
                          aria-hidden
                          data-testid={`memory-pinned-badge-${item.id}`}
                        />
                      )}
                      <div className="truncate text-body font-medium text-ink">{item.title}</div>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-caption text-ink-secondary">{item.content}</p>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-caption text-ink-tertiary">
                      <span>{t(`settings.memory.kind.${item.kind}`, { defaultValue: item.kind })}</span>
                      <span>·</span>
                      <span>{t(`settings.memory.scope.${item.scope}`, { defaultValue: item.scope })}</span>
                      {item.expiresAt != null && item.expiresAt > Date.now() && (
                        <>
                          <span>·</span>
                          <span data-testid={`memory-expires-${item.id}`}>
                            {(() => {
                              const days = Math.max(
                                0,
                                Math.ceil((item.expiresAt! - Date.now()) / 86_400_000),
                              )
                              return days <= 14
                                ? t('settings.memory.expiresSoon', { n: days })
                                : t('settings.memory.expiresOn', {
                                    date: new Date(item.expiresAt!).toISOString().slice(0, 10),
                                  })
                            })()}
                          </span>
                        </>
                      )}
                      {item.agentId && (
                        <>
                          <span>·</span>
                          <span className="truncate" title={item.agentId}>
                            agent:{item.agentId}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5">
                    {isTrash ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="shrink-0 text-ink-secondary"
                        disabled={busy}
                        aria-label={t('settings.memory.restore')}
                        data-testid={`memory-restore-${item.id}`}
                        onClick={() => void onRestore(item)}
                      >
                        <RotateCcw size={15} />
                      </Button>
                    ) : (
                      <>
                        <Button
                          size="icon"
                          variant="ghost"
                          className={cn('shrink-0', item.pinned ? 'text-accent' : 'text-ink-secondary')}
                          disabled={busy}
                          aria-label={item.pinned ? t('settings.memory.unpin') : t('settings.memory.pin')}
                          aria-pressed={item.pinned}
                          data-testid={`memory-pin-${item.id}`}
                          onClick={() => void onTogglePin(item)}
                        >
                          <Pin size={15} fill={item.pinned ? 'currentColor' : 'none'} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="shrink-0 text-ink-secondary"
                          disabled={busy}
                          aria-label={t('settings.memory.edit')}
                          data-testid={`memory-edit-${item.id}`}
                          onClick={() => openEdit(item)}
                        >
                          <Pencil size={15} />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="shrink-0 text-ink-secondary hover:text-danger"
                          disabled={busy}
                          aria-label={t('settings.memory.delete')}
                          data-testid={`memory-delete-${item.id}`}
                          onClick={() => setDeleting(item)}
                        >
                          <Trash2 size={15} />
                        </Button>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {items.length >= 200 && (
              <p className="border-t border-border px-3 py-2 text-caption text-ink-tertiary" data-testid="memory-list-cap">
                {t('settings.memory.listCapHint')}
              </p>
            )}
          </div>
        )}
      </section>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={busy} data-testid="memory-export" onClick={() => void onExport()}>
          <Download size={14} />
          {t('settings.memory.exportJsonl')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          data-testid="memory-import"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload size={14} />
          {t('settings.memory.importJsonl')}
        </Button>
        {config?.generateMemories && (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy || consolidating}
            data-testid="memory-consolidate"
            onClick={() => void onConsolidate()}
          >
            {consolidating ? t('settings.memory.consolidating') : t('settings.memory.consolidate')}
          </Button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".jsonl,application/x-ndjson,text/plain"
          className="hidden"
          data-testid="memory-import-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void onImportFile(f)
          }}
        />
      </div>
      {config?.generateMemories && (
        <div className="space-y-1">
          <p className="text-caption text-ink-tertiary">{t('settings.memory.consolidateHint')}</p>
          {consolidateMsg && (
            <p
              className={cn(
                'text-meta',
                consolidateMsg.tone === 'ok' && 'text-ink-secondary',
                consolidateMsg.tone === 'warn' && 'text-warning',
                consolidateMsg.tone === 'err' && 'text-danger',
              )}
              data-testid="memory-consolidate-result"
              role="status"
            >
              {consolidateMsg.text}
            </p>
          )}
        </div>
      )}

      {/* Advanced — collapsed by default */}
      <section className="rounded-xl border border-border" data-testid="memory-advanced-section">
        <button
          type="button"
          className="flex w-full items-center gap-2 px-4 py-3 text-left text-prose font-medium text-ink"
          data-testid="memory-advanced-toggle"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          {t('settings.memory.advancedTitle')}
        </button>
        {showAdvanced && config && (
          <div className="space-y-5 border-t border-border px-4 py-4" data-testid="memory-advanced-gates">
            <p className="text-meta text-ink-tertiary">{t('settings.memory.advancedDesc')}</p>

            <div>
              <label className="text-prose font-medium text-ink" htmlFor="memory-extract-model">
                {t('settings.memory.extractModel')}
              </label>
              <p className="mt-0.5 text-meta text-ink-tertiary">{t('settings.memory.extractModelPlain')}</p>
              <select
                id="memory-extract-model"
                className={cn(inputCls, 'mt-2')}
                value={memoryModelKey(config?.extractModel)}
                disabled={busy || !config}
                data-testid="memory-extract-model"
                onChange={(e) => void onExtractModelChange(e.target.value)}
              >
                <option value="">{t('settings.memory.extractModelDefault')}</option>
                {modelGroups.map((g) => (
                  <optgroup key={g.providerID} label={g.providerName}>
                    {g.models.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.modelID}
                      </option>
                    ))}
                  </optgroup>
                ))}
                {config?.extractModel &&
                  !modelGroups.some((g) =>
                    g.models.some((m) => m.key === memoryModelKey(config.extractModel)),
                  ) &&
                  memoryModelKey(config.extractModel).includes('/') && (
                    <option value={memoryModelKey(config.extractModel)}>
                      {memoryModelKey(config.extractModel)}
                    </option>
                  )}
              </select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  ['idleMinutes', 'idleMinutes', 'idleMinutesHint'],
                  ['minExtractIntervalHours', 'minExtractIntervalHours', 'minExtractIntervalHoursHint'],
                  ['minUserTurns', 'minUserTurns', 'minUserTurnsHint'],
                  ['minUserChars', 'minUserChars', 'minUserCharsHint'],
                  ['maxExtractsPerDay', 'maxExtractsPerDay', 'maxExtractsPerDayHint'],
                ] as const
              ).map(([key, labelKey, hintKey]) => (
                <label key={key} className="block text-meta text-ink-secondary">
                  <span className="font-medium text-ink">{t(`settings.memory.${labelKey}`)}</span>
                  <span className="mt-0.5 block text-caption text-ink-tertiary">
                    {t(`settings.memory.${hintKey}`)}
                  </span>
                  <input
                    type="number"
                    className={cn(inputCls, 'mt-1')}
                    value={config[key] ?? ''}
                    disabled={busy}
                    onChange={(e) => {
                      const n = Number(e.target.value)
                      if (!Number.isFinite(n)) return
                      void applyConfig({ [key]: n } as Partial<MemoryFileConfig>)
                    }}
                  />
                </label>
              ))}
            </div>

            <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
              <div className="min-w-0 flex-1">
                <div className="text-prose font-medium text-ink">{t('settings.memory.perAgentMemory')}</div>
                <div className="mt-0.5 text-meta text-ink-tertiary">
                  {t('settings.memory.perAgentMemoryPlain')}
                </div>
              </div>
              <Switch
                checked={!!config?.perAgentMemory}
                disabled={busy || !config}
                ariaLabel={t('settings.memory.perAgentMemory')}
                data-testid="memory-switch-per-agent"
                onCheckedChange={(v) => void applyConfig({ perAgentMemory: v })}
              />
            </div>

            {!!config?.useMemories && (
              <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
                <div className="min-w-0 flex-1">
                  <div className="text-prose font-medium text-ink">
                    {t('settings.memory.useMemoriesWithExternal')}
                  </div>
                  <div className="mt-0.5 text-meta text-ink-tertiary">
                    {t('settings.memory.useMemoriesWithExternalHint')}
                  </div>
                </div>
                <Switch
                  checked={!!config?.useMemoriesWithExternal}
                  disabled={busy || !config}
                  ariaLabel={t('settings.memory.useMemoriesWithExternal')}
                  data-testid="memory-switch-use-external"
                  onCheckedChange={(v) => void applyConfig({ useMemoriesWithExternal: v })}
                />
              </div>
            )}

            <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
              <div className="min-w-0 flex-1">
                <div className="text-prose font-medium text-ink">{t('settings.memory.hybridSearch')}</div>
                <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.memory.hybridSearchPlain')}</div>
                <p className="mt-1 text-caption text-ink-tertiary" data-testid="memory-hybrid-privacy">
                  {t('settings.memory.hybridPrivacyNote')}
                </p>
              </div>
              <Switch
                checked={!!config?.hybridSearchEnabled}
                disabled={busy || !config}
                ariaLabel={t('settings.memory.hybridSearch')}
                data-testid="memory-switch-hybrid"
                onCheckedChange={onHybridChange}
              />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 flex-1 text-meta text-ink-secondary" data-testid="memory-index-status">
                {hasEmbeddingModel && indexStatus
                  ? t('settings.memory.indexStatus', {
                      embedded: indexStatus.embedded,
                      total: indexStatus.total,
                    })
                  : t('settings.memory.indexStatusNone')}
              </div>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy || reindexing}
                data-testid="memory-reindex"
                onClick={() => void onReindex()}
              >
                {reindexing ? t('settings.memory.reindexing') : t('settings.memory.reindex')}
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* Add modal */}
      {adding && (
        <Modal
          open
          onOpenChange={(o) => {
            if (!o) setAdding(false)
          }}
          title={t('settings.memory.addTitle')}
          className="max-w-md"
        >
          <div className="space-y-3 p-5" data-testid="memory-add-modal">
            <p className="text-meta text-ink-tertiary">{t('settings.memory.addHint')}</p>
            <div>
              <label className="mb-1.5 block text-meta text-ink-tertiary" htmlFor="memory-add-title">
                {t('settings.memory.fieldTitle')}
              </label>
              <input
                id="memory-add-title"
                className={inputCls}
                value={addTitle}
                data-testid="memory-add-title"
                placeholder={t('settings.memory.addTitlePlaceholder')}
                onChange={(e) => setAddTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-meta text-ink-tertiary" htmlFor="memory-add-content">
                {t('settings.memory.fieldContent')}
              </label>
              <textarea
                id="memory-add-content"
                className={textareaCls}
                value={addContent}
                data-testid="memory-add-content"
                placeholder={t('settings.memory.addContentPlaceholder')}
                onChange={(e) => setAddContent(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-meta text-ink-tertiary">
                {t('settings.memory.fieldKind')}
                <select
                  className={cn(inputCls, 'mt-1')}
                  value={addKind}
                  data-testid="memory-add-kind"
                  onChange={(e) => setAddKind(e.target.value as MemoryKind)}
                >
                  {KIND_OPTIONS.map((k) => (
                    <option key={k} value={k}>
                      {t(`settings.memory.kind.${k}`)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-meta text-ink-tertiary">
                {t('settings.memory.fieldScope')}
                <select
                  className={cn(inputCls, 'mt-1')}
                  value={addScope}
                  data-testid="memory-add-scope"
                  onChange={(e) => setAddScope(e.target.value as MemoryScope)}
                >
                  <option value="global">{t('settings.memory.scope.global')}</option>
                  <option value="project">{t('settings.memory.scope.project')}</option>
                </select>
              </label>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setAdding(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                disabled={busy || !addTitle.trim() || !addContent.trim()}
                data-testid="memory-add-save"
                onClick={() => void onSaveAdd()}
              >
                {t('settings.memory.save')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal
          open
          onOpenChange={(o) => {
            if (!o) setEditing(null)
          }}
          title={t('settings.memory.editTitle')}
          className="max-w-md"
        >
          <div className="space-y-3 p-5">
            <div>
              <label className="mb-1.5 block text-meta text-ink-tertiary" htmlFor="memory-edit-title">
                {t('settings.memory.fieldTitle')}
              </label>
              <input
                id="memory-edit-title"
                className={inputCls}
                value={editTitle}
                data-testid="memory-edit-title"
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-meta text-ink-tertiary" htmlFor="memory-edit-content">
                {t('settings.memory.fieldContent')}
              </label>
              <textarea
                id="memory-edit-content"
                className={textareaCls}
                value={editContent}
                data-testid="memory-edit-content"
                onChange={(e) => setEditContent(e.target.value)}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                size="sm"
                disabled={busy || !editTitle.trim() || !editContent.trim()}
                data-testid="memory-edit-save"
                onClick={() => void onSaveEdit()}
              >
                {t('settings.memory.save')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {deleting && (
        <Modal
          open
          onOpenChange={(o) => {
            if (!o) setDeleting(null)
          }}
          title={t('settings.memory.deleteConfirmTitle')}
          className="max-w-sm"
        >
          <div className="p-5">
            <p className="text-body text-ink-secondary">
              {t('settings.memory.deleteConfirmBody', { title: deleting.title })}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDeleting(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                data-testid="memory-delete-confirm"
                onClick={() => void onConfirmDelete()}
              >
                {t('settings.memory.delete')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {confirmEmptyTrash && (
        <Modal
          open
          onOpenChange={(o) => {
            if (!o) setConfirmEmptyTrash(false)
          }}
          title={t('settings.memory.emptyTrashConfirmTitle')}
          className="max-w-sm"
        >
          <div className="p-5">
            <p className="text-body text-ink-secondary">{t('settings.memory.emptyTrashConfirmBody')}</p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setConfirmEmptyTrash(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={busy}
                data-testid="memory-empty-trash-confirm"
                onClick={() => void onConfirmEmptyTrash()}
              >
                {t('settings.memory.emptyTrash')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {needEmbedOpen && (
        <Modal
          open
          onOpenChange={(o) => {
            if (!o) setNeedEmbedOpen(false)
          }}
          title={t('settings.memory.hybridNeedsEmbeddingTitle')}
          className="max-w-sm"
        >
          <div className="p-5" data-testid="memory-need-embed-modal">
            <p className="text-body text-ink-secondary">{t('settings.memory.hybridNeedsEmbeddingBody')}</p>
            <div className="mt-5 flex justify-end">
              <Button size="sm" data-testid="memory-need-embed-ok" onClick={() => setNeedEmbedOpen(false)}>
                {t('common.close')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

    </div>
  )
}
