import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2, CheckCircle2, XCircle, Circle } from 'lucide-react'
import type { AgentRole, AgentRun, TimelineStep, ToolCall } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { AgentBadge, TurnTimeline } from './TurnTimeline'

interface ActivityBarProps {
  steps?: TimelineStep[]
  toolCalls?: ToolCall[]
  agentRuns?: AgentRun[]
  streaming?: boolean
}

export function ActivityBar({ steps = [], toolCalls = [], agentRuns = [], streaming }: ActivityBarProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const ordered = useMemo(() => [...steps].sort((a, b) => a.stepSeq - b.stepSeq), [steps])
  const lastStep = ordered[ordered.length - 1]
  const activeRole: AgentRole | null = lastStep?.role ?? agentRuns[agentRuns.length - 1]?.role ?? null

  const agentCount = useMemo(() => {
    const ids = new Set(agentRuns.filter((r) => r.role !== 'supervisor').map((r) => r.agentId))
    return ids.size
  }, [agentRuns])

  const byCallId = useMemo(() => new Map(toolCalls.map((tc) => [tc.callId, tc])), [toolCalls])

  const currentStepText = useMemo(() => {
    if (!lastStep) return null
    if (lastStep.kind === 'reasoning') return t('chat.activity.runningReasoning')
    const tool = byCallId.get(lastStep.callId)
    if (tool) return t('chat.activity.runningTool', { name: tool.name })
    return null
  }, [lastStep, byCallId, t])

  const hasActivity = steps.length > 0 || toolCalls.length > 0 || agentRuns.length > 0
  if (!hasActivity) {
    if (!streaming) return null
    return (
      <div
        className="mb-2 flex items-center gap-2 rounded-lg border border-border bg-surface-muted/40 px-2.5 py-1.5"
        data-testid="activity-bar"
        role="status"
        aria-live="polite"
      >
        <span className="mt-1.5 h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-meta text-ink-tertiary">{t('chat.activity.initializing')}</span>
        <Loader2 aria-hidden size={14} className="animate-spin text-accent-strong" />
      </div>
    )
  }

  const totalCount = toolCalls.length
  const finishedCount = toolCalls.filter((t) => t.status === 'finished').length
  const hasError = toolCalls.some((t) => t.status === 'error')
  const status: 'running' | 'finished' | 'error' = hasError ? 'error' : streaming ? 'running' : 'finished'

  const summaryText = streaming
    ? (currentStepText ?? t('chat.activity.runningReasoning'))
    : hasError
      ? t('chat.activity.completedWithError', { finished: finishedCount, total: totalCount, agents: agentCount })
      : t('chat.activity.completed', { finished: finishedCount, total: totalCount, agents: agentCount })

  const barClassName = cn(
    'flex w-full items-center gap-2 rounded-lg border border-border bg-surface-muted/40 px-2.5 py-1.5 text-left transition-colors hover:border-accent/30 hover:bg-surface-muted/60',
  )

  const barContent = (
    <>
      {activeRole ? (
        <span className={cn('inline-flex', status === 'running' && 'animate-pulse')}>
          <AgentBadge role={activeRole} />
        </span>
      ) : (
        <Circle size={10} className="mt-1.5 text-ink-tertiary" />
      )}
      {activeRole && (
        <span className="shrink-0 text-meta font-medium text-ink-secondary">{t(`artifact.roles.${activeRole}`)}</span>
      )}
      <span className="min-w-0 flex-1 truncate text-meta text-ink-tertiary">{summaryText}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {status === 'running' && <Loader2 size={14} className="animate-spin text-accent-strong" />}
        {status === 'finished' && <CheckCircle2 size={14} className="text-success" />}
        {status === 'error' && <XCircle size={14} className="text-danger" />}
        <ChevronRight size={14} className={cn('text-ink-tertiary transition-transform', open && 'rotate-90')} />
      </span>
    </>
  )

  return (
    <div className="mb-2" data-testid="activity-bar" aria-live="polite">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className={barClassName}>
        {barContent}
      </button>
      {open && (
        <div className="mt-1.5 rounded-lg border border-border bg-surface-muted/30 px-2 py-1.5">
          <TurnTimeline steps={steps} toolCalls={toolCalls} agentRuns={agentRuns} />
        </div>
      )}
    </div>
  )
}
