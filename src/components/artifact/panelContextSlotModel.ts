/** Basename of a path (POSIX or Windows separators). */
export function pathBasename(p: string): string {
  if (!p) return ''
  const parts = p.replace(/[/\\]+$/, '').split(/[/\\]/)
  return parts[parts.length - 1] || p
}

/** Short sha for titlebar (7 chars). */
export function shortSha(sha: string): string {
  return sha.length > 7 ? sha.slice(0, 7) : sha
}

export type DiffStats = {
  fileCount: number
  additions: number
  deletions: number
}

export function sumDiffStats(
  files: ReadonlyArray<{ additions: number; deletions: number }>,
): DiffStats {
  let additions = 0
  let deletions = 0
  for (const f of files) {
    additions += f.additions
    deletions += f.deletions
  }
  return { fileCount: files.length, additions, deletions }
}
