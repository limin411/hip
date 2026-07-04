import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useSessions, useActiveSessionId, sessionService } from '@/domain'
import { SessionTab } from './SessionTab'

interface SessionTabBarProps {
  onNewSession: () => void
}

export function SessionTabBar({ onNewSession }: SessionTabBarProps) {
  const { t } = useTranslation()
  const openIds = useUiStore((s) => s.openSessionIds)
  const sessions = useSessions()
  const activeId = useActiveSessionId()

  const openSessions = openIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  return (
    <div
      role="tablist"
      aria-label={t('tabs.tabList')}
      className="flex h-full flex-1 items-end gap-0.5 overflow-x-auto scrollbar-hide"
    >
      {openSessions.map((session) => (
        <SessionTab
          key={session.id}
          session={session}
          active={session.id === activeId}
          onSelect={() => sessionService.selectSession(session.id)}
          onClose={() => sessionService.closeSession(session.id)}
        />
      ))}
      <button
        type="button"
        onClick={onNewSession}
        title={t('tabs.newSession')}
        data-testid="new-session-button"
        className="mb-[3px] ml-0.5 flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
      >
        <Plus size={14} />
      </button>
    </div>
  )
}
