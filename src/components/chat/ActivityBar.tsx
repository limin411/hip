import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, CheckCircle2, XCircle, Circle, AlertTriangle } from 'lucide-react'
import type { AgentRole, AgentRun, TimelineStep, ToolCall } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { AgentBadge, TRAIL_ROW, TurnTimeline } from './TurnTimeline'
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
        className={cn('mb-2', TRAIL_ROW, 'text-ink-tertiary')}
        data-testid="activity-bar"
        role="status"
        aria-live="polite"
      >
        <Loader2 aria-hidden size={14} className="block shrink-0 animate-spin text-accent-strong" />
        <span className="inline-block h-2 w-2 shrink-0 animate-pulse rounded-full bg-accent" aria-hidden />
        <span className="min-w-0 truncate">{t('chat.activity.initializing')}</span>
      </div>
    )
  }

  const statusIcon =
    status === 'running' ? (
      <Loader2 size={14} className="block shrink-0 animate-spin text-accent-strong" />
    ) : status === 'error' ? (
      <XCircle size={14} className="block shrink-0 text-danger" data-testid="activity-status-error" />
    ) : status === 'success_partial' ? (
      <AlertTriangle size={14} className="block shrink-0 text-warning" data-testid="activity-status-partial" />
    ) : status === 'stopped' ? (
      <Circle size={14} className="block shrink-0 text-ink-tertiary" data-testid="activity-status-stopped" />
    ) : (
      <CheckCircle2 size={14} className="block shrink-0 text-success" data-testid="activity-status-success" />
    )

  // Always expanded (CLI-style process trail) — one min-h-5 row for icon/dot/text alignment.
  return (
    <div className="mb-2" data-testid="activity-bar" aria-live="polite">
      <div
        className={TRAIL_ROW}
        role="status"
        data-testid="activity-bar-summary"
      >
        {statusIcon}
        {activeRole ? (
          <span className={cn('inline-flex items-center', status === 'running' && 'animate-pulse')}>
            <AgentBadge role={activeRole} />
          </span>
        ) : (
          <Circle size={14} className="block shrink-0 text-ink-tertiary" />
        )}
        {activeRole && (
          <span className="shrink-0 font-medium text-ink-secondary">{t(`artifact.roles.${activeRole}`)}</span>
        )}
        <span className="min-w-0 truncate text-ink-tertiary" title={summaryText}>
          {summaryText}
        </span>
      </div>
      <div className="mt-1 flex flex-col gap-0.5 border-l border-border pl-3">
        <TurnTimeline steps={steps} toolCalls={toolCalls} agentRuns={agentRuns} hidePlan={hidePlan} />
      </div>
    </div>
  )
}
