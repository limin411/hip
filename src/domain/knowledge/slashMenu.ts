/**
 * Knowledge slash `/` insert catalog.
 *
 * Shared by Source (CodeMirror) and Live (BlockNote).
 * Source inserts Markdown snippets; Live maps via `blockNoteSlash.ts`
 * (native blocks + dialect-preserving carriers).
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
  | 'calloutTip'
  | 'calloutNote'
  | 'calloutWarning'
  | 'calloutDanger'
  | 'calloutInfo'
  | 'calloutImportant'
  | 'toggle'
  | 'math'
  | 'mathInline'
  | 'mermaid'
  | 'svg'
  | 'image'
  | 'file'
  | 'aiContinue'
  | 'aiSummarize'
  | 'aiToTasks'
  | 'aiExplain'
  | 'aiRewrite'
  | 'subdoc'
  | 'copyPageLink'

/** Slash menu section (R5 + AI). */
export type KnowledgeSlashGroup = 'basic' | 'list' | 'media' | 'advanced' | 'ai'

export const SLASH_GROUP_ORDER: readonly KnowledgeSlashGroup[] = [
  'basic',
  'list',
  'media',
  'advanced',
  'ai',
] as const

export interface KnowledgeSlashItem {
  id: KnowledgeSlashId
  /** Filter token after `/` (e.g. `h1`, `table`). */
  name: string
  /** Extra aliases for filter (not shown as the primary token). */
  keywords: string[]
  /** Chinese aliases (R5) — first-class in filterSlashItems. */
  keywordsZh: string[]
  /** Menu section. */
  group: KnowledgeSlashGroup
  /** Short icon glyph for menu (emoji or 1–2 char). */
  icon: string
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

/** i18n key for group header (`knowledge.slash.group.<id>`). */
export function slashGroupLabelKey(group: KnowledgeSlashGroup): string {
  return `knowledge.slash.group.${group}`
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
  'calloutTip',
  'calloutNote',
  'calloutWarning',
  'calloutDanger',
  'calloutInfo',
  'calloutImportant',
  'toggle',
  'math',
  'mermaid',
  'svg',
  'image',
  'file',
  'subdoc',
])

/** Live/Source slash insert config — single source of truth. */
export const KNOWLEDGE_SLASH_ITEMS: KnowledgeSlashItem[] = [
  {
    id: 'h1',
    name: 'h1',
    keywords: ['heading', 'title', 'heading1'],
    keywordsZh: ['标题', '一级标题', '标题1'],
    group: 'basic',
    icon: 'H1',
    label: 'Heading 1',
    insert: '# ',
    cursorOffset: 2,
  },
  {
    id: 'h2',
    name: 'h2',
    keywords: ['heading', 'heading2'],
    keywordsZh: ['标题', '二级标题', '标题2'],
    group: 'basic',
    icon: 'H2',
    label: 'Heading 2',
    insert: '## ',
    cursorOffset: 3,
  },
  {
    id: 'h3',
    name: 'h3',
    keywords: ['heading', 'heading3'],
    keywordsZh: ['标题', '三级标题', '标题3'],
    group: 'basic',
    icon: 'H3',
    label: 'Heading 3',
    insert: '### ',
    cursorOffset: 4,
  },
  {
    id: 'quote',
    name: 'quote',
    keywords: ['blockquote', 'bq'],
    keywordsZh: ['引用', '引述'],
    group: 'basic',
    icon: '❝',
    label: 'Quote',
    insert: '> ',
    cursorOffset: 2,
  },
  {
    id: 'hr',
    name: 'hr',
    keywords: ['divider', 'rule', 'line', 'thematic'],
    keywordsZh: ['分割线', '分隔线', '横线'],
    group: 'basic',
    icon: '—',
    label: 'Horizontal rule',
    insert: '---\n',
    cursorOffset: 4,
  },
  {
    id: 'callout',
    name: 'callout',
    keywords: ['note', 'tip', 'warning', 'admonition'],
    keywordsZh: ['高亮', '提示', '注意', '警告'],
    group: 'basic',
    icon: '💡',
    label: 'Callout',
    insert: '> [!note] Title\n> ',
    cursorOffset: 10,
  },
  {
    id: 'calloutTip',
    name: 'tip',
    keywords: ['callout', 'tip'],
    keywordsZh: ['提示'],
    group: 'basic',
    icon: '💡',
    label: 'Tip callout',
    insert: '> [!tip] Tip\n> ',
    cursorOffset: 9,
  },
  {
    id: 'calloutNote',
    name: 'note',
    keywords: ['callout', 'note'],
    keywordsZh: ['笔记', '备注'],
    group: 'basic',
    icon: '📝',
    label: 'Note callout',
    insert: '> [!note] Note\n> ',
    cursorOffset: 10,
  },
  {
    id: 'calloutWarning',
    name: 'warning',
    keywords: ['callout', 'warn', 'warning'],
    keywordsZh: ['警告'],
    group: 'basic',
    icon: '⚠',
    label: 'Warning callout',
    insert: '> [!warning] Warning\n> ',
    cursorOffset: 13,
  },
  {
    id: 'calloutDanger',
    name: 'danger',
    keywords: ['callout', 'danger', 'error'],
    keywordsZh: ['危险', '错误'],
    group: 'basic',
    icon: '⛔',
    label: 'Danger callout',
    insert: '> [!danger] Danger\n> ',
    cursorOffset: 12,
  },
  {
    id: 'calloutInfo',
    name: 'info',
    keywords: ['callout', 'info'],
    keywordsZh: ['信息'],
    group: 'basic',
    icon: 'ℹ',
    label: 'Info callout',
    insert: '> [!info] Info\n> ',
    cursorOffset: 10,
  },
  {
    id: 'calloutImportant',
    name: 'important',
    keywords: ['callout', 'important'],
    keywordsZh: ['重要'],
    group: 'basic',
    icon: '❗',
    label: 'Important callout',
    insert: '> [!important] Important\n> ',
    cursorOffset: 15,
  },
  {
    id: 'toggle',
    name: 'toggle',
    keywords: ['fold', 'details', 'collapse'],
    keywordsZh: ['折叠', '展开'],
    group: 'basic',
    icon: '▸',
    label: 'Toggle',
    insert: '<details>\n<summary>Details</summary>\n\n\n\n</details>\n',
    cursorOffset: 19,
  },
  {
    id: 'bullet',
    name: 'bullet',
    keywords: ['ul', 'list', 'unordered'],
    keywordsZh: ['列表', '无序', '项目符号'],
    group: 'list',
    icon: '•',
    label: 'Bullet list',
    insert: '- ',
    cursorOffset: 2,
  },
  {
    id: 'ordered',
    name: 'ordered',
    keywords: ['ol', 'numbered', 'number'],
    keywordsZh: ['列表', '有序', '数字列表', '编号'],
    group: 'list',
    icon: '1.',
    label: 'Numbered list',
    insert: '1. ',
    cursorOffset: 3,
  },
  {
    id: 'task',
    name: 'task',
    keywords: ['todo', 'checkbox', 'check'],
    keywordsZh: ['待办', '任务', '清单', '复选'],
    group: 'list',
    icon: '☑',
    label: 'Task list',
    insert: '- [ ] ',
    cursorOffset: 6,
  },
  {
    id: 'file',
    name: 'file',
    keywords: ['attach', 'attachment', 'pdf', 'upload'],
    keywordsZh: ['附件', '文件', '上传'],
    group: 'media',
    icon: '📎',
    label: 'File attachment',
    insert: '',
    cursorOffset: 0,
  },
  {
    id: 'image',
    name: 'image',
    keywords: ['img', 'picture', 'photo', 'asset', 'attach'],
    keywordsZh: ['图片', '图像', '照片', '附件'],
    group: 'media',
    icon: '🖼',
    label: 'Image',
    /** Skeleton when no spaceId; with spaceId Live host opens attach (K10). */
    insert: '![](assets/)',
    cursorOffset: 11,
  },
  {
    id: 'table',
    name: 'table',
    keywords: ['grid'],
    keywordsZh: ['表格', '表'],
    group: 'media',
    icon: '▦',
    label: 'Table',
    insert: TABLE_SKELETON_3X2,
    cursorOffset: 2,
  },
  {
    id: 'fence',
    name: 'fence',
    keywords: ['code', 'codeblock', 'pre'],
    keywordsZh: ['代码', '代码块'],
    group: 'media',
    icon: '{ }',
    label: 'Code block',
    insert: '```\n\n```',
    cursorOffset: 4,
  },
  {
    id: 'mermaid',
    name: 'mermaid',
    keywords: ['diagram', 'flowchart', 'chart'],
    keywordsZh: ['图表', '流程图', 'mermaid'],
    group: 'media',
    icon: '↗',
    label: 'Mermaid diagram',
    insert: '```mermaid\nflowchart LR\n  A --> B\n```',
    cursorOffset: 12,
  },
  {
    id: 'svg',
    name: 'svg',
    keywords: ['vector', 'drawing', 'illustration'],
    keywordsZh: ['矢量', '绘图'],
    group: 'media',
    icon: '◇',
    label: 'SVG',
    insert: '```svg\n\n```',
    cursorOffset: 7,
  },
  {
    id: 'math',
    name: 'math',
    keywords: ['latex', 'formula', 'equation', 'katex'],
    keywordsZh: ['公式', '数学', '方程'],
    group: 'media',
    icon: '∑',
    label: 'Math block',
    insert: '$$\n\n$$',
    cursorOffset: 3,
  },
  {
    id: 'mathInline',
    name: 'inlineformula',
    keywords: ['latex', 'formula', 'equation', 'katex', 'inline'],
    keywordsZh: ['行内公式', '公式', '数学', '方程'],
    group: 'media',
    icon: '∑',
    label: 'Inline math',
    insert: '$',
    cursorOffset: 1,
  },
  {
    id: 'wiki',
    name: 'wiki',
    keywords: ['link', 'wikilink', 'page'],
    keywordsZh: ['链接', '双链', '页面'],
    group: 'advanced',
    icon: '[[',
    label: 'Wiki link',
    insert: '[[]]',
    cursorOffset: 2,
  },
  {
    id: 'embed',
    name: 'embed',
    keywords: ['transclude', 'include', 'ref'],
    keywordsZh: ['嵌入', '引用文档', '内嵌'],
    group: 'advanced',
    icon: '![[',
    label: 'Embed document',
    insert: '![[]]',
    cursorOffset: 3,
  },
  {
    id: 'subdoc',
    name: 'subdoc',
    keywords: ['child', 'page', 'subpage'],
    keywordsZh: ['子文档', '子页面'],
    group: 'advanced',
    icon: '↳',
    label: 'Sub-document',
    insert: '[[]]',
    cursorOffset: 2,
  },
  {
    id: 'copyPageLink',
    name: 'copylink',
    keywords: ['copy', 'link', 'url', 'pagelink'],
    keywordsZh: ['复制链接', '页面链接'],
    group: 'advanced',
    icon: '🔗',
    label: 'Copy page link',
    insert: '',
    cursorOffset: 0,
  },
  {
    id: 'aiContinue',
    name: 'aicontinue',
    keywords: ['ai', 'complete', 'continue'],
    keywordsZh: ['续写', '继续写'],
    group: 'ai',
    icon: '✨',
    label: 'AI continue',
    insert: '',
    cursorOffset: 0,
  },
  {
    id: 'aiSummarize',
    name: 'aisummarize',
    keywords: ['ai', 'summary', 'tldr', 'summarize'],
    keywordsZh: ['总结', '摘要'],
    group: 'ai',
    icon: '✨',
    label: 'AI summarize',
    insert: '',
    cursorOffset: 0,
  },
  {
    id: 'aiToTasks',
    name: 'aitasks',
    keywords: ['ai', 'extracttasks'],
    keywordsZh: ['转任务', '待办'],
    group: 'ai',
    icon: '✨',
    label: 'AI to tasks',
    insert: '',
    cursorOffset: 0,
  },
  {
    id: 'aiExplain',
    name: 'aiexplain',
    keywords: ['ai', 'explain'],
    keywordsZh: ['解释'],
    group: 'ai',
    icon: '✨',
    label: 'AI explain',
    insert: '',
    cursorOffset: 0,
  },
  {
    id: 'aiRewrite',
    name: 'airewrite',
    keywords: ['ai', 'rewrite', 'improve'],
    keywordsZh: ['改写', '润色'],
    group: 'ai',
    icon: '✨',
    label: 'AI rewrite',
    insert: '',
    cursorOffset: 0,
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

/** Filter slash items by query (name prefix > name includes > keyword/zh > label). */
export function filterSlashItems(
  items: KnowledgeSlashItem[],
  query: string,
): KnowledgeSlashItem[] {
  const raw = query.trim()
  const q = raw.toLowerCase()
  if (!q) {
    // Stable group order when showing full catalog
    return [...items].sort(
      (a, b) =>
        SLASH_GROUP_ORDER.indexOf(a.group) - SLASH_GROUP_ORDER.indexOf(b.group) ||
        a.name.localeCompare(b.name),
    )
  }

  const scored = items.map((item) => {
    const name = item.name.toLowerCase()
    const label = item.label.toLowerCase()
    const kws = item.keywords.map((k) => k.toLowerCase())
    const zh = item.keywordsZh ?? []
    let score = 6
    if (name === q) score = 0
    else if (name.startsWith(q)) score = 1
    else if (zh.some((k) => k === raw || k.toLowerCase() === q)) score = 1
    // Substring name match only for multi-char queries (avoid "h" → math).
    else if (q.length >= 2 && name.includes(q)) score = 2
    else if (zh.some((k) => k.startsWith(raw) || k.includes(raw))) score = 2
    else if (kws.some((k) => k.startsWith(q) || k === q)) score = 3
    // Substring keyword/label match only for multi-char queries (avoid "h" → check/task).
    else if (q.length >= 2 && (label.includes(q) || kws.some((k) => k.includes(q))))
      score = 4
    else if (q.length >= 2 && zh.some((k) => k.includes(raw))) score = 4
    return { item, score }
  })

  return scored
    .filter((s) => s.score < 6)
    .sort(
      (a, b) =>
        a.score - b.score ||
        SLASH_GROUP_ORDER.indexOf(a.item.group) - SLASH_GROUP_ORDER.indexOf(b.item.group) ||
        a.item.name.localeCompare(b.item.name),
    )
    .map((s) => s.item)
}

/** Group filtered items for menu headers (preserves filter order within group). */
export function groupSlashItems(
  items: KnowledgeSlashItem[],
): { group: KnowledgeSlashGroup; items: KnowledgeSlashItem[] }[] {
  const map = new Map<KnowledgeSlashGroup, KnowledgeSlashItem[]>()
  for (const g of SLASH_GROUP_ORDER) map.set(g, [])
  for (const item of items) {
    const list = map.get(item.group) ?? []
    list.push(item)
    map.set(item.group, list)
  }
  return SLASH_GROUP_ORDER
    .map((group) => ({ group, items: map.get(group) ?? [] }))
    .filter((g) => g.items.length > 0)
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
