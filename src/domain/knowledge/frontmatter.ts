/**
 * Opaque YAML frontmatter strip/join for Live editor (and later search indexing).
 *
 * Milkdown treats `---` as thematic breaks and corrupts YAML — never feed the
 * fenced block into Live. Split before edit, re-prefix on serialize.
 *
 * Does not parse YAML values; only matches a leading `---` … `---` fence.
 */

export type FrontmatterSplit = {
  /** Full fence including opening/closing `---`, or '' when absent. */
  fmText: string
  /** Remainder after the closing fence line (may start with a blank line). */
  body: string
}

/**
 * Split leading YAML frontmatter fences from a document.
 * CRLF is normalized when a fence is present; documents without FM are returned unchanged.
 */
export function splitYamlFrontmatter(raw: string): FrontmatterSplit {
  const s = raw.replace(/\r\n/g, '\n')
  if (!s.startsWith('---\n')) return { fmText: '', body: raw }

  const rest = s.slice(4) // after opening `---\n`
  const close = rest.match(/\n---(?:\n|$)/)
  if (!close || close.index === undefined) return { fmText: '', body: raw }

  const yaml = rest.slice(0, close.index)
  const after = rest.slice(close.index + close[0].length)
  const fmText = `---\n${yaml}\n---`
  return { fmText, body: after }
}

/** Re-prefix opaque FM text onto a body serialized from Live (or any body string). */
export function joinYamlFrontmatter(fmText: string, body: string): string {
  if (!fmText) return body
  return `${fmText}\n${body}`
}
