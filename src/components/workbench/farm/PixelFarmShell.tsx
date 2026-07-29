import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'
import type { HeroModel, ZoneModel } from '../workbenchTypes'
import { IsoPlot } from '../map/IsoPlot'
import { isoBounds, ZONE_CELL } from '../map/isoLayout'
import { mascotForHero } from '../map/mascotForZone'
import { IsoMascot } from '../map/IsoMascot'
import { FarmSky } from '../map/FarmSky'
import '../map/isoFarm.css'
import './pixelFarm.css'

const PAD = 48

/**
 * Pixel farming mini-game hub — replaces Calm Home list as workbench cold-start.
 * Spec: docs/design/2026-07-29-workbench-pixel-farm.md
 */
export function PixelFarmShell({
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
  const showScene = useUiStore((s) => s.workbenchShowScene)

  const cells = useMemo(() => zones.map((z) => ZONE_CELL[z.id]), [zones])
  const bounds = useMemo(() => isoBounds(cells), [cells])
  const mapW = bounds.width + PAD * 2
  const mapH = bounds.height + PAD * 2 + 40
  const originX = PAD - bounds.minX
  const originY = PAD - bounds.minY + 20

  const motion = forceStatic || !showScene ? 'static' : 'live'
  const heroAction = mascotForHero(hero.state)

  return (
    <div
      className="iso-farm px-farm"
      data-motion={motion}
      data-hero-state={hero.state}
      data-testid="workbench-farm"
    >
      <FarmSky motion={motion} />

      <header
        className="iso-hud px-hud"
        aria-label={t('workbench.hero.region')}
        data-testid="workbench-hero"
      >
        <div className="iso-hud-inner px-hud-inner">
          {showScene && (
            <div className="iso-hud-mascot" aria-hidden>
              <IsoMascot action={heroAction} size={72} forceStatic={forceStatic} />
            </div>
          )}
          <div className="iso-hud-copy min-w-0 flex-1">
            <p className="iso-hud-kicker">{t('workbench.farm.kicker')}</p>
            <h1 className="iso-hud-title">{heroTitle}</h1>
            <p className="iso-hud-sub">{heroSubtitle}</p>
            <p className="px-hud-hint">{t('workbench.farm.hint')}</p>
          </div>
          {hero.runningCount > 0 && (
            <dl className="iso-hud-stats px-hud-stats" aria-label={t('workbench.metrics.summary')}>
              <div data-testid="workbench-metric-running">
                <dt>{t('workbench.metrics.running')}</dt>
                <dd>{hero.runningCount}</dd>
              </div>
            </dl>
          )}
        </div>
      </header>

      <div className="iso-stage px-stage" data-testid="workbench-modules">
        <div
          className="iso-world"
          style={{ width: mapW, height: mapH }}
          aria-label={t('workbench.zonesRegion')}
        >
          {/* Soft pad under the even 3×2 field — no grid texture */}
          <div
            className="iso-ground px-ground"
            style={{
              left: originX + bounds.minX - 24,
              top: originY + bounds.minY + Math.round(bounds.height * 0.18),
              width: bounds.width + 48,
              height: Math.round(bounds.height * 0.62),
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
              forceStatic={forceStatic || !showScene}
              plotIndex={i}
              onOpen={onOpenZone}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
