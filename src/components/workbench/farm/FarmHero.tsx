import { useMemo, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { MascotAction } from '@/components/login/MascotActor'
import type { HeroModel, ZoneId, ZoneModel } from '../workbenchTypes'
import { mascotForHero, mascotForZone } from '../map/mascotForZone'
import { IsoMascot } from '../map/IsoMascot'
import { isoProject, YARD_CELL, ZONE_CELL } from '../map/isoLayout'

const BUBBLE_KEYS = [
  'workbench.farm.bubble.hi',
  'workbench.farm.bubble.tip',
  'workbench.farm.bubble.hungry',
  'workbench.farm.bubble.cheer',
] as const

/** Prefer busy / attention plot; else courtyard well (YARD_CELL). */
export function resolveHeroAnchor(
  hoverId: ZoneId | null,
  zones: ZoneModel[],
  hero: HeroModel,
): { col: number; row: number } {
  if (hoverId && ZONE_CELL[hoverId]) return ZONE_CELL[hoverId]
  const running = zones.find((z) => z.state === 'running')
  if (running) return ZONE_CELL[running.id]
  const attention = zones.find((z) => z.state === 'fail' || z.state === 'blocked')
  if (attention) return ZONE_CELL[attention.id]
  if (hero.state === 'done') {
    const done = zones.find((z) => z.state === 'done')
    if (done) return ZONE_CELL[done.id]
  }
  return { ...YARD_CELL }
}

export function resolveHeroAction(
  hoverId: ZoneId | null,
  zones: ZoneModel[],
  hero: HeroModel,
): MascotAction {
  if (hoverId) {
    const z = zones.find((x) => x.id === hoverId)
    if (z) return mascotForZone(z.id, z.state)
  }
  return mascotForHero(hero.state)
}

/**
 * Single field protagonist — strong character presence (P2).
 * Walks toward hovered / busiest plot; click shows a speech bubble.
 */
export function FarmHero({
  originX,
  originY,
  hoverId,
  zones,
  hero,
  forceStatic,
}: {
  originX: number
  originY: number
  hoverId: ZoneId | null
  zones: ZoneModel[]
  hero: HeroModel
  forceStatic: boolean
}) {
  const { t } = useTranslation()
  const tr = t as (key: string) => string
  const [bubbleKey, setBubbleKey] = useState<string | null>(null)
  const [bubbleN, setBubbleN] = useState(0)

  const anchor = useMemo(
    () => resolveHeroAnchor(hoverId, zones, hero),
    [hoverId, zones, hero],
  )
  const action = useMemo(
    () => resolveHeroAction(hoverId, zones, hero),
    [hoverId, zones, hero],
  )
  const { x, y } = isoProject(anchor.col, anchor.row)

  const size = 124
  // Stand slightly south of plot center so crops/buildings stay readable
  const style = {
    left: originX + x - size / 2,
    top: originY + y + 18,
    width: size,
    height: size + 40,
    zIndex: Math.round(anchor.col + anchor.row * 10) + 14,
    transition: forceStatic
      ? undefined
      : 'left 0.45s cubic-bezier(0.22, 1, 0.36, 1), top 0.45s cubic-bezier(0.22, 1, 0.36, 1)',
  } as CSSProperties

  const showBubble = (key: string) => {
    setBubbleKey(key)
    setBubbleN((n) => n + 1)
    window.setTimeout(() => {
      setBubbleKey((cur) => (cur === key ? null : cur))
    }, 2200)
  }

  return (
    <div
      className="px-hero"
      style={style}
      data-testid="workbench-farm-hero"
      data-hover={hoverId ?? ''}
      data-hero-state={hero.state}
    >
      {bubbleKey != null && (
        <div className="px-hero-bubble" data-testid="workbench-farm-bubble" key={bubbleN}>
          {tr(bubbleKey)}
        </div>
      )}
      {(hero.state === 'fail' || hero.state === 'blocked') && bubbleKey == null && (
        <div className="px-hero-alert" aria-hidden>
          !
        </div>
      )}
      <button
        type="button"
        className="px-hero-btn"
        data-testid="workbench-farm-hero-btn"
        aria-label={t('workbench.farm.heroAria')}
        onClick={(e) => {
          e.stopPropagation()
          const key = BUBBLE_KEYS[Math.floor(Math.random() * BUBBLE_KEYS.length)]!
          showBubble(key)
        }}
      >
        <div className="px-hero-bob">
          <IsoMascot action={action} size={size} forceStatic={forceStatic} />
        </div>
      </button>
    </div>
  )
}
