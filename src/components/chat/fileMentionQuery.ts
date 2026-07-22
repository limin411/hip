/**
 * Pure helpers for composer `@` file references.
 * Trigger mirrors extractSlashQuery; token may contain `/` (unlike slash).
 */

/** Extract @-query at end of composer value. Null = palette closed. */
export function extractAtQuery(value: string): string | null {
  // @ at start or after whitespace (\s includes tab); token: no whitespace, no extra @
  const m = value.match(/(?:^|\s)@([^\s@]*)$/)
  if (!m) return null
  return m[1]
}

/** Replace the active @-token with selected relative path (leading @ kept, trailing space). */
export function applyFileMention(currentValue: string, relPath: string): string {
  const m = currentValue.match(/^((?:.*\s)?)@[^\s@]*$/)
  const prefix = m ? m[1] : ''
  const rel = relPath.replace(/\\/g, '/').replace(/\/+$/, '')
  return `${prefix}@${rel} `
}

/**
 * Directory prefix completion: keep palette open (no trailing space).
 * extractAtQuery remains non-null; query becomes the path prefix including trailing `/`.
 */
export function applyFileMentionDirPrefix(currentValue: string, relDir: string): string {
  const m = currentValue.match(/^((?:.*\s)?)@[^\s@]*$/)
  const prefix = m ? m[1] : ''
  const rel = relDir.replace(/\\/g, '/').replace(/\/+$/, '')
  return `${prefix}@${rel}/`
}

/** Strip active @-token (slash-parity dismiss). */
export function stripAtToken(currentValue: string): string {
  const m = currentValue.match(/^((?:.*\s)?)@[^\s@]*$/)
  return m ? m[1] : currentValue
}
