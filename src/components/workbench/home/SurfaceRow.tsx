import type { CSSProperties } from 'react'
import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { ZoneId, ZoneModel } from '../workbenchTypes'
import { visualForZone } from '../visualForZone'
import { ZONE_ICON } from './icons'

const ACCENT: Record<ZoneId, string> = {
  sessions: 'var(--role-supervisor)',
  tasks: 'var(--role-coder)',
  automations: 'var(--role-reviewer)',
  knowledge: 'var(--role-planner)',
  terminals: 'var(--role-worker)',
  workflows: 'var(--role-supervisor)',
}

export function SurfaceRow({
  zone,
  selected = false,
  onOpen,
  onHover,
}: {
  zone: ZoneModel
  selected?: boolean
  onOpen: (zone: ZoneModel) => void
  onHover?: (id: ZoneId | null) => void
}) {
  const { t } = useTranslation()
  const tr = t as (key: string, opts?: Record<string, string | number>) => string
  const label = tr(zone.labelKey)
  const stateLabel = tr(`workbench.state.${zone.state}`)
  const primary = tr(zone.primaryMetricKey, zone.primaryMetricValues)
  const secondary = zone.secondaryMetricKey
    ? tr(zone.secondaryMetricKey, zone.secondaryMetricValues)
    : null
  const visual = visualForZone(zone.state, zone.progress)
  const Icon = ZONE_ICON[zone.id]
  const pct =
    zone.progress != null && zone.progress > 0
      ? Math.round(zone.progress * 100)
      : null

  return (
    <button
      type="button"
      data-testid={`workbench-zone-${zone.id}`}
      data-state={zone.state}
      data-tone={visual.tone}
      data-selected={selected ? 'true' : 'false'}
      aria-pressed={selected}
      onClick={() => onOpen(zone)}
      onMouseEnter={() => onHover?.(zone.id)}
      onMouseLeave={() => onHover?.(null)}
      onFocus={() => onHover?.(zone.id)}
      onBlur={() => onHover?.(null)}
      className={cn('wb-surface')}
      style={{ ['--surface-accent' as string]: ACCENT[zone.id] } as CSSProperties}
      aria-label={`${label}, ${stateLabel}, ${primary}`}
    >
      <span className="wb-surface-icon" aria-hidden>
        <Icon size={18} strokeWidth={1.75} />
      </span>

      <span className="wb-surface-body">
        <span className="wb-surface-top">
          <span className="wb-surface-name">{label}</span>
          <span className={cn('wb-surface-badge', `wb-surface-badge--${visual.tone}`)}>
            {stateLabel}
          </span>
        </span>
        <span className="wb-surface-meta">
          <span className="wb-surface-primary">{primary}</span>
          {secondary != null && (
            <span className="wb-surface-secondary">
              {secondary}
              {pct != null ? ` · ${pct}%` : ''}
            </span>
          )}
        </span>
        {visual.ringProgress != null && (
          <span className="wb-surface-bar" aria-hidden>
            <span
              className="wb-surface-bar-fill"
              style={{ width: `${Math.round(visual.ringProgress * 100)}%` }}
            />
          </span>
        )}
      </span>

      <ChevronRight className="wb-surface-chevron" size={16} strokeWidth={1.75} aria-hidden />
    </button>
  )
}
