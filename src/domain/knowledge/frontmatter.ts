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
 * Knowledge-doc YAML frontmatter: built-ins + free-form props.
 * Hand-rolled (no gray-matter) — enough for flat scalars + string lists.
 *
 * Frontmatter is accepted only when the opening `---`…`---` block contains at
 * least one known key (built-ins). Bare thematic breaks (`---` as Markdown hr)
 * are left in the body and stay searchable.
 */

/** Extra property values (custom schema keys). */
export type PropValue = string | number | boolean | string[]

export type KnowledgeDocMeta = {
  tags: string[]
  status: string | null
  aliases: string[]
  /** ISO date `YYYY-MM-DD` or free string. */
  date: string | null
  priority: string | null
  /** Optional page emoji icon (R5 Gate C). */
  icon: string | null
  /** Optional cover image path relative to space (assets/…). */
  cover: string | null
  /** Cover focal Y percent 0–100 (optional). */
  coverY: number | null
  /** Custom keys not mapped to built-ins. */
  props: Record<string, PropValue>
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
  date: null,
  priority: null,
  icon: null,
  cover: null,
  coverY: null,
  props: {},
}

/** Keys that make a fence count as knowledge frontmatter. */
const KNOWN_FM_KEYS = new Set([
  'tags',
  'status',
  'aliases',
  'date',
  'priority',
  'icon',
  'cover',
  'covery',
])

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

/** Shallow clone meta (arrays/props copied). */
export function cloneDocMeta(meta: KnowledgeDocMeta): KnowledgeDocMeta {
  return {
    tags: [...meta.tags],
    status: meta.status,
    aliases: [...meta.aliases],
    date: meta.date,
    priority: meta.priority,
    icon: meta.icon,
    cover: meta.cover,
    coverY: meta.coverY,
    props: { ...meta.props },
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

type KnownFmKey =
  | 'tags'
  | 'status'
  | 'aliases'
  | 'date'
  | 'priority'
  | 'icon'
  | 'cover'
  | 'coverY'

function normalizeKnownKey(raw: string): KnownFmKey | null {
  const k = raw.toLowerCase()
  if (k === 'covery' || k === 'cover_y' || k === 'cover-y') return 'coverY'
  if (k === 'cover') return 'cover'
  if (KNOWN_FM_KEYS.has(k)) {
    return k as KnownFmKey
  }
  return null
}

function parseMetaLines(lines: string[]): {
  meta: KnowledgeDocMeta
  foundKnownKey: boolean
} {
  const meta: KnowledgeDocMeta = {
    tags: [],
    status: null,
    aliases: [],
    date: null,
    priority: null,
    icon: null,
    cover: null,
    coverY: null,
    props: {},
  }
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
      const rawKey = blockKey[1].toLowerCase()
      const known = normalizeKnownKey(rawKey)
      const items: string[] = []
      i += 1
      while (i < lines.length) {
        const next = lines[i]
        const m = next.match(/^\s+-\s*(.*)$/)
        if (!m) break
        const v = unquote(m[1].trim())
        if (v) items.push(v)
        i += 1
      }
      if (known) {
        foundKnownKey = true
        assignListKey(meta, known, items)
      } else if (items.length > 0) {
        // Custom multi values only count if we already have a known key
        // (or will get one later). Store when key is valid-ish.
        meta.props[rawKey] = uniquePreserve(items)
      }
      continue
    }

    // Inline: `key: value`
    const inline = trimmed.match(/^([A-Za-z_][\w-]*)\s*:\s*(.*)$/)
    if (inline) {
      const rawKey = inline[1].toLowerCase()
      const known = normalizeKnownKey(rawKey)
      const rawVal = inline[2].trim()
      if (known) {
        foundKnownKey = true
        if (
          known === 'status' ||
          known === 'date' ||
          known === 'priority' ||
          known === 'icon' ||
          known === 'cover'
        ) {
          const scalar = unquote(rawVal) || null
          if (known === 'status') meta.status = scalar
          else if (known === 'date') meta.date = scalar
          else if (known === 'icon') meta.icon = scalar
          else if (known === 'cover') meta.cover = scalar
          else meta.priority = scalar
        } else if (known === 'coverY') {
          const n = Number(unquote(rawVal))
          meta.coverY = Number.isFinite(n) ? n : null
        } else {
          assignListKey(meta, known, parseInlineList(rawVal))
        }
        i += 1
        continue
      }
      // Custom scalar / list
      if (rawVal === 'true' || rawVal === 'false') {
        meta.props[rawKey] = rawVal === 'true'
      } else if (rawVal !== '' && !Number.isNaN(Number(rawVal)) && /^-?\d+(\.\d+)?$/.test(rawVal)) {
        meta.props[rawKey] = Number(rawVal)
      } else if (rawVal.startsWith('[')) {
        meta.props[rawKey] = parseInlineList(rawVal)
      } else {
        const one = unquote(rawVal)
        if (one) meta.props[rawKey] = one
      }
      i += 1
      continue
    }

    i += 1
  }

  meta.tags = uniquePreserve(meta.tags)
  meta.aliases = uniquePreserve(meta.aliases)
  // Custom-only FM (no known keys) → reject as frontmatter (thematic break safety).
  // Drop props when rejecting at caller; here we only set foundKnownKey.
  if (!foundKnownKey) {
    meta.props = {}
  }
  return { meta, foundKnownKey }
}

function assignListKey(
  meta: KnowledgeDocMeta,
  key: KnownFmKey,
  items: string[],
): void {
  if (key === 'status') {
    meta.status = items[0] ?? null
    return
  }
  if (key === 'date') {
    meta.date = items[0] ?? null
    return
  }
  if (key === 'priority') {
    meta.priority = items[0] ?? null
    return
  }
  if (key === 'icon') {
    meta.icon = items[0] ?? null
    return
  }
  if (key === 'cover') {
    meta.cover = items[0] ?? null
    return
  }
  if (key === 'coverY') {
    const n = Number(items[0])
    meta.coverY = Number.isFinite(n) ? n : null
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
