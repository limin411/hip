/**
 * Knowledge slash `/` insert catalog (P1.2).
 *
 * Shared by Source (CodeMirror) and Live (Milkdown host when present).
 * Inserts are Markdown snippets — Live serializes via its own pipeline.
 * Live host should import these symbols (do not fork a Crepe slash plugin).
 */

export type KnowledgeSlashId =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet'
  | 'ordered'
  | 'task'
  | 'fence'
  | 'quote'
  | 'hr'
  | 'table'
  | 'wiki'
  | 'embed'
  | 'callout'
  | 'math'
  | 'mermaid'
  | 'svg'
  | 'image'

export interface KnowledgeSlashItem {
  id: KnowledgeSlashId
  /** Filter token after `/` (e.g. `h1`, `table`). */
  name: string
  /** Extra aliases for filter (not shown as the primary token). */
  keywords: string[]
  /** English fallback label; UI prefers i18n via `slashItemLabelKey`. */
  label: string
  /** Markdown snippet that replaces the `/query` token. */
  insert: string
  /** Cursor offset from the start of `insert` after apply. */
  cursorOffset: number
}

/** i18n key for a slash item label (`knowledge.slash.<id>`). */
export function slashItemLabelKey(id: KnowledgeSlashId | string): string {
  return `knowledge.slash.${id}`
}

/**
 * Header + 2 body rows × 3 columns (table 3×2 skeleton).
 * Cursor lands in the first header cell.
 */
export const TABLE_SKELETON_3X2 =
  '|   |   |   |\n| --- | --- | --- |\n|   |   |   |\n|   |   |   |\n'

/**
 * Slash ids that must form a Markdown block.
 * Mid-line apply prepends `\n` so ATX/lists/tables/etc. stay valid.
 * `wiki` stays inline.
 */
export const BLOCK_SLASH_IDS: ReadonlySet<KnowledgeSlashId> = new Set([
  'h1',
  'h2',
  'h3',
  'bullet',
  'ordered',
  'task',
  'fence',
  'quote',
  'hr',
  'table',
  'callout',
  'math',
  'mermaid',
  'svg',
  'image',
])

/** Live/Source slash insert config — single source of truth. */
export const KNOWLEDGE_SLASH_ITEMS: KnowledgeSlashItem[] = [
  {
    id: 'h1',
    name: 'h1',
    keywords: ['heading', 'title', 'heading1'],
    label: 'Heading 1',
    insert: '# ',
    cursorOffset: 2,
  },
  {
    id: 'h2',
    name: 'h2',
    keywords: ['heading', 'heading2'],
    label: 'Heading 2',
    insert: '## ',
    cursorOffset: 3,
  },
  {
    id: 'h3',
    name: 'h3',
    keywords: ['heading', 'heading3'],
    label: 'Heading 3',
    insert: '### ',
    cursorOffset: 4,
  },
  {
    id: 'bullet',
    name: 'bullet',
    keywords: ['ul', 'list', 'unordered'],
    label: 'Bullet list',
    insert: '- ',
    cursorOffset: 2,
  },
  {
    id: 'ordered',
    name: 'ordered',
    keywords: ['ol', 'numbered', 'number'],
    label: 'Numbered list',
    insert: '1. ',
    cursorOffset: 3,
  },
  {
    id: 'task',
    name: 'task',
    keywords: ['todo', 'checkbox', 'check'],
    label: 'Task list',
    insert: '- [ ] ',
    cursorOffset: 6,
  },
  {
    id: 'fence',
    name: 'fence',
    keywords: ['code', 'codeblock', 'pre'],
    label: 'Code block',
    insert: '```\n\n```',
    cursorOffset: 4,
  },
  {
    id: 'quote',
    name: 'quote',
    keywords: ['blockquote', 'bq'],
    label: 'Quote',
    insert: '> ',
    cursorOffset: 2,
  },
  {
    id: 'hr',
    name: 'hr',
    keywords: ['divider', 'rule', 'line', 'thematic'],
    label: 'Horizontal rule',
    insert: '---\n',
    cursorOffset: 4,
  },
  {
    id: 'table',
    name: 'table',
    keywords: ['grid'],
    label: 'Table',
    insert: TABLE_SKELETON_3X2,
    // first header cell after leading `| `
    cursorOffset: 2,
  },
  {
    id: 'wiki',
    name: 'wiki',
    keywords: ['link', 'wikilink', 'page'],
    label: 'Wiki link',
    insert: '[[]]',
    cursorOffset: 2,
  },
  {
    id: 'embed',
    name: 'embed',
    keywords: ['transclude', 'include', 'ref'],
    label: 'Embed document',
    insert: '![[]]',
    cursorOffset: 3,
  },
  {
    id: 'callout',
    name: 'callout',
    keywords: ['note', 'tip', 'warning', 'admonition'],
    label: 'Callout',
    insert: '> [!note] Title\n> ',
    cursorOffset: 10,
  },
  {
    id: 'math',
    name: 'math',
    keywords: ['latex', 'formula', 'equation', 'katex'],
    label: 'Math block',
    insert: '$$\n\n$$',
    cursorOffset: 3,
  },
  {
    id: 'mermaid',
    name: 'mermaid',
    keywords: ['diagram', 'flowchart', 'chart'],
    label: 'Mermaid diagram',
    insert: '```mermaid\nflowchart LR\n  A --> B\n```',
    cursorOffset: 12,
  },
  {
    id: 'svg',
    name: 'svg',
    keywords: ['vector', 'drawing', 'illustration'],
    label: 'SVG',
    insert: '```svg\n\n```',
    cursorOffset: 7,
  },
  {
    id: 'image',
    name: 'image',
    keywords: ['img', 'picture', 'photo', 'asset', 'attach'],
    label: 'Image',
    /** Skeleton when no spaceId; with spaceId Live host opens attach (K10). */
    insert: '![](assets/)',
    cursorOffset: 11,
  },
]

export type SlashQueryMatch = {
  /** Text after `/` (may be empty). */
  query: string
  /** Absolute doc offset of `/`. */
  from: number
  /** Absolute doc offset after the query token (usually cursor). */
  to: number
}

/** True when both matches point at the same token (for cheap setState). */
export function sameSlashMatch(
  a: SlashQueryMatch | null,
  b: SlashQueryMatch | null,
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.query === b.query && a.from === b.from && a.to === b.to
}

/**
 * Detect a slash insert query immediately before `cursor` in `lineText`.
 * Trigger: `/` at line start or after whitespace; token has no spaces or `/`.
 *
 * `lineFrom` is the absolute offset of the line start in the full document.
 */
export function extractSlashQueryAt(
  lineText: string,
  cursorInLine: number,
  lineFrom = 0,
): SlashQueryMatch | null {
  if (cursorInLine < 0 || cursorInLine > lineText.length) return null
  const before = lineText.slice(0, cursorInLine)
  // `/` at start or after whitespace; token cannot contain space or `/`
  const m = before.match(/(?:^|[\s])\/([^\s/]*)$/)
  if (!m) return null
  const tokenWithSlash = `/${m[1]}`
  const fromInLine = before.length - tokenWithSlash.length
  return {
    query: m[1],
    from: lineFrom + fromInLine,
    to: lineFrom + cursorInLine,
  }
}

/** Filter slash items by query (name prefix > name includes > keyword > label). */
export function filterSlashItems(
  items: KnowledgeSlashItem[],
  query: string,
): KnowledgeSlashItem[] {
  const q = query.toLowerCase().trim()
  if (!q) return items

  const scored = items.map((item) => {
    const name = item.name.toLowerCase()
    const label = item.label.toLowerCase()
    const kws = item.keywords.map((k) => k.toLowerCase())
    let score = 5
    if (name === q) score = 0
    else if (name.startsWith(q)) score = 1
    // Substring name match only for multi-char queries (avoid "h" → math).
    else if (q.length >= 2 && name.includes(q)) score = 2
    else if (kws.some((k) => k.startsWith(q) || k === q)) score = 3
    // Substring keyword/label match only for multi-char queries (avoid "h" → check/task).
    else if (q.length >= 2 && (label.includes(q) || kws.some((k) => k.includes(q))))
      score = 4
    return { item, score }
  })

  return scored
    .filter((s) => s.score < 5)
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name))
    .map((s) => s.item)
}

/**
 * Live (ProseMirror) block slash is only safe at textblock start (or after
 * whitespace-only prefix). Mid-line block insert would nest block nodes in a
 * paragraph; Source still allows mid-line via string `\n` prepend.
 *
 * `slashFromInBlock` is the offset of `/` within `blockText`.
 */
export function liveAllowsBlockSlash(
  blockText: string,
  slashFromInBlock: number,
): boolean {
  if (slashFromInBlock < 0 || slashFromInBlock > blockText.length) return false
  const prefix = blockText.slice(0, slashFromInBlock)
  return prefix.trim().length === 0
}

/**
 * Drop BLOCK_SLASH_IDS when Live does not allow block inserts at the caret.
 * Call after `filterSlashItems` (or on the full catalog before query filter).
 */
export function filterSlashItemsForLive(
  items: KnowledgeSlashItem[],
  opts: { allowBlocks: boolean },
): KnowledgeSlashItem[] {
  if (opts.allowBlocks) return items
  return items.filter((item) => !BLOCK_SLASH_IDS.has(item.id))
}

/**
 * Normalize insert for block items: if `/` is mid-line after non-whitespace,
 * prepend `\n` so the snippet starts a new block line.
 */
export function prepareSlashInsert(
  doc: string,
  from: number,
  item: Pick<KnowledgeSlashItem, 'id' | 'insert' | 'cursorOffset'>,
): { insert: string; cursorOffset: number } {
  let insert = item.insert
  let cursorOffset = item.cursorOffset
  if (BLOCK_SLASH_IDS.has(item.id)) {
    const lineStart = from === 0 ? 0 : doc.lastIndexOf('\n', from - 1) + 1
    const prefix = doc.slice(lineStart, from)
    if (prefix.trim().length > 0) {
      insert = `\n${insert}`
      cursorOffset += 1
    }
  }
  return { insert, cursorOffset }
}

/** Pure string replace of a slash token with a (possibly block-normalized) insert. */
export function applySlashInsertText(
  doc: string,
  from: number,
  to: number,
  item: Pick<KnowledgeSlashItem, 'id' | 'insert' | 'cursorOffset'>,
): { text: string; cursor: number } {
  const prepared = prepareSlashInsert(doc, from, item)
  const text = doc.slice(0, from) + prepared.insert + doc.slice(to)
  return { text, cursor: from + prepared.cursorOffset }
}
