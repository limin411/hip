import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ROLE_COLOR, ROLE_NAME_KEY } from '@/lib/roleColor'
import type { TurnAgent } from '@/lib/turnAgents'
import { Badge } from '@/components/ui/Badge'
import { ToolTrace } from './ToolTrace'

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
          <span className="truncate text-body font-semibold text-ink">{t(ROLE_NAME_KEY[agent.role])}</span>
          {agent.tools.length > 0 && <Badge className="shrink-0">{t('artifact.toolsCount', { count: agent.tools.length })}</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <StatusDot status={agent.status} color={color} />
          <span className="text-caption capitalize text-ink-tertiary">
            {agent.status === 'done' && agent.elapsedMs > 0
              ? t('chat.thoughtFor', { seconds: Math.round(agent.elapsedMs / 1000) })
              : agent.status}
          </span>
        </div>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-3 pt-2.5">
          {agent.taskInput && (
            <div className="rounded-md bg-surface-muted px-2.5 py-1.5 text-meta leading-snug text-ink-secondary">
              <span className="text-ink-tertiary">{t('artifact.delegatedBy')} {t(ROLE_NAME_KEY.supervisor)} · </span>
              {agent.taskInput}
            </div>
          )}
          {agent.reasoning && <pre className="whitespace-pre-wrap break-words rounded-md bg-surface-muted px-2.5 py-1.5 font-sans text-meta leading-snug text-ink-secondary">{agent.reasoning}</pre>}
          {agent.tools.length > 0 && <ToolTrace tools={agent.tools} />}
          {agent.role !== 'supervisor' && agent.output && (
            <div>
              <div className="mb-1 text-caption font-medium uppercase tracking-wide text-ink-tertiary">{t('artifact.output')}</div>
              <pre className="whitespace-pre-wrap break-words rounded-md bg-surface-muted px-2.5 py-1.5 font-sans text-meta leading-snug text-ink-secondary">{agent.output}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
