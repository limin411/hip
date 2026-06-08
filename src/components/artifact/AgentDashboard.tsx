import { useTranslation } from 'react-i18next'
import { useAgents } from '@/domain'
import { AgentCard } from './AgentCard'

export function AgentDashboard() {
  const { t } = useTranslation()
  const agents = useAgents()
  const supervisor = agents.find((a) => a.role === 'supervisor')
  const children = agents.filter((a) => a.role !== 'supervisor')

  return (
    <div className="flex flex-col gap-3">
      {supervisor && <AgentCard agent={supervisor} />}
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t('artifact.subAgents')}</div>
      <div className="flex flex-col gap-2.5">
        {children.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  )
}
