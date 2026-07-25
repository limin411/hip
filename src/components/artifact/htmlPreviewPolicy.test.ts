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
  it('passes through under the hard cap', () => {
    const r = htmlForIframe('<html></html>')
    expect(r).toEqual({ srcDoc: '<html></html>', hardTruncated: false })
  })
  it('hard-truncates oversized content within the hard cap', () => {
    const big = 'a'.repeat(HTML_IFRAME_HARD_MAX_CHARS + 50)
    const r = htmlForIframe(big)
    expect(r.hardTruncated).toBe(true)
    expect(r.srcDoc.length).toBeLessThanOrEqual(HTML_IFRAME_HARD_MAX_CHARS)
    expect(r.srcDoc.length).toBeLessThan(big.length)
    expect(r.srcDoc.startsWith('a'.repeat(100))).toBe(true)
    expect(r.srcDoc).toContain('truncated for performance')
  })
})
