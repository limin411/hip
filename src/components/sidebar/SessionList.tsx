import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'
import { useSessions, useActiveSessionId, useSearchHits, sessionService } from '@/domain'
import { filterSessions } from '@/lib/sessions'
import { SessionItem } from './SessionItem'

export function SessionList() {
  const { t } = useTranslation()
  const sessions = useSessions()
  const search = useUiStore((s) => s.search)
  const activeSessionId = useActiveSessionId()
  const hits = useSearchHits()

  const q = search.trim()
  const local = filterSessions(sessions, q)
  // Content matches (sidecar FTS) for sessions the instant local title/preview
  // filter didn't already surface; dedupe so each session appears once.
  const seen = new Set(local.map((s) => s.id))
  const contentHits = q
    ? hits.filter((h) => {
        if (!h.sessionId || seen.has(h.sessionId)) return false
        seen.add(h.sessionId)
        return true
      })
    : []

  if (local.length === 0 && contentHits.length === 0) {
    return <div className="px-2.5 py-4 text-[12px] text-ink-tertiary">{t('sidebar.noMatches')}</div>
  }

  return (
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
      {contentHits.map((h) => {
        const s = sessions.find((x) => x.id === h.sessionId)
        if (!s) return null
        return (
          <SessionItem
            key={`hit-${h.sessionId}`}
            session={s}
            snippet={h.snippet}
            active={s.id === activeSessionId}
            onSelect={() => sessionService.selectSession(s.id, h.messageId ?? undefined)}
            onDelete={() => sessionService.deleteSession(s.id)}
          />
        )
      })}
    </div>
  )
}
