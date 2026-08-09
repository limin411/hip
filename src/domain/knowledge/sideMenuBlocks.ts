/**
 * Side-menu (+ / six-dot) block type catalog.
 * Labels/icons reuse slash catalog where possible; insert uses the same BN path.
 */
import { insertOrUpdateBlockForSlashMenu } from '@blocknote/core'
import {
  applyKnowledgeSlashItem,
  type BlockNoteSlashEditor,
} from './blockNoteSlash'
import {
  KNOWLEDGE_SLASH_ITEMS,
  slashItemLabelKey,
  type KnowledgeSlashId,
  type KnowledgeSlashItem,
} from './slashMenu'

/** Core types shown in + insert menu and Turn into submenu (spec v3). */
export type SideMenuBlockId =
  | 'text'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'task'
  | 'bullet'
  | 'ordered'
  | 'toggle'
  | 'fence'
  | 'quote'
  | 'hr'
  | 'callout'

export const SIDE_MENU_BLOCK_ORDER: readonly SideMenuBlockId[] = [
  'text',
  'h1',
  'h2',
  'h3',
  'task',
  'bullet',
  'ordered',
  'toggle',
  'fence',
  'quote',
  'hr',
  'callout',
] as const

export type SideMenuBlockDef = {
  id: SideMenuBlockId
  icon: string
  /** English fallback label. */
  label: string
  slashItem?: KnowledgeSlashItem
}

function slashById(id: KnowledgeSlashId): KnowledgeSlashItem {
  const item = KNOWLEDGE_SLASH_ITEMS.find((i) => i.id === id)
  if (!item) throw new Error(`missing slash item: ${id}`)
  return item
}

export const SIDE_MENU_BLOCKS: SideMenuBlockDef[] = SIDE_MENU_BLOCK_ORDER.map(
  (id) => {
    if (id === 'text') {
      return { id, icon: '¶', label: 'Text' }
    }
    const slashItem = slashById(id)
    return {
      id,
      icon: slashItem.icon,
      label: slashItem.label,
      slashItem,
    }
  },
)

export function sideMenuLabelKey(id: SideMenuBlockId): string {
  if (id === 'text') return 'knowledge.doc.blockTypeText'
  return slashItemLabelKey(id)
}

/** PartialBlock shape for turn-into (updateBlock). */
export function blockPartialForSideMenu(
  id: SideMenuBlockId,
): Record<string, unknown> {
  switch (id) {
    case 'text':
      return { type: 'paragraph' }
    case 'h1':
      return { type: 'heading', props: { level: 1 } }
    case 'h2':
      return { type: 'heading', props: { level: 2 } }
    case 'h3':
      return { type: 'heading', props: { level: 3 } }
    case 'quote':
      return { type: 'quote' }
    case 'hr':
      return { type: 'divider' }
    case 'bullet':
      return { type: 'bulletListItem' }
    case 'ordered':
      return { type: 'numberedListItem' }
    case 'task':
      return { type: 'checkListItem' }
    case 'fence':
      return { type: 'codeBlock', props: { language: '' } }
    case 'toggle':
      return { type: 'toggle', props: { summary: 'Details', body: '' } }
    case 'callout':
      return { type: 'callout', props: { type: 'note', title: 'Title', body: '' } }
    default: {
      const _exhaustive: never = id
      return _exhaustive
    }
  }
}

/**
 * + menu: empty block converts, non-empty inserts after
 * (insertOrUpdateBlockForSlashMenu / applyKnowledgeSlashItem).
 * Caller must set text cursor on the target block first.
 */
export function insertSideMenuBlock(
  editor: BlockNoteSlashEditor,
  id: SideMenuBlockId,
): void {
  if (id === 'text') {
    insertOrUpdateBlockForSlashMenu(
      editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
      { type: 'paragraph' } as Parameters<
        typeof insertOrUpdateBlockForSlashMenu
      >[1],
    )
    return
  }
  const def = SIDE_MENU_BLOCKS.find((b) => b.id === id)
  if (def?.slashItem) {
    applyKnowledgeSlashItem(editor, def.slashItem, {})
    return
  }
  insertOrUpdateBlockForSlashMenu(
    editor as Parameters<typeof insertOrUpdateBlockForSlashMenu>[0],
    blockPartialForSideMenu(id) as Parameters<
      typeof insertOrUpdateBlockForSlashMenu
    >[1],
  )
}

/** ⋮⋮ Turn into: convert current block in place. */
export function turnIntoSideMenuBlock(
  editor: { updateBlock: (block: { id: string }, update: Record<string, unknown>) => unknown },
  block: { id: string },
  id: SideMenuBlockId,
): void {
  editor.updateBlock(block, blockPartialForSideMenu(id))
}

/**
 * Whether `block` already matches a side-menu catalog id.
 * Paired with `blockPartialForSideMenu` (inverse mapping).
 */
export function isCurrentSideMenuType(
  block: { type: string; props?: Record<string, unknown> },
  id: SideMenuBlockId,
): boolean {
  switch (id) {
    case 'text':
      return block.type === 'paragraph'
    case 'h1':
      return block.type === 'heading' && Number(block.props?.level ?? 1) === 1
    case 'h2':
      return block.type === 'heading' && Number(block.props?.level) === 2
    case 'h3':
      return block.type === 'heading' && Number(block.props?.level) === 3
    case 'quote':
      return block.type === 'quote'
    case 'hr':
      return block.type === 'divider'
    case 'bullet':
      return block.type === 'bulletListItem'
    case 'ordered':
      return block.type === 'numberedListItem'
    case 'task':
      return block.type === 'checkListItem'
    case 'fence':
      return block.type === 'codeBlock'
    case 'toggle':
      return block.type === 'toggle'
    case 'callout':
      return block.type === 'callout'
    default: {
      const _exhaustive: never = id
      return _exhaustive
    }
  }
}

/** Safe-ish clone for Duplicate (type/props/content only). */
export function cloneBlockForDuplicate(block: {
  type: string
  props?: Record<string, unknown>
  content?: unknown
}): Record<string, unknown> {
  const next: Record<string, unknown> = { type: block.type }
  if (block.props && typeof block.props === 'object') {
    next.props = { ...block.props }
  }
  if (block.content !== undefined) {
    try {
      next.content = structuredClone(block.content)
    } catch {
      next.content = block.content
    }
  }
  return next
}
