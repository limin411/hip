import { useTranslation } from 'react-i18next'
import type { Message } from '@hip/protocol'
import { useActiveMessages, useActiveSessionStatus } from '@/domain'
import { groupAllAgents, type GroupedTurn } from '@/lib/turnAgents'
import { formatClockTime } from '@/lib/datetime'
import { AgentCard } from './AgentCard'
import { CollaborationStructure } from './CollaborationStructure'

export function AgentDashboard() {
  const { t, i18n } = useTranslation()
  const messages: Message[] = useActiveMessages()
  const status = useActiveSessionStatus()
  const live = status === 'running'
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'

  const turns: GroupedTurn[] = groupAllAgents(messages, status)
  // Display newest turn at top (reverse chronological order)
  const ordered = [...turns].reverse()

  if (turns.length === 0) {
    return <div className="text-meta text-ink-tertiary">{t('artifact.noTools')}</div>
  }

  return (
    <div className="flex flex-col gap-4">
      {ordered.map((group, index) => {
        // After reversing, index 0 is the chronologically newest (last) turn
        const isLastTurn = index === 0
        const turnLive = live && isLastTurn
        const supervisor = group.agents.find((a) => a.role === 'supervisor')
        const children = group.agents.filter((a) => a.role !== 'supervisor')

        return (
          <div key={group.messageId} className="flex flex-col gap-2">
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
            {supervisor && <AgentCard agent={supervisor} live={turnLive} />}
            {children.length > 0 && (
              <>
                <div className="text-caption font-medium uppercase tracking-wide text-ink-tertiary">
                  {t('artifact.subAgents')}
                </div>
                <div className="flex flex-col gap-2.5">
                  {children.map((agent) => (
                    <AgentCard key={agent.agentId} agent={agent} live={turnLive} />
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
