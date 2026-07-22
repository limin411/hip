import { useTranslation } from 'react-i18next'
import { useSessionTokenMeter } from '@/domain'
import { formatTokensCompact } from '@/lib/formatTokens'
import { formatUsd } from '@/lib/usageCost'
import { cn } from '@/lib/utils'

/** Zone → text color for the session token chip (composer send-left). */
export function tokenUsageZoneClass(
  zone: 'success' | 'warning' | 'danger' | null | undefined,
): string {
  if (zone === 'success') return 'text-success'
  if (zone === 'warning') return 'text-warning'
  if (zone === 'danger') return 'text-danger'
  return 'text-ink-tertiary'
}

/**
 * Compact session token meter left of composer send/stop.
 * Hidden when no active session usage; percent uses last-turn context fill.
 */
export function TokenUsageChip() {
  const { t } = useTranslation()
  const meter = useSessionTokenMeter()
  if (!meter) return null

  const { contextTokens, contextWindow, percent, zone, cumulative, costUsd } = meter

  const primary =
    percent !== null
      ? t('chat.usage.percentage', { percent })
      : formatTokensCompact(contextTokens)

  const tooltipParts: string[] = []
  if (percent !== null && contextWindow) {
    tooltipParts.push(
      t('chat.usage.percentageTooltip', {
        used: contextTokens.toLocaleString(),
        total: contextWindow.toLocaleString(),
        percent,
      }),
    )
  } else {
    tooltipParts.push(formatTokensCompact(contextTokens))
  }
  tooltipParts.push(
    `${t('chat.usage.sessionTotal')}: ${t('chat.usage.io', {
      input: cumulative.inputTokens.toLocaleString(),
      output: cumulative.outputTokens.toLocaleString(),
    })}`,
  )
  if (costUsd != null) {
    tooltipParts.push(t('chat.usage.cost', { cost: formatUsd(costUsd) }))
  }
  const title = tooltipParts.join(' · ')

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

  return (
    <span
      data-testid="session-usage"
      data-zone={zone ?? undefined}
      title={title}
      aria-label={aria}
      className={cn(
        // Hide on very narrow composer rows so send stays reachable (Codex-style collapse).
        'hidden shrink-0 select-none rounded-full bg-surface-muted px-1.5 py-0.5 text-caption tabular-nums sm:inline-block',
        tokenUsageZoneClass(zone),
      )}
    >
      {primary}
    </span>
  )
}
