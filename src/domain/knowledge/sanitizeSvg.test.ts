/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from 'vitest'
import {
  SANITIZE_SVG_DEFAULT_MAX_CHARS,
  SANITIZE_SVG_DEFAULT_MAX_NODES,
  isSafeSvgHref,
  normalizeHrefCandidate,
  sanitizePaintValue,
  sanitizeSvg,
} from './sanitizeSvg'

describe('normalizeHrefCandidate', () => {
  it('strips tabs/newlines/CR and other C0 controls', () => {
    expect(normalizeHrefCandidate('java\tscript:alert(1)')).toBe('javascript:alert(1)')
    expect(normalizeHrefCandidate('java\nscript:alert(1)')).toBe('javascript:alert(1)')
    expect(normalizeHrefCandidate('java\rscript:alert(1)')).toBe('javascript:alert(1)')
    expect(normalizeHrefCandidate('  #frag  ')).toBe('#frag')
  })
})

describe('isSafeSvgHref', () => {
  it('use only allows fragment', () => {
    expect(isSafeSvgHref('#icon', 'use')).toBe(true)
    expect(isSafeSvgHref('assets/x.svg#i', 'use')).toBe(false)
    expect(isSafeSvgHref('https://evil/x.svg#i', 'use')).toBe(false)
  })

  it('image allows relative and data:image, not javascript/external', () => {
    expect(isSafeSvgHref('assets/a.png', 'image')).toBe(true)
    expect(isSafeSvgHref('data:image/png;base64,aa', 'image')).toBe(true)
    expect(isSafeSvgHref('javascript:alert(1)', 'image')).toBe(false)
    expect(isSafeSvgHref('https://evil/a.png', 'image')).toBe(false)
    expect(isSafeSvgHref('//evil/a.png', 'image')).toBe(false)
  })

  it('a allows fragment and relative only', () => {
    expect(isSafeSvgHref('#top', 'a')).toBe(true)
    expect(isSafeSvgHref('docs/x', 'a')).toBe(true)
    expect(isSafeSvgHref('https://example.com', 'a')).toBe(false)
    expect(isSafeSvgHref('javascript:alert(1)', 'a')).toBe(false)
  })

  it('rejects control-char split javascript: (tab/NL/CR)', () => {
    expect(isSafeSvgHref('java\tscript:alert(1)', 'a')).toBe(false)
    expect(isSafeSvgHref('java\nscript:alert(1)', 'a')).toBe(false)
    expect(isSafeSvgHref('java\rscript:alert(1)', 'a')).toBe(false)
    expect(isSafeSvgHref('java\tscript:alert(1)', 'image')).toBe(false)
  })

  it('rejects backslash external / protocol-relative forms', () => {
    expect(isSafeSvgHref('\\\\evil.com/x.png', 'image')).toBe(false)
    expect(isSafeSvgHref('/\\evil.com/x', 'image')).toBe(false)
    expect(isSafeSvgHref('\\\\evil.com', 'a')).toBe(false)
    expect(isSafeSvgHref('/\\evil.com/x', 'a')).toBe(false)
    // literal single-backslash host tricks
    expect(isSafeSvgHref('\\evil.com/x.png', 'image')).toBe(false)
  })
})

describe('sanitizePaintValue', () => {
  it('keeps solid colors and fragment paint servers', () => {
    expect(sanitizePaintValue('red')).toBe('red')
    expect(sanitizePaintValue('#0f0')).toBe('#0f0')
    expect(sanitizePaintValue('url(#grad)')).toBe('url(#grad)')
    expect(sanitizePaintValue('none')).toBe('none')
  })

  it('neutralizes javascript: and external url() paint servers', () => {
    expect(sanitizePaintValue('url(javascript:alert(1))')).toBe('none')
    expect(sanitizePaintValue('url(https://evil/x)')).toBe('none')
    expect(sanitizePaintValue('url(\\\\evil.com/x)')).toBe('none')
    expect(sanitizePaintValue('java\tscript:alert(1)')).toBeNull()
  })
})

describe('sanitizeSvg', () => {
  it('returns empty for blank input', () => {
    expect(sanitizeSvg('')).toEqual({ ok: false, reason: 'empty' })
    expect(sanitizeSvg('   \n')).toEqual({ ok: false, reason: 'empty' })
  })

  it('accepts a simple safe circle', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red"/></svg>`
    const r = sanitizeSvg(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.svg).toContain('<circle')
    expect(r.svg).toContain('fill="red"')
    expect(r.svg).not.toMatch(/script/i)
  })

  it('strips script elements', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="1"/></svg>`
    const r = sanitizeSvg(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.svg.toLowerCase()).not.toContain('script')
    expect(r.svg).not.toContain('alert')
    expect(r.svg).toContain('circle')
  })

  it('strips onclick and all on* handlers', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg"><circle r="1" onclick="alert(1)" onload="evil()" onmouseover="x()"/></svg>`
    const r = sanitizeSvg(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.svg.toLowerCase()).not.toContain('onclick')
    expect(r.svg.toLowerCase()).not.toContain('onload')
    expect(r.svg.toLowerCase()).not.toContain('onmouseover')
    expect(r.svg).not.toContain('alert')
  })

  it('strips foreignObject entirely', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg">
      <foreignObject width="100" height="100"><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject>
      <rect width="1" height="1"/>
    </svg>`
    const r = sanitizeSvg(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.svg.toLowerCase()).not.toContain('foreignobject')
    expect(r.svg).not.toContain('alert')
    expect(r.svg).toContain('rect')
  })

  it('strips javascript: href on anchors', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><text>x</text></a></svg>`
    const r = sanitizeSvg(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.svg.toLowerCase()).not.toContain('javascript')
    expect(r.svg).not.toContain('alert')
  })

  it('strips external image href and keeps relative', () => {
    const ext = `<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/x.png" width="1" height="1"/></svg>`
    const r1 = sanitizeSvg(ext)
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(r1.svg).not.toContain('evil.example')
    expect(r1.svg).not.toMatch(/href\s*=\s*"https:/i)

    const rel = `<svg xmlns="http://www.w3.org/2000/svg"><image href="assets/x.png" width="1" height="1"/></svg>`
    const r2 = sanitizeSvg(rel)
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.svg).toContain('assets/x.png')
  })

  it('strips external use; keeps fragment use', () => {
    const ext = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <use xlink:href="https://evil/icons.svg#i"/>
    </svg>`
    const r1 = sanitizeSvg(ext)
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(r1.svg).not.toContain('evil')

    const frag = `<svg xmlns="http://www.w3.org/2000/svg"><defs><g id="i"><circle r="1"/></g></defs><use href="#i"/></svg>`
    const r2 = sanitizeSvg(frag)
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.svg).toContain('href="#i"')
  })

  it('strips SMIL animate / onbegin (disallowed elements)', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg">
      <circle r="1">
        <animate attributeName="r" values="1;2" onbegin="alert(1)"/>
      </circle>
      <set attributeName="visibility" to="hidden" onbegin="evil()"/>
    </svg>`
    const r = sanitizeSvg(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.svg.toLowerCase()).not.toContain('animate')
    expect(r.svg.toLowerCase()).not.toContain('<set')
    expect(r.svg).not.toContain('alert')
    expect(r.svg).not.toContain('onbegin')
  })

  it('strips style elements (not allowlisted)', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>circle{fill:url("javascript:alert(1)")}</style>
      <circle r="1"/>
    </svg>`
    const r = sanitizeSvg(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.svg.toLowerCase()).not.toContain('<style')
    expect(r.svg).not.toContain('javascript')
  })

  it('sanitizes dangerous inline style', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg"><circle r="1" style="fill:red;background:url(javascript:alert(1))"/></svg>`
    const r = sanitizeSvg(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.svg).not.toContain('javascript')
  })

  it('rejects oversized char payload', () => {
    const pad = 'x'.repeat(100)
    const raw = `<svg xmlns="http://www.w3.org/2000/svg"><!-- ${pad} --></svg>`
    const r = sanitizeSvg(raw, { maxChars: 50 })
    expect(r).toEqual({ ok: false, reason: 'too_large' })
  })

  it('rejects too many nodes (nested bomb)', () => {
    // 2^n growth — keep n small so the string fits, but over maxNodes=20.
    let inner = '<circle r="1"/>'
    for (let i = 0; i < 6; i++) {
      inner = `<g>${inner}${inner}</g>`
    }
    const raw = `<svg xmlns="http://www.w3.org/2000/svg">${inner}</svg>`
    expect(raw.length).toBeLessThan(SANITIZE_SVG_DEFAULT_MAX_CHARS)
    const r = sanitizeSvg(raw, { maxNodes: 20 })
    expect(r).toEqual({ ok: false, reason: 'too_many_nodes' })
  })

  it('defaults caps are the documented limits', () => {
    expect(SANITIZE_SVG_DEFAULT_MAX_CHARS).toBe(100_000)
    expect(SANITIZE_SVG_DEFAULT_MAX_NODES).toBe(2_000)
  })

  it('rejects non-svg root / parse failure', () => {
    expect(sanitizeSvg('<html><body>hi</body></html>').ok).toBe(false)
    // broken xml
    const broken = sanitizeSvg('<svg><circle>')
    // happy-dom may auto-close; if it yields svg with circle that's ok
    if (!broken.ok) {
      expect(['parse', 'rejected']).toContain(broken.reason)
    }
  })

  it('strips CDATA-wrapped script when parent is script', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg"><script><![CDATA[alert(1)]]></script><rect width="1" height="1"/></svg>`
    const r = sanitizeSvg(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.svg).not.toContain('alert')
    expect(r.svg.toLowerCase()).not.toContain('script')
  })

  it('does not re-emit original event attrs after rebuild', () => {
    // Classic "strip then rejoin" bug would leave residual on* in the string.
    const raw = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><g onclick="x()"><path d="M0 0"/></g></svg>`
    const r = sanitizeSvg(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.svg).not.toMatch(/\son[a-z]+\s*=/i)
  })

  it('drops data:text/html href', () => {
    // Keep payload XML-valid (no raw < inside the attribute).
    const raw = `<svg xmlns="http://www.w3.org/2000/svg"><a href="data:text/html,%3Cscript%3Ealert(1)%3C/script%3E"><text>x</text></a></svg>`
    const r = sanitizeSvg(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.svg).not.toContain('data:text/html')
    expect(r.svg).not.toContain('alert')
  })

  it('drops control-char javascript: href on anchors (tab/NL)', () => {
    const tab = `<svg xmlns="http://www.w3.org/2000/svg"><a href="java\tscript:alert(1)"><text>x</text></a></svg>`
    const r1 = sanitizeSvg(tab)
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(r1.svg.toLowerCase()).not.toContain('javascript')
    expect(r1.svg).not.toContain('alert')
    expect(r1.svg).not.toMatch(/href\s*=/i)

    const nl = `<svg xmlns="http://www.w3.org/2000/svg"><a href="java\nscript:alert(1)"><text>x</text></a></svg>`
    const r2 = sanitizeSvg(nl)
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.svg.toLowerCase()).not.toContain('javascript')
    expect(r2.svg).not.toContain('alert')
  })

  it('drops backslash external image and anchor hrefs', () => {
    const img = `<svg xmlns="http://www.w3.org/2000/svg"><image href="\\\\evil.com/x.png" width="1" height="1"/></svg>`
    const r1 = sanitizeSvg(img)
    expect(r1.ok).toBe(true)
    if (!r1.ok) return
    expect(r1.svg).not.toContain('evil.com')
    expect(r1.svg).not.toMatch(/href\s*=/i)

    const anchor = `<svg xmlns="http://www.w3.org/2000/svg"><a href="/\\\\evil.com/x"><text>x</text></a></svg>`
    const r2 = sanitizeSvg(anchor)
    expect(r2.ok).toBe(true)
    if (!r2.ok) return
    expect(r2.svg).not.toContain('evil.com')
    // href attr dropped entirely
    expect(r2.svg).not.toMatch(/href\s*=/i)
  })

  it('hardens fill/stroke paint-server url(javascript:)', () => {
    const raw = `<svg xmlns="http://www.w3.org/2000/svg"><circle r="1" fill="url(javascript:alert(1))" stroke="url(https://evil/x)"/></svg>`
    const r = sanitizeSvg(raw)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.svg).not.toContain('javascript')
    expect(r.svg).not.toContain('evil')
    expect(r.svg).not.toContain('alert')
    // solid + fragment still ok
    const ok = sanitizeSvg(
      `<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><circle r="1" fill="url(#g)" stroke="red"/></svg>`,
    )
    expect(ok.ok).toBe(true)
    if (!ok.ok) return
    expect(ok.svg).toContain('url(#g)')
    expect(ok.svg).toContain('stroke="red"')
  })
})
