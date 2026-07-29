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

export function OfficeDesk({
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
      className="wb-desk"
      style={{ ['--desk-accent' as string]: ACCENT_BY_ZONE[zone.id] }}
      aria-label={`${label}, ${stateLabel}, ${primary}`}
    >
      <div className="wb-desk-screen" aria-hidden>
        <div className="wb-desk-screen-glow" />
        <div className="wb-desk-screen-lines" />
      </div>
      <div className="wb-desk-neck" aria-hidden />
      <div className="wb-desk-plate">
        {showCartoon && (
          <div className="wb-desk-mascot">
            <WorkbenchMascot
              action={zone.mascotAction}
              size={64}
              forceStatic={forceStatic}
            />
          </div>
        )}
        <div className={cn('wb-desk-label', !showCartoon && 'mt-1')}>
          <div className="wb-desk-title-row">
            <span className="wb-desk-title">{label}</span>
            <span className="wb-desk-badge">{stateLabel}</span>
          </div>
          <div className="wb-desk-metric">{primary}</div>
          {secondary != null && (
            <div className="wb-desk-metric-sec">
              {secondary}
              {pct}
            </div>
          )}
          <div className="wb-desk-cta">{t('workbench.openZone', { name: label })}</div>
        </div>
      </div>
      <div className="wb-desk-legs" aria-hidden>
        <span />
        <span />
      </div>
    </button>
  )
}
