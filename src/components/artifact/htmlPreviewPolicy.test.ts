import { describe, it, expect } from 'vitest'
import {
  HTML_AUTO_RENDER_MAX_CHARS,
  HTML_IFRAME_HARD_MAX_CHARS,
  htmlForIframe,
  shouldAutoRenderHtml,
} from './htmlPreviewPolicy'

describe('shouldAutoRenderHtml', () => {
  it('allows small documents', () => {
    expect(shouldAutoRenderHtml('<p>hi</p>')).toBe(true)
  })
  it('blocks auto-render past the soft cap', () => {
    expect(shouldAutoRenderHtml('x'.repeat(HTML_AUTO_RENDER_MAX_CHARS + 1))).toBe(false)
  })
  it('allows exactly at the soft cap', () => {
    expect(shouldAutoRenderHtml('x'.repeat(HTML_AUTO_RENDER_MAX_CHARS))).toBe(true)
  })
})

describe('htmlForIframe', () => {
  it('injects thin scrollbar chrome under the hard cap', () => {
    const r = htmlForIframe('<html><head></head><body>x</body></html>')
    expect(r.hardTruncated).toBe(false)
    expect(r.srcDoc).toContain('data-hip-preview-chrome')
    expect(r.srcDoc).toContain('::-webkit-scrollbar')
    expect(r.srcDoc).toContain('<body>x</body>')
  })
  it('is idempotent when chrome is already present', () => {
    const once = htmlForIframe('<html><head></head></html>').srcDoc
    const twice = htmlForIframe(once).srcDoc
    expect(twice.match(/data-hip-preview-chrome/g)).toHaveLength(1)
  })
  it('hard-truncates oversized content within the hard cap', () => {
    const big = 'a'.repeat(HTML_IFRAME_HARD_MAX_CHARS + 50)
    const r = htmlForIframe(big)
    expect(r.hardTruncated).toBe(true)
    expect(r.srcDoc.length).toBeLessThanOrEqual(HTML_IFRAME_HARD_MAX_CHARS)
    expect(r.srcDoc.length).toBeLessThan(big.length)
    expect(r.srcDoc).toContain('a'.repeat(100))
    expect(r.srcDoc).toContain('truncated for performance')
    expect(r.srcDoc).toContain('data-hip-preview-chrome')
  })
})
