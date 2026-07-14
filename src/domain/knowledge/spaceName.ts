/** Display-name helpers for knowledge spaces (unique among siblings in the index). */

export function normalizeSpaceName(name: string): string {
  return name.trim()
}

/**
 * True if another space already uses this display name (case-insensitive after trim).
 * Pass `excludeId` when renaming so the space can keep its current name.
 */
export function isSpaceNameTaken(
  spaces: ReadonlyArray<{ id: string; name: string }>,
  name: string,
  excludeId?: string | null,
): boolean {
  const key = normalizeSpaceName(name).toLowerCase()
  if (!key) return false
  return spaces.some(
    (s) => s.id !== excludeId && s.name.trim().toLowerCase() === key,
  )
}
