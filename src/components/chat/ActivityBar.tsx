import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, CheckCircle2, XCircle, Circle, AlertTriangle, ChevronRight } from 'lucide-react'
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
  /** PR-5: pass through to TurnTimeline for global stepSeq TurnBlocks. */
  interleaved?: boolean
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
  interleaved,
}: ActivityBarProps) {
  const { t } = useTranslation()

  const ordered = useMemo(() => [...steps].sort((a, b) => a.stepSeq - b.stepSeq), [steps])
  const lastStep = ordered[ordered.length - 1]
  const activeRun = lastStep
    ? agentRuns.find((r) => r.agentId === lastStep.agentId) ?? agentRuns[agentRuns.length - 1]
    : agentRuns[agentRuns.length - 1]
  const activeRole: AgentRole | null = lastStep?.role ?? activeRun?.role ?? null
  const activeName = activeRun?.name?.trim()

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
  // Process trail defaults collapsed. Interleaved TurnBlocks embed answer text, so stay open.
  const [open, setOpen] = useState(!!interleaved)
  const trailOpen = interleaved || open

  if (!hasActivity) {
    if (!streaming) return null
    // Initializing: Loader2 only — no pulse dot (single motion).
    return (
      <div
        className={cn('mb-2', TRAIL_ROW, 'text-ink-tertiary')}
        data-testid="activity-bar"
        role="status"
        aria-live="polite"
      >
        <Loader2 aria-hidden size={14} className="block shrink-0 animate-spin text-accent-strong" />
        <span className="min-w-0 truncate">{t('chat.activity.initializing')}</span>
      </div>
    )
  }

  const isRunning = status === 'running'
  // Running + activeRole: no Loader2 (pulse on AgentBadge only). Running without role: Loader2 only.
  const statusIcon = isRunning
    ? activeRole
      ? null
      : (
          <Loader2 size={14} className="block shrink-0 animate-spin text-accent-strong" />
        )
    : status === 'error' ? (
        <XCircle size={14} className="block shrink-0 text-danger" data-testid="activity-status-error" />
      ) : status === 'success_partial' ? (
        <AlertTriangle size={14} className="block shrink-0 text-warning" data-testid="activity-status-partial" />
      ) : status === 'stopped' ? (
        <Circle size={14} className="block shrink-0 text-ink-tertiary" data-testid="activity-status-stopped" />
      ) : (
        <CheckCircle2 size={14} className="block shrink-0 text-success" data-testid="activity-status-success" />
      )

  return (
    <div className="mb-2" data-testid="activity-bar" aria-live="polite">
      {interleaved ? (
        <div
          className={TRAIL_ROW}
          role="status"
          data-testid="activity-bar-summary"
        >
          {statusIcon}
          {activeRole ? (
            <span className={cn('inline-flex items-center', isRunning && 'animate-pulse')}>
              <AgentBadge role={activeRole} />
            </span>
          ) : !isRunning ? (
            <Circle size={14} className="block shrink-0 text-ink-tertiary" />
          ) : null}
          {activeRole && (
            <span className="shrink-0 font-medium text-ink-secondary">
              {activeName || t(`artifact.roles.${activeRole}`)}
            </span>
          )}
          <span className="min-w-0 truncate text-ink-tertiary" title={summaryText}>
            {summaryText}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className={cn(TRAIL_ROW, 'w-full text-ink-tertiary transition-colors hover:text-ink-secondary')}
          data-testid="activity-bar-summary"
        >
          <ChevronRight
            size={14}
            className={cn('block shrink-0 transition-transform', open && 'rotate-90')}
          />
          {statusIcon}
          {activeRole ? (
            <span className={cn('inline-flex items-center', isRunning && 'animate-pulse')}>
              <AgentBadge role={activeRole} />
            </span>
          ) : !isRunning ? (
            <Circle size={14} className="block shrink-0 text-ink-tertiary" />
          ) : null}
          {activeRole && (
            <span className="shrink-0 font-medium text-ink-secondary">
              {activeName || t(`artifact.roles.${activeRole}`)}
            </span>
          )}
          <span className="min-w-0 truncate" title={summaryText}>
            {summaryText}
          </span>
        </button>
      )}
      {/* O3: interleaved TurnBlocks (incl. answer text) sit outside the process rail so
          supervisor prose is not demoted under border-l + meta chrome. */}
      {trailOpen && (
        <div
          className={
            interleaved
              ? 'mt-1 flex flex-col gap-1'
              : 'mt-1 flex flex-col gap-0.5 border-l border-border pl-3'
          }
        >
          <TurnTimeline
            steps={steps}
            toolCalls={toolCalls}
            agentRuns={agentRuns}
            hidePlan={hidePlan}
            interleaved={interleaved}
          />
        </div>
      )}
    </div>
  )
}
