import { useTranslation } from 'react-i18next'
import type { Message } from '@hip/protocol'
import { useActiveMessages, useActiveSessionStatus } from '@/domain'
import { groupAllAgents, type GroupedTurn } from '@/lib/turnAgents'
import { formatClockTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { useFocusStore } from '@/store/focusStore'
import { AgentCard } from './AgentCard'
import { CollaborationStructure } from './CollaborationStructure'

export function AgentDashboard() {
  const { t, i18n } = useTranslation()
  const messages: Message[] = useActiveMessages()
  const status = useActiveSessionStatus()
  const live = status === 'running'
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const focusedAgentId = useFocusStore((s) => s.focusedAgentId)

  const turns: GroupedTurn[] = groupAllAgents(messages, status)
  // Display newest turn at top (reverse chronological order)
  const ordered = [...turns].reverse()

  const liveTurn = ordered[0]
  const liveRunning = liveTurn?.agents.find((a) => a.status === 'running')
  const liveTool = liveRunning?.tools.find((tc) => tc.status === 'running')

  if (turns.length === 0) {
    return (
      <div className="text-meta text-ink-tertiary" data-testid="agents-empty">
        {t('artifact.noTools')}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-4" data-testid="agents-dashboard">
      {live && liveRunning && (
        <div
          className="sticky top-0 z-10 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-meta"
          data-testid="agent-live-strip"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium text-ink">
            {liveRunning.taskInput?.trim() || liveRunning.role}
            {liveTool ? ` · ${liveTool.name}` : ''}
          </span>
          <span className="shrink-0 text-caption text-ink-tertiary">live</span>
        </div>
      )}
      {ordered.map((group, index) => {
        // After reversing, index 0 is the chronologically newest (last) turn
        const isLastTurn = index === 0
        const turnLive = live && isLastTurn
        const supervisor = group.agents.find((a) => a.role === 'supervisor')
        const children = group.agents.filter((a) => a.role !== 'supervisor')

        return (
          <div
            key={group.messageId}
            className={cn('flex flex-col gap-2', isLastTurn && 'order-first')}
            data-testid={isLastTurn ? 'agents-live-turn' : 'agents-history-turn'}
          >
            <div className="text-caption font-medium uppercase tracking-wide text-ink-tertiary">
              {t('artifact.timelineView.turn', { n: group.turnIndex })} · {formatClockTime(group.timestamp, locale)}
              {children.length > 0
                ? ` · ${t('artifact.subAgentCount', { count: children.length })}`
                : ''}
            </div>
            {/* D2: structure only when sub-agents exist */}
            {children.length > 0 && (
              <CollaborationStructure agents={group.agents} live={turnLive} />
            )}
            {supervisor && (
              <div
                data-focus-highlight={focusedAgentId === supervisor.agentId ? 'true' : undefined}
                className={cn(focusedAgentId === supervisor.agentId && 'ring-1 ring-accent/40 rounded-lg')}
              >
                <AgentCard agent={supervisor} live={turnLive} />
              </div>
            )}
            {children.length > 0 && (
              <>
                <div className="text-caption font-medium uppercase tracking-wide text-ink-tertiary">
                  {t('artifact.subAgents')}
                </div>
                <div className="flex flex-col gap-2.5">
                  {children.map((agent) => (
                    <div
                      key={agent.agentId}
                      data-focus-highlight={focusedAgentId === agent.agentId ? 'true' : undefined}
                      className={cn(focusedAgentId === agent.agentId && 'ring-1 ring-accent/40 rounded-lg')}
                    >
                      <AgentCard agent={agent} live={turnLive} />
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
