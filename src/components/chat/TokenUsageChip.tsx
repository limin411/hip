import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useActiveMessages, useSessionTokenMeter } from '@/domain'
import {
  estimateContextBreakdown,
  inputBudgetFromUsage,
  selectLastUsage,
  type ContextBreakdownKey,
} from '@/lib/contextBreakdown'
import { formatTokensCompact } from '@/lib/formatTokens'
import { formatUsd } from '@/lib/usageCost'
import { cn } from '@/lib/utils'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/Popover'

/** Zone → text color for the session token chip (composer send-left). */
export function tokenUsageZoneClass(
  zone: 'success' | 'warning' | 'danger' | null | undefined,
): string {
  if (zone === 'success') return 'text-success'
  if (zone === 'warning') return 'text-warning'
  if (zone === 'danger') return 'text-danger'
  return 'text-ink-tertiary'
}

/** Segment colors for the stacked context bar (quiet, semantic-ish). */
const SEGMENT_BAR: Record<ContextBreakdownKey, string> = {
  user: 'bg-accent',
  assistant: 'bg-success',
  skills: 'bg-warning',
  tools: 'bg-ink-secondary/50',
  other: 'bg-ink-tertiary/40',
}

const SEGMENT_DOT: Record<ContextBreakdownKey, string> = {
  user: 'bg-accent',
  assistant: 'bg-success',
  skills: 'bg-warning',
  tools: 'bg-ink-secondary/50',
  other: 'bg-ink-tertiary/40',
}

const OPEN_DELAY_MS = 180
const CLOSE_DELAY_MS = 120

/**
 * Compact session token meter left of composer send/stop.
 * Hover opens a detailed context-occupancy panel (estimated breakdown).
 */
export function TokenUsageChip() {
  const { t } = useTranslation()
  const meter = useSessionTokenMeter()
  const messages = useActiveMessages()
  const [open, setOpen] = useState(false)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimers = useCallback(() => {
    if (openTimer.current) {
      clearTimeout(openTimer.current)
      openTimer.current = null
    }
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }, [])

  const scheduleOpen = useCallback(() => {
    clearTimers()
    openTimer.current = setTimeout(() => setOpen(true), OPEN_DELAY_MS)
  }, [clearTimers])

  const scheduleClose = useCallback(() => {
    clearTimers()
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS)
  }, [clearTimers])

  const lastUsage = useMemo(() => selectLastUsage(messages), [messages])
  const inputBudget = useMemo(() => inputBudgetFromUsage(lastUsage), [lastUsage])
  const segments = useMemo(
    () => (inputBudget != null ? estimateContextBreakdown(messages, inputBudget) : []),
    [messages, inputBudget],
  )

  if (!meter) return null

  const { contextTokens, contextWindow, percent, zone, cumulative, costUsd } = meter

  const primary =
    percent !== null
      ? t('chat.usage.percentage', { percent })
      : formatTokensCompact(contextTokens)

  const aria =
    percent !== null && contextWindow
      ? t('chat.usage.aria', {
          percent,
          used: contextTokens.toLocaleString(),
          total: contextWindow.toLocaleString(),
        })
      : t('chat.usage.ariaTokens', {
          used: contextTokens.toLocaleString(),
        })

  const segmentLabel = (key: ContextBreakdownKey) => t(`chat.usage.breakdown.${key}`)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span
          data-testid="session-usage"
          data-zone={zone ?? undefined}
          aria-label={aria}
          aria-haspopup="dialog"
          aria-expanded={open}
          onMouseEnter={scheduleOpen}
          onMouseLeave={scheduleClose}
          onFocus={scheduleOpen}
          onBlur={scheduleClose}
          tabIndex={0}
          className={cn(
            // Hide on very narrow composer rows so send stays reachable.
            'hidden shrink-0 cursor-default select-none rounded-full bg-surface-muted px-1.5 py-0.5 text-caption tabular-nums sm:inline-block',
            'outline-none focus-visible:ring-1 focus-visible:ring-ink/20',
            tokenUsageZoneClass(zone),
          )}
        >
          {primary}
        </span>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={8}
        className="w-[min(280px,calc(100vw-2rem))] p-3"
        data-testid="session-usage-popover"
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <div className="space-y-3">
          <div>
            <div className="flex items-baseline gap-1.5">
              <div className="text-caption font-medium text-ink">{t('chat.usage.contextTitle')}</div>
              {segments.length > 0 && (
                <span
                  className="cursor-help text-meta text-ink-tertiary"
                  title={t('chat.usage.breakdownNote')}
                  data-testid="session-usage-estimated"
                >
                  {t('chat.usage.estimated')}
                </span>
              )}
            </div>
            <div className="mt-0.5 text-meta text-ink-secondary tabular-nums">
              {percent !== null && contextWindow
                ? t('chat.usage.percentageTooltip', {
                    used: contextTokens.toLocaleString(),
                    total: contextWindow.toLocaleString(),
                    percent,
                  })
                : t('chat.usage.tokens', { total: contextTokens.toLocaleString() })}
            </div>
            {inputBudget != null && (
              <div className="mt-0.5 text-meta text-ink-tertiary tabular-nums">
                {t('chat.usage.lastInput', { tokens: inputBudget.toLocaleString() })}
              </div>
            )}
          </div>

          {segments.length > 0 && (
            <div className="space-y-2" data-testid="session-usage-breakdown">
              <div
                className="flex h-1.5 w-full overflow-hidden rounded-full bg-surface-muted"
                aria-hidden
              >
                {segments.map((s) => (
                  <div
                    key={s.key}
                    className={cn('h-full min-w-0', SEGMENT_BAR[s.key])}
                    style={{ width: `${s.width}%` }}
                    title={`${segmentLabel(s.key)}: ${s.tokens.toLocaleString()}`}
                  />
                ))}
              </div>
              <ul className="space-y-1">
                {segments.map((s) => (
                  <li
                    key={s.key}
                    className="flex items-center justify-between gap-3 text-meta"
                    data-testid={`session-usage-seg-${s.key}`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5 text-ink-secondary">
                      <span
                        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', SEGMENT_DOT[s.key])}
                        aria-hidden
                      />
                      <span className="truncate">{segmentLabel(s.key)}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-ink">
                      {formatTokensCompact(s.tokens)}
                      <span className="ml-1 text-ink-tertiary">
                        {t('chat.usage.segPercent', { percent: s.percent })}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="border-t border-border pt-2 space-y-1">
            <div className="flex justify-between gap-3 text-meta">
              <span className="text-ink-secondary">{t('chat.usage.sessionTotal')}</span>
              <span className="tabular-nums text-ink">
                {t('chat.usage.io', {
                  input: cumulative.inputTokens.toLocaleString(),
                  output: cumulative.outputTokens.toLocaleString(),
                })}
              </span>
            </div>
            {costUsd != null && (
              <div className="flex justify-between gap-3 text-meta">
                <span className="text-ink-secondary">{t('chat.usage.costLabel')}</span>
                <span className="tabular-nums text-ink">
                  {t('chat.usage.cost', { cost: formatUsd(costUsd) })}
                </span>
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
