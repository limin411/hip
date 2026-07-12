import type { ContextMenuPrefs } from './types'

const KEY = 'hip.contextMenu.prefs.v1'

const DEFAULT_PREFS: ContextMenuPrefs = {
  version: 1,
  disabledIds: [],
}

function canUseStorage(): boolean {
  return typeof localStorage !== 'undefined'
}

export function defaultContextMenuPrefs(): ContextMenuPrefs {
  return { version: 1, disabledIds: [] }
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
    if (obj.orderByKind && typeof obj.orderByKind === 'object' && !Array.isArray(obj.orderByKind)) {
      prefs.orderByKind = obj.orderByKind as ContextMenuPrefs['orderByKind']
    }
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

export { KEY as CONTEXT_MENU_PREFS_KEY, DEFAULT_PREFS }
