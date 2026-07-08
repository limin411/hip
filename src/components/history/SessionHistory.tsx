import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search, MessageSquare, Code2 } from 'lucide-react'
import { useSessions, sessionService } from '@/domain'
import { surfaceOf } from '@/lib/sessions'
import { cn } from '@/lib/utils'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/Tabs'
import { Pagination } from '@/components/ui/Pagination'

const PAGE_SIZE = 20

type SurfaceFilter = 'all' | 'chat' | 'code'

export function SessionHistory() {
  const { t } = useTranslation()
  const sessions = useSessions()
  const [query, setQuery] = useState('')
  const [surfaceFilter, setSurfaceFilter] = useState<SurfaceFilter>('all')
  const [page, setPage] = useState(1)

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

  const paged = useMemo(() => {
    const safePage = Math.min(page, totalPages)
    return filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)
  }, [filtered, page, totalPages])

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-6 py-5" data-testid="session-history">
      <h2 className="mb-4 text-display font-semibold text-ink">{t('history.title')}</h2>
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

      <Tabs
        value={surfaceFilter}
        onValueChange={(v) => handleSurfaceChange(v as SurfaceFilter)}
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="all">{t('history.filterAll')}</TabsTrigger>
          <TabsTrigger value="chat">{t('history.filterChat')}</TabsTrigger>
          <TabsTrigger value="code">{t('history.filterCode')}</TabsTrigger>
        </TabsList>
      </Tabs>

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
                <button
                  key={session.id}
                  type="button"
                  onClick={() => sessionService.selectSession(session.id)}
                  className="flex items-center justify-between rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-accent"
                >
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate text-body font-medium text-ink">{session.title}</span>
                    <span className="truncate text-meta text-ink-secondary">{session.preview}</span>
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
              )
            })}
          </div>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between">
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onChange={setPage}
                previousLabel={t('history.previous')}
                nextLabel={t('history.next')}
              />
              <span className="text-caption text-ink-secondary">
                {t('history.pageInfo', { page, total: totalPages })}
              </span>
            </div>
          )}
        </>
      )}
    </div>
  )
}
