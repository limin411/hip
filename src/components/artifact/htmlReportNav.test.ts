import { describe, it, expect } from 'vitest'
import {
  parseHipReportOpenFile,
  prepareHtmlReportForPreview,
  resolveSiblingHtmlFile,
  sanitizeSiblingHtmlBasename,
  HIP_REPORT_MSG_SOURCE,
} from './htmlReportNav'

describe('sanitizeSiblingHtmlBasename', () => {
  it('accepts simple report basenames', () => {
    expect(sanitizeSiblingHtmlBasename('roundtable-report-strategist.html')).toBe(
      'roundtable-report-strategist.html',
    )
    expect(sanitizeSiblingHtmlBasename('./roundtable-report.html')).toBe('roundtable-report.html')
  })

  it('rejects traversal and nested paths', () => {
    expect(sanitizeSiblingHtmlBasename('../secret.html')).toBeNull()
    expect(sanitizeSiblingHtmlBasename('a/b.html')).toBeNull()
    expect(sanitizeSiblingHtmlBasename('/tmp/x.html')).toBeNull()
    expect(sanitizeSiblingHtmlBasename('note.md')).toBeNull()
    expect(sanitizeSiblingHtmlBasename('')).toBeNull()
  })
})

describe('parseHipReportOpenFile', () => {
  it('parses valid postMessage payload', () => {
    expect(
      parseHipReportOpenFile({
        source: HIP_REPORT_MSG_SOURCE,
        type: 'open-file',
        file: 'roundtable-report-skeptic.html',
      }),
    ).toBe('roundtable-report-skeptic.html')
  })

  it('rejects foreign messages', () => {
    expect(parseHipReportOpenFile({ source: 'other', type: 'open-file', file: 'a.html' })).toBeNull()
    expect(parseHipReportOpenFile(null)).toBeNull()
  })
})

describe('resolveSiblingHtmlFile', () => {
  it('resolves next to absolute current path under cwd', () => {
    expect(
      resolveSiblingHtmlFile('/tmp/proj/roundtable-report.html', 'roundtable-report-operator.html', '/tmp/proj'),
    ).toBe('/tmp/proj/roundtable-report-operator.html')
  })

  it('resolves relative current path via cwd', () => {
    expect(
      resolveSiblingHtmlFile('roundtable-report.html', 'roundtable-report-creative.html', '/work'),
    ).toBe('/work/roundtable-report-creative.html')
  })

  it('returns null when path would escape cwd', () => {
    expect(resolveSiblingHtmlFile('/other/x.html', 'a.html', '/tmp/proj')).toBeNull()
  })
})

describe('prepareHtmlReportForPreview', () => {
  it('adds data-file and injects nav for legacy sibling links', () => {
    const raw = `<!DOCTYPE html><html><body>
<a class="role-card" href="roundtable-report-strategist.html">Strategist</a>
</body></html>`
    const out = prepareHtmlReportForPreview(raw)
    expect(out).toContain('data-file="roundtable-report-strategist.html"')
    expect(out).toContain(HIP_REPORT_MSG_SOURCE)
    expect(out).toContain('__hipReportSiblingNav')
  })

  it('does not re-inject when report already has hip nav script', () => {
    const raw = `<!DOCTYPE html><html><body>
<a href="roundtable-report-skeptic.html" data-file="roundtable-report-skeptic.html">S</a>
<script>/* hip-roundtable-report open-file */</script>
</body></html>`
    const out = prepareHtmlReportForPreview(raw)
    expect(out).not.toContain('__hipReportSiblingNav')
    expect(out.match(/hip-roundtable-report/g)?.length).toBe(1)
  })
})
