import { useTranslation } from 'react-i18next'
import { BookOpen, Plus, X } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useSessions, useActiveSessionId, sessionService } from '@/domain'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu'
import { cn } from '@/lib/utils'
import { SessionTab } from './SessionTab'

interface SessionTabBarProps {
  onNewSession: () => void
}

function knowledgeChipLabel(
  fallback: string,
  mode: 'home' | 'workspace',
  spaces: { id: string; name: string }[],
  activeSpaceId: string | null,
): string {
  if (mode === 'workspace' && activeSpaceId) {
    const name = spaces.find((s) => s.id === activeSpaceId)?.name
    if (name) return name
  }
  return fallback
}

export function SessionTabBar({ onNewSession }: SessionTabBarProps) {
  void onNewSession
  const { t } = useTranslation()
  const openIds = useUiStore((s) => s.openSessionIds)
  const activeView = useUiStore((s) => s.activeView)
  const knowledgeTabOpen = useUiStore((s) => s.knowledgeTabOpen)
  const openKnowledgeView = useUiStore((s) => s.openKnowledgeView)
  const closeKnowledgeView = useUiStore((s) => s.closeKnowledgeView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const sessions = useSessions()
  const activeId = useActiveSessionId()
  const kbMode = useKnowledgeStore((s) => s.mode)
  const kbSpaces = useKnowledgeStore((s) => s.spaces)
  const kbActiveSpaceId = useKnowledgeStore((s) => s.activeSpaceId)

  const openSessions = openIds
    .map((id) => sessions.find((s) => s.id === id))
    .filter((s): s is NonNullable<typeof s> => Boolean(s))

  const handleNewChat = () => {
    sessionService.newConversation('chat')
  }

  const handleNewCode = () => {
    sessionService.newConversation('code')
  }

  const handleOpenKnowledge = () => {
    openKnowledgeView()
    void useKnowledgeStore.getState().loadSpaces()
  }

  const sessionSurfaceActive = activeView === 'chat' || activeView === 'code'
  const chipLabel = knowledgeChipLabel(t('tabs.knowledge'), kbMode, kbSpaces, kbActiveSpaceId)

  return (
    <div
      role="tablist"
      aria-label={t('tabs.tabList')}
      className="flex h-full flex-1 items-center gap-0.5 overflow-x-auto scrollbar-hide"
    >
      {openSessions.map((session) => (
        <SessionTab
          key={session.id}
          session={session}
          active={session.id === activeId && sessionSurfaceActive}
          onSelect={() => sessionService.selectSession(session.id)}
          onClose={() => sessionService.closeSession(session.id)}
        />
      ))}

      {knowledgeTabOpen && (
        <div
          data-testid="knowledge-tab-container"
          data-tauri-drag-region="false"
          className={cn(
            'group flex h-[28px] min-w-[120px] max-w-[200px] items-center gap-1 rounded-md px-2.5 text-body transition-colors',
            activeView === 'knowledge'
              ? 'bg-state-active text-ink'
              : 'text-ink-secondary hover:bg-state-hover hover:text-ink',
          )}
        >
          <div
            role="tab"
            data-testid="knowledge-tab"
            tabIndex={0}
            aria-selected={activeView === 'knowledge'}
            onClick={() => setActiveView('knowledge')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setActiveView('knowledge')
              }
            }}
            className="flex min-w-0 flex-1 items-center gap-2 outline-none"
          >
            <BookOpen
              size={14}
              className={cn(
                'shrink-0',
                activeView === 'knowledge' ? 'text-accent-strong' : 'text-ink-tertiary',
              )}
            />
            <span className="min-w-0 flex-1 truncate text-left">{chipLabel}</span>
          </div>
          <button
            type="button"
            aria-label={t('tabs.closeKnowledge')}
            data-no-drag
            data-testid="knowledge-tab-close"
            onClick={() => void closeKnowledgeView()}
            className={cn(
              'flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity',
              'group-hover:opacity-100 focus-visible:opacity-100 hover:bg-surface-muted',
            )}
          >
            <X size={12} />
          </button>
        </div>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title={t('tabs.newSession')}
            data-testid="new-session-button"
            data-tauri-drag-region="false"
            data-no-drag
            className="ml-0.5 flex h-[26px] w-[26px] items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink"
          >
            <Plus size={14} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuItem data-testid="new-session-chat" onClick={handleNewChat}>
            <span className="truncate">{t('dropdown.newChat')}</span>
          </DropdownMenuItem>
          <DropdownMenuItem data-testid="new-session-code" onClick={handleNewCode}>
            <span className="truncate">{t('dropdown.newCode')}</span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem data-testid="new-session-kb" onClick={handleOpenKnowledge}>
            <span className="truncate">{t('dropdown.newKnowledge')}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
