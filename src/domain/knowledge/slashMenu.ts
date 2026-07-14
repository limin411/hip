/**
 * Knowledge slash `/` insert catalog (P1.2).
 *
 * Shared by Source (CodeMirror) and Live (Milkdown host when present).
 * Inserts are Markdown snippets — Live serializes via its own pipeline.
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
]

export type SlashQueryMatch = {
  /** Text after `/` (may be empty). */
  query: string
  /** Absolute doc offset of `/`. */
  from: number
  /** Absolute doc offset after the query token (usually cursor). */
  to: number
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
  // Require the char before `/` to be start or whitespace (already in regex),
  // and reject mid-word like `foo/bar`.
  if (fromInLine > 0 && !/\s/.test(before[fromInLine - 1]!)) return null
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
    else if (name.includes(q)) score = 2
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

/** Pure string replace of a slash token with an insert snippet. */
export function applySlashInsertText(
  doc: string,
  from: number,
  to: number,
  item: Pick<KnowledgeSlashItem, 'insert' | 'cursorOffset'>,
): { text: string; cursor: number } {
  const text = doc.slice(0, from) + item.insert + doc.slice(to)
  return { text, cursor: from + item.cursorOffset }
}
