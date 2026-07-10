/** Candidate project instruction files (matches sidecar load order). */
export const PROJECT_GUIDANCE_CANDIDATES = [
  'AGENTS.md',
  'CLAUDE.md',
  'Claude.md',
  '.hip/AGENTS.md',
] as const

/** Pick the first guidance file name present in a directory listing. */
export function pickProjectGuidanceName(entryNames: string[]): string | null {
  const set = new Set(entryNames)
  for (const c of PROJECT_GUIDANCE_CANDIDATES) {
    const base = c.includes('/') ? c.split('/').pop()! : c
    // Root candidates appear as basename; .hip/AGENTS.md needs parent listing — UI only probes root first.
    if (!c.includes('/') && set.has(base)) return c
  }
  return null
}

export function projectGuidancePreview(content: string, max = 200): string {
  const t = content.trim()
  if (t.length <= max) return t
  return `${t.slice(0, max)}…`
}
