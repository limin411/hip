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
  // Only the latest turn / stage — older history is in the main transcript.
  const latest = turns.length > 0 ? turns[turns.length - 1]! : null

  if (!latest) {
    return (
      <div className="text-meta text-ink-tertiary" data-testid="agents-empty">
        {t('artifact.noTools')}
      </div>
    )
  }

  const turnLive = live
  const liveRunning = latest.agents.find((a) => a.status === 'running')
  const liveTool = liveRunning?.tools.find((tc) => tc.status === 'running')
  const supervisor = latest.agents.find((a) => a.role === 'supervisor')
  const children = latest.agents.filter((a) => a.role !== 'supervisor')

  return (
    <div className="flex flex-col gap-4" data-testid="agents-dashboard">
      {live && liveRunning && (
        <div
          className="sticky top-0 z-10 flex items-center gap-2 border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-meta"
          data-testid="agent-live-strip"
        >
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" aria-hidden />
          <span className="min-w-0 flex-1 truncate font-medium text-ink">
            {liveRunning.taskInput?.trim() || liveRunning.name?.trim() || liveRunning.role}
            {liveTool ? ` · ${liveTool.name}` : ''}
          </span>
          <span className="shrink-0 text-caption text-ink-tertiary">live</span>
        </div>
      )}
      <div
        className="flex flex-col gap-2"
        data-testid="agents-live-turn"
      >
        <div className="text-caption font-medium text-ink-tertiary">
          {t('artifact.timelineView.turn', { n: latest.turnIndex })} · {formatClockTime(latest.timestamp, locale)}
          {children.length > 0
            ? ` · ${t('artifact.subAgentCount', { count: children.length })}`
            : ''}
        </div>
        {/* D2: structure only when sub-agents exist */}
        {children.length > 0 && (
          <CollaborationStructure agents={latest.agents} live={turnLive} />
        )}
        {supervisor && (
          <div
            data-focus-highlight={focusedAgentId === supervisor.agentId ? 'true' : undefined}
            className={cn(focusedAgentId === supervisor.agentId && 'ring-1 ring-accent/40')}
          >
            <AgentCard agent={supervisor} live={turnLive} />
          </div>
        )}
        {children.length > 0 && (
          <>
            <div className="text-caption font-medium text-ink-tertiary">
              {t('artifact.subAgents')}
            </div>
            <div className="flex flex-col gap-2.5">
              {children.map((agent) => (
                <div
                  key={agent.agentId}
                  data-focus-highlight={focusedAgentId === agent.agentId ? 'true' : undefined}
                  className={cn(focusedAgentId === agent.agentId && 'ring-1 ring-accent/40')}
                >
                  <AgentCard agent={agent} live={turnLive} />
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
