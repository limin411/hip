import { useTranslation } from 'react-i18next'
import type { AgentRole } from '@hip/protocol'
import type { AgentVM } from '@/domain'
import { useAgents } from '@/domain'
import { cn } from '@/lib/utils'

const ROLE_COLOR: Record<AgentRole, string> = {
  supervisor: 'var(--role-supervisor)',
  planner: 'var(--role-planner)',
  coder: 'var(--role-coder)',
  reviewer: 'var(--role-reviewer)',
}

function StatusDot({ status, color }: { status: AgentVM['status']; color: string }) {
  if (status === 'running') {
    return <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: color }} />
  }
  if (status === 'done') {
    return <span className="h-2 w-2 rounded-full bg-ink-tertiary" />
  }
  return <span className="h-2 w-2 rounded-full border border-border" />
}

function AgentCard({ agent }: { agent: AgentVM }) {
  const { t } = useTranslation()
  const color = ROLE_COLOR[agent.role]
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border bg-surface p-3 transition-colors',
        agent.status === 'running' ? 'border-accent/40' : 'border-border',
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
          <span className="text-[13px] font-semibold text-ink">{agent.title}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <StatusDot status={agent.status} color={color} />
          <span className="text-[11px] capitalize text-ink-tertiary">{agent.status}</span>
        </div>
      </div>

      <div className="min-h-[32px] rounded-md bg-surface-muted px-2.5 py-1.5 text-[12px] leading-snug text-ink-secondary">
        {agent.tokens || <span className="text-ink-tertiary">{t('artifact.waiting')}</span>}
      </div>

      <div className="flex items-center gap-3 text-[11px] text-ink-tertiary">
        <span>{agent.tokenCount} tokens</span>
        <span>{(agent.elapsedMs / 1000).toFixed(1)}s</span>
      </div>
    </div>
  )
}

export function AgentDashboard() {
  const { t } = useTranslation()
  const agents = useAgents()
  const supervisor = agents.find((a) => a.role === 'supervisor')
  const children = agents.filter((a) => a.role !== 'supervisor')

  return (
    <div className="flex flex-col gap-3">
      {supervisor && <AgentCard agent={supervisor} />}
      <div className="text-[11px] font-medium uppercase tracking-wide text-ink-tertiary">{t('artifact.parallelAgents')}</div>
      <div className="flex flex-col gap-2.5">
        {children.map((agent) => (
          <AgentCard key={agent.id} agent={agent} />
        ))}
      </div>
    </div>
  )
}
