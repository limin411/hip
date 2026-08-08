/**
 * Map hip KnowledgeSlash catalog → BlockNote slash menu actions.
 * Single catalog: slashMenu.ts. Native blocks use BN API; dialects use hip blocks.
 */
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import type { DefaultReactSuggestionItem } from '@blocknote/react'
import {
  filterSlashItems,
  KNOWLEDGE_SLASH_ITEMS,
  type KnowledgeSlashId,
  type KnowledgeSlashItem,
  SLASH_GROUP_ORDER,
} from './slashMenu'
import type { KnowledgeAiActionId } from './ai/knowledgeAiActions'
import type { CalloutType } from './callout'

/** Minimal BlockNote editor surface used by slash mapping (avoids deep generic coupling). */
export type BlockNoteSlashEditor = {
  getTextCursorPosition: () => { block: { id: string } }
  updateBlock: (block: { id: string }, update: Record<string, unknown>) => unknown
  insertBlocks: (
    blocks: Record<string, unknown>[],
    ref: { id: string },
    placement: 'before' | 'after',
  ) => unknown
  setTextCursorPosition: (block: unknown, placement?: 'start' | 'end') => void
  tryParseMarkdownToBlocks: (md: string) => Record<string, unknown>[]
  focus: () => void
}

export type BlockNoteSlashHandlers = {
  /** Open file attach for image slash when space is available. */
  onRequestAttach?: () => void
  /** After wiki skeleton insert — open picker. */
  onWikiInsert?: () => void
  /** AI slash actions. */
  onAiAction?: (action: KnowledgeAiActionId) => void
  /** Create subdoc under current parent + insert wiki. */
  onCreateSubdoc?: () => void
  /** Copy hip:// page link. */
  onCopyPageLink?: () => void
  /** Resolve i18n label for a slash id. */
  labelFor: (id: KnowledgeSlashId, fallback: string) => string
  /** Resolve i18n group label. */
  groupLabelFor: (group: string, fallback: string) => string
}

const GROUP_FALLBACK: Record<string, string> = {
  basic: 'Basic',
  list: 'List',
  media: 'Media',
  advanced: 'Advanced',
  ai: 'AI',
}

function emptyTable3x2(): Record<string, unknown> {
  return {
    type: 'table',
    content: {
      type: 'tableContent',
      rows: [
        { cells: ['', '', ''] },
        { cells: ['', '', ''] },
        { cells: ['', '', ''] },
      ],
    },
  }
}

function insertNative(
  editor: BlockNoteSlashEditor,
  block: Record<string, unknown>,
): void {
  insertOrUpdateBlockForSlashMenu(
    editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
    block as Parameters<typeof insertOrUpdateBlockForSlashMenu>[1],
  )
}

/** Insert MD snippet as blocks (dialect / fallback). */
export function insertMarkdownBlocks(
  editor: BlockNoteSlashEditor,
  md: string,
): boolean {
  try {
    const blocks = editor.tryParseMarkdownToBlocks(md)
    if (!blocks.length) return false
    const current = editor.getTextCursorPosition().block
    insertOrUpdateBlockForSlashMenu(
      editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
      blocks[0] as Parameters<typeof insertOrUpdateBlockForSlashMenu>[1],
    )
    if (blocks.length > 1) {
      const after = editor.getTextCursorPosition().block
      editor.insertBlocks(blocks.slice(1), after, 'after')
    }
    void current
    return true
  } catch {
    return false
  }
}

function insertCallout(editor: BlockNoteSlashEditor, type: CalloutType, title: string) {
  insertNative(editor, {
    type: 'callout',
    props: { type, title, body: '' },
  })
}

const AI_SLASH_MAP: Partial<Record<KnowledgeSlashId, KnowledgeAiActionId>> = {
  aiContinue: 'continue',
  aiSummarize: 'summarize',
  aiToTasks: 'toTasks',
  aiExplain: 'explain',
  aiRewrite: 'rewrite',
}

export function applyKnowledgeSlashItem(
  editor: BlockNoteSlashEditor,
  item: KnowledgeSlashItem,
  handlers: Pick<
    BlockNoteSlashHandlers,
    | 'onRequestAttach'
    | 'onWikiInsert'
    | 'onAiAction'
    | 'onCreateSubdoc'
    | 'onCopyPageLink'
  >,
): void {
  const ai = AI_SLASH_MAP[item.id]
  if (ai) {
    handlers.onAiAction?.(ai)
    return
  }

  switch (item.id) {
    case 'h1':
      insertNative(editor, { type: 'heading', props: { level: 1 } })
      return
    case 'h2':
      insertNative(editor, { type: 'heading', props: { level: 2 } })
      return
    case 'h3':
      insertNative(editor, { type: 'heading', props: { level: 3 } })
      return
    case 'quote':
      insertNative(editor, { type: 'quote' })
      return
    case 'hr':
      insertNative(editor, { type: 'divider' })
      return
    case 'bullet':
      insertNative(editor, { type: 'bulletListItem' })
      return
    case 'ordered':
      insertNative(editor, { type: 'numberedListItem' })
      return
    case 'task':
      insertNative(editor, { type: 'checkListItem' })
      return
    case 'fence':
      insertNative(editor, { type: 'codeBlock', props: { language: '' } })
      return
    case 'table':
      insertNative(editor, emptyTable3x2())
      return
    case 'image':
      if (handlers.onRequestAttach) {
        handlers.onRequestAttach()
        return
      }
      insertMarkdownBlocks(editor, item.insert)
      return
    case 'file':
      if (handlers.onRequestAttach) {
        handlers.onRequestAttach()
        return
      }
      insertMarkdownBlocks(editor, item.insert)
      return
    case 'mermaid':
      insertNative(editor, {
        type: 'mermaid',
        props: { src: 'flowchart LR\n  A --> B' },
      })
      return
    case 'svg':
      insertNative(editor, {
        type: 'svgBlock',
        props: { src: '' },
      })
      return
    case 'math':
      insertNative(editor, {
        type: 'math',
        props: { src: '' },
      })
      return
    case 'mathInline':
      // Insert a lone `$`; typing the closing `$` auto-converts (keyup hook).
      insertMarkdownBlocks(editor, '$')
      return
    case 'callout':
      insertCallout(editor, 'note', 'Title')
      return
    case 'calloutTip':
      insertCallout(editor, 'tip', 'Tip')
      return
    case 'calloutNote':
      insertCallout(editor, 'note', 'Note')
      return
    case 'calloutWarning':
      insertCallout(editor, 'warning', 'Warning')
      return
    case 'calloutDanger':
      insertCallout(editor, 'danger', 'Danger')
      return
    case 'calloutInfo':
      insertCallout(editor, 'info', 'Info')
      return
    case 'calloutImportant':
      insertCallout(editor, 'important', 'Important')
      return
    case 'toggle':
      insertNative(editor, {
        type: 'toggle',
        props: { summary: 'Details', body: '' },
      })
      return
    case 'embed':
      insertNative(editor, {
        type: 'embed',
        props: { title: '', fragment: '' },
      })
      return
    case 'wiki':
      insertMarkdownBlocks(editor, '[[]]')
      handlers.onWikiInsert?.()
      return
    case 'subdoc':
      handlers.onCreateSubdoc?.()
      return
    case 'copyPageLink':
      handlers.onCopyPageLink?.()
      return
    case 'columns':
      insertNative(editor, {
        type: 'columns',
        props: { count: '2', columns: '["",""]' },
      })
      return
    default:
      if (item.insert) insertMarkdownBlocks(editor, item.insert)
  }
}

export function buildKnowledgeSlashItems(
  editor: BlockNoteSlashEditor,
  handlers: BlockNoteSlashHandlers,
  query: string,
): DefaultReactSuggestionItem[] {
  const filtered = filterSlashItems(KNOWLEDGE_SLASH_ITEMS, query)
  const ordered = [...filtered].sort(
    (a, b) =>
      SLASH_GROUP_ORDER.indexOf(a.group) - SLASH_GROUP_ORDER.indexOf(b.group) ||
      a.name.localeCompare(b.name),
  )

  return ordered.map((item) => {
    const aliases = [
      item.name,
      ...item.keywords,
      ...item.keywordsZh,
      item.id,
    ]
    return {
      title: handlers.labelFor(item.id, item.label),
      group: handlers.groupLabelFor(item.group, GROUP_FALLBACK[item.group] ?? item.group),
      aliases,
      subtext: item.name,
      onItemClick: () => {
        applyKnowledgeSlashItem(editor, item, handlers)
        try {
          editor.focus()
        } catch {
          // ignore
        }
      },
    }
  })
}

/** Dialect / advanced fence markers that must survive Live serialize when possible. */
export const DIALECT_PRESERVE_MARKERS: ReadonlyArray<{
  id: KnowledgeSlashId
  probe: RegExp
}> = [
  { id: 'mermaid', probe: /```mermaid\b/i },
  { id: 'svg', probe: /```svg\b/i },
  { id: 'math', probe: /\$\$[\s\S]*?\$\$|```math\b/i },
  { id: 'callout', probe: /\[!note\]|\[!tip\]|\[!warning\]|\[!important\]|\[!danger\]|\[!info\]/i },
  { id: 'embed', probe: /!\[\[[^\]]*\]\]/ },
  { id: 'wiki', probe: /\[\[[^\]]+\]\]/ },
  { id: 'toggle', probe: /<details[\s\S]*?<\/details>/i },
]
