import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { ZoneId, ZoneModel } from './workbenchTypes'
import { WorkbenchMascot } from './WorkbenchMascot'

const ACCENT_BY_ZONE: Record<ZoneId, string> = {
  sessions: 'var(--role-supervisor)',
  tasks: 'var(--role-coder)',
  automations: 'var(--role-reviewer)',
  knowledge: 'var(--role-planner)',
  terminals: 'var(--role-worker)',
  workflows: 'var(--role-supervisor)',
}

const CROP_CLASS: Record<ZoneId, string> = {
  sessions: 'wb-crop--chat',
  tasks: 'wb-crop--task',
  automations: 'wb-crop--auto',
  knowledge: 'wb-crop--know',
  terminals: 'wb-crop--term',
  workflows: 'wb-crop--auto',
}

/** Per-plot lane bias so the row of farmers doesn't mirror each other. */
const LANE_BY_ZONE: Record<ZoneId, 'left' | 'center' | 'right'> = {
  sessions: 'left',
  tasks: 'center',
  automations: 'right',
  knowledge: 'left',
  terminals: 'right',
  workflows: 'center',
}

export function FarmPlot({
  zone,
  onOpen,
  showCartoon = true,
  forceStatic = false,
  selected = false,
  /** Index in the row — staggers idle animation phase. */
  plotIndex = 0,
}: {
  zone: ZoneModel
  onOpen: (zone: ZoneModel) => void
  showCartoon?: boolean
  forceStatic?: boolean
  selected?: boolean
  plotIndex?: number
}) {
  const { t } = useTranslation()
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

  const lane = LANE_BY_ZONE[zone.id]
  const animDelay = `${(plotIndex % 5) * 0.35}s`

  return (
    <button
      type="button"
      data-testid={`workbench-zone-${zone.id}`}
      data-state={zone.state}
      data-selected={selected ? 'true' : 'false'}
      data-lane={lane}
      aria-pressed={selected}
      onClick={() => onOpen(zone)}
      className={cn('wb-plot', CROP_CLASS[zone.id])}
      style={
        {
          ['--plot-accent' as string]: ACCENT_BY_ZONE[zone.id],
          ['--mascot-delay' as string]: animDelay,
        } as CSSProperties
      }
      aria-label={`${label}, ${stateLabel}, ${primary}`}
    >
      <div className="wb-plot-stake" aria-hidden>
        <div className="wb-plot-stake-pole" />
        <div className="wb-plot-stake-sign">
          <span className="wb-plot-stake-label">{label}</span>
          <span className="wb-plot-badge">{stateLabel}</span>
        </div>
      </div>

      {/* Stage: bed + free mascot (mascot outside bed overflow) */}
      <div className="wb-plot-stage">
        <div className="wb-plot-bed">
          <div className="wb-plot-soil">
            <div className="wb-plot-furrow" />
            <div className="wb-plot-furrow" />
            <div className="wb-plot-furrow" />
          </div>

          <div className="wb-plot-crops" aria-hidden>
            <span className="wb-crop wb-crop-a" />
            <span className="wb-crop wb-crop-b" />
            <span className="wb-crop wb-crop-c" />
            <span className="wb-crop wb-crop-d" />
            <span className="wb-crop wb-crop-e" />
          </div>

          {zone.state === 'running' && (
            <div className="wb-plot-spray" aria-hidden>
              <i />
              <i />
              <i />
            </div>
          )}

          {(zone.state === 'fail' || zone.state === 'blocked') && (
            <div className="wb-plot-cracks" aria-hidden />
          )}
        </div>

        {showCartoon && (
          <div
            className="wb-plot-mascot"
            data-state={zone.state}
            data-lane={lane}
            aria-hidden
          >
            <div className="wb-plot-mascot-bob">
              <WorkbenchMascot
                action={zone.mascotAction}
                size={80}
                forceStatic={forceStatic}
              />
            </div>
            <span className="wb-plot-mascot-ground" />
          </div>
        )}
      </div>

      <div className="wb-plot-meta">
        <div className="wb-plot-metric">{primary}</div>
        {secondary != null && (
          <div className="wb-plot-metric-sec">
            {secondary}
            {pct}
          </div>
        )}
        {zone.progress != null && zone.progress > 0 && (
          <div className="wb-plot-progress" aria-hidden>
            <div
              className="wb-plot-progress-fill"
              style={{ width: `${Math.round(zone.progress * 100)}%` }}
            />
          </div>
        )}
        <div className="wb-plot-cta">{t('workbench.openZone', { name: label })}</div>
      </div>

      <div className="wb-plot-shadow" aria-hidden />
    </button>
  )
}
