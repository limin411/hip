import type { KnowledgeNode } from './types'
import { buildChildrenMap } from './tree'
import { fuzzyMatch } from '@/components/command-palette/fuzzyScore'

/**
 * Relative href prefix used when rewriting `[[title]]` for MarkdownBody preview.
 * Must stay a relative URL — react-markdown's default urlTransform strips unknown schemes.
 */
export const WIKI_LINK_HREF_PREFIX = './__wiki__/'

export type WikiLinkHit = {
  /** Full match including brackets, e.g. `[[Title|Disp]]` */
  raw: string
  /** Target title (left of pipe, trimmed). */
  title: string
  /** Optional display text (right of pipe); null when absent or empty. */
  display: string | null
  /** Inclusive start index in source string. */
  start: number
  /** Exclusive end index. */
  end: number
}

export type WikiCandidate = {
  node: KnowledgeNode
  score: number
}

/**
 * Parse the inner body of `[[...]]` into title + optional pipe display.
 * Pipe only (no aliases / namespaces in Phase 1 title-only resolution).
 */
export function parseWikiLinkInner(inner: string): {
  title: string
  display: string | null
} {
  const pipe = inner.indexOf('|')
  if (pipe < 0) {
    return { title: inner.trim(), display: null }
  }
  const title = inner.slice(0, pipe).trim()
  const displayRaw = inner.slice(pipe + 1).trim()
  return { title, display: displayRaw.length > 0 ? displayRaw : null }
}

/** Build href for preview rewrite (`./__wiki__/` + URI-encoded title). */
export function wikiHrefForTitle(title: string): string {
  return `${WIKI_LINK_HREF_PREFIX}${encodeURIComponent(title)}`
}

/** Extract title from a rewritten wiki href, or null if not a wiki link. */
export function titleFromWikiHref(href: string | null | undefined): string | null {
  if (!href) return null
  // react-markdown may leave relative as-is or resolve; accept common forms.
  const prefixes = [
    WIKI_LINK_HREF_PREFIX,
    '__wiki__/',
    '/__wiki__/',
  ]
  let enc: string | null = null
  for (const p of prefixes) {
    const i = href.indexOf(p)
    if (i >= 0) {
      enc = href.slice(i + p.length)
      break
    }
  }
  if (enc == null) return null
  // Drop trailing query/hash if any.
  const clean = enc.split(/[?#]/)[0] ?? enc
  try {
    return decodeURIComponent(clean)
  } catch {
    return clean
  }
}

/**
 * Docs of the current space in stable tree order (DFS, children sorted by
 * order → title → id). Duplicate titles: first in this list wins (K23).
 */
export function listDocsInTreeOrder(nodes: KnowledgeNode[]): KnowledgeNode[] {
  const map = buildChildrenMap(nodes)
  // Stabilize siblings with same order+title by id (compareNodes omits id).
  for (const list of map.values()) {
    list.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order
      const t = a.title.localeCompare(b.title)
      if (t !== 0) return t
      return a.id.localeCompare(b.id)
    })
  }
  const out: KnowledgeNode[] = []
  const walk = (parentId: string | null) => {
    for (const n of map.get(parentId) ?? []) {
      if (n.kind === 'doc') out.push(n)
      else walk(n.id)
    }
  }
  walk(null)
  return out
}

/**
 * Same-space title resolution (PR-12: title only — no frontmatter aliases).
 * 1) Exact title match among docs in tree order
 * 2) Case-insensitive match
 * First hit wins. Empty title → null (broken).
 */
export function resolveWikiTitle(
  title: string,
  docs: KnowledgeNode[],
): KnowledgeNode | null {
  const t = title.trim()
  if (!t) return null
  const exact = docs.find((d) => d.title === t)
  if (exact) return exact
  const lower = t.toLowerCase()
  return docs.find((d) => d.title.toLowerCase() === lower) ?? null
}

/**
 * Fuzzy rank doc titles for the `[[` picker (not used for click navigation).
 * Empty query returns tree-order docs with score 0 (browse mode).
 */
export function rankWikiCandidates(
  query: string,
  docs: KnowledgeNode[],
  limit = 12,
): WikiCandidate[] {
  const q = query.trim()
  if (!q) {
    return docs.slice(0, limit).map((node) => ({ node, score: 0 }))
  }
  const ranked: WikiCandidate[] = []
  for (const node of docs) {
    const title = node.title
    // Prefer prefix / includes, then palette fuzzy subsequence.
    const lower = title.toLowerCase()
    const ql = q.toLowerCase()
    let score = 0
    if (lower === ql) score = 1
    else if (lower.startsWith(ql)) score = 0.9
    else if (lower.includes(ql)) score = 0.75
    else {
      const fuzzy = fuzzyMatch(title, q)
      if (fuzzy.score <= 0) continue
      score = fuzzy.score
    }
    ranked.push({ node, score })
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    // Stable: preserve tree order among equal scores.
    return docs.indexOf(a.node) - docs.indexOf(b.node)
  })
  return ranked.slice(0, limit)
}

/** Ranges of fenced code blocks (``` or ~~~) to skip during extract/rewrite. */
function fencedRanges(md: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = []
  const re = /^(?:```|~~~)[^\n]*\n[\s\S]*?^(?:```|~~~)[ \t]*$/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(md)) !== null) {
    ranges.push({ start: m.index, end: m.index + m[0].length })
  }
  return ranges
}

/** Ranges of inline `code` spans (simple, non-nested). */
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
 * Extract `[[title]]` / `[[title|display]]` hits from markdown.
 * Skips fenced code blocks and inline code. Does not rewrite sources.
 */
export function extractWikiLinks(md: string): WikiLinkHit[] {
  if (!md) return []
  const skip = [...fencedRanges(md), ...inlineCodeRanges(md)]
  const hits: WikiLinkHit[] = []
  // Non-greedy; no nested brackets. Empty [[]] still captured then filtered by title.
  const re = /\[\[([^\]]*)\]\]/g
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
 * Rewrite wiki links to standard markdown links for react-markdown preview.
 * `[[Title]]` → `[Title](./__wiki__/Title)`
 * `[[Title|Disp]]` → `[Disp](./__wiki__/Title)`
 * Leaves code fences / inline code untouched. Empty titles become broken hrefs still.
 */
export function rewriteWikiLinksForPreview(md: string): string {
  const hits = extractWikiLinks(md)
  if (hits.length === 0) return md
  // Replace from end so indices stay valid.
  let out = md
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i]!
    const label = h.display ?? h.title
    // Escape label brackets so nested MD links stay well-formed.
    const safeLabel = label.replace(/[[\]]/g, '')
    const href = wikiHrefForTitle(h.title)
    const replacement = `[${safeLabel || h.title || '?'}](${href})`
    out = out.slice(0, h.start) + replacement + out.slice(h.end)
  }
  return out
}

/**
 * Detect open wiki-link query at `cursor` for picker/completion.
 * Returns query text after `[[` and absolute from/to range to replace, or null.
 * Closed `]]` or missing `[[` → null.
 */
export function wikiLinkQueryAt(
  text: string,
  cursor: number,
): { query: string; from: number; to: number } | null {
  if (cursor < 0 || cursor > text.length) return null
  const before = text.slice(0, cursor)
  // Find last `[[` not closed by `]]` before cursor.
  const open = before.lastIndexOf('[[')
  if (open < 0) return null
  const afterOpen = before.slice(open + 2)
  if (afterOpen.includes(']]')) return null
  // Abort if newline inside unclosed wiki (one-line only).
  if (afterOpen.includes('\n')) return null
  // Don't trigger inside inline code: if odd number of unescaped backticks on line…
  const lineStart = before.lastIndexOf('\n') + 1
  const linePrefix = before.slice(lineStart)
  // crude: if `[[` is after an unclosed ` on the line, skip
  const ticks = (linePrefix.match(/`/g) ?? []).length
  if (ticks % 2 === 1) return null

  // Replace from after `[[` through cursor (keep the opening brackets).
  return {
    query: afterOpen,
    from: open + 2,
    to: cursor,
  }
}

/** Format a wiki link token. */
export function formatWikiLink(title: string, display?: string | null): string {
  const t = title.trim()
  if (display != null && display.trim().length > 0 && display.trim() !== t) {
    return `[[${t}|${display.trim()}]]`
  }
  return `[[${t}]]`
}
