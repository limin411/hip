import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { ZoneModel, ZoneState } from './workbenchTypes'
import { WorkbenchMascot } from './WorkbenchMascot'

const STATE_BADGE: Record<ZoneState, string> = {
  idle: 'bg-surface-muted text-ink-secondary',
  running: 'bg-surface-muted text-ink',
  blocked: 'bg-[color-mix(in_srgb,var(--warning)_14%,white)] text-[var(--warning)]',
  done: 'bg-[color-mix(in_srgb,var(--success)_14%,white)] text-[var(--success)]',
  fail: 'bg-[color-mix(in_srgb,var(--danger)_12%,white)] text-[var(--danger)]',
}

function ProgressRing({
  progress,
  className,
}: {
  progress: number | null
  className?: string
}) {
  const r = 42
  const c = 2 * Math.PI * r
  const p = progress == null ? 0 : Math.max(0, Math.min(1, progress))
  const show = progress != null && progress > 0
  return (
    <svg
      className={cn('absolute inset-0 h-full w-full -rotate-90', className)}
      viewBox="0 0 100 100"
      aria-hidden
    >
      <circle
        cx="50"
        cy="50"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
        className="text-border opacity-40"
      />
      {show && (
        <circle
          cx="50"
          cy="50"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - p)}
          className="text-ink-secondary transition-[stroke-dashoffset] duration-300"
        />
      )}
    </svg>
  )
}

export function ZoneCard({
  zone,
  onOpen,
  showCartoon = true,
  forceStatic = false,
  selected = false,
}: {
  zone: ZoneModel
  onOpen: (zone: ZoneModel) => void
  showCartoon?: boolean
  forceStatic?: boolean
  selected?: boolean
}) {
  const { t } = useTranslation()
  // Dynamic metric keys + interpolation bags — keep keys typed on ZoneModel, cast call site.
  const tr = t as (key: string, opts?: Record<string, string | number>) => string
  const stateKey = `workbench.state.${zone.state}`
  const label = tr(zone.labelKey)
  const primary = tr(zone.primaryMetricKey, zone.primaryMetricValues)
  const secondary = zone.secondaryMetricKey
    ? tr(zone.secondaryMetricKey, zone.secondaryMetricValues)
    : null
  const stateLabel = tr(stateKey)
  const pct =
    zone.progress != null && zone.progress > 0
      ? ` · ${Math.round(zone.progress * 100)}%`
      : ''

  return (
    <button
      type="button"
      data-testid={`workbench-zone-${zone.id}`}
      data-state={zone.state}
      aria-pressed={selected}
      onClick={() => onOpen(zone)}
      className={cn(
        'group flex flex-col rounded-xl border border-border bg-surface p-3.5 text-left',
        'border-t-[3px] transition-[transform,box-shadow,border-color] duration-150',
        'hover:-translate-y-0.5 hover:shadow-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        selected && 'ring-2 ring-accent/30',
        zone.accentClass,
      )}
      aria-label={`${label}, ${stateLabel}, ${primary}`}
    >
      <div className="mb-1 flex items-start justify-between gap-2">
        <div className="text-meta font-semibold tracking-tight text-ink">{label}</div>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide',
            STATE_BADGE[zone.state],
          )}
        >
          {stateLabel}
        </span>
      </div>

      {showCartoon ? (
        <div className="relative mx-auto my-1 flex h-[112px] w-[112px] items-center justify-center">
          <ProgressRing progress={zone.progress} />
          <WorkbenchMascot
            action={zone.mascotAction}
            size={88}
            forceStatic={forceStatic}
          />
        </div>
      ) : (
        <div className="relative mx-auto my-3 flex h-10 w-10 items-center justify-center">
          <ProgressRing progress={zone.progress} />
        </div>
      )}

      <div className="mt-1 flex items-baseline justify-between gap-2">
        <span className="text-body font-semibold tracking-tight text-ink">{primary}</span>
        {secondary != null && (
          <span className="text-meta text-ink-tertiary">
            {secondary}
            {pct}
          </span>
        )}
      </div>
      <div className="mt-2 text-meta font-semibold text-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
        {t('workbench.openZone', { name: label })}
      </div>
    </button>
  )
}
