import type { HeroSubtitleKey, HeroTitleKey, ZoneState } from './workbenchTypes'

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night'

/** Local hour → day part for idle hero greeting (no LLM). */
export function dayPartFromHour(hour: number): DayPart {
  const h = ((hour % 24) + 24) % 24
  if (h >= 5 && h < 12) return 'morning'
  if (h >= 12 && h < 18) return 'afternoon'
  if (h >= 18 && h < 22) return 'evening'
  return 'night'
}

const IDLE_BY_PART: Record<DayPart, { titleKey: HeroTitleKey; subtitleKey: HeroSubtitleKey }> = {
  morning: {
    titleKey: 'workbench.hero.greetingMorning',
    subtitleKey: 'workbench.hero.subIdle',
  },
  afternoon: {
    titleKey: 'workbench.hero.greetingAfternoon',
    subtitleKey: 'workbench.hero.subIdle',
  },
  evening: {
    titleKey: 'workbench.hero.greetingEvening',
    subtitleKey: 'workbench.hero.subIdle',
  },
  night: {
    titleKey: 'workbench.hero.greetingNight',
    subtitleKey: 'workbench.hero.subIdle',
  },
}

/**
 * When aggregate state is idle, use time-of-day greeting titles.
 * Busy / attention / done keep status-driven copy from aggregateHero.
 */
export function resolveHeroCopy(
  state: ZoneState,
  titleKey: HeroTitleKey,
  subtitleKey: HeroSubtitleKey,
  now: Date = new Date(),
): { titleKey: HeroTitleKey; subtitleKey: HeroSubtitleKey; dayPart: DayPart } {
  const dayPart = dayPartFromHour(now.getHours())
  if (state === 'idle') {
    const idle = IDLE_BY_PART[dayPart]
    return { titleKey: idle.titleKey, subtitleKey: idle.subtitleKey, dayPart }
  }
  return { titleKey, subtitleKey, dayPart }
}
