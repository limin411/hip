/**
 * Knowledge-doc YAML frontmatter: tags / status / aliases only.
 * Hand-rolled (no gray-matter) — enough for flat scalars + string lists.
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
  const meta = parseMetaLines(yamlLines)
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

// ─── internal line parser ───────────────────────────────────────────────────

function parseMetaLines(lines: string[]): KnowledgeDocMeta {
  const meta: KnowledgeDocMeta = { tags: [], status: null, aliases: [] }
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
    if (blockKey && FM_KEYS.has(blockKey[1])) {
      const key = blockKey[1] as 'tags' | 'status' | 'aliases'
      const items: string[] = []
      i += 1
      while (i < lines.length) {
        const next = lines[i]
        const m = next.match(/^\s+-\s+(.*)$/)
        if (!m) break
        const v = unquote(m[1].trim())
        if (v) items.push(v)
        i += 1
      }
      assignListKey(meta, key, items)
      continue
    }

    // Inline: `key: value`
    const inline = trimmed.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (inline && FM_KEYS.has(inline[1])) {
      const key = inline[1] as 'tags' | 'status' | 'aliases'
      const rawVal = inline[2].trim()
      if (key === 'status') {
        meta.status = unquote(rawVal) || null
      } else {
        assignListKey(meta, key, parseInlineList(rawVal))
      }
      i += 1
      continue
    }

    i += 1
  }

  meta.tags = uniquePreserve(meta.tags)
  meta.aliases = uniquePreserve(meta.aliases)
  return meta
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
