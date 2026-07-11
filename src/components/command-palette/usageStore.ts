const KEY = 'hip.commandPalette.usage.v1'
const MAX_KEYS = 500

export type CommandUsageEntry = {
  count: number
  lastUsedAtMs: number
}

export type CommandUsageMap = Record<string, CommandUsageEntry>

function canUseStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

export function loadCommandUsage(): CommandUsageMap {
  if (!canUseStorage()) return {}
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as CommandUsageMap
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed
  } catch {
    return {}
  }
}

function saveCommandUsage(map: CommandUsageMap): void {
  if (!canUseStorage()) return
  try {
    localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    // quota / private mode — ignore
  }
}

/** Cap map size by dropping oldest lastUsedAtMs entries. */
function prune(map: CommandUsageMap): CommandUsageMap {
  const keys = Object.keys(map)
  if (keys.length <= MAX_KEYS) return map
  const sorted = keys.sort(
    (a, b) => (map[a]?.lastUsedAtMs ?? 0) - (map[b]?.lastUsedAtMs ?? 0),
  )
  const drop = sorted.slice(0, keys.length - MAX_KEYS)
  const next = { ...map }
  for (const k of drop) delete next[k]
  return next
}

export function recordCommandUsage(id: string, now = Date.now()): CommandUsageMap {
  const map = loadCommandUsage()
  const prev = map[id]
  map[id] = {
    count: (prev?.count ?? 0) + 1,
    lastUsedAtMs: now,
  }
  const pruned = prune(map)
  saveCommandUsage(pruned)
  return pruned
}

/**
 * Additive boost for already-matching items only (caller must gate on score > 0).
 * Caps at 0.15.
 */
export function usageBoost(entry: CommandUsageEntry | undefined, now = Date.now()): number {
  if (!entry || entry.count <= 0) return 0
  const countPart = Math.min(0.12, Math.log1p(entry.count) * 0.03)
  const ageMs = Math.max(0, now - entry.lastUsedAtMs)
  const day = 86_400_000
  const recency =
    ageMs < day ? 0.03 : ageMs < 7 * day ? 0.015 : ageMs < 30 * day ? 0.005 : 0
  return Math.min(0.15, countPart + recency)
}
