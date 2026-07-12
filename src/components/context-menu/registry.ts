import type {
  ContextGroupId,
  ContextMenuBuildContext,
  ContextMenuItemDef,
  ContextMenuPrefs,
  ContextProvider,
  ContextRequest,
} from './types'
import { loadPrefs } from './prefs'

/**
 * Builtin providers — assembled inside buildContextMenuItems (not side-effect registration).
 * Surface PRs import and append here (message, codeBlock, sessionTab, …).
 * PR-1 foundation: empty.
 */
const BUILTIN_PROVIDERS: ContextProvider[] = []

const extraProviders: ContextProvider[] = []

/** Register an extra provider (tests / in-app modules). Returns unregister. */
export function registerContextProvider(provider: ContextProvider): () => void {
  extraProviders.push(provider)
  return () => {
    const i = extraProviders.indexOf(provider)
    if (i >= 0) extraProviders.splice(i, 1)
  }
}

/** Test helper: clear all extra providers. Builtins always remain. */
export function clearContextProviders(): void {
  extraProviders.length = 0
}

/** Stable group order for merge (not user-editable in PR-1). */
const GROUP_ORDER: ContextGroupId[] = [
  'primary',
  'edit',
  'clipboard',
  'navigation',
  'session',
  'workspace',
  'git',
  'debug',
  'danger',
  'extensions',
]

function groupRank(group: ContextGroupId): number {
  const i = GROUP_ORDER.indexOf(group)
  return i >= 0 ? i : GROUP_ORDER.length
}

/**
 * Merge items: stable group order, first-wins on duplicate ids, separators between groups.
 */
export function mergeByGroup(items: ContextMenuItemDef[]): ContextMenuItemDef[] {
  const seen = new Set<string>()
  const byGroup = new Map<ContextGroupId, ContextMenuItemDef[]>()
  const groupOrder: ContextGroupId[] = []

  for (const item of items) {
    if (!item.id || seen.has(item.id)) {
      if (item.id && seen.has(item.id) && import.meta.env.DEV) {
        console.warn(`[context-menu] duplicate id skipped: ${item.id}`)
      }
      continue
    }
    seen.add(item.id)
    if (!byGroup.has(item.group)) {
      byGroup.set(item.group, [])
      groupOrder.push(item.group)
    }
    byGroup.get(item.group)!.push(item)
  }

  groupOrder.sort((a, b) => groupRank(a) - groupRank(b))

  const out: ContextMenuItemDef[] = []
  for (let gi = 0; gi < groupOrder.length; gi++) {
    const g = groupOrder[gi]!
    const list = byGroup.get(g) ?? []
    for (let i = 0; i < list.length; i++) {
      const item = list[i]!
      const separatorBefore = item.separatorBefore || (gi > 0 && i === 0)
      out.push(separatorBefore ? { ...item, separatorBefore: true } : item)
    }
  }
  return out
}

/** PR-1: filter disabledIds only. orderByKind deferred to PR-7. */
export function applyPrefs(
  items: ContextMenuItemDef[],
  prefs: ContextMenuPrefs = loadPrefs(),
): ContextMenuItemDef[] {
  if (!prefs.disabledIds.length) return items
  const disabled = new Set(prefs.disabledIds)
  return items.filter((item) => !disabled.has(item.id))
}

export function buildContextMenuItems(
  req: ContextRequest,
  ctx: ContextMenuBuildContext,
  prefs: ContextMenuPrefs = loadPrefs(),
): ContextMenuItemDef[] {
  const raw = [...BUILTIN_PROVIDERS, ...extraProviders]
    .flatMap((p) => p(req, ctx))
    .filter((item) => Boolean(item?.id))
  return applyPrefs(mergeByGroup(raw), prefs)
}
