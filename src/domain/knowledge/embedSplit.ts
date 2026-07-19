/**
 * Split markdown into plain MD segments and embed tokens for Preview rendering.
 */

import { extractEmbedLinks } from './linkExtract'
import { splitTitleFragment } from './linkExtract'
import { parseFrontmatter } from './frontmatter'
import { extractDocOutline, slugifyHeading } from './mdPreview'

export type MdEmbedSegment =
  | { type: 'md'; text: string }
  | {
      type: 'embed'
      raw: string
      /** Target doc title (empty = invalid / same-doc not supported for embed). */
      docTitle: string
      fragment: string | null
      display: string | null
      start: number
      end: number
    }

/** Max embed body chars rendered (spec ~64KB). */
export const EMBED_BODY_CAP = 64 * 1024

/** Max nested embed depth (0 = top-level page; embeds render at depth 1 without further embeds). */
export const EMBED_MAX_DEPTH = 1

/**
 * Split body (or full md) into ordered segments. Embeds skipped inside fences/code
 * via extractEmbedLinks.
 */
export function splitByEmbeds(md: string): MdEmbedSegment[] {
  if (!md) return [{ type: 'md', text: '' }]
  const hits = extractEmbedLinks(md)
  if (hits.length === 0) return [{ type: 'md', text: md }]

  const out: MdEmbedSegment[] = []
  let cursor = 0
  for (const h of hits) {
    if (h.start > cursor) {
      out.push({ type: 'md', text: md.slice(cursor, h.start) })
    }
    const { docTitle, fragment } = splitTitleFragment(h.title)
    out.push({
      type: 'embed',
      raw: h.raw,
      docTitle,
      fragment,
      display: h.display,
      start: h.start,
      end: h.end,
    })
    cursor = h.end
  }
  if (cursor < md.length) {
    out.push({ type: 'md', text: md.slice(cursor) })
  }
  return out
}

/**
 * Extract body for embed: strip FM, optional heading section, cap length.
 * Heading match: exact → ci → slug (first win), same as outline/wiki anchors.
 */
export function bodyForEmbed(
  rawMd: string,
  fragment: string | null,
  cap = EMBED_BODY_CAP,
): { body: string; truncated: boolean } {
  const { bodyWithoutFm } = parseFrontmatter(typeof rawMd === 'string' ? rawMd : '')
  let body = bodyWithoutFm
  if (fragment && fragment.trim()) {
    body = extractSectionByHeading(body, fragment.trim())
  }
  if (body.length <= cap) return { body, truncated: false }
  return { body: body.slice(0, cap), truncated: true }
}

/**
 * From ATX heading matching `fragment` through the line before the next heading
 * of same or higher level. If no match, returns full body.
 */
export function extractSectionByHeading(md: string, fragment: string): string {
  const outline = extractDocOutline(md)
  if (outline.length === 0) return md

  const slug = slugifyHeading(fragment)
  const hit =
    outline.find((o) => o.text === fragment) ||
    outline.find((o) => o.text.toLowerCase() === fragment.toLowerCase()) ||
    outline.find((o) => o.id === slug || slugifyHeading(o.text) === slug)

  if (!hit) return md

  const lines = md.split('\n')
  const startIdx = hit.line - 1 // 0-based
  if (startIdx < 0 || startIdx >= lines.length) return md

  let endIdx = lines.length
  for (const o of outline) {
    if (o.line <= hit.line) continue
    if (o.level <= hit.level) {
      endIdx = o.line - 1
      break
    }
  }
  return lines.slice(startIdx, endIdx).join('\n')
}
