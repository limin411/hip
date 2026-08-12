import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, CheckCircle2, XCircle, Circle, AlertTriangle } from 'lucide-react'
import type { AgentRun, TimelineStep, ToolCall } from '@hip/protocol'
import { cn } from '@/lib/utils'
import { TRAIL_ROW } from './TurnTimeline'
import {
  buildActivitySummary,
  formatActivityParts,
  formatElapsed,
  turnElapsedMs,
  type ActivityUiStatus,
} from '@/lib/activitySummary'

export interface TurnStatusLineProps {
  streaming?: boolean
  stopped?: boolean
  hasAssistantContent?: boolean
  steps?: TimelineStep[]
  toolCalls?: ToolCall[]
  agentRuns?: AgentRun[]
  /** Fallback start time when agentRuns lack startedAt (e.g. message.timestamp). */
  startedAt?: number | null
  className?: string
}

function statusIcon(status: ActivityUiStatus, streaming: boolean) {
  if (streaming || status === 'running') {
    return (
      <Loader2
        aria-hidden
        size={14}
        className="block shrink-0 animate-spin text-accent-strong"
        data-testid="turn-status-spinner"
      />
    )
  }
  if (status === 'error') {
    return (
      <XCircle size={14} className="block shrink-0 text-danger" data-testid="turn-status-error" />
    )
  }
  if (status === 'success_partial') {
    return (
      <AlertTriangle
        size={14}
        className="block shrink-0 text-warning"
        data-testid="turn-status-partial"
      />
    )
  }
  if (status === 'stopped') {
    return (
      <Circle
        size={14}
        className="block shrink-0 text-ink-tertiary"
        data-testid="turn-status-stopped"
      />
    )
  }
  return (
    <CheckCircle2
      size={14}
      className="block shrink-0 text-success"
      data-testid="turn-status-success"
    />
  )
}

/**
 * Compact status row at the bottom of a turn.
 * While streaming: phase (thinking / tool / writing) + live elapsed.
 * After settle: completed/stopped + duration (and light summary).
 */
export function TurnStatusLine({
  streaming = false,
  stopped,
  hasAssistantContent,
  steps,
  toolCalls,
  agentRuns,
  startedAt,
  className,
}: TurnStatusLineProps) {
  const { t } = useTranslation()
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!streaming) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [streaming])

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

  // Streaming: full phase narrative. Settled: compact status only (process detail stays in ActivityBar).
  const displayParts = useMemo(() => {
    if (streaming) return parts
    return parts.filter(
      (p) =>
        p.type === 'completed' ||
        p.type === 'stopped' ||
        p.type === 'partialTools',
    )
  }, [parts, streaming])

  const summaryText = formatActivityParts(
    displayParts,
    t as (key: string, params?: Record<string, unknown>) => string,
  )

  const elapsedMs = turnElapsedMs({
    agentRuns,
    startedAt,
    streaming,
    now: streaming ? now : undefined,
  })

  const elapsedLabel =
    elapsedMs != null && elapsedMs >= 0
      ? t('chat.activity.elapsed', { time: formatElapsed(elapsedMs) })
      : null

  const line = [summaryText, elapsedLabel].filter(Boolean).join(' · ')
  if (!line) return null

  return (
    <div
      className={cn(TRAIL_ROW, 'mt-1.5 text-ink-tertiary', className)}
      data-testid="turn-status-line"
      data-phase={streaming ? 'running' : 'settled'}
      data-status={status}
      role="status"
      aria-live="polite"
    >
      {/* Keyed remount on settle/state change → 120ms fade-in (P0-4);
          the spinner svg keeps its own animate-spin inside the wrapper. */}
      <span
        key={streaming ? 'live' : status}
        className="animate-status-icon block shrink-0"
        aria-hidden
      >
        {statusIcon(status, streaming)}
      </span>
      <span className="min-w-0 truncate" title={line} data-testid="turn-status-text">
        {summaryText}
        {elapsedLabel && (
          <>
            {' · '}
            <span className="font-mono tabular-nums">{elapsedLabel}</span>
          </>
        )}
      </span>
    </div>
  )
}
