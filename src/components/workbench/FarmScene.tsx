import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { HeroModel, ZoneModel } from './workbenchTypes'
import { FarmPlot } from './FarmPlot'
import { WorkbenchMascot } from './WorkbenchMascot'
import './farmScene.css'

/** Heat shimmer flecks — decorative only. */
const HEAT_SPECS = [
  { left: '18%', top: '38%', delay: '0s' },
  { left: '35%', top: '42%', delay: '1.2s' },
  { left: '52%', top: '36%', delay: '2.4s' },
  { left: '70%', top: '44%', delay: '0.6s' },
  { left: '84%', top: '40%', delay: '3s' },
] as const

export function FarmScene({
  zones,
  hero,
  heroTitle,
  heroSubtitle,
  showCartoon,
  reduceMotion,
  selectedId,
  onOpenZone,
}: {
  zones: ZoneModel[]
  hero: HeroModel
  heroTitle: string
  heroSubtitle: string
  showCartoon: boolean
  reduceMotion: boolean
  selectedId: string | null
  onOpenZone: (zone: ZoneModel) => void
}) {
  const { t } = useTranslation()
  const motion = reduceMotion ? 'static' : 'live'
  const count = Math.min(6, Math.max(1, zones.length))

  return (
    <div
      className="wb-farm relative flex min-h-0 flex-1 flex-col overflow-hidden"
      data-motion={motion}
      data-testid="workbench-farm"
    >
      {/* Abstract sunny field backdrop */}
      <div className="wb-farm-bg" aria-hidden>
        <div className="wb-farm-sky" />
        <div className="wb-farm-sun">
          <div className="wb-farm-sun-core" />
          <div className="wb-farm-sun-rays" />
          <div className="wb-farm-sun-face" />
        </div>
        <div className="wb-farm-cloud wb-farm-cloud-a" />
        <div className="wb-farm-cloud wb-farm-cloud-b" />
        <div className="wb-farm-heat" />

        {/* Distant hills — soft blobs */}
        <div className="wb-farm-hill wb-farm-hill-a" />
        <div className="wb-farm-hill wb-farm-hill-b" />
        <div className="wb-farm-hill wb-farm-hill-c" />

        {/* Field strips */}
        <div className="wb-farm-field">
          <div className="wb-farm-row" />
          <div className="wb-farm-row" />
          <div className="wb-farm-row" />
          <div className="wb-farm-row" />
          <div className="wb-farm-row" />
        </div>

        {/* Fence line */}
        <div className="wb-farm-fence">
          {Array.from({ length: 9 }).map((_, i) => (
            <span key={i} className="wb-farm-fence-post" />
          ))}
          <div className="wb-farm-fence-rail wb-farm-fence-rail-top" />
          <div className="wb-farm-fence-rail wb-farm-fence-rail-bot" />
        </div>

        {/* Playful props */}
        <div className="wb-farm-scarecrow">
          <div className="wb-farm-scarecrow-head" />
          <div className="wb-farm-scarecrow-body" />
          <div className="wb-farm-scarecrow-arm wb-farm-scarecrow-arm-l" />
          <div className="wb-farm-scarecrow-arm wb-farm-scarecrow-arm-r" />
          <div className="wb-farm-scarecrow-pole" />
        </div>
        <div className="wb-farm-can">
          <div className="wb-farm-can-body" />
          <div className="wb-farm-can-spout" />
          <div className="wb-farm-can-handle" />
        </div>
        <div className="wb-farm-bucket" />
        <div className="wb-farm-tree wb-farm-tree-l">
          <div className="wb-farm-tree-crown" />
          <div className="wb-farm-tree-trunk" />
        </div>
        <div className="wb-farm-tree wb-farm-tree-r">
          <div className="wb-farm-tree-crown" />
          <div className="wb-farm-tree-trunk" />
        </div>

        {/* Decorative veggie stickers in distance */}
        <div className="wb-farm-sticker wb-farm-sticker-a" />
        <div className="wb-farm-sticker wb-farm-sticker-b" />
        <div className="wb-farm-sticker wb-farm-sticker-c" />

        {HEAT_SPECS.map((h, i) => (
          <div
            key={i}
            className="wb-farm-shimmer"
            style={{ left: h.left, top: h.top, animationDelay: h.delay }}
          />
        ))}
      </div>

      {/* HUD + plots */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col">
        <header
          className="wb-farm-hud"
          aria-label={t('workbench.hero.region')}
          data-testid="workbench-hero"
        >
          <div className="wb-farm-hud-inner">
            {showCartoon ? (
              <div className="wb-farm-hero-mascot relative shrink-0">
                <WorkbenchMascot
                  action={hero.mascotAction}
                  size={64}
                  forceStatic={reduceMotion}
                />
                <span className="wb-farm-hero-hat" aria-hidden />
              </div>
            ) : (
              <div className="h-16 w-16 shrink-0" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <div className="wb-farm-hud-kicker">{t('workbench.farm.kicker')}</div>
              <h1 className="wb-farm-hud-title">{heroTitle}</h1>
              <p className="wb-farm-hud-sub">{heroSubtitle}</p>
            </div>
            <div className="wb-farm-hud-metrics">
              <MetricPill
                value={hero.runningCount}
                label={t('workbench.metrics.running')}
                testId="workbench-metric-running"
                tone="running"
              />
              <MetricPill
                value={hero.attentionCount}
                label={t('workbench.metrics.attention')}
                testId="workbench-metric-attention"
                tone="attention"
              />
              <MetricPill
                value={hero.doneCount}
                label={t('workbench.metrics.done')}
                testId="workbench-metric-done"
                tone="done"
              />
            </div>
          </div>
        </header>

        <section aria-label={t('workbench.zonesRegion')} className="wb-farm-stage min-h-0">
          <div className="wb-plot-cluster" data-count={count}>
            {zones.map((zone) => (
              <FarmPlot
                key={zone.id}
                zone={zone}
                showCartoon={showCartoon}
                forceStatic={reduceMotion}
                selected={selectedId === zone.id}
                onOpen={onOpenZone}
              />
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

function MetricPill({
  value,
  label,
  testId,
  tone,
}: {
  value: number
  label: string
  testId: string
  tone: 'running' | 'attention' | 'done'
}) {
  return (
    <div className={cn('wb-farm-metric', `wb-farm-metric--${tone}`)} data-testid={testId}>
      <div className="wb-farm-metric-value">{value}</div>
      <div className="wb-farm-metric-label">{label}</div>
    </div>
  )
}
