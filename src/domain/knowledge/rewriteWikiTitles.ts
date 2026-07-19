/**
 * Bulk rewrite wiki/embed titles after a document rename (opt-in tool).
 */

import { extractEmbedLinks } from './linkExtract'
import { extractWikiLinks, formatWikiLink, splitWikiTitleFragment } from './wikiLink'

export type WikiRewriteHit = {
  start: number
  end: number
  raw: string
  replacement: string
}

function titlesMatch(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/**
 * Replace wiki/embed targets that resolve to oldTitle with newTitle.
 * Preserves `#fragment` and `|display` when display was different from title.
 * Skips fenced/inline code via extract helpers.
 */
export function planWikiTitleRewrites(
  md: string,
  oldTitle: string,
  newTitle: string,
): WikiRewriteHit[] {
  const oldT = oldTitle.trim()
  const newT = newTitle.trim()
  if (!oldT || !newT || titlesMatch(oldT, newT)) return []

  const hits: WikiRewriteHit[] = []

  for (const h of extractEmbedLinks(md)) {
    const { docTitle, fragment } = splitWikiTitleFragment(h.title)
    if (!titlesMatch(docTitle, oldT)) continue
    const inner =
      fragment != null
        ? `${newT}#${fragment}${h.display != null ? `|${h.display}` : ''}`
        : h.display != null && h.display !== docTitle
          ? `${newT}|${h.display}`
          : newT
    hits.push({
      start: h.start,
      end: h.end,
      raw: h.raw,
      replacement: `![[${inner}]]`,
    })
  }

  for (const h of extractWikiLinks(md)) {
    if (h.start > 0 && md[h.start - 1] === '!') continue
    const { docTitle, fragment } = splitWikiTitleFragment(h.title)
    if (!titlesMatch(docTitle, oldT)) continue
    let replacement: string
    if (fragment != null) {
      const titlePart = `${newT}#${fragment}`
      replacement =
        h.display != null
          ? formatWikiLink(titlePart, h.display)
          : formatWikiLink(titlePart)
    } else {
      replacement = formatWikiLink(newT, h.display)
    }
    hits.push({
      start: h.start,
      end: h.end,
      raw: h.raw,
      replacement,
    })
  }

  hits.sort((a, b) => a.start - b.start)
  return hits
}

export function applyWikiRewrites(md: string, hits: WikiRewriteHit[]): string {
  if (hits.length === 0) return md
  let out = md
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]!
    out = out.slice(0, h.start) + h.replacement + out.slice(h.end)
  }
  return out
}
