import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/store/uiStore'
import type { HeroModel, ZoneId, ZoneModel } from '../workbenchTypes'
import { IsoPlot } from '../map/IsoPlot'
import { isoBounds, ZONE_CELL } from '../map/isoLayout'
import { FarmHero } from './FarmHero'
import { FarmScenery } from './FarmScenery'
import { parseFarmKey, stepFarmFocus } from './farmNav'
import { PixelSky } from './PixelSky'
import '../map/isoFarm.css'
import './pixelFarm.css'

const PAD = 72

/**
 * Pixel farming mini-game — courtyard, scenery, keyboard pad (P3).
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
  const [focusId, setFocusId] = useState<ZoneId | null>(null)
  const stageRef = useRef<HTMLDivElement>(null)

  const cells = useMemo(() => zones.map((z) => ZONE_CELL[z.id]), [zones])
  const bounds = useMemo(() => isoBounds(cells), [cells])
  const mapW = bounds.width + PAD * 2
  const mapH = bounds.height + PAD * 2 + 100
  const originX = PAD - bounds.minX
  const originY = PAD - bounds.minY + 36

  const motion = forceStatic || !showScene ? 'static' : 'live'
  const zoneIds = useMemo(() => zones.map((z) => z.id), [zones])
  const focusZone = focusId ? zones.find((z) => z.id === focusId) : null
  const tr = t as (key: string, opts?: Record<string, string>) => string

  const openFocused = useCallback(() => {
    if (!focusId) return
    const z = zones.find((x) => x.id === focusId)
    if (z) onOpenZone(z)
  }, [focusId, zones, onOpenZone])

  // Keyboard pad: WASD / arrows move, Enter / Space open
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return
      }

      const cmd = parseFarmKey(e.key)
      if (!cmd) return

      // Only handle when focus is inside farm or nothing steals keys
      const root = stageRef.current?.closest('.px-farm')
      if (root && document.activeElement && !root.contains(document.activeElement)) {
        // still allow keys when body-focused (desktop app main view)
        if (document.activeElement !== document.body && document.activeElement !== root) {
          const ae = document.activeElement as HTMLElement
          if (ae.getAttribute('role') === 'textbox' || ae.closest('[data-testid="chat-composer"]')) {
            return
          }
        }
      }

      if (cmd === 'open') {
        if (!focusId) {
          const first = stepFarmFocus(null, 'right', zoneIds)
          if (first) setFocusId(first)
          return
        }
        e.preventDefault()
        openFocused()
        return
      }

      e.preventDefault()
      setFocusId((cur) => stepFarmFocus(cur, cmd, zoneIds))
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusId, zoneIds, openFocused])

  // Drop focus if zone disappears (feature flags)
  useEffect(() => {
    if (focusId && !zoneIds.includes(focusId)) setFocusId(null)
  }, [focusId, zoneIds])

  // Move DOM focus to the focused plot for a11y / Enter activation
  useEffect(() => {
    if (!focusId) return
    const el = document.querySelector<HTMLElement>(
      `[data-testid="workbench-zone-${focusId}"]`,
    )
    el?.focus({ preventScroll: true })
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [focusId])

  return (
    <div
      className="iso-farm px-farm"
      data-motion={motion}
      data-hero-state={hero.state}
      data-testid="workbench-farm"
      tabIndex={-1}
    >
      <PixelSky motion={motion} />

      <header
        className="iso-hud px-hud"
        aria-label={t('workbench.hero.region')}
        data-testid="workbench-hero"
      >
        <div className="iso-hud-inner px-hud-inner px-dialog">
          <div className="px-dialog-nameplate">{t('workbench.farm.kicker')}</div>
          <div className="px-dialog-deco" aria-hidden>
            <span />
            <span />
            <span />
          </div>
          <div className="iso-hud-copy min-w-0 flex-1">
            <h1 className="iso-hud-title">{heroTitle}</h1>
            <p className="iso-hud-sub">{heroSubtitle}</p>
            <p className="px-hud-hint">
              {focusZone
                ? tr('workbench.farm.hoverHint', {
                    name: tr(focusZone.labelKey),
                    state: tr(`workbench.state.${focusZone.state}`),
                  })
                : tr('workbench.farm.hint')}
            </p>
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

      <div className="iso-stage px-stage" data-testid="workbench-modules" ref={stageRef}>
        <div
          className="iso-world"
          style={{ width: mapW, height: mapH }}
          aria-label={t('workbench.zonesRegion')}
        >
          {/* dense pixel tile pad */}
          <div
            className="px-tile-field"
            style={{
              left: originX + bounds.minX - 56,
              top: originY + bounds.minY + Math.round(bounds.height * 0.1),
              width: bounds.width + 112,
              height: Math.round(bounds.height * 0.78),
            }}
            aria-hidden
          />
          <div
            className="iso-ground px-ground"
            style={{
              left: originX + bounds.minX - 48,
              top: originY + bounds.minY + Math.round(bounds.height * 0.12),
              width: bounds.width + 96,
              height: Math.round(bounds.height * 0.72),
            }}
            aria-hidden
          />

          <FarmScenery originX={originX} originY={originY} />

          {zones.map((zone, i) => (
            <IsoPlot
              key={zone.id}
              zone={zone}
              originX={originX}
              originY={originY}
              selected={selectedId === zone.id}
              focused={focusId === zone.id}
              forceStatic={forceStatic || !showScene}
              plotIndex={i}
              onOpen={onOpenZone}
              onHover={setFocusId}
            />
          ))}

          {showScene && (
            <FarmHero
              originX={originX}
              originY={originY}
              hoverId={focusId}
              zones={zones}
              hero={hero}
              forceStatic={forceStatic}
            />
          )}
        </div>
      </div>

      {/* game control strip — not a content dock */}
      <footer className="px-pad" data-testid="workbench-farm-pad" aria-label={t('workbench.farm.padAria')}>
        <kbd className="px-pad-key">WASD</kbd>
        <span className="px-pad-label">{t('workbench.farm.padMove')}</span>
        <kbd className="px-pad-key">↵</kbd>
        <span className="px-pad-label">{t('workbench.farm.padOpen')}</span>
        <span className="px-pad-sep" aria-hidden>
          ·
        </span>
        <span className="px-pad-label px-pad-label--muted">{t('workbench.farm.padClick')}</span>
      </footer>
    </div>
  )
}
