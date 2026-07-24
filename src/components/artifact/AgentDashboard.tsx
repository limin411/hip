import { useTranslation } from 'react-i18next'
import { Bot } from 'lucide-react'
import type { Message } from '@hip/protocol'
import { useActiveMessages, useActiveSessionStatus } from '@/domain'
import { groupAllAgents, type GroupedTurn } from '@/lib/turnAgents'
import { formatClockTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { useFocusStore } from '@/store/focusStore'
import { EmptyState } from '@/components/ui/EmptyState'
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
      <div className="flex h-full items-center justify-center p-4" data-testid="agents-empty">
        <EmptyState
          icon={Bot}
          title={t('artifact.agentsEmpty')}
          description={
            live
              ? t('artifact.agentsEmptyLive', {
                  defaultValue: 'Agents will appear here as the turn starts…',
                })
              : t('artifact.agentsEmptyDesc')
          }
        />
      </div>
    )
  }

  const turnLive = live
  const liveRunning = latest.agents.find((a) => a.status === 'running')
  const liveTool = liveRunning?.tools.find((tc) => tc.status === 'running')
  const supervisor = latest.agents.find((a) => a.role === 'supervisor')
  const children = latest.agents.filter((a) => a.role !== 'supervisor')

  const turnMeta = [
    t('artifact.timelineView.turn', { n: latest.turnIndex }),
    formatClockTime(latest.timestamp, locale),
    children.length > 0 ? t('artifact.subAgentCount', { count: children.length }) : null,
    liveRunning
      ? t('artifact.agentsLiveRunning', {
          defaultValue: 'Running: {{name}}',
          name: liveRunning.name || liveRunning.role,
        })
      : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="agents-dashboard">
      <div className="flex h-8 shrink-0 items-center justify-between gap-2 px-3">
        <p className="min-w-0 truncate text-caption font-medium text-ink-tertiary">{turnMeta}</p>
        {live && liveRunning && (
          <span className="flex shrink-0 items-center gap-1.5 text-caption text-accent">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
            live
          </span>
        )}
      </div>

      {live && liveRunning && (
        <div
          className="flex shrink-0 items-center gap-2 px-3 pb-2 text-meta"
          data-testid="agent-live-strip"
        >
          <span className="min-w-0 flex-1 truncate text-ink-secondary">
            <span className="font-medium text-ink">
              {liveRunning.taskInput?.trim() || liveRunning.name?.trim() || liveRunning.role}
            </span>
            {liveTool ? <span className="text-ink-tertiary"> · {liveTool.name}</span> : null}
          </span>
        </div>
      )}

      <div
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto px-2.5 pb-3"
        data-testid="agents-live-turn"
      >
        {children.length > 0 && (
          <CollaborationStructure agents={latest.agents} live={turnLive} />
        )}

        {supervisor && (
          <div
            data-focus-highlight={focusedAgentId === supervisor.agentId ? 'true' : undefined}
            className={cn(focusedAgentId === supervisor.agentId && 'text-ink')}
          >
            <AgentCard agent={supervisor} live={turnLive} />
          </div>
        )}

        {children.length > 0 && (
          <div className="flex flex-col gap-1">
            <div className="px-1.5 pt-1 text-caption font-medium text-ink-tertiary">
              {t('artifact.subAgents')}
            </div>
            {children.map((agent) => (
              <div
                key={agent.agentId}
                data-focus-highlight={focusedAgentId === agent.agentId ? 'true' : undefined}
              >
                <AgentCard agent={agent} live={turnLive} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
