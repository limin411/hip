/**
 * Outbound link extraction for knowledge link index (P0).
 * Pure — skips fenced code and inline code (same rules as wikiLink).
 */

import { parseFrontmatter } from './frontmatter'
import { extractWikiLinks, parseWikiLinkInner, type WikiLinkHit } from './wikiLink'

export type OutboundLinkKind = 'wiki' | 'embed' | 'md'

export type ExtractedOutbound = {
  kind: OutboundLinkKind
  /** Full authored token, e.g. `[[A#H|x]]` or `[lab](url)` */
  raw: string
  /** Wiki/embed target title (empty string for same-doc `[[#H]]`). Null for md. */
  targetTitle: string | null
  fragment: string | null
  display: string | null
  start: number
  end: number
}

/** Ranges of fenced code blocks (``` or ~~~). */
function fencedRanges(md: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const re = /^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(md)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length })
  }
  return ranges
}

function inlineCodeRanges(md: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const re = /`+[^`\n]+`+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(md)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length })
  }
  return ranges
}

function inAnyRange(
  index: number,
  ranges: Array<{ start: number; end: number }>,
): boolean {
  return ranges.some((r) => index >= r.start && index < r.end)
}

/**
 * Split `Title#Heading` / `#Heading` / `Title`.
 * Empty docTitle means same-document fragment (`[[#H]]`).
 */
export function splitTitleFragment(rawTitle: string): {
  docTitle: string
  fragment: string | null
} {
  const t = rawTitle.trim()
  if (!t) return { docTitle: '', fragment: null }
  if (t.startsWith('#')) {
    const frag = t.slice(1).trim()
    return { docTitle: '', fragment: frag.length > 0 ? frag : null }
  }
  const hash = t.indexOf('#')
  if (hash < 0) return { docTitle: t, fragment: null }
  const docTitle = t.slice(0, hash).trim()
  const frag = t.slice(hash + 1).trim()
  return {
    docTitle,
    fragment: frag.length > 0 ? frag : null,
  }
}

/**
 * Extract `![[...]]` embeds. Positions refer to full `![[...]]` span.
 */
export function extractEmbedLinks(md: string): WikiLinkHit[] {
  if (!md) return []
  const skip = [...fencedRanges(md), ...inlineCodeRanges(md)]
  const hits: WikiLinkHit[] = []
  const re = /!\[\[([^\]]*)\]\]/g
  let m: RegExpExecArray | null
  while ((m = re.exec(md)) !== null) {
    if (inAnyRange(m.index, skip)) continue
    const raw = m[0]
    const { title, display } = parseWikiLinkInner(m[1] ?? '')
    hits.push({
      raw,
      title,
      display,
      start: m.index,
      end: m.index + raw.length,
    })
  }
  return hits
}

/**
 * Markdown links `[label](dest)` — skips images and internal `__wiki__` hrefs.
 */
export function extractMdLinks(md: string): ExtractedOutbound[] {
  if (!md) return []
  const skip = [...fencedRanges(md), ...inlineCodeRanges(md)]
  const out: ExtractedOutbound[] = []
  const re = /(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(md)) !== null) {
    if (m[1] === '!') continue // image
    if (inAnyRange(m.index, skip)) continue
    const dest = (m[3] ?? '').trim()
    if (!dest) continue
    if (dest.includes('__wiki__')) continue
    const hash = dest.indexOf('#')
    out.push({
      kind: 'md',
      raw: m[0],
      targetTitle: null,
      fragment: hash >= 0 ? dest.slice(hash + 1) || null : null,
      display: (m[2] ?? '').trim() || null,
      start: m.index,
      end: m.index + m[0].length,
    })
  }
  return out
}

/**
 * All outbound links from a document (frontmatter stripped).
 */
export function extractOutboundLinks(rawMd: string): ExtractedOutbound[] {
  const { bodyWithoutFm } = parseFrontmatter(rawMd)
  const body = bodyWithoutFm
  const out: ExtractedOutbound[] = []

  const embeds = extractEmbedLinks(body)
  for (const h of embeds) {
    const { docTitle, fragment } = splitTitleFragment(h.title)
    out.push({
      kind: 'embed',
      raw: h.raw,
      targetTitle: docTitle,
      fragment,
      display: h.display,
      start: h.start,
      end: h.end,
    })
  }

  for (const h of extractWikiLinks(body)) {
    // Skip `[[...]]` that is part of `![[...]]`
    if (h.start > 0 && body[h.start - 1] === '!') continue
    const { docTitle, fragment } = splitTitleFragment(h.title)
    out.push({
      kind: 'wiki',
      raw: h.raw,
      targetTitle: docTitle,
      fragment,
      display: h.display,
      start: h.start,
      end: h.end,
    })
  }

  out.push(...extractMdLinks(body))
  out.sort((a, b) => a.start - b.start)
  return out
}
