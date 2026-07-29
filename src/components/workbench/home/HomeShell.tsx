import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'
import type { HeroModel, ZoneId, ZoneModel } from '../workbenchTypes'
import { HomeHeader } from './HomeHeader'
import { SurfaceRow } from './SurfaceRow'
import { QuickStart } from './QuickStart'
import { CosmosHost } from '../scene/CosmosHost'
import './home.css'

export function HomeShell({
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
  const showScene = useUiStore((s) => s.workbenchShowScene)
  const reduceMotion = useUiStore((s) => s.workbenchReduceMotion)
  const [hoveredId, setHoveredId] = useState<ZoneId | null>(null)

  return (
    <div className="wb-home" data-testid="workbench-home">
      <CosmosHost
        heroState={hero.state}
        zones={zones}
        hoveredId={hoveredId}
        enabled={showScene}
        reduceMotion={reduceMotion}
      />

      <div className="wb-home-scroll">
        <div className="wb-home-inner">
          <HomeHeader hero={hero} title={heroTitle} subtitle={heroSubtitle} />

          <section
            className="wb-home-surfaces"
            aria-label={t('workbench.zonesRegion')}
            data-testid="workbench-modules"
          >
            <h2 className="wb-home-section-label">{t('workbench.home.surfaces')}</h2>
            <div className="wb-home-list">
              {zones.map((zone) => (
                <SurfaceRow
                  key={zone.id}
                  zone={zone}
                  selected={selectedId === zone.id}
                  onOpen={onOpenZone}
                  onHover={setHoveredId}
                />
              ))}
            </div>
          </section>

          <QuickStart />
        </div>
      </div>
    </div>
  )
}
