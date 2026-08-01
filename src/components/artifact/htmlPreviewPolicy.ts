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

/**
 * srcDoc is a separate document — host scrollbar CSS never applies. Default
 * WebKit track is a wide light strip on the right when content overflows
 * (classic “white edge” on tall/dark HTML). Match host thin transparent bars.
 */
const IFRAME_CHROME_STYLE =
  '<style data-hip-preview-chrome>' +
  'html{color-scheme:light dark}' +
  '*{scrollbar-width:thin;scrollbar-color:rgba(128,128,128,.45) transparent}' +
  '::-webkit-scrollbar{width:5px;height:5px}' +
  '::-webkit-scrollbar-track{background:transparent}' +
  '::-webkit-scrollbar-thumb{background:rgba(128,128,128,.4);border-radius:3px}' +
  '</style>'

/** Inject preview chrome once (idempotent if already present). */
export function injectHtmlPreviewChrome(html: string): string {
  if (!html || html.includes('data-hip-preview-chrome')) return html
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => `${m}${IFRAME_CHROME_STYLE}`)
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${IFRAME_CHROME_STYLE}</head>`)
  }
  return `${IFRAME_CHROME_STYLE}${html}`
}

export function htmlForIframe(content: string): { srcDoc: string; hardTruncated: boolean } {
  if (content.length <= HTML_IFRAME_HARD_MAX_CHARS) {
    return { srcDoc: injectHtmlPreviewChrome(content), hardTruncated: false }
  }
  const overhead = HARD_TRUNC_NOTE.length + IFRAME_CHROME_STYLE.length
  const bodyBudget = Math.max(0, HTML_IFRAME_HARD_MAX_CHARS - overhead)
  return {
    srcDoc: injectHtmlPreviewChrome(content.slice(0, bodyBudget) + HARD_TRUNC_NOTE),
    hardTruncated: true,
  }
}
