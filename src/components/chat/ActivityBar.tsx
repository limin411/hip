import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Loader2, CheckCircle2, XCircle, Circle, AlertTriangle } from 'lucide-react'
import type { AgentRole, AgentRun, TimelineStep, ToolCall } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { AgentBadge, TurnTimeline } from './TurnTimeline'
import { buildActivitySummary, type SummaryPart } from '@/lib/activitySummary'

interface ActivityBarProps {
  steps?: TimelineStep[]
  toolCalls?: ToolCall[]
  agentRuns?: AgentRun[]
  streaming?: boolean
  stopped?: boolean
  hasAssistantContent?: boolean
  /** When true, omit TodoChecklist inside the expanded timeline (live plan is sticky). */
  hidePlan?: boolean
}

function formatParts(
  parts: SummaryPart[],
  t: (key: string, params?: Record<string, unknown>) => string,
): string {
  const bits: string[] = []
  for (const p of parts) {
    switch (p.type) {
      case 'completed':
        bits.push(t('chat.activity.completed'))
        break
      case 'stopped':
        bits.push(t('chat.activity.stopped'))
        break
      case 'toolCount':
        bits.push(t('chat.activity.toolCount', { finished: p.finished, total: p.total }))
        break
      case 'agentCount':
        bits.push(t('chat.activity.agentCount', { agents: p.agents }))
        break
      case 'partialTools':
        bits.push(t('chat.activity.partialTools', { count: p.count }))
        break
      case 'categorySummary': {
        const segs: string[] = []
        if (p.search > 0) segs.push(t('chat.activity.catSearch', { count: p.search }))
        if (p.read > 0) segs.push(t('chat.activity.catRead', { count: p.read }))
        if (p.browse > 0) segs.push(t('chat.activity.catBrowse', { count: p.browse }))
        if (segs.length) bits.push(segs.join(' · '))
        break
      }
      case 'taskHint':
        bits.push(p.text)
        break
      case 'runningTool':
        bits.push(t('chat.activity.runningTool', { name: p.label }))
        break
      case 'runningReasoning':
        bits.push(t('chat.activity.runningReasoning'))
        break
      case 'initializing':
        bits.push(t('chat.activity.initializing'))
        break
      case 'planProgress':
        bits.push(t('chat.activity.planProgress', { done: p.done, total: p.total }))
        break
    }
  }
  return bits.join(' · ')
}

export function ActivityBar({
  steps = [],
  toolCalls = [],
  agentRuns = [],
  streaming,
  stopped,
  hasAssistantContent,
  hidePlan,
}: ActivityBarProps) {
  const { t } = useTranslation()
  // Spec U2: running turn process is expanded by default so tools are visible without a click.
  const [open, setOpen] = useState(!!streaming)

  const ordered = useMemo(() => [...steps].sort((a, b) => a.stepSeq - b.stepSeq), [steps])
  const lastStep = ordered[ordered.length - 1]
  const activeRole: AgentRole | null = lastStep?.role ?? agentRuns[agentRuns.length - 1]?.role ?? null

  const { status, parts } = useMemo(
    () =>
      buildActivitySummary({
        streaming,
        stopped,
        hasAssistantContent,
        steps,
        toolCalls,
        agentRuns,
      }),
    [streaming, stopped, hasAssistantContent, steps, toolCalls, agentRuns],
  )

  const summaryText = formatParts(parts, t as (key: string, params?: Record<string, unknown>) => string)

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

  const statusIcon =
    status === 'running' ? (
      <Loader2 size={14} className="animate-spin text-accent-strong" />
    ) : status === 'error' ? (
      <XCircle size={14} className="text-danger" data-testid="activity-status-error" />
    ) : status === 'success_partial' ? (
      <AlertTriangle size={14} className="text-warning" data-testid="activity-status-partial" />
    ) : status === 'stopped' ? (
      <Circle size={14} className="text-ink-tertiary" data-testid="activity-status-stopped" />
    ) : (
      <CheckCircle2 size={14} className="text-success" data-testid="activity-status-success" />
    )

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
      <span className="min-w-0 flex-1 truncate text-meta text-ink-tertiary" title={summaryText}>
        {summaryText}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {statusIcon}
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
          <TurnTimeline steps={steps} toolCalls={toolCalls} agentRuns={agentRuns} hidePlan={hidePlan} />
        </div>
      )}
    </div>
  )
}
