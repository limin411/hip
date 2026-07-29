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

/** Abstract crop glyph per zone — playful, not literal produce. */
const CROP_CLASS: Record<ZoneId, string> = {
  sessions: 'wb-crop--chat',
  tasks: 'wb-crop--task',
  automations: 'wb-crop--auto',
  knowledge: 'wb-crop--know',
  terminals: 'wb-crop--term',
  workflows: 'wb-crop--auto',
}

export function FarmPlot({
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
      data-selected={selected ? 'true' : 'false'}
      aria-pressed={selected}
      onClick={() => onOpen(zone)}
      className={cn('wb-plot', CROP_CLASS[zone.id])}
      style={{ ['--plot-accent' as string]: ACCENT_BY_ZONE[zone.id] }}
      aria-label={`${label}, ${stateLabel}, ${primary}`}
    >
      {/* Wooden stake sign */}
      <div className="wb-plot-stake" aria-hidden>
        <div className="wb-plot-stake-pole" />
        <div className="wb-plot-stake-sign">
          <span className="wb-plot-stake-label">{label}</span>
          <span className="wb-plot-badge">{stateLabel}</span>
        </div>
      </div>

      {/* Raised bed */}
      <div className="wb-plot-bed">
        <div className="wb-plot-soil">
          <div className="wb-plot-furrow" />
          <div className="wb-plot-furrow" />
          <div className="wb-plot-furrow" />
        </div>

        {/* Abstract crops — density follows state via CSS */}
        <div className="wb-plot-crops" aria-hidden>
          <span className="wb-crop wb-crop-a" />
          <span className="wb-crop wb-crop-b" />
          <span className="wb-crop wb-crop-c" />
          <span className="wb-crop wb-crop-d" />
          <span className="wb-crop wb-crop-e" />
        </div>

        {/* Running: water sparkles */}
        {zone.state === 'running' && (
          <div className="wb-plot-spray" aria-hidden>
            <i />
            <i />
            <i />
          </div>
        )}

        {/* Fail/blocked: heat cracks */}
        {(zone.state === 'fail' || zone.state === 'blocked') && (
          <div className="wb-plot-cracks" aria-hidden />
        )}

        {showCartoon && (
          <div className="wb-plot-mascot">
            <WorkbenchMascot
              action={zone.mascotAction}
              size={72}
              forceStatic={forceStatic}
            />
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
