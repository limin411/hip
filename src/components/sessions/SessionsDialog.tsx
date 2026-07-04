import { useState, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Search } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { SessionItem } from '@/components/sidebar/SessionItem'
import { useSessions, useActiveSessionId, sessionService } from '@/domain'
import { filterSessions, filterBySurface } from '@/lib/sessions'
import { cn } from '@/lib/utils'
import { SessionFilters, type SessionFilter } from './SessionFilters'
import { SessionPagination } from './SessionPagination'

const PAGE_SIZE = 20

interface SessionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SessionsDialog({ open, onOpenChange }: SessionsDialogProps) {
  const { t } = useTranslation()
  const sessions = useSessions()
  const activeSessionId = useActiveSessionId()
  const [filter, setFilter] = useState<SessionFilter>('all')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    let list = sessions
    if (filter !== 'all') {
      list = filterBySurface(list, filter)
    }
    list = filterSessions(list, query)
    return [...list].sort((a, b) => b.updatedAtMs - a.updatedAtMs)
  }, [sessions, filter, query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageSessions = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const handleSelect = (id: string) => {
    sessionService.selectSession(id)
    onOpenChange(false)
  }

  const handleFilterChange = (value: SessionFilter) => {
    setFilter(value)
    setPage(1)
  }

  const handleQueryChange = (value: string) => {
    setQuery(value)
    setPage(1)
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('sidebar.allSessions')}
      className="max-w-2xl"
      footer={<SessionPagination page={page} totalPages={totalPages} onChange={setPage} />}
    >
      <div className="flex h-full flex-col gap-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SessionFilters value={filter} onChange={handleFilterChange} />
          <div className="relative flex-1">
            <Search
              size={15}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary"
            />
            <input
              data-testid="sessions-dialog-search"
              value={query}
              onChange={(e) => handleQueryChange(e.target.value)}
              placeholder={t('sidebar.search')}
              className={cn(
                'h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-body text-ink placeholder:text-ink-tertiary',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
              )}
            />
          </div>
        </div>
        <div className="text-caption text-ink-tertiary">
          {t('sidebar.sessionCount', { count: filtered.length })}
        </div>
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col gap-0.5">
            {pageSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                onSelect={() => handleSelect(session.id)}
                onDelete={() => sessionService.deleteSession(session.id)}
              />
            ))}
          </div>
          {pageSessions.length === 0 && (
            <div className="py-8 text-center text-meta text-ink-secondary">
              {t('sidebar.noMatches')}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
