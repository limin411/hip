import { useRef, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { ZoneId, ZoneModel, ZoneState } from '../workbenchTypes'
import {
  killFarmJuice,
  playPlotClick,
  playPlotHover,
  resetPlotHover,
} from '../farm/farmJuice'
import { mascotForZone } from './mascotForZone'
import { IsoMascot } from './IsoMascot'
import { ISO_TH, ISO_TW, isoProject, ZONE_CELL } from './isoLayout'

const ACCENT: Record<ZoneId, string> = {
  sessions: 'var(--role-supervisor)',
  tasks: 'var(--role-coder)',
  automations: 'var(--role-reviewer)',
  knowledge: 'var(--role-planner)',
  terminals: 'var(--role-worker)',
  workflows: 'var(--role-supervisor)',
}

/** 0 wilted · 1 seedling · 2 growing · 3 harvest-ready */
export function growthForZone(state: ZoneState, progress: number | null | undefined): 0 | 1 | 2 | 3 {
  if (state === 'fail' || state === 'blocked') return 0
  if (state === 'done') return 3
  if (state === 'running') {
    if (progress != null && progress >= 0.75) return 3
    if (progress != null && progress >= 0.35) return 2
    return 2
  }
  if (progress != null && progress > 0.5) return 2
  if (progress != null && progress > 0.1) return 1
  return 1
}

export function IsoPlot({
  zone,
  originX,
  originY,
  selected,
  forceStatic,
  plotIndex,
  onOpen,
}: {
  zone: ZoneModel
  originX: number
  originY: number
  selected: boolean
  forceStatic: boolean
  plotIndex: number
  onOpen: (zone: ZoneModel) => void
}) {
  const { t } = useTranslation()
  const tr = t as (key: string, opts?: Record<string, string | number>) => string
  const btnRef = useRef<HTMLButtonElement>(null)
  const cell = ZONE_CELL[zone.id]
  const { x, y } = isoProject(cell.col, cell.row)
  const label = tr(zone.labelKey)
  const stateLabel = tr(`workbench.state.${zone.state}`)
  const primary = tr(zone.primaryMetricKey, zone.primaryMetricValues)
  const secondary = zone.secondaryMetricKey
    ? tr(zone.secondaryMetricKey, zone.secondaryMetricValues)
    : null
  const action = mascotForZone(zone.id, zone.state)
  const delay = `${(plotIndex % 5) * 0.28}s`
  const pct =
    zone.progress != null && zone.progress > 0
      ? Math.round(zone.progress * 100)
      : null
  const growth = growthForZone(zone.state, zone.progress)
  const ticks = Math.max(1, Math.min(4, growth + 1))

  const juice = !forceStatic

  return (
    <button
      ref={btnRef}
      type="button"
      className={cn('iso-plot')}
      data-testid={`workbench-zone-${zone.id}`}
      data-state={zone.state}
      data-growth={growth}
      data-selected={selected ? 'true' : 'false'}
      data-zone={zone.id}
      aria-pressed={selected}
      aria-label={`${label}, ${stateLabel}, ${primary}`}
      onClick={() => {
        if (juice) playPlotClick(btnRef.current)
        onOpen(zone)
      }}
      onPointerEnter={() => {
        if (juice) playPlotHover(btnRef.current)
      }}
      onPointerLeave={() => {
        if (juice) resetPlotHover(btnRef.current)
        else killFarmJuice(btnRef.current)
      }}
      onBlur={() => {
        if (juice) resetPlotHover(btnRef.current)
      }}
      style={
        {
          left: originX + x - ISO_TW / 2,
          top: originY + y,
          width: ISO_TW,
          height: ISO_TH + 132,
          zIndex: Math.round(cell.col + cell.row * 10) + 2,
          ['--plot-accent' as string]: ACCENT[zone.id],
          ['--plot-delay' as string]: delay,
        } as CSSProperties
      }
    >
      <div className="iso-plot-actor" aria-hidden>
        <div className="iso-plot-actor-bob">
          <IsoMascot action={action} size={88} forceStatic={forceStatic} />
        </div>
      </div>

      <div className="iso-plot-diamond" aria-hidden>
        <div className="iso-plot-top">
          <span className="iso-crop iso-crop-a" />
          <span className="iso-crop iso-crop-b" />
          <span className="iso-crop iso-crop-c" />
          <span className="iso-crop iso-crop-d" />
          {zone.state === 'running' && (
            <span className="iso-plot-spray">
              <i />
              <i />
              <i />
            </span>
          )}
        </div>
        <div className="iso-plot-left" />
        <div className="iso-plot-right" />
      </div>

      <div className="iso-plot-sign">
        <span className="iso-plot-sign-name">{label}</span>
        <span className="iso-plot-sign-badge">{stateLabel}</span>
        <span className="iso-plot-sign-metric">{primary}</span>
        {secondary != null && (
          <span className="iso-plot-sign-sec">
            {secondary}
            {pct != null ? ` · ${pct}%` : ''}
          </span>
        )}
        <span className="px-growth-bar" aria-hidden>
          {Array.from({ length: 4 }, (_, i) => (
            <i key={i} data-on={i < ticks ? 'true' : 'false'} />
          ))}
        </span>
      </div>
    </button>
  )
}
