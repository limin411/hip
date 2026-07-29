import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'
import type { HeroModel, ZoneModel } from '../workbenchTypes'
import { HomeHeader } from './HomeHeader'
import { SurfaceRow } from './SurfaceRow'
import { QuickStart } from './QuickStart'
import { ContinueWork } from './ContinueWork'
import { NeedsAttention } from './NeedsAttention'
import { RecentSessions } from './RecentSessions'
import { AmbientBackdrop } from './AmbientBackdrop'
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
  const reduceMotion = useUiStore((s) => s.workbenchReduceMotion)
  const ambientMotion = useUiStore((s) => s.workbenchShowScene)
  const motion = reduceMotion || !ambientMotion ? 'static' : 'live'

  return (
    <div
      className="wb-home"
      data-testid="workbench-home"
      data-hero-state={hero.state}
      data-motion={motion}
    >
      <AmbientBackdrop motion={motion} />

      <div className="wb-home-scroll">
        <div className="wb-home-inner">
          <HomeHeader hero={hero} title={heroTitle} subtitle={heroSubtitle} />

          <ContinueWork />

          <NeedsAttention zones={zones} onOpen={onOpenZone} />

          <div className="wb-home-main">
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
                  />
                ))}
              </div>
            </section>

            <aside className="wb-home-aside" aria-label={t('workbench.home.aside')}>
              <QuickStart />
              <RecentSessions />
            </aside>
          </div>
        </div>
      </div>
    </div>
  )
}
