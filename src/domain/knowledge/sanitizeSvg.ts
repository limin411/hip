/**
 * Rebuild-style SVG sanitizer for knowledge ```svg fences.
 *
 * Algorithm: DOMParser → walk → recreate only allowlisted elements/attrs →
 * serialize. Never strip-and-rejoin the original string (XSS residual risk).
 *
 * Caps: maxChars (~100k default), maxNodes (~2k default) for DoS.
 */

export type SanitizeSvgResult =
  | { ok: true; svg: string }
  | {
      ok: false
      reason: 'parse' | 'empty' | 'too_large' | 'too_many_nodes' | 'rejected'
    }

export type SanitizeSvgOptions = {
  maxChars?: number
  maxNodes?: number
}

export const SANITIZE_SVG_DEFAULT_MAX_CHARS = 100_000
export const SANITIZE_SVG_DEFAULT_MAX_NODES = 2_000

const SVG_NS = 'http://www.w3.org/2000/svg'
const XLINK_NS = 'http://www.w3.org/1999/xlink'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'

/** Elements safe to keep (lowercase local names). */
const ALLOWED_ELEMENTS: ReadonlySet<string> = new Set([
  'svg',
  'g',
  'defs',
  'symbol',
  'use',
  'marker',
  'clippath',
  'mask',
  'pattern',
  'switch',
  'path',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'text',
  'tspan',
  'textpath',
  'title',
  'desc',
  'lineargradient',
  'radialgradient',
  'stop',
  'image',
  'a',
  'view',
  // filters (presentation only; no script)
  'filter',
  'feblend',
  'fecolormatrix',
  'fecomponenttransfer',
  'fecomposite',
  'feconvolvematrix',
  'fediffuselighting',
  'fedisplacementmap',
  'fedistantlight',
  'fedropshadow',
  'feflood',
  'fefunca',
  'fefuncb',
  'fefuncg',
  'fefuncr',
  'fegaussianblur',
  'feimage',
  'femerge',
  'femergenode',
  'femorphology',
  'feoffset',
  'fepointlight',
  'fespecularlighting',
  'fespotlight',
  'fetile',
  'feturbulence',
])

/**
 * Attribute local names allowed on any element (lowercase).
 * Event handlers (`on*`) are never allowed — filtered before this set.
 */
const ALLOWED_ATTRS: ReadonlySet<string> = new Set([
  'id',
  'class',
  'className',
  'transform',
  'fill',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-opacity',
  'fill-opacity',
  'fill-rule',
  'opacity',
  'd',
  'points',
  'x',
  'y',
  'x1',
  'y1',
  'x2',
  'y2',
  'cx',
  'cy',
  'r',
  'rx',
  'ry',
  'width',
  'height',
  'viewbox',
  'preserveaspectratio',
  'xmlns',
  'version',
  'clip-rule',
  'clip-path',
  'clippath',
  'mask',
  'filter',
  'marker-start',
  'marker-mid',
  'marker-end',
  'markerwidth',
  'markerheight',
  'markerunits',
  'refx',
  'refy',
  'orient',
  'font-size',
  'font-family',
  'font-weight',
  'font-style',
  'text-anchor',
  'dominant-baseline',
  'alignment-baseline',
  'dx',
  'dy',
  'rotate',
  'textlength',
  'lengthadjust',
  'gradientunits',
  'gradienttransform',
  'spreadmethod',
  'offset',
  'stop-color',
  'stop-opacity',
  'patternunits',
  'patterncontentunits',
  'patterntransform',
  'overflow',
  'display',
  'visibility',
  'pointer-events',
  'role',
  'focusable',
  'tabindex',
  'xmlns:xlink',
  'xml:space',
  'xml:lang',
  'color',
  'vector-effect',
  'shape-rendering',
  'text-rendering',
  'image-rendering',
  'paint-order',
  'letter-spacing',
  'word-spacing',
  'writing-mode',
  'direction',
  'baseline-shift',
  'startoffset',
  'method',
  'spacing',
  'href',
  'xlink:href',
  'target',
  'type',
  'result',
  'in',
  'in2',
  'mode',
  'operator',
  'k1',
  'k2',
  'k3',
  'k4',
  'order',
  'kernelmatrix',
  'divisor',
  'bias',
  'targetx',
  'targety',
  'edgemode',
  'kernelunitlength',
  'preservealpha',
  'surfaceScale',
  'surfacescale',
  'diffuseconstant',
  'specularconstant',
  'specularexponent',
  'limitingconeangle',
  'pointsatx',
  'pointsaty',
  'pointsatz',
  'azimuth',
  'elevation',
  'stddeviation',
  'basefrequency',
  'numoctaves',
  'seed',
  'stitchtiles',
  'type',
  'values',
  'tablevalues',
  'slope',
  'intercept',
  'amplitude',
  'exponent',
  'scale',
  'xchannelselector',
  'ychannelselector',
  'stdDeviation',
  'flood-color',
  'flood-opacity',
  'lighting-color',
  'primitiveunits',
  'filterunits',
  'filterres',
  'fx',
  'fy',
  'fr',
  'pathlength',
  'attributename',
  'attributetype',
  // style is allowlisted only after CSS URL sanitization below
  'style',
])

/** href-bearing tags that need special URL policy. */
type HrefKind = 'use' | 'image' | 'a' | 'other'

function hrefKindFor(tag: string): HrefKind {
  if (tag === 'use') return 'use'
  if (tag === 'image' || tag === 'feimage') return 'image'
  if (tag === 'a') return 'a'
  return 'other'
}

/**
 * Safe URL policy for href / xlink:href:
 * - use: only #fragment (no external resource load)
 * - image: #fragment, data:image/*, or relative path (no scheme / //)
 * - a / other: #fragment or relative (strip absolute / javascript: / data:text/html)
 */
export function isSafeSvgHref(value: string, kind: HrefKind): boolean {
  const v = value.trim()
  if (!v) return false
  const lower = v.toLowerCase()
  if (lower.startsWith('javascript:') || lower.startsWith('vbscript:')) {
    return false
  }
  if (lower.startsWith('data:text/html') || lower.startsWith('data:text/javascript')) {
    return false
  }
  if (kind === 'use') {
    return v.startsWith('#')
  }
  if (kind === 'image') {
    if (v.startsWith('#')) return true
    if (lower.startsWith('data:image/')) return true
    if (v.startsWith('//')) return false
    if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return false
    return true
  }
  // a / other
  if (v.startsWith('#')) return true
  if (v.startsWith('//')) return false
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return false
  return true
}

/** Strip dangerous url() / expression from inline style. */
function sanitizeStyleValue(value: string): string | null {
  const lower = value.toLowerCase()
  if (
    lower.includes('javascript:') ||
    lower.includes('vbscript:') ||
    lower.includes('expression(') ||
    lower.includes('-moz-binding') ||
    lower.includes('behavior:')
  ) {
    return null
  }
  // Drop url(...) that is not a fragment or data:image
  const cleaned = value.replace(/url\s*\(\s*([^)]*)\s*\)/gi, (full, inner: string) => {
    const raw = inner.trim().replace(/^['"]|['"]$/g, '')
    const l = raw.toLowerCase()
    if (raw.startsWith('#')) return full
    if (l.startsWith('data:image/')) return full
    // relative without scheme
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && !raw.startsWith('//')) {
      return full
    }
    return 'url()'
  })
  return cleaned
}

function attrLocalName(attr: Attr): string {
  const n = attr.localName || attr.name
  return n.toLowerCase()
}

function isEventAttr(name: string): boolean {
  return name.startsWith('on')
}

function findSvgRoot(doc: Document): Element | null {
  const de = doc.documentElement
  if (de && de.localName.toLowerCase() === 'svg') return de
  const nested = doc.getElementsByTagName('svg')[0]
  return nested ?? null
}

function hasFatalParseError(doc: Document): boolean {
  const de = doc.documentElement
  if (!de) return true
  // Root-level parse failure (no recoverable svg).
  if (de.localName.toLowerCase() === 'parsererror') return true
  // Some parsers wrap errors in html/body.
  if (
    de.localName.toLowerCase() === 'html' &&
    doc.getElementsByTagName('svg').length === 0
  ) {
    return true
  }
  return false
}

/**
 * Expand CDATA into escaped text so script bodies stay inspectable and
 * parsers that mishandle CDATA (e.g. some happy-dom paths) still yield a tree.
 */
function expandCdata(raw: string): string {
  return raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, (_m, body: string) =>
    body
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;'),
  )
}

type WalkState = {
  nodeCount: number
  maxNodes: number
  outDoc: Document
}

function rebuildElement(src: Element, state: WalkState): Element | null {
  state.nodeCount += 1
  if (state.nodeCount > state.maxNodes) {
    const err = new Error('too_many_nodes')
    ;(err as Error & { code?: string }).code = 'too_many_nodes'
    throw err
  }

  const tag = src.localName.toLowerCase()
  if (!ALLOWED_ELEMENTS.has(tag)) {
    // Drop disallowed element and its entire subtree (script, foreignObject, animate, style, …).
    return null
  }

  const out = state.outDoc.createElementNS(SVG_NS, src.localName)
  const kind = hrefKindFor(tag)

  for (const attr of Array.from(src.attributes)) {
    const local = attrLocalName(attr)
    const rawName = attr.name
    const value = attr.value

    if (isEventAttr(local) || isEventAttr(rawName.toLowerCase())) {
      continue
    }

    // href / xlink:href
    const isHref =
      local === 'href' ||
      rawName.toLowerCase() === 'xlink:href' ||
      (attr.namespaceURI === XLINK_NS && local === 'href')
    if (isHref) {
      if (!isSafeSvgHref(value, kind)) continue
      if (attr.namespaceURI === XLINK_NS || rawName.toLowerCase().startsWith('xlink:')) {
        out.setAttributeNS(XLINK_NS, 'xlink:href', value.trim())
      } else {
        out.setAttribute('href', value.trim())
      }
      continue
    }

    if (local === 'style') {
      const safe = sanitizeStyleValue(value)
      if (safe != null && safe.trim()) out.setAttribute('style', safe)
      continue
    }

    // aria-* and data-* (non-event) for a11y; data-* cannot run script by itself
    if (local.startsWith('aria-') || local.startsWith('data-')) {
      out.setAttribute(rawName, value)
      continue
    }

    if (!ALLOWED_ATTRS.has(local) && !ALLOWED_ATTRS.has(rawName.toLowerCase())) {
      continue
    }

    // xmlns
    if (local === 'xmlns' || rawName === 'xmlns') {
      out.setAttribute('xmlns', value)
      continue
    }
    if (rawName.toLowerCase() === 'xmlns:xlink') {
      out.setAttributeNS(
        'http://www.w3.org/2000/xmlns/',
        'xmlns:xlink',
        value,
      )
      continue
    }
    if (attr.namespaceURI === XML_NS) {
      out.setAttributeNS(XML_NS, rawName, value)
      continue
    }

    // Prefer un-namespaced for normal presentation attrs
    try {
      out.setAttribute(local === 'viewbox' ? 'viewBox' : attr.name, value)
    } catch {
      // ignore invalid names
    }
  }

  for (const child of Array.from(src.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) {
      const text = child.textContent ?? ''
      if (text) out.appendChild(state.outDoc.createTextNode(text))
      continue
    }
    if (child.nodeType === Node.ELEMENT_NODE) {
      const rebuilt = rebuildElement(child as Element, state)
      if (rebuilt) out.appendChild(rebuilt)
    }
    // comments / PIs dropped
  }

  return out
}

/**
 * Sanitize untrusted SVG source for safe `dangerouslySetInnerHTML` rendering.
 * Pure domain function (uses DOMParser / XMLSerializer available in browser + happy-dom).
 */
export function sanitizeSvg(
  raw: string,
  opts?: SanitizeSvgOptions,
): SanitizeSvgResult {
  const maxChars = opts?.maxChars ?? SANITIZE_SVG_DEFAULT_MAX_CHARS
  const maxNodes = opts?.maxNodes ?? SANITIZE_SVG_DEFAULT_MAX_NODES

  if (raw == null || raw.trim() === '') {
    return { ok: false, reason: 'empty' }
  }
  if (raw.length > maxChars) {
    return { ok: false, reason: 'too_large' }
  }

  if (typeof DOMParser === 'undefined') {
    return { ok: false, reason: 'parse' }
  }

  const prepared = expandCdata(raw)

  let doc: Document
  try {
    const parser = new DOMParser()
    // Prefer image/svg+xml; fall back to application/xml if needed.
    doc = parser.parseFromString(prepared, 'image/svg+xml')
    if (hasFatalParseError(doc) || !findSvgRoot(doc)) {
      doc = parser.parseFromString(prepared, 'application/xml')
    }
  } catch {
    return { ok: false, reason: 'parse' }
  }

  if (hasFatalParseError(doc)) {
    return { ok: false, reason: 'parse' }
  }

  const root = findSvgRoot(doc)
  if (!root) {
    return { ok: false, reason: 'parse' }
  }

  // Count root toward the budget up front via rebuild.
  const outDoc = document.implementation.createDocument(SVG_NS, null, null)
  const state: WalkState = { nodeCount: 0, maxNodes, outDoc }

  let rebuilt: Element | null
  try {
    rebuilt = rebuildElement(root, state)
  } catch (e) {
    if (
      e instanceof Error &&
      ((e as Error & { code?: string }).code === 'too_many_nodes' ||
        e.message === 'too_many_nodes')
    ) {
      return { ok: false, reason: 'too_many_nodes' }
    }
    return { ok: false, reason: 'rejected' }
  }

  if (!rebuilt || rebuilt.localName.toLowerCase() !== 'svg') {
    return { ok: false, reason: 'rejected' }
  }

  // Ensure xmlns for standalone serialization.
  if (!rebuilt.hasAttribute('xmlns')) {
    rebuilt.setAttribute('xmlns', SVG_NS)
  }

  try {
    const serializer = new XMLSerializer()
    const svg = serializer.serializeToString(rebuilt)
    if (!svg.trim()) {
      return { ok: false, reason: 'empty' }
    }
    // Final size guard after rebuild (attrs may expand slightly; rare).
    if (svg.length > maxChars) {
      return { ok: false, reason: 'too_large' }
    }
    return { ok: true, svg }
  } catch {
    return { ok: false, reason: 'rejected' }
  }
}
