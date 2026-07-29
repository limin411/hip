import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { HeroModel, ZoneModel } from './workbenchTypes'
import { OfficeDesk } from './OfficeDesk'
import { WorkbenchMascot } from './WorkbenchMascot'
import './officeScene.css'

const DUST_SPECS = [
  { left: '14%', top: '52%', delay: '0s' },
  { left: '30%', top: '58%', delay: '2s' },
  { left: '48%', top: '46%', delay: '3.5s' },
  { left: '62%', top: '60%', delay: '1s' },
  { left: '78%', top: '50%', delay: '4s' },
  { left: '88%', top: '56%', delay: '2.5s' },
] as const

function Plant({ className }: { className: string }) {
  return (
    <div className={cn('wb-office-plant', className)}>
      <div className="wb-office-plant-leaf" />
      <div className="wb-office-plant-leaf" />
      <div className="wb-office-plant-leaf" />
      <div className="wb-office-plant-pot" />
    </div>
  )
}

function Bookshelf() {
  return (
    <div className="wb-office-shelf">
      {[0, 1, 2].map((row) => (
        <div key={row} className="wb-office-shelf-row">
          <span className="wb-office-book" />
          <span className="wb-office-book" />
          <span className="wb-office-book" />
          <span className="wb-office-book" />
          <span className="wb-office-book" />
        </div>
      ))}
    </div>
  )
}

export function OfficeScene({
  zones,
  hero,
  heroTitle,
  heroSubtitle,
  showCartoon,
  reduceMotion,
  selectedId,
  onOpenZone,
  shortcuts,
}: {
  zones: ZoneModel[]
  hero: HeroModel
  heroTitle: string
  heroSubtitle: string
  showCartoon: boolean
  reduceMotion: boolean
  selectedId: string | null
  onOpenZone: (zone: ZoneModel) => void
  shortcuts: ReactNode
}) {
  const { t } = useTranslation()
  const motion = reduceMotion ? 'static' : 'live'
  const count = Math.min(6, Math.max(1, zones.length))

  return (
    <div
      className="wb-office relative flex min-h-0 flex-1 flex-col overflow-hidden"
      data-motion={motion}
      data-testid="workbench-office"
    >
      {/* Decorative office layers — dense midground like cozy isometric offices */}
      <div className="wb-office-bg" aria-hidden>
        <div className="wb-office-wall" />
        <div className="wb-office-wall-shade" />
        <div className="wb-office-floor" />
        <div className="wb-office-rug" />
        <div className="wb-office-baseboard" />

        <div className="wb-office-window-glow" />
        <div className="wb-office-window">
          <div className="wb-office-window-sun" />
          <div className="wb-office-window-cloud wb-office-window-cloud-a" />
          <div className="wb-office-window-cloud wb-office-window-cloud-b" />
          <div className="wb-office-window-pane" />
        </div>

        <Bookshelf />
        <div className="wb-office-board">
          <div className="wb-office-board-grid" />
          <div className="wb-office-board-sticky" />
          <div className="wb-office-board-sticky" />
          <div className="wb-office-board-sticky" />
          <div className="wb-office-board-line" />
          <div className="wb-office-board-line" />
          <div className="wb-office-board-line" />
        </div>
        <div className="wb-office-poster" />
        <div className="wb-office-frame" />
        <div className="wb-office-clock">
          <div className="wb-office-clock-hand wb-office-clock-hand-h" />
          <div className="wb-office-clock-hand wb-office-clock-hand-m" />
        </div>

        <div className="wb-office-sofa">
          <div className="wb-office-sofa-back" />
          <div className="wb-office-sofa-body" />
          <div className="wb-office-sofa-arm wb-office-sofa-arm-l" />
          <div className="wb-office-sofa-arm wb-office-sofa-arm-r" />
        </div>
        <div className="wb-office-cabinet">
          <div className="wb-office-cabinet-drawer" />
          <div className="wb-office-cabinet-drawer" />
          <div className="wb-office-cabinet-drawer" />
        </div>
        <div className="wb-office-lamp">
          <div className="wb-office-lamp-shade" />
          <div className="wb-office-lamp-pole" />
          <div className="wb-office-lamp-base" />
        </div>
        <Plant className="wb-office-plant-a" />
        <Plant className="wb-office-plant-b" />
        <Plant className="wb-office-plant-c" />

        <div className="wb-office-meeting">
          <div className="wb-office-meeting-top" />
          <div className="wb-office-meeting-leg wb-office-meeting-leg-l" />
          <div className="wb-office-meeting-leg wb-office-meeting-leg-r" />
        </div>

        <div className="wb-office-coffee">
          <div className="wb-office-coffee-steam" />
          <div className="wb-office-coffee-steam" />
          <div className="wb-office-coffee-top" />
          <div className="wb-office-coffee-body">
            <div className="wb-office-coffee-cup" />
          </div>
        </div>
        <div className="wb-office-rack">
          <div className="wb-office-rack-bay" />
          <div className="wb-office-rack-bay" />
          <div className="wb-office-rack-bay" />
          <div className="wb-office-rack-bay" />
        </div>
        <div className="wb-office-cooler">
          <div className="wb-office-cooler-jug" />
          <div className="wb-office-cooler-body" />
        </div>
        <div className="wb-office-bin" />
        <div className="wb-office-cable" />

        {DUST_SPECS.map((d, i) => (
          <div
            key={i}
            className="wb-office-dust"
            style={{ left: d.left, top: d.top, animationDelay: d.delay }}
          />
        ))}
      </div>

      {/* HUD + desk cluster centered on rug */}
      <div className="relative z-10 flex min-h-0 flex-1 flex-col gap-2 p-2.5 sm:p-3 md:p-4">
        <header
          className={cn(
            'wb-hud grid shrink-0 items-center gap-2.5 rounded-xl border border-[var(--glass-border)]',
            'bg-[var(--glass-bg)] px-3 py-2.5 shadow-panel backdrop-blur-md',
            'sm:grid-cols-[auto_1fr_auto]',
          )}
          style={{ backdropFilter: 'var(--glass-backdrop)' }}
          aria-label={t('workbench.hero.region')}
          data-testid="workbench-hero"
        >
          {showCartoon ? (
            <div className="wb-hero-mascot relative">
              <WorkbenchMascot
                action={hero.mascotAction}
                size={56}
                forceStatic={reduceMotion}
              />
            </div>
          ) : (
            <div className="h-14 w-14" aria-hidden />
          )}
          <div className="min-w-0">
            <h1 className="text-title font-semibold tracking-tight text-ink">{heroTitle}</h1>
            <p className="mt-0.5 text-meta text-ink-secondary">{heroSubtitle}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            <MetricPill
              value={hero.runningCount}
              label={t('workbench.metrics.running')}
              testId="workbench-metric-running"
            />
            <MetricPill
              value={hero.attentionCount}
              label={t('workbench.metrics.attention')}
              testId="workbench-metric-attention"
            />
            <MetricPill
              value={hero.doneCount}
              label={t('workbench.metrics.done')}
              testId="workbench-metric-done"
            />
          </div>
        </header>

        <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[1fr_200px]">
          <section aria-label={t('workbench.zonesRegion')} className="wb-stage min-h-0">
            <div className="wb-desk-cluster" data-count={count}>
              {zones.map((zone) => (
                <OfficeDesk
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

          <aside
            className={cn(
              'flex h-fit flex-col gap-0.5 rounded-xl border border-[var(--glass-border)]',
              'bg-[var(--glass-bg)] p-2 shadow-panel backdrop-blur-md',
              'lg:sticky lg:top-0',
            )}
            style={{ backdropFilter: 'var(--glass-backdrop)' }}
            aria-label={t('workbench.shortcuts.title')}
            data-testid="workbench-shortcuts"
          >
            <div className="px-1 pb-1 text-meta font-semibold text-ink">
              {t('workbench.shortcuts.title')}
            </div>
            {shortcuts}
          </aside>
        </div>
      </div>
    </div>
  )
}

function MetricPill({
  value,
  label,
  testId,
}: {
  value: number
  label: string
  testId: string
}) {
  return (
    <div
      className="min-w-[4rem] rounded-lg border border-border bg-[color-mix(in_srgb,var(--bg-app)_72%,transparent)] px-2.5 py-1.5 text-center"
      data-testid={testId}
    >
      <div className="text-title font-semibold tracking-tight text-ink">{value}</div>
      <div className="text-[11px] text-ink-tertiary">{label}</div>
    </div>
  )
}
