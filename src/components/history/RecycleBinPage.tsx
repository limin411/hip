import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquare, Code2, BookOpen, RotateCcw, Trash2, Search } from 'lucide-react'
import { sessionService } from '@/domain'
import { Button } from '@/components/ui/Button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { Pagination } from '@/components/ui/Pagination'
import { Modal } from '@/components/ui/Modal'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useTrashListStore } from '@/store/trashListStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { daysLeftInTrash, resolveTrashRetentionDays } from '@/lib/trashRetention'
import { useTrashBadgeStore } from '@/store/trashBadgeStore'
import {
  knowledgeEmptyTrash,
  knowledgeHardDeleteTrashEntry,
  knowledgeListTrash,
  knowledgePurgeExpiredTrash,
  knowledgeRestoreTrashEntry,
  type KnowledgeTrashItem,
} from '@/ipc/knowledge'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useUiStore } from '@/store/uiStore'
import { toast } from 'sonner'

const PAGE_SIZE = 20

type KindFilter = 'all' | 'chat' | 'code' | 'knowledge'

type UnifiedRow =
  | {
      key: string
      source: 'session'
      id: string
      title: string
      surface: 'chat' | 'code'
      deletedAt: number
      preview?: string
      deleteDerivedMemories: boolean
    }
  | {
      key: string
      source: 'knowledge'
      id: string
      title: string
      entityKind: KnowledgeTrashItem['kind']
      deletedAt: number
      spaceName?: string
    }

export function RecycleBinPage() {
  const { t } = useTranslation()
  const sessions = useTrashListStore((s) => s.sessions)
  const sessionsLoaded = useTrashListStore((s) => s.loaded)
  const retentionRaw = useHipConfigStore((s) => s.config.trash?.retentionDays)
  const loadHip = useHipConfigStore((s) => s.load)
  const hipLoaded = useHipConfigStore((s) => s.loaded)
  const retentionDays = resolveTrashRetentionDays(retentionRaw)

  const [knowledge, setKnowledge] = useState<KnowledgeTrashItem[]>([])
  const [knowledgeLoaded, setKnowledgeLoaded] = useState(false)
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [page, setPage] = useState(1)
  const [hardDeleteKey, setHardDeleteKey] = useState<string | null>(null)
  const [emptyOpen, setEmptyOpen] = useState(false)

  const refreshKnowledge = useCallback(async () => {
    try {
      const days = resolveTrashRetentionDays(
        useHipConfigStore.getState().config.trash?.retentionDays,
      )
      await knowledgePurgeExpiredTrash(days).catch(() => [])
      const items = await knowledgeListTrash()
      setKnowledge(items)
      useTrashBadgeStore.getState().setKnowledgeCount(items.length)
    } catch {
      setKnowledge([])
    } finally {
      setKnowledgeLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!hipLoaded) void loadHip()
  }, [hipLoaded, loadHip])

  useEffect(() => {
    sessionService.requestTrashList()
    void refreshKnowledge()
    const onFocus = () => {
      sessionService.requestTrashList()
      void refreshKnowledge()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshKnowledge])

  const rows = useMemo<UnifiedRow[]>(() => {
    const sessionRows: UnifiedRow[] = sessions.map((s) => ({
      key: `session:${s.id}`,
      source: 'session' as const,
      id: s.id,
      title: s.title,
      surface: s.surface,
      deletedAt: s.deletedAt,
      preview: s.preview,
      deleteDerivedMemories: s.deleteDerivedMemories,
    }))
    const knowledgeRows: UnifiedRow[] = knowledge.map((k) => ({
      key: `knowledge:${k.id}`,
      source: 'knowledge' as const,
      id: k.id,
      title: k.title,
      entityKind: k.kind,
      deletedAt: k.deletedAt,
      spaceName: k.spaceName,
    }))
    return [...sessionRows, ...knowledgeRows].sort((a, b) => b.deletedAt - a.deletedAt)
  }, [sessions, knowledge])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = rows
    if (kindFilter === 'chat' || kindFilter === 'code') {
      list = list.filter((r) => r.source === 'session' && r.surface === kindFilter)
    } else if (kindFilter === 'knowledge') {
      list = list.filter((r) => r.source === 'knowledge')
    }
    if (q) {
      list = list.filter((r) => {
        if (r.title.toLowerCase().includes(q)) return true
        if (r.source === 'session' && (r.preview ?? '').toLowerCase().includes(q)) return true
        if (r.source === 'knowledge' && (r.spaceName ?? '').toLowerCase().includes(q)) return true
        return false
      })
    }
    return list
  }, [rows, query, kindFilter])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const paged = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  const loaded = sessionsLoaded && knowledgeLoaded
  const hardTarget = hardDeleteKey
    ? filtered.find((r) => r.key === hardDeleteKey) ?? rows.find((r) => r.key === hardDeleteKey) ?? null
    : null

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-5" data-testid="recycle-bin-page">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-display font-semibold text-ink">{t('trash.title')}</h2>
        {rows.length > 0 && (
          <Button variant="danger" size="sm" onClick={() => setEmptyOpen(true)}>
            {t('trash.empty')}
          </Button>
        )}
      </div>
      <p className="mb-4 text-meta text-ink-tertiary">
        {t('trash.subtitle', { retentionDays })}
      </p>
      <p className="mb-4 text-meta text-ink-tertiary">
        {t('trash.memoryTrashNote')}{' '}
        <button
          type="button"
          className="text-accent-strong underline-offset-2 hover:underline"
          data-testid="recycle-bin-memory-settings-link"
          onClick={() => {
            useUiStore.getState().setSettingsPage('memory')
            useUiStore.getState().setActiveView('settings')
          }}
        >
          {t('trash.openMemorySettings')}
        </button>
      </p>

      <div className="relative mb-5 max-w-md">
        <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(1)
          }}
          placeholder={t('trash.searchPlaceholder')}
          className="h-9 w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-body text-ink transition-[border-color,box-shadow] duration-chrome placeholder:text-ink-tertiary focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/10"
        />
      </div>

      <div className="mb-4" data-testid="recycle-bin-toolbar">
        <Tabs
          value={kindFilter}
          onValueChange={(v) => {
            setKindFilter(v as KindFilter)
            setPage(1)
          }}
        >
          <TabsList className="h-9 gap-2">
            <TabsTrigger className="px-4" value="all">
              {t('trash.filterAll')}
            </TabsTrigger>
            <TabsTrigger className="px-4" value="chat">
              {t('trash.filterChat')}
            </TabsTrigger>
            <TabsTrigger className="px-4" value="code">
              {t('trash.filterCode')}
            </TabsTrigger>
            <TabsTrigger className="px-4" value="knowledge">
              {t('trash.filterKnowledge')}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {!loaded ? (
        <p className="text-body text-ink-tertiary">{t('common.loading', { defaultValue: 'Loading…' })}</p>
      ) : filtered.length === 0 ? (
        <p className="py-12 text-center text-body text-ink-tertiary" data-testid="recycle-bin-empty">
          {t('trash.emptyState')}
        </p>
      ) : (
        <>
          <div className="divide-y divide-border/80 overflow-hidden rounded-lg border border-border/80 bg-surface">
            {paged.map((row) => {
              const left = daysLeftInTrash(row.deletedAt, retentionDays)
              const Icon =
                row.source === 'knowledge'
                  ? BookOpen
                  : row.surface === 'chat'
                    ? MessageSquare
                    : Code2
              const kindLabel =
                row.source === 'knowledge'
                  ? t(`trash.kind.${row.entityKind}`, { defaultValue: row.entityKind })
                  : t(`nav.${row.surface}`)
              return (
                <div
                  key={row.key}
                  className="flex items-center gap-3 px-4 py-3 transition-colors duration-chrome hover:bg-state-hover/60"
                  data-testid="recycle-bin-row"
                  data-row-key={row.key}
                >
                  <Icon size={16} strokeWidth={1.75} className="shrink-0 text-ink-tertiary" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-body font-medium text-ink">{row.title}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-meta text-ink-tertiary">
                      <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-caption font-medium text-ink-secondary">
                        {kindLabel}
                      </span>
                      <span>{t('trash.daysLeft', { days: left })}</span>
                      {row.source === 'session' && row.preview ? (
                        <span className="truncate">{row.preview}</span>
                      ) : null}
                      {row.source === 'knowledge' && row.spaceName ? (
                        <span className="truncate">{row.spaceName}</span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        if (row.source === 'session') {
                          sessionService.restoreSession(row.id)
                          useTrashListStore.getState().removeSession(row.id)
                          useTrashBadgeStore.getState().adjustSessions(-1)
                        } else {
                          void knowledgeRestoreTrashEntry(row.id)
                            .then(async () => {
                              setKnowledge((k) => k.filter((x) => x.id !== row.id))
                              useTrashBadgeStore.getState().adjustKnowledge(-1)
                              toast.success(t('trash.restoredToast'))
                              await useKnowledgeStore.getState().loadSpaces()
                            })
                            .catch((e) => {
                              const msg = e instanceof Error ? e.message : String(e)
                              if (msg.includes('parent_missing')) {
                                toast.error(t('trash.parentMissing'))
                              } else {
                                toast.error(msg)
                              }
                            })
                        }
                      }}
                    >
                      <RotateCcw size={14} className="mr-1" />
                      {t('trash.restore')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-ink-secondary hover:text-danger"
                      title={t('trash.deleteForever')}
                      aria-label={t('trash.deleteForever')}
                      onClick={() => setHardDeleteKey(row.key)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
          {totalPages > 1 && (
            <div className="mt-4">
              <Pagination currentPage={safePage} totalPages={totalPages} onChange={setPage} />
            </div>
          )}
        </>
      )}

      {hardTarget && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setHardDeleteKey(null)
          }}
          title={t('trash.deleteForeverTitle', { title: hardTarget.title })}
          className="max-w-sm"
        >
          <div className="p-5">
            <DialogPrimitive.Description className="text-body text-ink-secondary">
              {t('trash.deleteForeverBody')}
            </DialogPrimitive.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setHardDeleteKey(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  if (hardTarget.source === 'session') {
                    sessionService.hardDeleteSession(hardTarget.id, {
                      deleteDerivedMemories: hardTarget.deleteDerivedMemories,
                      reason: 'trash-permanent',
                      meta: { source: 'RecycleBinPage' },
                    })
                    useTrashListStore.getState().removeSession(hardTarget.id)
                  } else {
                    void knowledgeHardDeleteTrashEntry(hardTarget.id)
                      .then(() => {
                        setKnowledge((k) => k.filter((x) => x.id !== hardTarget.id))
                        useTrashBadgeStore.getState().adjustKnowledge(-1)
                      })
                      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
                  }
                  setHardDeleteKey(null)
                }}
              >
                {t('trash.deleteForever')}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {emptyOpen && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setEmptyOpen(false)
          }}
          title={t('trash.emptyConfirmTitle')}
          className="max-w-sm"
        >
          <div className="p-5">
            <DialogPrimitive.Description className="text-body text-ink-secondary">
              {t('trash.emptyConfirmBody', { count: rows.length })}
            </DialogPrimitive.Description>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEmptyOpen(false)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  sessionService.emptySessionTrash()
                  useTrashListStore.getState().clear()
                  useTrashBadgeStore.getState().setSessionCount(0)
                  void knowledgeEmptyTrash()
                    .then(() => {
                      setKnowledge([])
                      useTrashBadgeStore.getState().setKnowledgeCount(0)
                    })
                    .catch(() => {})
                  setEmptyOpen(false)
                }}
              >
                {t('trash.empty')}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
