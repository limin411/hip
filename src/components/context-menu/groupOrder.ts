import type { ContextGroupId, ContextMenuItemMeta } from './types'

/** Stable group order for merge (not user-editable). Shared by registry + Settings baseline. */
export const GROUP_ORDER: ContextGroupId[] = [
  'primary',
  'edit',
  'clipboard',
  'agent',
  'navigation',
  'session',
  'workspace',
  'git',
  'debug',
  'danger',
  'extensions',
]

export function groupRank(group: ContextGroupId): number {
  const i = GROUP_ORDER.indexOf(group)
  return i >= 0 ? i : GROUP_ORDER.length
}

/**
 * Sort catalog meta with the same group ranking as `mergeByGroup`.
 * Stable within a group (preserves relative input order).
 * Use as Settings / first-write baseline when `orderByKind[kind]` is absent.
 */
export function sortMetaByGroup(items: ContextMenuItemMeta[]): ContextMenuItemMeta[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const rankDiff = groupRank(a.item.group) - groupRank(b.item.group)
      if (rankDiff !== 0) return rankDiff
      return a.index - b.index
    })
    .map(({ item }) => item)
}
