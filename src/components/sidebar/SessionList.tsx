import { useTranslation } from 'react-i18next'
import { SearchX } from 'lucide-react'
import { useUiStore, type Surface } from '@/store/uiStore'
import { useSessions, useActiveSessionId, sessionService } from '@/domain'
import { filterSessions, filterBySurface, groupSessionsByRelativeDate } from '@/lib/sessions'
import { SessionItem } from './SessionItem'

export function SessionList() {
  const { t } = useTranslation()
  const activeView = useUiStore((s) => s.activeView)
  const surface: Surface = activeView === 'code' ? 'code' : 'chat'
  const sessions = filterBySurface(useSessions(), surface)
  const search = useUiStore((s) => s.search)
  const activeSessionId = useActiveSessionId()

  const q = search.trim()
  const local = filterSessions(sessions, q).slice(0, 5)

  if (local.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 px-4 py-8 text-center">
        <SearchX size={20} className="text-ink-tertiary" />
        <div className="flex flex-col gap-1">
          <p className="text-meta text-ink-secondary">{t('sidebar.noMatches')}</p>
          {q && (
            <button
              onClick={() => useUiStore.getState().setSearch('')}
              className="rounded text-meta text-accent hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              {t('sidebar.clearSearch')}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (q) {
    return (
      <div className="flex flex-col gap-1">
        <div className="px-2.5 text-caption uppercase tracking-wider text-ink-tertiary">
          {t('sidebar.searchResults')}
        </div>
        <div className="flex flex-col gap-0.5">
          {local.map((session) => (
            <SessionItem
              key={session.id}
              session={session}
              active={session.id === activeSessionId}
              onSelect={() => sessionService.selectSession(session.id)}
              onDelete={() => sessionService.deleteSession(session.id)}
            />
          ))}
        </div>
      </div>
    )
  }

  const grouped = groupSessionsByRelativeDate(local)

  return (
    <div className="flex flex-col gap-4">
      {grouped.map(({ key, sessions: groupSessions }) => (
        <div key={key} className="flex flex-col gap-1">
          <div className="px-2.5 text-caption uppercase tracking-wider text-ink-tertiary">
            {t(`sidebar.dateGroup.${key}`)}
          </div>
          <div className="flex flex-col gap-0.5">
            {groupSessions.map((session) => (
              <SessionItem
                key={session.id}
                session={session}
                active={session.id === activeSessionId}
                onSelect={() => sessionService.selectSession(session.id)}
                onDelete={() => sessionService.deleteSession(session.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
