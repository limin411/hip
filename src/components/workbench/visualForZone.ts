import type { ZoneState } from './workbenchTypes'

export type ZoneTone = 'neutral' | 'active' | 'warn' | 'danger' | 'success'

/** Pure visual tokens for deck cards + Three scene (no mascot). */
export interface ZoneVisual {
  tone: ZoneTone
  /** 0–1 emissive / border intensity */
  glow: number
  /** Edge particle / pulse speed multiplier */
  flowSpeed: number
  /** Progress ring fill when known */
  ringProgress: number | null
}

const BY_STATE: Record<ZoneState, Omit<ZoneVisual, 'ringProgress'>> = {
  idle: { tone: 'neutral', glow: 0.25, flowSpeed: 0.05 },
  running: { tone: 'active', glow: 0.85, flowSpeed: 1 },
  blocked: { tone: 'warn', glow: 0.7, flowSpeed: 0.2 },
  fail: { tone: 'danger', glow: 0.9, flowSpeed: 0.15 },
  done: { tone: 'success', glow: 0.75, flowSpeed: 0.35 },
}

export function visualForZone(
  state: ZoneState,
  progress: number | null = null,
): ZoneVisual {
  const base = BY_STATE[state]
  return {
    ...base,
    ringProgress: progress != null && progress > 0 ? progress : null,
  }
}

export function visualForHero(state: ZoneState): ZoneVisual {
  return visualForZone(state, null)
}
