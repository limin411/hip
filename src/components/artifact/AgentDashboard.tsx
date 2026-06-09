import { useTranslation } from 'react-i18next'
import type { Message } from '@hip/protocol'
import { useActiveMessages, useActiveSessionStatus } from '@/domain'
import { groupByAgent } from '@/lib/turnAgents'
import { AgentCard } from './AgentCard'

export function AgentDashboard() {
  const { t } = useTranslation()
  const messages = useActiveMessages()
  const status = useActiveSessionStatus()
  let latest: Message | null = null
  for (let i = messages.length - 1; i >= 0; i--) { if (messages[i].role === 'assistant') { latest = messages[i]; break } }
  const live = status === 'running'
  const agents = groupByAgent(latest, live)
  const supervisor = agents.find((a) => a.role === 'supervisor')
  const children = agents.filter((a) => a.role !== 'supervisor')
  if (agents.length === 0) return <div className="text-[12px] text-ink-tertiary">{t('artifact.noTools')}</div>
  return (
    <div className="flex flex-col gap-3">
      {supervisor && <AgentCard agent={supervisor} live={live} />}
      {children.length > 0 && (
        <>
          <div className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t('artifact.subAgents')}</div>
          <div className="flex flex-col gap-2.5">{children.map((agent) => <AgentCard key={agent.agentId} agent={agent} live={live} />)}</div>
        </>
      )}
    </div>
  )
}
