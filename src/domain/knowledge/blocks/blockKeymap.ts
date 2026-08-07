/**
 * Block-level keyboard handlers for Knowledge Live (Notion-like muscle memory).
 * Call from a capturing keydown on the editor root; returns true if handled.
 */

export type BlockKeymapEditor = {
  getTextCursorPosition: () => {
    block: { id: string; type?: string }
    prevBlock?: { id: string } | null
    nextBlock?: { id: string } | null
  }
  getPrevBlock?: (block: { id: string }) => { id: string } | null
  getNextBlock?: (block: { id: string }) => { id: string } | null
  removeBlocks: (blocks: { id: string }[]) => void
  insertBlocks: (
    blocks: Record<string, unknown>[],
    ref: { id: string },
    placement: 'before' | 'after',
  ) => unknown
  moveBlocksUp?: (blocks: { id: string }[]) => void
  moveBlocksDown?: (blocks: { id: string }[]) => void
  updateBlock: (block: { id: string }, update: Record<string, unknown>) => unknown
  /** Nest block under previous sibling when possible. */
  nestBlock?: (block: { id: string }) => void
  unnestBlock?: (block: { id: string }) => void
  document: Array<{ id: string; type?: string; props?: Record<string, unknown>; content?: unknown }>
  focus: () => void
}

function isMod(e: KeyboardEvent): boolean {
  return e.metaKey || e.ctrlKey
}

function currentBlock(editor: BlockKeymapEditor): { id: string; type?: string } | null {
  try {
    return editor.getTextCursorPosition().block
  } catch {
    return null
  }
}

function duplicateBlock(editor: BlockKeymapEditor): boolean {
  const block = currentBlock(editor)
  if (!block) return false
  const full = editor.document.find((b) => b.id === block.id)
  if (!full) return false
  const clone: Record<string, unknown> = {
    type: full.type ?? 'paragraph',
    props: full.props ? { ...full.props } : undefined,
    content: full.content,
  }
  editor.insertBlocks([clone], block, 'after')
  return true
}

function deleteBlock(editor: BlockKeymapEditor): boolean {
  const block = currentBlock(editor)
  if (!block) return false
  // Keep at least one block
  if (editor.document.length <= 1) {
    try {
      editor.updateBlock(block, { type: 'paragraph', content: '' })
    } catch {
      // ignore
    }
    return true
  }
  editor.removeBlocks([block])
  return true
}

function moveBlock(editor: BlockKeymapEditor, dir: 'up' | 'down'): boolean {
  const block = currentBlock(editor)
  if (!block) return false
  try {
    if (dir === 'up' && editor.moveBlocksUp) {
      editor.moveBlocksUp([block])
      return true
    }
    if (dir === 'down' && editor.moveBlocksDown) {
      editor.moveBlocksDown([block])
      return true
    }
  } catch {
    // fall through to manual swap via insert
  }
  const idx = editor.document.findIndex((b) => b.id === block.id)
  if (idx < 0) return false
  const swapWith = dir === 'up' ? idx - 1 : idx + 1
  if (swapWith < 0 || swapWith >= editor.document.length) return false
  const target = editor.document[swapWith]!
  const full = editor.document[idx]!
  const clone: Record<string, unknown> = {
    type: full.type ?? 'paragraph',
    props: full.props ? { ...full.props } : undefined,
    content: full.content,
  }
  try {
    editor.removeBlocks([block])
    editor.insertBlocks([clone], target, dir === 'up' ? 'before' : 'after')
    return true
  } catch {
    return false
  }
}

function indent(editor: BlockKeymapEditor, out: boolean): boolean {
  const block = currentBlock(editor)
  if (!block) return false
  try {
    if (out) {
      editor.unnestBlock?.(block)
    } else {
      editor.nestBlock?.(block)
    }
    return true
  } catch {
    return false
  }
}

/**
 * Handle block shortcuts. Must be called with `e.isComposing` already filtered.
 */
export function handleBlockKeydown(
  e: KeyboardEvent,
  editor: BlockKeymapEditor,
): boolean {
  if (e.isComposing) return false

  const mod = isMod(e)
  const key = e.key

  // Tab / Shift-Tab indent
  if (key === 'Tab' && !mod && !e.altKey) {
    const ok = indent(editor, e.shiftKey)
    if (ok) {
      e.preventDefault()
      e.stopPropagation()
      return true
    }
    return false
  }

  // Mod+D duplicate
  if (mod && !e.shiftKey && !e.altKey && key.toLowerCase() === 'd') {
    if (duplicateBlock(editor)) {
      e.preventDefault()
      e.stopPropagation()
      return true
    }
  }

  // Mod+Shift+Backspace delete block
  if (mod && e.shiftKey && (key === 'Backspace' || key === 'Delete')) {
    if (deleteBlock(editor)) {
      e.preventDefault()
      e.stopPropagation()
      return true
    }
  }

  // Mod+Shift+ArrowUp/Down move
  if (mod && e.shiftKey && (key === 'ArrowUp' || key === 'ArrowDown')) {
    if (moveBlock(editor, key === 'ArrowUp' ? 'up' : 'down')) {
      e.preventDefault()
      e.stopPropagation()
      return true
    }
  }

  return false
}
