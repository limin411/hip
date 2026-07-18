/**
 * Case-insensitive substring highlight split for knowledge search hits.
 * No RegExp — safe for metacharacters (C++, (draft), a.b).
 */

export type HighlightPart =
  | { type: 'text'; value: string }
  | { type: 'mark'; value: string }

/**
 * Case-insensitive substring split.
 * - empty/whitespace query → single text part (caller should skip highlight UI)
 * - match unit = full trimmed query
 * - preserves original casing in output parts
 * - finds all non-overlapping occurrences left-to-right
 */
export function splitHighlight(text: string, query: string): HighlightPart[] {
  const q = query.trim()
  if (!q || !text) return [{ type: 'text', value: text }]
  const lowerText = text.toLowerCase()
  const lowerQ = q.toLowerCase()
  const parts: HighlightPart[] = []
  let start = 0
  while (start < text.length) {
    const idx = lowerText.indexOf(lowerQ, start)
    if (idx < 0) {
      parts.push({ type: 'text', value: text.slice(start) })
      break
    }
    if (idx > start) parts.push({ type: 'text', value: text.slice(start, idx) })
    parts.push({ type: 'mark', value: text.slice(idx, idx + q.length) })
    start = idx + q.length
  }
  return parts.length ? parts : [{ type: 'text', value: text }]
}
