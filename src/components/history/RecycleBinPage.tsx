import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MessageSquare,
  Code2,
  BookOpen,
  ListTodo,
  Zap,
  RotateCcw,
  Trash2,
  Search,
  SearchX,
} from 'lucide-react'
import { sessionService } from '@/domain'
import { Button } from '@/components/ui/Button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { Pagination } from '@/components/ui/Pagination'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton } from '@/components/ui/Skeleton'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useTrashListStore } from '@/store/trashListStore'
import { useHipConfigStore } from '@/store/hipConfigStore'
import { daysLeftInTrash, resolveTrashRetentionDays } from '@/lib/trashRetention'
import { formatAbsolute, formatRelativeTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { useTrashBadgeStore } from '@/store/trashBadgeStore'
import {
  knowledgeEmptyTrash,
  knowledgeHardDeleteTrashEntry,
  knowledgeListTrash,
  knowledgePurgeExpiredTrash,
  knowledgeRestoreTrashEntry,
  type KnowledgeTrashItem,
} from '@/ipc/knowledge'
import {
  emptyWorkItemsTrash,
  hardDeleteWorkItemTrashEntry,
  listWorkItemsTrash,
  purgeExpiredWorkItemsTrash,
  type WorkItemTrashItem,
} from '@/ipc/workItems'
import {
  emptyAutomationsTrash,
  hardDeleteAutomationTrashEntry,
  listAutomationsTrash,
  purgeExpiredAutomationsTrash,
  type AutomationTrashItem,
} from '@/ipc/automations'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useWorkItemStore } from '@/store/workItemStore'
import { useAutomationStore } from '@/store/automationStore'
import { useUiStore } from '@/store/uiStore'
import { toast } from 'sonner'
import { DeclarativeContextMenu } from '@/components/context-menu'

/** Show pagination when total items exceed one page. */
const PAGE_SIZE = 10

type KindFilter = 'all' | 'chat' | 'code' | 'knowledge' | 'workItems' | 'automations'

type UnifiedRow =
  | {
      key: string
      source: 'session'
      id: string
      title: string
      surface: 'chat' | 'code' | 'terminal'
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
  | {
      key: string
      source: 'workItem'
      id: string
      title: string
      deletedAt: number
      status: string
    }
  | {
      key: string
      source: 'automation'
      id: string
      title: string
      deletedAt: number
      triggerKind: string
    }

export function RecycleBinPage({
  embeddedInShell = false,
}: {
  /** When true, suppress page-level h2 (shell Modal already shows title). */
  embeddedInShell?: boolean
} = {}) {
  const { t, i18n } = useTranslation()
  const overlay = useUiStore((s) => s.overlay)
  const confirmNested = overlay != null
  const sessions = useTrashListStore((s) => s.sessions)
  const sessionsLoaded = useTrashListStore((s) => s.loaded)
  const retentionRaw = useHipConfigStore((s) => s.config.trash?.retentionDays)
  const loadHip = useHipConfigStore((s) => s.load)
  const hipLoaded = useHipConfigStore((s) => s.loaded)
  const retentionDays = resolveTrashRetentionDays(retentionRaw)
  const locale = i18n.language || 'en'

  const [knowledge, setKnowledge] = useState<KnowledgeTrashItem[]>([])
  const [knowledgeLoaded, setKnowledgeLoaded] = useState(false)
  const [workItems, setWorkItems] = useState<WorkItemTrashItem[]>([])
  const [workItemsLoaded, setWorkItemsLoaded] = useState(false)
  const [automations, setAutomations] = useState<AutomationTrashItem[]>([])
  const [automationsLoaded, setAutomationsLoaded] = useState(false)
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

  const refreshWorkItems = useCallback(async () => {
    try {
      const days = resolveTrashRetentionDays(
        useHipConfigStore.getState().config.trash?.retentionDays,
      )
      await purgeExpiredWorkItemsTrash(days).catch(() => [])
      const items = await listWorkItemsTrash()
      setWorkItems(items)
      useTrashBadgeStore.getState().setWorkItemCount(items.length)
    } catch {
      setWorkItems([])
    } finally {
      setWorkItemsLoaded(true)
    }
  }, [])

  const refreshAutomations = useCallback(async () => {
    try {
      const days = resolveTrashRetentionDays(
        useHipConfigStore.getState().config.trash?.retentionDays,
      )
      await purgeExpiredAutomationsTrash(days).catch(() => [])
      const items = await listAutomationsTrash()
      setAutomations(items)
      useTrashBadgeStore.getState().setAutomationCount(items.length)
    } catch {
      setAutomations([])
    } finally {
      setAutomationsLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!hipLoaded) void loadHip()
  }, [hipLoaded, loadHip])

  useEffect(() => {
    sessionService.requestTrashList()
    void refreshKnowledge()
    void refreshWorkItems()
    void refreshAutomations()
    const onFocus = () => {
      sessionService.requestTrashList()
      void refreshKnowledge()
      void refreshWorkItems()
      void refreshAutomations()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refreshKnowledge, refreshWorkItems, refreshAutomations])

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
    const workItemRows: UnifiedRow[] = workItems.map((w) => ({
      key: `workItem:${w.id}`,
      source: 'workItem' as const,
      id: w.id,
      title: w.title,
      deletedAt: w.deletedAt,
      status: w.status,
    }))
    const automationRows: UnifiedRow[] = automations.map((a) => ({
      key: `automation:${a.id}`,
      source: 'automation' as const,
      id: a.id,
      title: a.name,
      deletedAt: a.deletedAt,
      triggerKind: a.triggerKind,
    }))
    return [...sessionRows, ...knowledgeRows, ...workItemRows, ...automationRows].sort(
      (a, b) => b.deletedAt - a.deletedAt,
    )
  }, [sessions, knowledge, workItems, automations])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = rows
    if (kindFilter === 'chat' || kindFilter === 'code') {
      list = list.filter((r) => r.source === 'session' && r.surface === kindFilter)
    } else if (kindFilter === 'knowledge') {
      list = list.filter((r) => r.source === 'knowledge')
    } else if (kindFilter === 'workItems') {
      list = list.filter((r) => r.source === 'workItem')
    } else if (kindFilter === 'automations') {
      list = list.filter((r) => r.source === 'automation')
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
  const loaded =
    sessionsLoaded && knowledgeLoaded && workItemsLoaded && automationsLoaded
  const hardTarget = hardDeleteKey
    ? filtered.find((r) => r.key === hardDeleteKey) ?? rows.find((r) => r.key === hardDeleteKey) ?? null
    : null

  const hasActiveFilters = kindFilter !== 'all' || query.trim().length > 0
  const clearFilters = () => {
    setKindFilter('all')
    setQuery('')
    setPage(1)
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-5" data-testid="recycle-bin-page">
      <div className="mb-2">
        {embeddedInShell ? (
          <span className="sr-only">{t('trash.title')}</span>
        ) : (
          <h2 className="text-display font-semibold text-ink">{t('trash.title')}</h2>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="relative max-w-md flex-1">
          <Search
            size={16}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary"
          />
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
            placeholder={t('trash.searchPlaceholder')}
            className="h-9 w-full rounded-sm border border-border bg-surface py-2 pl-9 pr-3 text-body text-ink transition-[border-color,box-shadow] duration-chrome placeholder:text-ink-tertiary focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/10"
          />
        </div>
        {rows.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-ink-secondary hover:text-danger"
            onClick={() => setEmptyOpen(true)}
          >
            <Trash2 size={14} className="mr-1.5" aria-hidden />
            {t('trash.empty')}
          </Button>
        )}
      </div>

      <div
        className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
        data-testid="recycle-bin-toolbar"
      >
        <Tabs
          value={kindFilter}
          onValueChange={(v) => {
            setKindFilter(v as KindFilter)
            setPage(1)
          }}
        >
          <TabsList className="h-9 max-w-full flex-wrap gap-1">
            <TabsTrigger className="px-2.5" value="all" data-testid="recycle-bin-filter-all">
              {t('trash.filterAll')}
            </TabsTrigger>
            <TabsTrigger className="px-2.5" value="chat" data-testid="recycle-bin-filter-chat">
              {t('trash.filterChat')}
            </TabsTrigger>
            <TabsTrigger className="px-2.5" value="code" data-testid="recycle-bin-filter-code">
              {t('trash.filterCode')}
            </TabsTrigger>
            <TabsTrigger
              className="px-2.5"
              value="knowledge"
              data-testid="recycle-bin-filter-knowledge"
            >
              {t('trash.filterKnowledge')}
            </TabsTrigger>
            <TabsTrigger
              className="px-2.5"
              value="workItems"
              data-testid="recycle-bin-filter-work-items"
            >
              {t('trash.filterWorkItems')}
            </TabsTrigger>
            <TabsTrigger
              className="px-2.5"
              value="automations"
              data-testid="recycle-bin-filter-automations"
            >
              {t('trash.filterAutomations')}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex shrink-0 items-center gap-3">
          {loaded && filtered.length > 0 && (
            <span className="text-caption text-ink-secondary">
              {t('trash.itemCount', { count: filtered.length })}
            </span>
          )}
          {totalPages > 1 && (
            <>
              <Pagination
                currentPage={safePage}
                totalPages={totalPages}
                onChange={setPage}
                previousLabel={t('trash.previous')}
                nextLabel={t('trash.next')}
              />
              <span className="hidden text-caption text-ink-secondary sm:inline">
                {t('trash.pageInfo', { page: safePage, total: totalPages })}
              </span>
            </>
          )}
        </div>
      </div>

      {!loaded ? (
        <div className="space-y-2 py-2" data-testid="recycle-bin-loading">
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-full rounded-lg" />
          <Skeleton className="h-12 w-4/5 rounded-lg" />
        </div>
      ) : filtered.length === 0 ? (
        rows.length === 0 ? (
          <EmptyState
            icon={Trash2}
            tier="professional"
            title={t('trash.emptyState')}
            description={t('trash.emptyStateDesc')}
            className="flex-1"
            data-testid="recycle-bin-empty"
          />
        ) : (
          <EmptyState
            icon={SearchX}
            tier="professional"
            title={t('trash.emptyFiltered')}
            description={t('trash.emptyFilteredDesc')}
            className="flex-1"
            data-testid="recycle-bin-empty-filtered"
            action={
              hasActiveFilters
                ? {
                    label: t('trash.clearFilters'),
                    onClick: clearFilters,
                    'data-testid': 'recycle-bin-clear-filters',
                  }
                : undefined
            }
          />
        )
      ) : (
        <div className="flex flex-col gap-1.5">
          {paged.map((row) => {
            const left = daysLeftInTrash(row.deletedAt, retentionDays)
            const Icon =
              row.source === 'knowledge'
                ? BookOpen
                : row.source === 'workItem'
                  ? ListTodo
                  : row.source === 'automation'
                    ? Zap
                    : row.surface === 'chat'
                      ? MessageSquare
                      : Code2
            const kindLabel =
              row.source === 'knowledge'
                ? t(`trash.kind.${row.entityKind}`, { defaultValue: row.entityKind })
                : row.source === 'workItem'
                  ? t('trash.kind.workItem')
                  : row.source === 'automation'
                    ? t('trash.kind.automation')
                    : row.surface === 'chat'
                      ? t('sidebar.nav.chats')
                      : t('sidebar.nav.projects')
            const secondary =
              row.source === 'session'
                ? row.preview
                : row.source === 'knowledge'
                  ? row.spaceName
                  : row.source === 'workItem'
                    ? t(`workItems.status.${row.status as 'todo'}`, {
                        defaultValue: row.status,
                      })
                    : t(`automation.trigger.${row.triggerKind as 'manual'}`, {
                        defaultValue: row.triggerKind,
                      })
            const deletedWhen = formatRelativeTime(row.deletedAt, locale)
            const deletedAbs = formatAbsolute(row.deletedAt, locale)
            const restoreRow = () => {
              if (row.source === 'session') {
                sessionService.restoreSession(row.id)
                useTrashListStore.getState().removeSession(row.id)
                useTrashBadgeStore.getState().adjustSessions(-1)
              } else if (row.source === 'knowledge') {
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
              } else if (row.source === 'workItem') {
                void useWorkItemStore
                  .getState()
                  .restoreTrashEntry(row.id)
                  .then(() => {
                    setWorkItems((w) => w.filter((x) => x.id !== row.id))
                    toast.success(t('trash.restoredToast'))
                  })
                  .catch((e) => {
                    toast.error(e instanceof Error ? e.message : String(e))
                  })
              } else {
                void useAutomationStore
                  .getState()
                  .restoreTrashEntry(row.id)
                  .then(() => {
                    setAutomations((a) => a.filter((x) => x.id !== row.id))
                    toast.success(t('trash.restoredToast'))
                  })
                  .catch((e) => {
                    toast.error(e instanceof Error ? e.message : String(e))
                  })
              }
            }
            return (
              <div
                key={row.key}
                data-testid="recycle-bin-row"
                data-row-key={row.key}
                data-row-source={row.source}
                className="group rounded-lg border border-border/80 bg-surface transition-colors duration-chrome hover:bg-state-hover/50"
              >
                <DeclarativeContextMenu
                  kind="trashEntry"
                  payload={{
                    key: row.key,
                    source: row.source,
                    id: row.id,
                    title: row.title,
                    onRestore: restoreRow,
                    onHardDelete: () => setHardDeleteKey(row.key),
                  }}
                  className="flex items-center gap-3 px-3 py-2.5"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-ink-tertiary">
                    <Icon size={15} strokeWidth={1.75} aria-hidden />
                  </span>
                  <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                    <span className="min-w-0 truncate text-body font-medium text-ink">
                      {row.title}
                    </span>
                    <span
                      className={
                        row.source === 'session'
                          ? row.surface === 'code'
                            ? 'shrink-0 rounded-md px-1.5 py-0.5 text-caption font-medium text-success'
                            : 'shrink-0 rounded-md px-1.5 py-0.5 text-caption font-medium text-accent'
                          : 'shrink-0 rounded-md bg-surface-muted px-1.5 py-0.5 text-caption font-medium text-ink-secondary'
                      }
                    >
                      {kindLabel}
                    </span>
                    {secondary ? (
                      <span className="min-w-0 max-w-[12rem] truncate text-meta text-ink-tertiary">
                        {secondary}
                      </span>
                    ) : null}
                  </div>
                  <div
                    className="flex shrink-0 items-center gap-2 text-meta text-ink-tertiary"
                    title={deletedAbs}
                  >
                    <span className="hidden max-w-[9rem] truncate md:inline">
                      {t('trash.deletedAt', { when: deletedWhen })}
                    </span>
                    <span className="hidden text-ink-tertiary/50 md:inline" aria-hidden>
                      ·
                    </span>
                    <span
                      className={cn(
                        'tabular-nums',
                        left <= 3
                          ? 'font-medium text-danger'
                          : left <= 7
                            ? 'text-warning'
                            : 'text-ink-tertiary',
                      )}
                    >
                      {t('trash.daysLeft', { days: left })}
                    </span>
                  </div>
                  <div
                    className={cn('flex shrink-0 items-center gap-0.5')}
                  >
                    <Button
                      variant="ghost"
                      size="sm"
                      data-testid="recycle-bin-restore"
                      onClick={restoreRow}
                    >
                      <RotateCcw size={14} className="mr-1" aria-hidden />
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
                </DeclarativeContextMenu>
              </div>
            )
          })}
        </div>
      )}

      {rows.length > 0 && (
        <p className="mt-auto pt-5 text-caption leading-relaxed text-ink-tertiary">
          {t('trash.memoryTrashNote')}{' '}
          <button
            type="button"
            className="text-accent-strong underline-offset-2 hover:underline"
            data-testid="recycle-bin-memory-settings-link"
            onClick={() => {
              void import('@/components/layout/sidebarActions').then(
                ({ openSettingsOverlay }) => openSettingsOverlay('memory'),
              )
            }}
          >
            {t('trash.openMemorySettings')}
          </button>
        </p>
      )}

      {hardTarget && (
        <Modal
          open
          onOpenChange={(open) => {
            if (!open) setHardDeleteKey(null)
          }}
          title={t('trash.deleteForeverTitle', { title: hardTarget.title })}
          variant="confirm"
          nested={confirmNested}
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
                  } else if (hardTarget.source === 'knowledge') {
                    void knowledgeHardDeleteTrashEntry(hardTarget.id)
                      .then(() => {
                        setKnowledge((k) => k.filter((x) => x.id !== hardTarget.id))
                        useTrashBadgeStore.getState().adjustKnowledge(-1)
                      })
                      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
                  } else if (hardTarget.source === 'workItem') {
                    void hardDeleteWorkItemTrashEntry(hardTarget.id)
                      .then(() => {
                        setWorkItems((w) => w.filter((x) => x.id !== hardTarget.id))
                        useTrashBadgeStore.getState().adjustWorkItems(-1)
                      })
                      .catch((e) => toast.error(e instanceof Error ? e.message : String(e)))
                  } else {
                    void hardDeleteAutomationTrashEntry(hardTarget.id)
                      .then(() => {
                        setAutomations((a) => a.filter((x) => x.id !== hardTarget.id))
                        useTrashBadgeStore.getState().adjustAutomations(-1)
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
          variant="confirm"
          nested={confirmNested}
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
                  void emptyWorkItemsTrash()
                    .then(() => {
                      setWorkItems([])
                      useTrashBadgeStore.getState().setWorkItemCount(0)
                    })
                    .catch(() => {})
                  void emptyAutomationsTrash()
                    .then(() => {
                      setAutomations([])
                      useTrashBadgeStore.getState().setAutomationCount(0)
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
