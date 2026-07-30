/**
 * Defense-in-depth link href filtering for Live bubble Apply (R4).
 * Milkdown linkSchema.toDOM already sanitizes for render; this filters before
 * writing attrs so javascript: etc. are less likely to land in disk MD.
 */

const SAFE_SCHEME = /^(https?:|mailto:|tel:|#|\/|\.\/|\.\.\/)/i

/**
 * Returns sanitized href or null if the value must not be applied.
 * Empty/whitespace → null. Relative paths and http(s)/mailto/tel/# allowed.
 */
export function sanitizeKnowledgeLinkHref(raw: string): string | null {
  const href = raw.trim()
  if (!href) return null
  // Block explicit dangerous schemes even if they match loosely.
  if (/^(javascript|data|vbscript):/i.test(href)) return null
  if (SAFE_SCHEME.test(href)) return href
  // Bare domain-like or path without scheme: allow as relative/path text.
  if (!/^[a-z][a-z0-9+.-]*:/i.test(href)) return href
  return null
}
