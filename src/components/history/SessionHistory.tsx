import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, MessageSquare, Code2, Trash2, Inbox, SearchX } from 'lucide-react'
import { useSessions, sessionService } from '@/domain'
import { selectSessionFromSidebar } from '@/components/layout/sidebarActions'
import { isTerminalSession, surfaceOf } from '@/lib/sessions'
import { formatAbsolute, formatRelativeTime } from '@/lib/datetime'
import { Button } from '@/components/ui/Button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState } from '@/components/ui/EmptyState'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { DeleteSessionDialog } from './DeleteSessionDialog'
import { ClearAllSessionsDialog } from './ClearAllSessionsDialog'
import { auditSessionDelete, debugSessionDelete } from '@/lib/sessionDelete'

/** Show pagination when total items exceed one page. */
const PAGE_SIZE = 10

type SurfaceFilter = 'all' | 'chat' | 'code'

export function SessionHistory({
  embeddedInShell = false,
}: {
  /** When true, suppress page-level h2 (shell Modal already shows title). */
  embeddedInShell?: boolean
} = {}) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language || 'en'
  const sessions = useSessions()
  const [query, setQuery] = useState('')
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>('all')
  const [page, setPage] = useState(1)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const [clearAllOpen, setClearAllOpen] = useState(false)

  const deletingSession = useMemo(
    () => sessions.find((s) => s.id === deletingSessionId) ?? null,
    [sessions, deletingSessionId],
  )

  /** Visible history universe. */
  const listBase = useMemo(() => {
    return sessions
      .filter((s) => !isTerminalSession(s.config))
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  }, [sessions])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let result = listBase
    if (q) {
      result = result.filter(
        (s) => s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q),
      )
    }
    if (surfaceFilter !== 'all') {
      result = result.filter((s) => surfaceOf(s.config) === surfaceFilter)
    }
    return result
  }, [listBase, query, surfaceFilter])

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)),
    [filtered.length],
  )

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setPage(1)
  }

  const handleSurfaceChange = (value: SurfaceFilter) => {
    setSurfaceFilter(value)
    setPage(1)
  }

  const hasActiveFilters = surfaceFilter !== 'all' || query.trim().length > 0
  const clearFilters = () => {
    setSurfaceFilter('all')
    setQuery('')
    setPage(1)
  }

  const safePage = useMemo(() => Math.min(page, totalPages), [page, totalPages])

  const paged = useMemo(() => {
    return filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  }, [filtered, safePage])

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-5" data-testid="session-history">
      <div className="mb-2">
        {embeddedInShell ? (
          <span className="sr-only">{t('history.title')}</span>
        ) : (
          <h2 className="text-display font-semibold text-ink">{t('history.title')}</h2>
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
            onChange={(e) => handleQueryChange(e.target.value)}
            placeholder={t('history.searchPlaceholder')}
            className="h-9 w-full rounded-sm border border-border bg-surface py-2 pl-9 pr-3 text-body text-ink transition-[border-color,box-shadow] duration-chrome placeholder:text-ink-tertiary focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/10"
          />
        </div>
        {filtered.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 text-ink-secondary hover:text-danger"
            onClick={() => setClearAllOpen(true)}
          >
            <Trash2 size={14} className="mr-1.5" aria-hidden />
            {t('history.clearAll')}
          </Button>
        )}
      </div>

      <div
        className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
        data-testid="session-history-toolbar"
      >
        <Tabs
          value={surfaceFilter}
          onValueChange={(v) => handleSurfaceChange(v as SurfaceFilter)}
        >
          <TabsList className="h-9 max-w-full flex-wrap gap-1">
            <TabsTrigger className="px-2.5" value="all">
              {t('history.filterAll')}
            </TabsTrigger>
            <TabsTrigger className="px-2.5" value="chat">
              {t('history.filterChat')}
            </TabsTrigger>
            <TabsTrigger className="px-2.5" value="code">
              {t('history.filterCode')}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex shrink-0 items-center gap-3">
          {filtered.length > 0 && (
            <span className="text-caption text-ink-secondary">
              {t('history.itemCount', { count: filtered.length })}
            </span>
          )}
          {totalPages > 1 && (
            <>
              <Pagination
                currentPage={safePage}
                totalPages={totalPages}
                onChange={setPage}
                previousLabel={t('history.previous')}
                nextLabel={t('history.next')}
              />
              <span className="hidden text-caption text-ink-secondary sm:inline">
                {t('history.pageInfo', { page: safePage, total: totalPages })}
              </span>
            </>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        listBase.length === 0 ? (
          <EmptyState
            icon={Inbox}
            tier="professional"
            title={t('history.empty')}
            description={t('history.emptyDesc')}
            className="flex-1"
            data-testid="session-history-empty"
          />
        ) : (
          <EmptyState
            icon={SearchX}
            tier="professional"
            title={t('history.emptyFiltered')}
            description={t('history.emptyFilteredDesc')}
            className="flex-1"
            data-testid="session-history-empty-filtered"
            action={
              hasActiveFilters
                ? {
                    label: t('history.clearFilters'),
                    onClick: clearFilters,
                    'data-testid': 'session-history-clear-filters',
                  }
                : undefined
            }
          />
        )
      ) : (
        <div className="flex flex-col gap-1.5">
          {paged.map((session) => {
            const surface = surfaceOf(session.config)
            const Icon = surface === 'code' ? Code2 : MessageSquare
            const updatedWhen = formatRelativeTime(session.updatedAtMs, locale)
            const updatedAbs = formatAbsolute(session.updatedAtMs, locale)
            return (
              <div
                key={session.id}
                className="group rounded-lg border border-border/80 bg-surface transition-colors duration-chrome hover:bg-state-hover/50"
              >
                {/* Layout on permanent outer so CONTEXT_MENUS=false keeps flex sizing. */}
                <div
                  className="flex items-center gap-3 px-3 py-2.5"
                  data-testid={`session-history-row-${session.id}`}
                >
                  <DeclarativeContextMenu
                    kind="sessionHistory"
                    payload={{
                      sessionId: session.id,
                      title: session.title,
                      surface: surface === 'terminal' ? 'chat' : surface,
                    }}
                    className="flex min-w-0 flex-1 items-center gap-3"
                  >
                    <button
                      type="button"
                      onClick={() => void selectSessionFromSidebar(session.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-surface-muted text-ink-tertiary">
                        <Icon size={15} strokeWidth={1.75} aria-hidden />
                      </span>
                      <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                        <span className="min-w-0 truncate text-body font-medium text-ink">
                          {session.title}
                        </span>
                        <span
                          className={
                            surface === 'code'
                              ? 'shrink-0 rounded-md px-1.5 py-0.5 text-caption font-medium text-success'
                              : 'shrink-0 rounded-md px-1.5 py-0.5 text-caption font-medium text-accent'
                          }
                        >
                          {surface === 'chat' ? t('sidebar.nav.chats') : t('sidebar.nav.projects')}
                        </span>
                        {session.preview ? (
                          <span className="min-w-0 max-w-[14rem] truncate text-meta text-ink-tertiary">
                            {session.preview}
                          </span>
                        ) : null}
                      </div>
                      <span
                        className="hidden shrink-0 text-meta text-ink-tertiary md:inline"
                        title={updatedAbs}
                      >
                        {t('history.updatedAt', { when: updatedWhen })}
                      </span>
                    </button>
                  </DeclarativeContextMenu>
                  <div className="flex shrink-0 items-center">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="text-ink-secondary hover:text-danger"
                      title={t('history.deleteSession')}
                      aria-label={t('history.deleteSession')}
                      onClick={() => setDeletingSessionId(session.id)}
                    >
                      <Trash2 size={16} />
                    </Button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
      {deletingSession && (
        <DeleteSessionDialog
          title={deletingSession.title}
          onConfirm={(opts) => {
            debugSessionDelete('history single-delete confirm', {
              sessionId: deletingSession.id,
              title: deletingSession.title,
            })
            sessionService.deleteSession(deletingSession.id, {
              ...opts,
              reason: 'user',
              meta: { source: 'SessionHistory' },
            })
            setDeletingSessionId(null)
          }}
          onCancel={() => setDeletingSessionId(null)}
        />
      )}
      {clearAllOpen && (
        <ClearAllSessionsDialog
          count={filtered.length}
          scope={
            query.trim()
              ? 'search'
              : surfaceFilter === 'chat'
                ? 'chat'
                : surfaceFilter === 'code'
                  ? 'code'
                  : 'all'
          }
          onConfirm={() => {
            // Only delete the *current filter/search list*, never the global session bag.
            const targets = filtered
            auditSessionDelete('batch-start', {
              reason: 'clearAll',
              count: targets.length,
              surfaceFilter,
              query: query.trim() || undefined,
              ids: targets.map((s) => s.id),
              totalSessions: sessions.length,
            })
            debugSessionDelete('clearAll confirm', {
              filteredCount: targets.length,
              totalSessions: sessions.length,
              surfaceFilter,
              query: query.trim() || undefined,
            })
            for (const s of targets) {
              sessionService.deleteSession(s.id, {
                reason: 'clearAll',
                meta: {
                  source: 'SessionHistory.clearAll',
                  surfaceFilter,
                  query: query.trim() || undefined,
                  batchSize: targets.length,
                },
              })
            }
            auditSessionDelete('batch-done', {
              reason: 'clearAll',
              count: targets.length,
            })
            setClearAllOpen(false)
          }}
          onCancel={() => setClearAllOpen(false)}
        />
      )}
    </div>
  )
}
