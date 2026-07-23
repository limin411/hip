import type { CommandUsageMap } from './usageStore'
import type { GlobalCommand, PaletteGroup } from './types'
import { indexCommands } from './favorites'

export const RECENT_COMMAND_LIMIT = 8

/**
 * Build a Recent group from usage timestamps, resolving against current groups.
 * Skips missing ids and nested `to` drill-in rows.
 */
export function buildRecentGroup(
  groups: PaletteGroup[],
  heading: string,
  usage: CommandUsageMap,
  limit = RECENT_COMMAND_LIMIT,
): PaletteGroup | null {
  const index = indexCommands(groups)
  const ranked = Object.entries(usage)
    .filter(([, e]) => e && e.count > 0)
    .sort((a, b) => (b[1]?.lastUsedAtMs ?? 0) - (a[1]?.lastUsedAtMs ?? 0))

  const items: GlobalCommand[] = []
  const seen = new Set<string>()
  for (const [id] of ranked) {
    if (seen.has(id)) continue
    const cmd = index.get(id)
    if (!cmd || cmd.to) continue
    seen.add(id)
    items.push({ ...cmd, shortcut: undefined })
    if (items.length >= limit) break
  }
  if (items.length === 0) return null
  return { id: 'recent', heading, items }
}
