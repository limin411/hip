import { useTaskRuntimeStore, formatRunningChip, totalRunning } from '@/store/taskRuntimeStore'
import { useActiveSessionId } from '@/domain'
import { cn } from '@/lib/utils'
import { useUiStore } from '@/store/uiStore'
import { useDomainStore } from '@/domain/sessionStore'
import { COMPOSER_COLUMN_CLASS } from './ChatColumn'

/** Composer-adjacent chip when background runtime work is still running. */
export function StillRunningChip() {
  const sessionId = useActiveSessionId()
  const counts = useTaskRuntimeStore((s) =>
    sessionId ? s.bySession[sessionId]?.runningCounts : undefined,
  )
  if (!sessionId || !counts || totalRunning(counts) === 0) return null
  const label = formatRunningChip(counts)
  if (!label) return null

  return (
    <div className={cn('mb-1 px-4', COMPOSER_COLUMN_CLASS)}>
      <button
        type="button"
        data-testid="still-running-chip"
        className="flex w-fit max-w-full items-center gap-1.5 truncate rounded-md border border-border bg-surface-subtle px-2 py-1 text-caption text-ink-secondary hover:border-accent hover:text-ink"
        onClick={() => {
          const view = useUiStore.getState().activeView
          // Agents tab hosts Agents (top) + Runtime (bottom).
          useUiStore.getState().setTab('agents')
          useUiStore.getState().setChatActiveTab('agents')
          if (view === 'code') {
            useDomainStore.getState().setSessionCodePanelOpen(sessionId, true)
          } else if (view === 'chat') {
            useDomainStore.getState().setSessionChatPanelOpen(sessionId, true)
          } else {
            useUiStore.getState().setActiveView('code')
            useDomainStore.getState().setSessionCodePanelOpen(sessionId, true)
          }
        }}
      >
        {label}
      </button>
    </div>
  )
}
