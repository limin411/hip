import type { ZoneId } from '../workbenchTypes'
import { ZONE_CELL } from '../map/isoLayout'

export type FarmDir = 'up' | 'down' | 'left' | 'right'

/**
 * Courtyard adjacency for keyboard pad control.
 * Missing edges fall through to nearest plot in that screen direction.
 */
const GRAPH: Record<ZoneId, Partial<Record<FarmDir, ZoneId>>> = {
  sessions: { right: 'tasks', down: 'knowledge' },
  tasks: { left: 'sessions', right: 'automations', down: 'workflows' },
  automations: { left: 'tasks', down: 'terminals' },
  knowledge: { up: 'sessions', right: 'workflows' },
  terminals: { up: 'automations', left: 'workflows' },
  workflows: { up: 'tasks', left: 'knowledge', right: 'terminals' },
}

const ORDER: ZoneId[] = [
  'sessions',
  'tasks',
  'automations',
  'knowledge',
  'terminals',
  'workflows',
]

export function parseFarmKey(key: string): FarmDir | 'open' | null {
  switch (key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      return 'up'
    case 'ArrowDown':
    case 's':
    case 'S':
      return 'down'
    case 'ArrowLeft':
    case 'a':
    case 'A':
      return 'left'
    case 'ArrowRight':
    case 'd':
    case 'D':
      return 'right'
    case 'Enter':
    case ' ':
      return 'open'
    default:
      return null
  }
}

/** Step focus to next available zone in direction. */
export function stepFarmFocus(
  current: ZoneId | null,
  dir: FarmDir,
  available: ZoneId[],
): ZoneId | null {
  if (available.length === 0) return null
  const set = new Set(available)

  if (current == null || !set.has(current)) {
    return available.includes('sessions')
      ? 'sessions'
      : (ORDER.find((id) => set.has(id)) ?? available[0]!)
  }

  // Walk graph edges in that direction, skipping missing zones
  const viaGraph = walkGraph(current, dir, set)
  if (viaGraph) return viaGraph

  // Geometric fallback: prefer axis-aligned nearest
  const from = ZONE_CELL[current]
  let best: ZoneId | null = null
  let bestScore = Infinity

  for (const id of available) {
    if (id === current) continue
    const to = ZONE_CELL[id]
    const dc = to.col - from.col
    const dr = to.row - from.row
    let ok = false
    let score = 0
    if (dir === 'right' && dc > 0 && Math.abs(dc) >= Math.abs(dr)) {
      ok = true
      score = dc + Math.abs(dr) * 0.5
    } else if (dir === 'left' && dc < 0 && Math.abs(dc) >= Math.abs(dr)) {
      ok = true
      score = -dc + Math.abs(dr) * 0.5
    } else if (dir === 'down' && dr > 0 && Math.abs(dr) >= Math.abs(dc)) {
      ok = true
      score = dr + Math.abs(dc) * 0.5
    } else if (dir === 'up' && dr < 0 && Math.abs(dr) >= Math.abs(dc)) {
      ok = true
      score = -dr + Math.abs(dc) * 0.5
    }
    if (ok && score < bestScore) {
      bestScore = score
      best = id
    }
  }

  return best ?? current
}

/** Follow graph in one direction until an available zone is found. */
function walkGraph(from: ZoneId, dir: FarmDir, available: Set<ZoneId>): ZoneId | null {
  const seen = new Set<ZoneId>([from])
  let cur: ZoneId | undefined = GRAPH[from]?.[dir]
  while (cur && !seen.has(cur)) {
    if (available.has(cur)) return cur
    seen.add(cur)
    cur = GRAPH[cur]?.[dir]
  }
  return null
}
