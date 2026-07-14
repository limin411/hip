/**
 * Knowledge preview helpers: heading slugs / anchors (P0.3a).
 * Pure slug helpers have no DOM dependency; scroll uses document when available.
 */

/**
 * GFM-ish heading id: lowercase, strip punctuation, spaces → hyphens.
 * Keeps Unicode letters/numbers (CJK-friendly). Empty → `heading`.
 */
export function slugifyHeading(text: string): string {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return s || 'heading'
}

/**
 * Assign unique heading ids in document order (first → `slug`, then `slug-1`, …).
 */
export function createHeadingIdAssigner(): (text: string) => string {
  const seen = new Map<string, number>()
  return (text: string) => {
    const base = slugifyHeading(text)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base}-${count}`
  }
}

/** Decode a hash fragment / id for lookup (best-effort). */
export function normalizeHeadingHash(idOrHash: string): string {
  const raw = idOrHash.startsWith('#') ? idOrHash.slice(1) : idOrHash
  if (!raw) return ''
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

/**
 * Scroll the first matching heading into view.
 * @returns true if an element was found and scrollIntoView was called.
 */
export function scrollToKnowledgeHeading(
  idOrHash: string,
  root?: ParentNode | null,
): boolean {
  if (typeof document === 'undefined') return false
  const id = normalizeHeadingHash(idOrHash)
  if (!id) return false

  const scope: ParentNode = root ?? document
  let el: Element | null = null
  if (scope === document) {
    el = document.getElementById(id)
  } else {
    try {
      el = (scope as ParentNode & { querySelector: typeof document.querySelector }).querySelector(
        `#${CSS.escape(id)}`,
      )
    } catch {
      el = null
    }
  }
  if (!el || typeof (el as HTMLElement).scrollIntoView !== 'function') return false
  ;(el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' })
  return true
}
