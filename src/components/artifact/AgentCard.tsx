import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import type { AgentRole } from '@hip/protocol'
import type { AgentVM } from '@/domain'
import { cn } from '@/lib/utils'
import { ToolTrace } from './ToolTrace'

const ROLE_COLOR: Record<AgentRole, string> = {
  supervisor: 'var(--role-supervisor)',
  planner: 'var(--role-planner)',
  coder: 'var(--role-coder)',
  reviewer: 'var(--role-reviewer)',
}

function StatusDot({ status, color }: { status: AgentVM['status']; color: string }) {
  if (status === 'running') return <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: color }} />
  if (status === 'done') return <span className="h-2 w-2 rounded-full bg-ink-tertiary" />
  return <span className="h-2 w-2 rounded-full border border-border" />
}

export function AgentCard({ agent }: { agent: AgentVM }) {
  const { t } = useTranslation()
  const color = ROLE_COLOR[agent.role]
  // Follow run-status by default (open while running, collapsed when done); respect a manual toggle once set.
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? agent.status === 'running'
  return (
    <div className={cn('flex flex-col rounded-lg border bg-surface transition-colors', agent.status === 'running' ? 'border-accent/40' : 'border-border')}>
      <button onClick={() => setManual(!open)} aria-expanded={open} className="flex items-center justify-between gap-2 p-3 text-left" data-testid="agent-card-header">
        <div className="flex min-w-0 items-center gap-2">
          <ChevronRight size={12} className={cn('shrink-0 text-ink-tertiary transition-transform', open && 'rotate-90')} />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate text-[13px] font-semibold text-ink">{agent.title}</span>
          {agent.toolCalls.length > 0 && (
            <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] text-ink-tertiary">{t('artifact.toolsCount', { count: agent.toolCalls.length })}</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusDot status={agent.status} color={color} />
          <span className="text-[11px] capitalize text-ink-tertiary">{agent.status}</span>
        </div>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-3 pt-2.5">
          {agent.parentAgentId && agent.taskInput && (
            <div className="rounded-md bg-surface-muted px-2.5 py-1.5 text-[11px] leading-snug text-ink-secondary">
              <span className="text-ink-tertiary">↳ {t('artifact.delegatedBy')} Supervisor: </span>
              {agent.taskInput}
            </div>
          )}
          <ToolTrace tools={agent.toolCalls} />
          <div className="min-h-[28px] rounded-md bg-surface-muted px-2.5 py-1.5 text-[12px] leading-snug text-ink-secondary">
            {agent.tokens || <span className="text-ink-tertiary">{t('artifact.waiting')}</span>}
          </div>
          <div className="flex items-center gap-3 text-[11px] text-ink-tertiary">
            <span>{agent.tokenCount} tokens</span>
            <span>{(agent.elapsedMs / 1000).toFixed(1)}s</span>
          </div>
        </div>
      )}
    </div>
  )
}
