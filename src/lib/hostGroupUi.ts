import type { HostGroup, TerminalHost } from '@/ipc/terminalHosts'

/** Host rows per page in a group — caps DOM when a group grows large. */
export const HOST_LIST_PAGE_SIZE = 15

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

function hostSearchHaystack(host: TerminalHost): string {
  const parts = [
    host.label,
    host.hostname,
    host.username,
    `${host.username}@${host.hostname}`,
    `${host.hostname}:${host.port}`,
  ]
  if (host.remotePath) parts.push(host.remotePath)
  return parts.join('\0').toLowerCase()
}

/** Case-insensitive match on label, user, host, user@host, host:port, remote path. */
export function hostMatchesQuery(host: TerminalHost, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return hostSearchHaystack(host).includes(q)
}

export function filterHostsByQuery(
  hosts: readonly TerminalHost[],
  query: string,
): TerminalHost[] {
  const q = query.trim()
  if (!q) return hosts.slice()
  return hosts.filter((h) => hostMatchesQuery(h, q))
}

export function paginateHosts<T>(
  items: readonly T[],
  page: number,
  pageSize = HOST_LIST_PAGE_SIZE,
): T[] {
  const safePage = Math.max(1, page)
  const start = (safePage - 1) * pageSize
  return items.slice(start, start + pageSize)
}

export function hostListTotalPages(
  count: number,
  pageSize = HOST_LIST_PAGE_SIZE,
): number {
  return Math.max(1, Math.ceil(count / pageSize))
}
