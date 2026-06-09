/** Sentinel control chars wrapping a matched term in a search snippet (set by the sidecar FTS query). */
const MARK_START = ''
const MARK_END = ''

export interface SnippetSegment {
  text: string
  mark: boolean
}

/**
 * Split a sentinel-delimited search snippet into ordered segments.
 * Text between U+0001 and U+0002 is a match (`mark: true`); everything else is plain (`mark: false`).
 * A string with no sentinels yields a single unmarked segment; empty segments are dropped.
 */
export function splitSnippet(s: string): SnippetSegment[] {
  const out: SnippetSegment[] = []
  let i = 0
  while (i < s.length) {
    const start = s.indexOf(MARK_START, i)
    if (start === -1) {
      out.push({ text: s.slice(i), mark: false })
      break
    }
    if (start > i) out.push({ text: s.slice(i, start), mark: false })
    const end = s.indexOf(MARK_END, start + 1)
    if (end === -1) {
      // Unterminated start sentinel: treat the remainder (minus the sentinel) as a match.
      out.push({ text: s.slice(start + 1), mark: true })
      break
    }
    if (end > start + 1) out.push({ text: s.slice(start + 1, end), mark: true })
    i = end + 1
  }
  return out
}
