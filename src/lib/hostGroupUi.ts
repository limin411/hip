import type { HostGroup } from '@/ipc/terminalHosts'

/** Case-insensitive name equality for group uniqueness. */
export function groupNamesEqual(a: string, b: string): boolean {
  return a.trim().localeCompare(b.trim(), undefined, { sensitivity: 'base' }) === 0
}

/**
 * True when `name` collides with another group (excluding `excludeId` when renaming).
 * Empty / whitespace-only names are not treated as duplicates (required check is separate).
 */
export function isDuplicateGroupName(
  name: string,
  groups: readonly HostGroup[],
  excludeId?: string,
): boolean {
  const n = name.trim()
  if (!n) return false
  return groups.some((g) => g.id !== excludeId && groupNamesEqual(g.name, n))
}

/** Display order: name ascending (locale-aware, case-insensitive). */
export function sortGroupsByName(groups: readonly HostGroup[]): HostGroup[] {
  return [...groups].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  )
}
