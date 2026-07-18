import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ROLE_COLOR, ROLE_NAME_KEY } from '@/lib/roleColor'
import type { TurnAgent } from '@/lib/turnAgents'
import { Badge } from '@/components/ui/Badge'
import { ToolTrace } from './ToolTrace'
import { useUiStore } from '@/store/uiStore'
import { useFocusStore } from '@/store/focusStore'

function StatusDot({ status, color }: { status: TurnAgent['status']; color: string }) {
  if (status === 'running') return <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: color }} data-testid="status-dot-running" />
  if (status === 'error') return <span className="h-2 w-2 rounded-full bg-danger" data-testid="status-dot-error" />
  return <span className="h-2 w-2 rounded-full bg-ink-tertiary" data-testid="status-dot-done" />
}

export function AgentCard({ agent, live }: { agent: TurnAgent; live: boolean }) {
  const { t } = useTranslation()
  const color = ROLE_COLOR[agent.role]
  const running = live && agent.status === 'running'
  const isError = agent.status === 'error'
  const [manual, setManual] = useState<boolean | null>(null)
  const open = manual ?? running
  const setScrollTarget = useUiStore((s) => s.setScrollTarget)

  const jumpToTurn = () => {
    if (agent.messageId) setScrollTarget(agent.messageId)
    useFocusStore.getState().setFocusedAgentId(agent.agentId)
  }

  return (
    <div
      className={cn(
        'flex flex-col rounded-lg border bg-surface transition-colors',
        running ? 'border-accent/40' : isError ? 'border-danger/40' : 'border-border',
      )}
      data-testid="agent-card"
      data-status={agent.status}
    >
      <button
        onClick={() => setManual(!open)}
        aria-expanded={open}
        className="flex min-h-9 items-center gap-1.5 px-3 py-2 text-left text-meta leading-5"
        data-testid="agent-card-header"
      >
        <ChevronRight size={14} className={cn('block shrink-0 text-ink-tertiary transition-transform', open && 'rotate-90')} />
        <StatusDot status={agent.status} color={color} />
        <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: isError ? 'var(--danger)' : color }} />
        <span className="min-w-0 truncate font-semibold text-ink">{t(ROLE_NAME_KEY[agent.role])}</span>
        {agent.tools.length > 0 && <Badge className="shrink-0">{t('artifact.toolsCount', { count: agent.tools.length })}</Badge>}
        {isError && (
          <Badge className="shrink-0 border-danger/30 bg-danger/10 text-danger">{t('artifact.failed')}</Badge>
        )}
        {typeof agent.totalTokens === 'number' && agent.totalTokens > 0 && (
          <span className="shrink-0 text-ink-tertiary" data-testid="agent-tokens">
            {t('artifact.tokens', { count: agent.totalTokens })}
          </span>
        )}
        <span className={cn('shrink-0 capitalize', isError ? 'text-danger' : 'text-ink-tertiary')}>
          {agent.status === 'done' && agent.elapsedMs > 0
            ? t('chat.thoughtFor', { seconds: Math.round(agent.elapsedMs / 1000) })
            : agent.status === 'error'
              ? t('artifact.failed')
              : agent.status}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-3 pt-2.5">
          {agent.messageId && (
            <button
              type="button"
              className="self-start text-caption text-accent hover:underline"
              onClick={jumpToTurn}
              data-testid="agent-jump-turn"
            >
              {t('artifact.jumpToTurn')}
            </button>
          )}
          {agent.taskInput && (
            <div className="rounded-md bg-surface-muted px-2.5 py-1.5 text-meta leading-snug text-ink-secondary">
              <span className="text-ink-tertiary">{t('artifact.delegatedBy')} {t(ROLE_NAME_KEY.supervisor)} · </span>
              {agent.taskInput}
            </div>
          )}
          {agent.reasoning && <pre className="whitespace-pre-wrap break-words rounded-md bg-surface-muted px-2.5 py-1.5 font-sans text-meta leading-snug text-ink-secondary">{agent.reasoning}</pre>}
          {agent.tools.length > 0 && (
            <ToolTrace
              tools={agent.tools}
              onToolClick={agent.messageId ? jumpToTurn : undefined}
            />
          )}
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
