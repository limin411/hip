/**
 * HTML iframe preview can freeze the WebView when the browser parses a large
 * DOM on the UI thread (srcDoc). Soft-gate auto-render and let the user opt in.
 */

/** Auto-render in iframe only when content is at or under this many UTF-16 code units. */
export const HTML_AUTO_RENDER_MAX_CHARS = 120_000

/** Hard cap for what we inject into srcDoc even after the user opts in (safety). */
export const HTML_IFRAME_HARD_MAX_CHARS = 512_000

export function shouldAutoRenderHtml(content: string): boolean {
  return content.length <= HTML_AUTO_RENDER_MAX_CHARS
}

/**
 * Content safe to put in iframe srcDoc. Returns truncated body + flag when
 * the hard cap is applied (user explicitly rendered a huge file).
 */
const HARD_TRUNC_NOTE = '\n<!-- hip: HTML preview truncated for performance -->\n'

export function htmlForIframe(content: string): { srcDoc: string; hardTruncated: boolean } {
  if (content.length <= HTML_IFRAME_HARD_MAX_CHARS) {
    return { srcDoc: content, hardTruncated: false }
  }
  const bodyBudget = Math.max(0, HTML_IFRAME_HARD_MAX_CHARS - HARD_TRUNC_NOTE.length)
  return {
    srcDoc: content.slice(0, bodyBudget) + HARD_TRUNC_NOTE,
    hardTruncated: true,
  }
}
