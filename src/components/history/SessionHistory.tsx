import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, MessageSquare, Code2, Trash2, Inbox } from 'lucide-react'
import { useSessions, sessionService } from '@/domain'
import { surfaceOf } from '@/lib/sessions'
import {
  collectNestedWorktreeSessionIds,
  extractParallelNestingHints,
  nestableCatalogPaths,
} from '@/lib/worktreeNesting'
import { useParallelStore } from '@/store/parallelStore'
import { useWorktreeStore } from '@/store/worktreeStore'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { Pagination } from '@/components/ui/Pagination'
import { EmptyState } from '@/components/ui/EmptyState'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { DeleteSessionDialog } from './DeleteSessionDialog'
import { ClearAllSessionsDialog } from './ClearAllSessionsDialog'
import { auditSessionDelete, debugSessionDelete } from '@/lib/sessionDelete'

const PAGE_SIZE = 20

type SurfaceFilter = 'all' | 'chat' | 'code'

export function SessionHistory() {
  const { t } = useTranslation()
  const sessions = useSessions()
  const parallelRuns = useParallelStore((s) => s.runs)
  const catalogById = useWorktreeStore((s) => s.byId)
  const [query, setQuery] = useState('')
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>('all')
  const [page, setPage] = useState(1)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const [clearAllOpen, setClearAllOpen] = useState(false)

  const nestedWorktreeSessionIds = useMemo(() => {
    const hints = extractParallelNestingHints(parallelRuns)
    // Primary catalog path === host project cwd; never use it for nesting.
    const catalogPaths = nestableCatalogPaths(Object.values(catalogById))
    return collectNestedWorktreeSessionIds({
      sessions: sessions.map((s) => ({ id: s.id, title: s.title, config: { cwd: s.config.cwd } })),
      slotSessionIds: hints.slotSessionIds,
      worktreePaths: [...hints.worktreePaths, ...catalogPaths],
    })
  }, [sessions, parallelRuns, catalogById])

  const deletingSession = useMemo(
    () => sessions.find((s) => s.id === deletingSessionId) ?? null,
    [sessions, deletingSessionId],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    // Worktree-bound slot sessions are nested under projects, not first-class history rows.
    const list = [...sessions]
      .filter((s) => !nestedWorktreeSessionIds.has(s.id))
      .sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    let result = list
    if (q) {
      result = result.filter(
        (s) => s.title.toLowerCase().includes(q) || s.preview.toLowerCase().includes(q),
      )
    }
    if (surfaceFilter !== 'all') {
      result = result.filter((s) => surfaceOf(s.config) === surfaceFilter)
    }
    return result
  }, [sessions, query, surfaceFilter, nestedWorktreeSessionIds])

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

  const safePage = useMemo(() => Math.min(page, totalPages), [page, totalPages])

  const paged = useMemo(() => {
    return filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  }, [filtered, safePage])

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-5" data-testid="session-history">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-display font-semibold text-ink">{t('history.title')}</h2>
        {filtered.length > 0 && (
          <Button variant="danger" size="sm" onClick={() => setClearAllOpen(true)}>
            {t('history.clearAll')}
          </Button>
        )}
      </div>
      <div className="relative mb-5 max-w-md">
        <Search size={16} strokeWidth={1.75} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder={t('history.searchPlaceholder')}
          className="h-9 w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-body text-ink transition-[border-color,box-shadow] duration-chrome placeholder:text-ink-tertiary focus-visible:border-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/10"
        />
      </div>

      <div
        className="mb-4 flex items-center justify-between gap-4"
        data-testid="session-history-toolbar"
      >
        <Tabs
          value={surfaceFilter}
          onValueChange={(v) => handleSurfaceChange(v as SurfaceFilter)}
        >
          <TabsList className="h-9 gap-2">
            <TabsTrigger className="px-4" value="all">
              {t('history.filterAll')}
            </TabsTrigger>
            <TabsTrigger className="px-4" value="chat">
              {t('history.filterChat')}
            </TabsTrigger>
            <TabsTrigger className="px-4" value="code">
              {t('history.filterCode')}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {totalPages > 1 && (
          <div className="flex items-center gap-3">
            <Pagination
              currentPage={safePage}
              totalPages={totalPages}
              onChange={setPage}
              previousLabel={t('history.previous')}
              nextLabel={t('history.next')}
            />
            <span className="text-caption text-ink-secondary">
              {t('history.pageInfo', { page: safePage, total: totalPages })}
            </span>
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={Inbox}
          tier="professional"
          title={t('history.empty')}
          className="flex-1"
          data-testid="session-history-empty"
        />
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            {paged.map((session) => {
              const surface = surfaceOf(session.config)
              const Icon = surface === 'code' ? Code2 : MessageSquare
              return (
                <div
                  key={session.id}
                  className="flex items-center justify-between rounded-lg border border-border/80 bg-surface p-3 text-left transition-colors duration-chrome hover:bg-state-hover"
                >
                  {/* Layout on permanent outer so CONTEXT_MENUS=false keeps flex sizing. */}
                  <div
                    className="flex min-w-0 flex-1"
                    data-testid={`session-history-row-${session.id}`}
                  >
                    <DeclarativeContextMenu
                      kind="sessionHistory"
                      payload={{
                        sessionId: session.id,
                        title: session.title,
                        surface,
                      }}
                      className="flex min-w-0 flex-1"
                    >
                      <button
                        type="button"
                        onClick={() => sessionService.selectSession(session.id)}
                        className="flex min-w-0 flex-1 items-center justify-between text-left"
                      >
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <span className="truncate text-body font-medium text-ink">
                            {session.title}
                          </span>
                          <span className="truncate text-meta text-ink-secondary">
                            {session.preview}
                          </span>
                        </div>
                        <span
                          className={cn(
                            'ml-3 flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-caption',
                            surface === 'code'
                              ? 'bg-surface-muted text-ink-secondary'
                              : 'bg-surface-muted text-ink-tertiary',
                          )}
                        >
                          <Icon size={12} strokeWidth={1.75} />
                          {t(`nav.${surface}`)}
                        </span>
                      </button>
                    </DeclarativeContextMenu>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="ml-2 shrink-0 text-ink-secondary hover:text-accent"
                    title={t('history.deleteSession')}
                    aria-label={t('history.deleteSession')}
                    onClick={() => setDeletingSessionId(session.id)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </div>
              )
            })}
          </div>
        </>
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
