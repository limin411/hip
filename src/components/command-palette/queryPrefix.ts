/**
 * Query prefix modes (VS Code / GitHub style):
 *   >  commands only (nav, actions, workspace, context, theme, appearance)
 *   #  sessions only
 *   @  skills only
 * (no prefix = all groups)
 */

export type PaletteQueryMode = 'all' | 'commands' | 'sessions' | 'skills'

export type ParsedPaletteQuery = {
  mode: PaletteQueryMode
  /** Text used for ranking (prefix character stripped). */
  needle: string
  /** Leading prefix if any. */
  prefix: '>' | '#' | '@' | null
  /** Raw input (for display). */
  raw: string
}

const COMMAND_GROUP_IDS = new Set([
  'context',
  'navigation',
  'actions',
  'workspace',
  'appearance',
  'theme',
  'favorites',
  'commands-extra',
])

export function parsePaletteQuery(raw: string): ParsedPaletteQuery {
  const trimmedStart = raw.trimStart()
  if (trimmedStart.startsWith('>')) {
    return {
      mode: 'commands',
      needle: trimmedStart.slice(1).trim(),
      prefix: '>',
      raw,
    }
  }
  if (trimmedStart.startsWith('#')) {
    return {
      mode: 'sessions',
      needle: trimmedStart.slice(1).trim(),
      prefix: '#',
      raw,
    }
  }
  if (trimmedStart.startsWith('@')) {
    return {
      mode: 'skills',
      needle: trimmedStart.slice(1).trim(),
      prefix: '@',
      raw,
    }
  }
  return { mode: 'all', needle: raw.trim(), prefix: null, raw }
}

export type GroupLike = { id?: string; heading?: string; items: unknown[] }

/** Filter groups by query mode. */
export function filterGroupsByMode<T extends GroupLike>(
  groups: T[],
  mode: PaletteQueryMode,
): T[] {
  if (mode === 'all') return groups
  if (mode === 'sessions') {
    return groups.filter((g) => g.id === 'sessions')
  }
  if (mode === 'skills') {
    return groups.filter((g) => g.id === 'skills')
  }
  // commands: drop sessions + skills
  return groups.filter((g) => {
    if (g.id === 'sessions' || g.id === 'skills') return false
    if (g.id && COMMAND_GROUP_IDS.has(g.id)) return true
    // Groups without id that aren't sessions/skills: keep if not named Sessions/Skills via id only
    return g.id !== 'sessions' && g.id !== 'skills'
  })
}

/**
 * Whether long-tail providers should run even with empty needle.
 * `@` alone should still list skills; `#` alone lists sessions.
 */
export function forceLongTail(mode: PaletteQueryMode): boolean {
  return mode === 'skills' || mode === 'sessions'
}
