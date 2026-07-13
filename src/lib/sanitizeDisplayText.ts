/**
 * Strip internal agent markup (DSML tool_calls blocks / tags) from user-facing text.
 * Pattern aligned with packages/sidecar/src/session/dsml.ts — keep in sync if MARK changes.
 */

/** Marker between angle brackets: |DSML| or ||DSML|| or fullwidth ｜ variants. */
const MARK = String.raw`(?:\|{1,2}|｜{1,2})\s*DSML\s*(?:\|{1,2}|｜{1,2})`

const OPEN_TOOL_CALLS = new RegExp(`<\\s*${MARK}\\s*tool_calls\\s*>`, 'i')
const CLOSE_TOOL_CALLS = new RegExp(`</\\s*${MARK}\\s*tool_calls\\s*>`, 'i')
const ANY_DSML_TAG = new RegExp(`</?\\s*${MARK}[^>]*>`, 'gi')
/** Loose residual markers that sometimes leak without full tags. */
const LOOSE_DSML = /(?:\|{1,2}|｜{1,2})\s*DSML\s*(?:\|{1,2}|｜{1,2})/gi

export function hasInternalMarkup(text: string | null | undefined): boolean {
  if (!text) return false
  OPEN_TOOL_CALLS.lastIndex = 0
  ANY_DSML_TAG.lastIndex = 0
  LOOSE_DSML.lastIndex = 0
  return OPEN_TOOL_CALLS.test(text) || ANY_DSML_TAG.test(text) || LOOSE_DSML.test(text)
}

/** Remove one DSML tool_calls block (or incomplete open → strip tags). */
function stripDsmlBlocks(text: string): string {
  let out = text
  // Repeat in case of multiple blocks
  for (let i = 0; i < 8; i++) {
    OPEN_TOOL_CALLS.lastIndex = 0
    const openMatch = out.match(OPEN_TOOL_CALLS)
    if (!openMatch || openMatch.index === undefined) break
    const start = openMatch.index
    const afterOpen = start + openMatch[0].length
    const closeMatch = out.slice(afterOpen).match(CLOSE_TOOL_CALLS)
    if (closeMatch && closeMatch.index !== undefined) {
      const blockEnd = afterOpen + closeMatch.index + closeMatch[0].length
      out = out.slice(0, start) + out.slice(blockEnd)
    } else {
      // Incomplete block — drop from open tag to end
      out = out.slice(0, start)
      break
    }
  }
  ANY_DSML_TAG.lastIndex = 0
  out = out.replace(ANY_DSML_TAG, '')
  LOOSE_DSML.lastIndex = 0
  out = out.replace(LOOSE_DSML, '')
  return out
}

/**
 * Defensive sanitization for any string shown in the chat process UI or answer.
 * Never returns DSML markup; empty after strip → ''.
 */
export function sanitizeDisplayText(text: string | null | undefined): string {
  if (text == null) return ''
  const normalized = String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  if (!hasInternalMarkup(normalized)) return normalized
  return stripDsmlBlocks(normalized).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}
