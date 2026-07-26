/**
 * Cross-file navigation for HTML report previews (e.g. roundtable summary → role sub-reports).
 *
 * srcDoc iframes cannot load sibling .html files via relative href (navigates to blank).
 * Reports postMessage the parent; the preview host opens the sibling via fs:read.
 */

import { resolvePathUnderCwd } from '@/lib/pathScope'

/** Must match packages/sidecar/.../report.ts ROUNDTABLE_REPORT_NAV_SCRIPT. */
export const HIP_REPORT_MSG_SOURCE = 'hip-roundtable-report'

/**
 * Injected when previewing HTML that links to sibling reports but lacks the
 * hip nav script (older deliverables). Mirrors report.ts openSibling handler.
 */
const SIBLING_NAV_INJECT = /* js */ `
(function () {
  if (window.__hipReportSiblingNav) return;
  window.__hipReportSiblingNav = true;
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a[data-file]') : null;
    if (!a) return;
    var file = a.getAttribute('data-file');
    if (!file || !window.parent || window.parent === window) return;
    e.preventDefault();
    try {
      window.parent.postMessage(
        { source: 'hip-roundtable-report', type: 'open-file', file: file },
        '*'
      );
    } catch (err) {}
  });
})();
`.trim()

/**
 * Prepare HTML for srcDoc preview: attach data-file on relative .html links and
 * ensure sibling-open postMessage works (fixes white-screen on role sub-report clicks).
 */
export function prepareHtmlReportForPreview(content: string): string {
  if (!content || !/\.html/i.test(content)) return content

  // Relative sibling basenames only (reject ..). Skip if data-file already present.
  let html = content.replace(
    /href="(\.\/)?([A-Za-z0-9._-]+\.html)"(?![^>]*data-file)/gi,
    (_full, dot: string | undefined, name: string) => {
      const href = `${dot ?? ''}${name}`
      return `href="${href}" data-file="${name}"`
    },
  )
  html = html.replace(
    /href='(\.\/)?([A-Za-z0-9._-]+\.html)'(?![^>]*data-file)/gi,
    (_full, dot: string | undefined, name: string) => {
      const href = `${dot ?? ''}${name}`
      return `href='${href}' data-file='${name}'`
    },
  )

  // New templates already embed hip-roundtable-report nav; only inject for older files.
  if (!html.includes('data-file=') || html.includes(HIP_REPORT_MSG_SOURCE)) {
    return html
  }

  if (/<\/body>/i.test(html)) {
    return html.replace(/<\/body>/i, `<script>${SIBLING_NAV_INJECT}</script></body>`)
  }
  return `${html}\n<script>${SIBLING_NAV_INJECT}</script>`
}

export type HipReportOpenFileMessage = {
  source: typeof HIP_REPORT_MSG_SOURCE
  type: 'open-file'
  file: string
}

/** Parse a window message payload; returns the requested sibling basename or null. */
export function parseHipReportOpenFile(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  if (d.source !== HIP_REPORT_MSG_SOURCE || d.type !== 'open-file') return null
  if (typeof d.file !== 'string') return null
  return sanitizeSiblingHtmlBasename(d.file)
}

/**
 * Only allow a single relative HTML basename (no directories / traversal).
 * Accepts `foo.html` or `./foo.html`.
 */
export function sanitizeSiblingHtmlBasename(file: string): string | null {
  const raw = file.trim().replace(/\\/g, '/')
  if (!raw) return null
  const cleaned = raw.replace(/^\.\//, '')
  if (!cleaned || cleaned.includes('/') || cleaned.includes('..')) return null
  if (!/\.html?$/i.test(cleaned)) return null
  if (!/^[A-Za-z0-9._-]+$/.test(cleaned)) return null
  return cleaned
}

/**
 * Resolve a sibling HTML path next to the currently previewed file, under cwd.
 */
export function resolveSiblingHtmlFile(
  currentPath: string,
  file: string,
  cwd?: string | null,
): string | null {
  const base = sanitizeSiblingHtmlBasename(file)
  if (!base) return null

  const currentAbs =
    resolvePathUnderCwd(cwd, currentPath) ??
    (currentPath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(currentPath) ? currentPath.replace(/\\/g, '/') : null)

  if (currentAbs) {
    const slash = currentAbs.lastIndexOf('/')
    const dir = slash >= 0 ? currentAbs.slice(0, slash) : ''
    const candidate = dir ? `${dir}/${base}` : base
    return resolvePathUnderCwd(cwd, candidate) ?? (cwd ? null : candidate)
  }

  return resolvePathUnderCwd(cwd, base)
}
