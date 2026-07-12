import type { ContextKind, ContextMenuPrefs } from './types'

const KEY = 'hip.contextMenu.prefs.v1'

function canUseStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

export function defaultContextMenuPrefs(): ContextMenuPrefs {
  return { version: 1, disabledIds: [] }
}

/** Validate orderByKind: string keys → string[] only; drop corrupt entries. */
function parseOrderByKind(raw: unknown): ContextMenuPrefs['orderByKind'] | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Partial<Record<ContextKind, string[]>> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== 'string' || !k) continue
    if (!Array.isArray(v)) continue
    const ids = v.filter((x): x is string => typeof x === 'string')
    if (ids.length > 0) {
      out[k as ContextKind] = ids
    }
  }
  return Object.keys(out).length > 0 ? out : undefined
}

export function loadPrefs(): ContextMenuPrefs {
  if (!canUseStorage()) return defaultContextMenuPrefs()
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return defaultContextMenuPrefs()
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return defaultContextMenuPrefs()
    const obj = parsed as Record<string, unknown>
    const disabledIds = Array.isArray(obj.disabledIds)
      ? obj.disabledIds.filter((x): x is string => typeof x === 'string')
      : []
    const prefs: ContextMenuPrefs = {
      version: 1,
      disabledIds,
    }
    const orderByKind = parseOrderByKind(obj.orderByKind)
    if (orderByKind) prefs.orderByKind = orderByKind
    return prefs
  } catch {
    return defaultContextMenuPrefs()
  }
}

export function savePrefs(prefs: ContextMenuPrefs): void {
  if (!canUseStorage()) return
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // ignore quota / private mode
  }
}

export { KEY as CONTEXT_MENU_PREFS_KEY }
