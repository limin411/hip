/**
 * Opaque YAML frontmatter strip/join for Live editor (and later search indexing).
 *
 * Milkdown treats `---` as thematic breaks and corrupts YAML — never feed the
 * fenced block into Live. Split before edit, re-prefix on serialize.
 *
 * Does not parse YAML values; only matches a leading `---` … `---` fence.
 */

export type FrontmatterSplit = {
  /** Full fence including opening/closing `---`, or '' when absent. */
  fmText: string
  /** Remainder after the closing fence line (may start with a blank line). */
  body: string
}

/**
 * Split leading YAML frontmatter fences from a document.
 * CRLF is normalized when a fence is present; documents without FM are returned unchanged.
 */
export function splitYamlFrontmatter(raw: string): FrontmatterSplit {
  const s = raw.replace(/\r\n/g, '\n')
  if (!s.startsWith('---\n')) return { fmText: '', body: raw }

  const rest = s.slice(4) // after opening `---\n`
  const close = rest.match(/\n---(?:\n|$)/)
  if (!close || close.index === undefined) return { fmText: '', body: raw }

  const yaml = rest.slice(0, close.index)
  const after = rest.slice(close.index + close[0].length)
  const fmText = `---\n${yaml}\n---`
  return { fmText, body: after }
}

/** Re-prefix opaque FM text onto a body serialized from Live (or any body string). */
export function joinYamlFrontmatter(fmText: string, body: string): string {
  if (!fmText) return body
  return `${fmText}\n${body}`
}

/**
 * Knowledge-doc YAML frontmatter: tags / status / aliases only.
 * Hand-rolled (no gray-matter) — enough for flat scalars + string lists.
 *
 * Frontmatter is accepted only when the opening `---`…`---` block contains at
 * least one known key (`tags` / `status` / `aliases`). Bare thematic breaks
 * (`---` as Markdown hr) are left in the body and stay searchable.
 */

export type KnowledgeDocMeta = {
  tags: string[]
  status: string | null
  aliases: string[]
}

export type ParsedFrontmatter = {
  meta: KnowledgeDocMeta
  /** Markdown after the closing `---` fence (leading blank line stripped once). */
  bodyWithoutFm: string
  hasFrontmatter: boolean
}

export const EMPTY_DOC_META: KnowledgeDocMeta = {
  tags: [],
  status: null,
  aliases: [],
}

const FM_KEYS = new Set(['tags', 'status', 'aliases'])

/** Strip a leading `--- … ---` block and parse known property keys. */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const normalized = raw.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')
  if (lines[0] !== '---') {
    return { meta: { ...EMPTY_DOC_META }, bodyWithoutFm: raw, hasFrontmatter: false }
  }

  let end = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === '---') {
      end = i
      break
    }
  }
  if (end < 0) {
    return { meta: { ...EMPTY_DOC_META }, bodyWithoutFm: raw, hasFrontmatter: false }
  }

  const yamlLines = lines.slice(1, end)
  const { meta, foundKnownKey } = parseMetaLines(yamlLines)

  // Reject false positives: thematic breaks / unknown-only blocks keep full body.
  if (!foundKnownKey) {
    return { meta: { ...EMPTY_DOC_META }, bodyWithoutFm: raw, hasFrontmatter: false }
  }

  let bodyWithoutFm = lines.slice(end + 1).join('\n')
  // Drop a single leading blank line after the fence (common authoring style).
  if (bodyWithoutFm.startsWith('\n')) bodyWithoutFm = bodyWithoutFm.slice(1)

  return { meta, bodyWithoutFm, hasFrontmatter: true }
}

/**
 * String fields for MiniSearch indexing (space-joined; empty → '').
 * Callers index these separately from `bodyWithoutFm`.
 */
export function metaToSearchFields(meta: KnowledgeDocMeta): {
  tags: string
  status: string
  aliases: string
} {
  return {
    tags: meta.tags.join(' '),
    status: meta.status ?? '',
    aliases: meta.aliases.join(' '),
  }
}

/**
 * Wiki resolution hook (P1.3 step 2 / PR-14): match by title then aliases.
 * Caller supplies docs in stable tree order; **first** match wins.
 *
 * 1. Exact title (case-sensitive)
 * 2. Case-insensitive title
 * 3. Case-insensitive alias
 */
export function matchDocByTitleOrAlias(
  target: string,
  docs: ReadonlyArray<{ id: string; title: string; aliases?: readonly string[] }>,
): { id: string; match: 'title' | 'title-ci' | 'alias' } | null {
  const q = target.trim()
  if (!q) return null

  for (const d of docs) {
    if (d.title === q) return { id: d.id, match: 'title' }
  }
  const qLower = q.toLowerCase()
  for (const d of docs) {
    if (d.title.toLowerCase() === qLower) return { id: d.id, match: 'title-ci' }
  }
  for (const d of docs) {
    const aliases = d.aliases ?? []
    for (const a of aliases) {
      if (a.toLowerCase() === qLower) return { id: d.id, match: 'alias' }
    }
  }
  return null
}

/**
 * Stable wiki sort: `order` asc, then `title`, then `id`.
 * Used by `listKnowledgeDocsForWiki` and available to PR-12 callers.
 */
export function compareWikiDocs(
  a: { id: string; title: string; order?: number },
  b: { id: string; title: string; order?: number },
): number {
  const orderA = a.order ?? Number.MAX_SAFE_INTEGER
  const orderB = b.order ?? Number.MAX_SAFE_INTEGER
  if (orderA !== orderB) return orderA - orderB
  const titleCmp = a.title.localeCompare(b.title)
  if (titleCmp !== 0) return titleCmp
  return a.id.localeCompare(b.id)
}

// ─── internal line parser ───────────────────────────────────────────────────

function normalizeFmKey(raw: string): 'tags' | 'status' | 'aliases' | null {
  const k = raw.toLowerCase()
  if (FM_KEYS.has(k)) return k as 'tags' | 'status' | 'aliases'
  return null
}

function parseMetaLines(lines: string[]): {
  meta: KnowledgeDocMeta
  foundKnownKey: boolean
} {
  const meta: KnowledgeDocMeta = { tags: [], status: null, aliases: [] }
  let foundKnownKey = false
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      i += 1
      continue
    }

    // Block list: `key:` then indented `- item` lines
    const blockKey = trimmed.match(/^([A-Za-z_][\w-]*)\s*:\s*$/)
    if (blockKey) {
      const key = normalizeFmKey(blockKey[1])
      if (key) {
        foundKnownKey = true
        const items: string[] = []
        i += 1
        while (i < lines.length) {
          const next = lines[i]
          // Optional space after `-`; bare `-` is empty item and does not break the list.
          const m = next.match(/^\s+-\s*(.*)$/)
          if (!m) break
          const v = unquote(m[1].trim())
          if (v) items.push(v)
          i += 1
        }
        assignListKey(meta, key, items)
        continue
      }
    }

    // Inline: `key: value`
    const inline = trimmed.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (inline) {
      const key = normalizeFmKey(inline[1])
      if (key) {
        foundKnownKey = true
        const rawVal = inline[2].trim()
        if (key === 'status') {
          meta.status = unquote(rawVal) || null
        } else {
          assignListKey(meta, key, parseInlineList(rawVal))
        }
        i += 1
        continue
      }
    }

    i += 1
  }

  meta.tags = uniquePreserve(meta.tags)
  meta.aliases = uniquePreserve(meta.aliases)
  return { meta, foundKnownKey }
}

function assignListKey(
  meta: KnowledgeDocMeta,
  key: 'tags' | 'status' | 'aliases',
  items: string[],
): void {
  if (key === 'status') {
    meta.status = items[0] ?? null
    return
  }
  if (key === 'tags') meta.tags = items
  else meta.aliases = items
}

/** `[a, b]` / `a, b` / single scalar → string list */
function parseInlineList(raw: string): string[] {
  if (!raw) return []
  let s = raw.trim()
  if (s.startsWith('[') && s.endsWith(']')) {
    s = s.slice(1, -1).trim()
    if (!s) return []
    return splitCommaList(s)
  }
  if (s.includes(',')) return splitCommaList(s)
  const one = unquote(s)
  return one ? [one] : []
}

function splitCommaList(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQuote: '"' | "'" | null = null
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuote) {
      if (ch === inQuote) inQuote = null
      else cur += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch
      continue
    }
    if (ch === ',') {
      const v = unquote(cur.trim())
      if (v) out.push(v)
      cur = ''
      continue
    }
    cur += ch
  }
  const last = unquote(cur.trim())
  if (last) out.push(last)
  return out
}

function unquote(s: string): string {
  if (
    (s.startsWith('"') && s.endsWith('"') && s.length >= 2) ||
    (s.startsWith("'") && s.endsWith("'") && s.length >= 2)
  ) {
    return s.slice(1, -1)
  }
  return s
}

function uniquePreserve(items: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const it of items) {
    const t = it.trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}
