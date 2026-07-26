/** Keep in sync with src/lib/roundtable.ts (FE). */
export const ROUNDTABLE_MARKER = '<!--hip.roundtable.v1-->'
export const ROUNDTABLE_SEP = '\n\n---user---\n\n'

export const ROUNDTABLE_ROUNDS_MIN = 2
export const ROUNDTABLE_ROUNDS_MAX = 4
/** Full 5-seat roster can speak each round (council parallel). */
export const MAX_ADVISORS_PER_ROUND = 5
/** 5 seats × 4 rounds max. */
export const MAX_ADVISOR_CALLS_PER_MEETING = 20
export const MAX_CHAIR_ACTIONS = 24
export const CHAIR_PARSE_RETRIES = 2
/** Council wall-clock: 5 parallel advisors + chair steps. */
export const ROUNDTABLE_COUNCIL_WALL_MS = 240_000

export type RoundtableEngine = 'sim' | 'loop' | 'council'

/**
 * Default engine when a roundtable-framed first message is detected.
 * Override with HIP_ROUNDTABLE_ENGINE=sim|loop|council.
 * Default **council** (multi-agent + Agents panel); use loop for chair-only path.
 */
export function resolveRoundtableEngine(
  env: NodeJS.ProcessEnv = process.env,
): RoundtableEngine {
  const raw = (env.HIP_ROUNDTABLE_ENGINE ?? 'council').trim().toLowerCase()
  if (raw === 'sim') return 'sim'
  if (raw === 'loop') return 'loop'
  return 'council'
}
