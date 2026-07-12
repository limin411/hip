import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, MessageSquare, Code2, Trash2 } from 'lucide-react'
import { useSessions, sessionService } from '@/domain'
import { surfaceOf } from '@/lib/sessions'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { Pagination } from '@/components/ui/Pagination'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { DeleteSessionDialog } from './DeleteSessionDialog'
import { ClearAllSessionsDialog } from './ClearAllSessionsDialog'

const PAGE_SIZE = 20

type SurfaceFilter = 'all' | 'chat' | 'code'

export function SessionHistory() {
  const { t } = useTranslation()
  const sessions = useSessions()
  const [query, setQuery] = useState('')
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>('all')
  const [page, setPage] = useState(1)
  const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null)
  const [clearAllOpen, setClearAllOpen] = useState(false)

  // ... 现有派生计算不变

  const deletingSession = useMemo(
    () => sessions.find((s) => s.id === deletingSessionId) ?? null,
    [sessions, deletingSessionId],
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = [...sessions].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
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
  }, [sessions, query, surfaceFilter])

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
        {sessions.length > 0 && (
          <Button variant="danger" size="sm" onClick={() => setClearAllOpen(true)}>
            {t('history.clearAll')}
          </Button>
        )}
      </div>
      <div className="relative mb-4 max-w-md">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
        <input
          type="text"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          placeholder={t('history.searchPlaceholder')}
          className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-body text-ink placeholder:text-ink-tertiary focus:border-accent focus:outline-none"
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
        <div className="flex flex-1 flex-col items-center justify-center text-ink-secondary">
          <span className="text-body">{t('history.empty')}</span>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2">
            {paged.map((session) => {
              const surface = surfaceOf(session.config)
              const Icon = surface === 'code' ? Code2 : MessageSquare
              return (
                <div
                  key={session.id}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-accent"
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
                            'ml-3 flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-caption',
                            surface === 'code'
                              ? 'bg-accent-subtle text-accent-strong'
                              : 'bg-surface-subtle text-ink-secondary',
                          )}
                        >
                          <Icon size={12} />
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
            sessionService.deleteSession(deletingSession.id, opts)
            setDeletingSessionId(null)
          }}
          onCancel={() => setDeletingSessionId(null)}
        />
      )}
      {clearAllOpen && (
        <ClearAllSessionsDialog
          onConfirm={() => {
            sessions.forEach((s) => sessionService.deleteSession(s.id))
            setClearAllOpen(false)
          }}
          onCancel={() => setClearAllOpen(false)}
        />
      )}
    </div>
  )
}
