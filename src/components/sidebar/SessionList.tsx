import { useUiStore } from '@/store/uiStore'
import { useSessions, useActiveSessionId, sessionService } from '@/domain'
import { filterSessions } from '@/lib/sessions'
import { SessionItem } from './SessionItem'

export function SessionList() {
  const sessions = useSessions()
  const search = useUiStore((s) => s.search)
  const activeSessionId = useActiveSessionId()

  const filtered = filterSessions(sessions, search)

  if (filtered.length === 0) {
    return <div className="px-2.5 py-4 text-[12px] text-ink-tertiary">没有匹配的会话</div>
  }

  return (
    <div className="flex flex-col gap-0.5">
      {filtered.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          active={session.id === activeSessionId}
          onSelect={() => sessionService.selectSession(session.id)}
          onDelete={() => sessionService.deleteSession(session.id)}
        />
      ))}
    </div>
  )
}
