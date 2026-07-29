import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'
import type { HeroModel, ZoneModel } from '../workbenchTypes'
import { IsoPlot } from './IsoPlot'
import { isoBounds, ZONE_CELL } from './isoLayout'
import { mascotForHero } from './mascotForZone'
import { IsoMascot } from './IsoMascot'
import './isoFarm.css'

const PAD = 48

export function IsoFarmMap({
  zones,
  hero,
  heroTitle,
  heroSubtitle,
  selectedId,
  onOpenZone,
}: {
  zones: ZoneModel[]
  hero: HeroModel
  heroTitle: string
  heroSubtitle: string
  selectedId: string | null
  onOpenZone: (zone: ZoneModel) => void
}) {
  const { t } = useTranslation()
  const forceStatic = useUiStore((s) => s.workbenchReduceMotion)
  const showCartoon = useUiStore((s) => s.workbenchShowScene) // reuse: "show farm life"

  const cells = useMemo(
    () => zones.map((z) => ZONE_CELL[z.id]),
    [zones],
  )
  const bounds = useMemo(() => isoBounds(cells), [cells])
  const mapW = bounds.width + PAD * 2
  const mapH = bounds.height + PAD * 2 + 40
  const originX = PAD - bounds.minX
  const originY = PAD - bounds.minY + 20

  const motion = forceStatic ? 'static' : 'live'
  const heroAction = mascotForHero(hero.state)

  return (
    <div
      className="iso-farm"
      data-motion={motion}
      data-hero-state={hero.state}
      data-testid="workbench-farm-map"
    >
      <div className="iso-farm-sky" aria-hidden>
        {/* depth layers back → front */}
        <div className="iso-sky-haze" />
        <div className="iso-sky-mountains" />
        <div className="iso-farm-sun" />
        <div className="iso-farm-cloud iso-farm-cloud-a" />
        <div className="iso-farm-cloud iso-farm-cloud-b" />
        <div className="iso-farm-cloud iso-farm-cloud-c" />
        <div className="iso-farm-cloud iso-farm-cloud-d" />
        <div className="iso-birds">
          <i />
          <i />
          <i />
        </div>
        <div className="iso-sky-ridge" />
        <div className="iso-farm-hills" />
        <div className="iso-tree-line">
          <span className="iso-tree iso-tree-a" />
          <span className="iso-tree iso-tree-b" />
          <span className="iso-tree iso-tree-c" />
          <span className="iso-tree iso-tree-d" />
          <span className="iso-tree iso-tree-e" />
          <span className="iso-tree iso-tree-f" />
        </div>
        <div className="iso-meadow" />
        <div className="iso-meadow-texture" />
        <div className="iso-path" />
        <div className="iso-fence" />
        <div className="iso-wildflowers">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
        <div className="iso-vignet" />
      </div>

      {/* floating HUD */}
      <header
        className="iso-hud"
        aria-label={t('workbench.hero.region')}
        data-testid="workbench-hero"
      >
        <div className="iso-hud-inner">
          {showCartoon && (
            <div className="iso-hud-mascot" aria-hidden>
              <IsoMascot action={heroAction} size={72} forceStatic={forceStatic} />
            </div>
          )}
          <div className="iso-hud-copy min-w-0 flex-1">
            <p className="iso-hud-kicker">{t('workbench.home.eyebrow')}</p>
            <h1 className="iso-hud-title">{heroTitle}</h1>
            <p className="iso-hud-sub">{heroSubtitle}</p>
          </div>
          <dl className="iso-hud-stats">
            <div data-testid="workbench-metric-running">
              <dt>{t('workbench.metrics.running')}</dt>
              <dd>{hero.runningCount}</dd>
            </div>
            <div data-testid="workbench-metric-attention">
              <dt>{t('workbench.metrics.attention')}</dt>
              <dd>{hero.attentionCount}</dd>
            </div>
            <div data-testid="workbench-metric-done">
              <dt>{t('workbench.metrics.done')}</dt>
              <dd>{hero.doneCount}</dd>
            </div>
          </dl>
        </div>
      </header>

      {/* scrollable map stage */}
      <div className="iso-stage" data-testid="workbench-modules">
        <div
          className="iso-world"
          style={{ width: mapW, height: mapH }}
          aria-label={t('workbench.zonesRegion')}
        >
          {/* ground plane under plots */}
          <div
            className="iso-ground"
            style={{
              left: originX + bounds.minX - 40,
              top: originY + bounds.minY + 20,
              width: bounds.width + 80,
              height: bounds.height * 0.55 + 60,
            }}
            aria-hidden
          />

          {zones.map((zone, i) => (
            <IsoPlot
              key={zone.id}
              zone={zone}
              originX={originX}
              originY={originY}
              selected={selectedId === zone.id}
              forceStatic={forceStatic || !showCartoon}
              plotIndex={i}
              onOpen={onOpenZone}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
