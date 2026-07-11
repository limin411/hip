import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Brain, Download, Pencil, Pin, RotateCcw, Trash2, Upload } from 'lucide-react'
import type { MemoryFileConfig, MemoryItem, MemoryStatus } from '@hip/protocol'
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

function downloadText(filename: string, data: string, mime = 'application/x-ndjson') {
  const blob = new Blob([data], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
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
  /** List filter: Active | Trash. */
  const [listStatus, setListStatus] = useState<MemoryStatus>('active')
  const [editing, setEditing] = useState<MemoryItem | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')
  const [deleting, setDeleting] = useState<MemoryItem | null>(null)
  const [confirmEmptyTrash, setConfirmEmptyTrash] = useState(false)
  const [indexStatus, setIndexStatus] = useState<{
    embedded: number
    total: number
    modelKey?: string
    vecEnabled?: boolean
  } | null>(null)
  const [reindexing, setReindexing] = useState(false)
  const [needEmbedOpen, setNeedEmbedOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const modelGroups = groupModelOptions(catalog, providersConfig, keyConfigured)
  const isTrash = listStatus === 'deleted'
  const hasEmbeddingModel = !!(
    config?.embeddingModel &&
    typeof config.embeddingModel === 'object' &&
    config.embeddingModel.providerID &&
    config.embeddingModel.modelID
  )

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
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [listStatus, loadItems, refreshIndexStatus])

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

  const onConfirmDelete = async () => {
    if (!deleting) return
    setBusy(true)
    setError(null)
    try {
      // Soft delete (hard: false / omitted) → trash semantics.
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

  const onConsolidate = () => {
    sessionService.consolidateMemories()
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
      // Clear override → cheap fallback for active provider.
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

  if (loading && !config) {
    return (
      <div className="p-6">
        <h2 className="text-title font-semibold text-ink">{t('settings.memory.title')}</h2>
        <p className="mt-2 text-body text-ink-secondary">{t('settings.memory.loading')}</p>
      </div>
    )
  }

  const bothOff = config !== null && !config.useMemories && !config.generateMemories

  if (bothOff) {
    return (
      <div className="p-6" data-testid="memory-config-empty">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
            <Brain size={18} />
          </span>
          <div>
            <h2 className="text-title font-semibold text-ink">{t('settings.memory.title')}</h2>
            <p className="mt-1 text-body text-ink-secondary">{t('settings.memory.intro')}</p>
            <p className="mt-3 text-body text-ink-tertiary">{t('settings.memory.emptyHint')}</p>
          </div>
        </div>
        {error && (
          <p className="mt-4 text-body text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy}
            data-testid="memory-enable-both"
            onClick={() => void applyConfig({ useMemories: true, generateMemories: true })}
          >
            {t('settings.memory.enableBoth')}
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
      </div>
    )
  }

  return (
    <div className="p-6" data-testid="memory-config">
      <div>
        <h2 className="text-title font-semibold text-ink">{t('settings.memory.title')}</h2>
        <p className="mt-1 text-body text-ink-secondary">{t('settings.memory.intro')}</p>
      </div>

      {error && (
        <p className="mt-4 text-body text-danger" role="alert">
          {error}
        </p>
      )}

      <div className="mt-2 divide-y divide-border border-t border-border">
        <div className="flex items-center justify-between px-0 py-5">
          <div className="min-w-0 flex-1">
            <div className="text-prose font-medium text-ink">{t('settings.memory.useMemories')}</div>
            <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.memory.useMemoriesDesc')}</div>
          </div>
          <Switch
            checked={!!config?.useMemories}
            disabled={busy || !config}
            ariaLabel={t('settings.memory.useMemories')}
            data-testid="memory-switch-use"
            onCheckedChange={(v) => void applyConfig({ useMemories: v })}
          />
        </div>
        <div className="flex items-center justify-between px-0 py-5">
          <div className="min-w-0 flex-1">
            <div className="text-prose font-medium text-ink">{t('settings.memory.generateMemories')}</div>
            <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.memory.generateMemoriesDesc')}</div>
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
      </div>

      <div className="mt-2 border-t border-border pt-5">
        <label className="text-prose font-medium text-ink" htmlFor="memory-extract-model">
          {t('settings.memory.extractModel')}
        </label>
        <p className="mt-0.5 text-meta text-ink-tertiary">{t('settings.memory.extractModelDesc')}</p>
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
          {/* Legacy free-text / missing catalog entry still displayable */}
          {config?.extractModel &&
            !modelGroups.some((g) => g.models.some((m) => m.key === memoryModelKey(config.extractModel))) &&
            memoryModelKey(config.extractModel).includes('/') && (
              <option value={memoryModelKey(config.extractModel)}>
                {memoryModelKey(config.extractModel)}
              </option>
            )}
        </select>
      </div>

      <div className="mt-2 divide-y divide-border border-t border-border">
        <div className="flex items-center justify-between px-0 py-5">
          <div className="min-w-0 flex-1">
            <div className="text-prose font-medium text-ink">{t('settings.memory.hybridSearch')}</div>
            <div className="mt-0.5 text-meta text-ink-tertiary">{t('settings.memory.hybridSearchDesc')}</div>
            <p className="mt-2 text-caption text-ink-tertiary" data-testid="memory-hybrid-privacy">
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
        <div className="flex flex-wrap items-center justify-between gap-2 px-0 py-5">
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

      <div className="mt-6 flex flex-wrap gap-2">
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
        <Button size="sm" variant="secondary" disabled={busy} data-testid="memory-consolidate" onClick={onConsolidate}>
          {t('settings.memory.consolidate')}
        </Button>
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

      <div className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-prose font-medium text-ink">{t('settings.memory.listTitle')}</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <div className="flex flex-wrap gap-1.5" data-testid="memory-list-filters" role="group" aria-label={t('settings.memory.listFilters')}>
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
                onClick={() => void switchListStatus('active')}
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
                onClick={() => void switchListStatus('deleted')}
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
        {items.length === 0 ? (
          <p className="mt-3 text-body text-ink-tertiary" data-testid="memory-list-empty">
            {isTrash ? t('settings.memory.listEmptyTrash') : t('settings.memory.listEmpty')}
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-lg border border-border" data-testid="memory-list">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-2 px-3 py-3" data-testid={`memory-item-${item.id}`}>
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
                  <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-caption text-ink-tertiary">
                    <span>{item.kind}</span>
                    <span>·</span>
                    <span>{item.scope}</span>
                    <span>·</span>
                    <span>
                      {t('settings.memory.confidence', {
                        value: Math.round(item.confidence * 100),
                      })}
                    </span>
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
        )}
      </div>

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
