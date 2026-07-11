const KEY = 'hip.commandPalette.favorites.v1'
const MAX = 20

function canUseStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

export function loadFavorites(): string[] {
  if (!canUseStorage()) return []
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX)
  } catch {
    return []
  }
}

function saveFavorites(ids: string[]): void {
  if (!canUseStorage()) return
  try {
    localStorage.setItem(KEY, JSON.stringify(ids.slice(0, MAX)))
  } catch {
    // ignore
  }
}

export function isFavorite(id: string): boolean {
  return loadFavorites().includes(id)
}

/** Toggle favorite; returns new list. */
export function toggleFavorite(id: string): string[] {
  const cur = loadFavorites()
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [id, ...cur].slice(0, MAX)
  saveFavorites(next)
  return next
}

export function setFavorites(ids: string[]): string[] {
  const next = [...new Set(ids)].slice(0, MAX)
  saveFavorites(next)
  return next
}
