import { useMemo, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, CheckCircle2, XCircle, Circle, AlertTriangle, ChevronRight } from 'lucide-react'
import type { AgentRole, AgentRun, TimelineStep, ToolCall } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { AgentBadge, TRAIL_ROW, TurnTimeline } from './TurnTimeline'
import { buildActivitySummary, formatActivityParts } from '@/lib/activitySummary'

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
  /**
   * Process chrome rendered only when the trail is expanded (e.g. SubAgentCards).
   * Kept outside TurnTimeline so nested agent cards share the same fold as tools.
   */
  children?: ReactNode
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
  children,
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

  const summaryText = formatActivityParts(
    parts,
    t as (key: string, params?: Record<string, unknown>) => string,
  )

  const hasActivity = steps.length > 0 || toolCalls.length > 0 || agentRuns.length > 0
  // Process chrome (tools / reasoning / SubAgentCards) defaults collapsed.
  // Interleaved turns still keep a fold control: when collapsed we only leave answer text visible.
  const [open, setOpen] = useState(false)

  if (!hasActivity) {
    if (!streaming) return null
    // Initializing: Loader2 only — no pulse dot (single motion).
    return (
      <div
        className={cn('mb-2', TRAIL_ROW, 'text-ink-tertiary')}
        data-testid="activity-bar"
        data-phase="initializing"
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

  // Terminal settle rail — quiet while running; semantic edge when the turn settles.
  const settleRail = !isRunning
    ? status === 'error'
      ? 'border-l-2 border-l-danger pl-2'
      : status === 'success_partial'
        ? 'border-l-2 border-l-warning pl-2'
        : status === 'stopped'
          ? 'border-l-2 border-l-border-strong pl-2'
          : 'border-l-2 border-l-success pl-2'
    : undefined

  // Interleaved: always mount a timeline shell so answer text stays available when process is folded.
  // Legacy: only mount the full process trail when expanded.
  const showTimeline = open || !!interleaved
  const answerOnly = !!interleaved && !open

  return (
    <div
      className={cn('mb-2', settleRail && 'animate-message-enter')}
      data-testid="activity-bar"
      data-status={status}
      data-phase={isRunning ? 'running' : 'settled'}
      aria-live="polite"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          TRAIL_ROW,
          'w-full text-ink-tertiary transition-colors hover:text-ink-secondary',
          settleRail,
        )}
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
      {/* O3: interleaved TurnBlocks (incl. answer text) sit outside the process rail so
          supervisor prose is not demoted under border-l + meta chrome.
          Process fold: tools / reasoning / SubAgentCards hide when collapsed; interleaved
          answer text remains via answerOnly. */}
      {showTimeline && (
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
            hidePlan={hidePlan || answerOnly}
            interleaved={interleaved}
            answerOnly={answerOnly}
          />
        </div>
      )}
      {/* SubAgentCards share the trail fold but keep their own left rail (not nested in the process border). */}
      {open && children ? <div className="mt-1">{children}</div> : null}
    </div>
  )
}
