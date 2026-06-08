import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import type { AgentRole, ToolCall } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { ROLE_COLOR } from '@/lib/roleColor'
import { ToolTrace } from './ToolTrace'

/** Per-turn, per-agent activity bucket (derived from a Message's timeline + toolCalls). */
export interface TurnAgent {
  agentId: string
  role: AgentRole
  reasoning: string
  tools: ToolCall[]
  status: 'running' | 'done'
}

const ROLE_TITLE: Record<AgentRole, string> = { supervisor: 'Supervisor', planner: 'Planner', coder: 'Coder', reviewer: 'Reviewer' }

function StatusDot({ status, color }: { status: TurnAgent['status']; color: string }) {
  if (status === 'running') return <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: color }} />
  return <span className="h-2 w-2 rounded-full bg-ink-tertiary" />
}

export function AgentCard({ agent, live }: { agent: TurnAgent; live: boolean }) {
  const { t } = useTranslation()
  const color = ROLE_COLOR[agent.role]
  const running = live && agent.status === 'running'
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? running
  return (
    <div className={cn('flex flex-col rounded-lg border bg-surface transition-colors', running ? 'border-accent/40' : 'border-border')}>
      <button onClick={() => setManual(!open)} aria-expanded={open} className="flex items-center justify-between gap-2 p-3 text-left" data-testid="agent-card-header">
        <div className="flex min-w-0 items-center gap-2">
          <ChevronRight size={12} className={cn('shrink-0 text-ink-tertiary transition-transform', open && 'rotate-90')} />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
          <span className="truncate text-[13px] font-semibold text-ink">{ROLE_TITLE[agent.role]}</span>
          {agent.tools.length > 0 && <span className="shrink-0 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] text-ink-tertiary">{t('artifact.toolsCount', { count: agent.tools.length })}</span>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusDot status={agent.status} color={color} />
          <span className="text-[11px] capitalize text-ink-tertiary">{agent.status}</span>
        </div>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-3 pt-2.5">
          {agent.reasoning && <pre className="whitespace-pre-wrap break-words rounded-md bg-surface-muted px-2.5 py-1.5 font-sans text-[12px] leading-snug text-ink-secondary">{agent.reasoning}</pre>}
          <ToolTrace tools={agent.tools} />
        </div>
      )}
    </div>
  )
}
