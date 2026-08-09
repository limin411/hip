import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  SIDE_MENU_BLOCKS,
  SIDE_MENU_BLOCK_ORDER,
  blockPartialForSideMenu,
  cloneBlockForDuplicate,
  insertSideMenuBlock,
  sideMenuLabelKey,
  turnIntoSideMenuBlock,
} from './sideMenuBlocks'
import type { BlockNoteSlashEditor } from './blockNoteSlash'

const insertOrUpdate = vi.fn()

vi.mock('@blocknote/core', () => ({
  insertOrUpdateBlockForSlashMenu: (...args: unknown[]) => insertOrUpdate(...args),
}))

describe('sideMenuBlocks', () => {
  beforeEach(() => {
    insertOrUpdate.mockClear()
  })

  it('exposes the v3 core catalog in order', () => {
    expect(SIDE_MENU_BLOCK_ORDER).toEqual([
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
    ])
    expect(SIDE_MENU_BLOCKS.map((b) => b.id)).toEqual([...SIDE_MENU_BLOCK_ORDER])
  })

  it('maps label keys (text is synthetic)', () => {
    expect(sideMenuLabelKey('text')).toBe('knowledge.doc.blockTypeText')
    expect(sideMenuLabelKey('h1')).toBe('knowledge.slash.h1')
  })

  it('builds turn-into partials', () => {
    expect(blockPartialForSideMenu('text')).toEqual({ type: 'paragraph' })
    expect(blockPartialForSideMenu('h2')).toEqual({
      type: 'heading',
      props: { level: 2 },
    })
    expect(blockPartialForSideMenu('task')).toEqual({ type: 'checkListItem' })
    expect(blockPartialForSideMenu('hr')).toEqual({ type: 'divider' })
  })

  it('turnIntoSideMenuBlock calls updateBlock', () => {
    const updateBlock = vi.fn()
    turnIntoSideMenuBlock(
      { updateBlock },
      { id: 'b1' },
      'h1',
    )
    expect(updateBlock).toHaveBeenCalledWith(
      { id: 'b1' },
      { type: 'heading', props: { level: 1 } },
    )
  })

  it('insertSideMenuBlock uses insertOrUpdate for text', () => {
    const editor = {
      getTextCursorPosition: () => ({ block: { id: 'b0' } }),
      updateBlock: vi.fn(),
      insertBlocks: vi.fn(),
      setTextCursorPosition: vi.fn(),
      tryParseMarkdownToBlocks: vi.fn(() => []),
      focus: vi.fn(),
    } satisfies BlockNoteSlashEditor
    insertSideMenuBlock(editor, 'text')
    expect(insertOrUpdate).toHaveBeenCalled()
    expect(insertOrUpdate.mock.calls.at(-1)?.[1]).toEqual({ type: 'paragraph' })
  })

  it('insertSideMenuBlock maps h1 via slash apply path', () => {
    const editor = {
      getTextCursorPosition: () => ({ block: { id: 'b0' } }),
      updateBlock: vi.fn(),
      insertBlocks: vi.fn(),
      setTextCursorPosition: vi.fn(),
      tryParseMarkdownToBlocks: vi.fn(() => []),
      focus: vi.fn(),
    } satisfies BlockNoteSlashEditor
    insertSideMenuBlock(editor, 'h1')
    expect(insertOrUpdate).toHaveBeenCalled()
    expect(insertOrUpdate.mock.calls.at(-1)?.[1]).toMatchObject({
      type: 'heading',
      props: { level: 1 },
    })
  })

  it('cloneBlockForDuplicate keeps type/props/content only', () => {
    const clone = cloneBlockForDuplicate({
      type: 'paragraph',
      props: { textColor: 'default' },
      content: [{ type: 'text', text: 'hi', styles: {} }],
    })
    expect(clone).toEqual({
      type: 'paragraph',
      props: { textColor: 'default' },
      content: [{ type: 'text', text: 'hi', styles: {} }],
    })
    // nested content is cloned, not same reference
    expect(clone.content).not.toBe([
      { type: 'text', text: 'hi', styles: {} },
    ])
  })
})
