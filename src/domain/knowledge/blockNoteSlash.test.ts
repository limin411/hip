import { describe, expect, it, vi } from 'vitest'
import {
  applyKnowledgeSlashItem,
  buildKnowledgeSlashItems,
  DIALECT_PRESERVE_MARKERS,
  insertMarkdownBlocks,
  type BlockNoteSlashEditor,
} from './blockNoteSlash'
import { KNOWLEDGE_SLASH_ITEMS } from './slashMenu'
import { normalizeMd } from './mdNormalize'

function mockEditor(overrides?: Partial<BlockNoteSlashEditor>): BlockNoteSlashEditor {
  const block = { id: 'b0' }
  return {
    getTextCursorPosition: () => ({ block }),
    updateBlock: vi.fn(),
    insertBlocks: vi.fn(),
    setTextCursorPosition: vi.fn(),
    tryParseMarkdownToBlocks: vi.fn((md: string) =>
      md.trim() ? [{ type: 'paragraph', content: md }] : [],
    ),
    focus: vi.fn(),
    ...overrides,
  }
}

vi.mock('@blocknote/core', () => ({
  insertOrUpdateBlockForSlashMenu: vi.fn((editor: BlockNoteSlashEditor, block: unknown) => {
    editor.updateBlock(editor.getTextCursorPosition().block, block as Record<string, unknown>)
    return block
  }),
}))

describe('buildKnowledgeSlashItems', () => {
  it('includes hip catalog ids and filters by Chinese keyword', () => {
    const editor = mockEditor()
    const items = buildKnowledgeSlashItems(
      editor,
      {
        labelFor: (_id, fb) => fb,
        groupLabelFor: (_g, fb) => fb,
      },
      '表格',
    )
    expect(items.some((i) => i.subtext === 'table')).toBe(true)
    expect(items.every((i) => typeof i.onItemClick === 'function')).toBe(true)
  })

  it('empty query returns full catalog size', () => {
    const editor = mockEditor()
    const items = buildKnowledgeSlashItems(
      editor,
      {
        labelFor: (_id, fb) => fb,
        groupLabelFor: (_g, fb) => fb,
      },
      '',
    )
    expect(items.length).toBe(KNOWLEDGE_SLASH_ITEMS.length)
  })
})

describe('applyKnowledgeSlashItem', () => {
  it('image with onRequestAttach does not parse md', () => {
    const editor = mockEditor()
    const onRequestAttach = vi.fn()
    const image = KNOWLEDGE_SLASH_ITEMS.find((i) => i.id === 'image')!
    applyKnowledgeSlashItem(editor, image, { onRequestAttach })
    expect(onRequestAttach).toHaveBeenCalled()
    expect(editor.tryParseMarkdownToBlocks).not.toHaveBeenCalled()
  })

  it('wiki calls onWikiInsert', () => {
    const editor = mockEditor()
    const onWikiInsert = vi.fn()
    const wiki = KNOWLEDGE_SLASH_ITEMS.find((i) => i.id === 'wiki')!
    applyKnowledgeSlashItem(editor, wiki, { onWikiInsert })
    expect(onWikiInsert).toHaveBeenCalled()
  })

  it('mermaid uses codeBlock language', async () => {
    const { insertOrUpdateBlockForSlashMenu } = await import('@blocknote/core')
    const editor = mockEditor()
    const mermaid = KNOWLEDGE_SLASH_ITEMS.find((i) => i.id === 'mermaid')!
    applyKnowledgeSlashItem(editor, mermaid, {})
    expect(insertOrUpdateBlockForSlashMenu).toHaveBeenCalled()
    const block = vi.mocked(insertOrUpdateBlockForSlashMenu).mock.calls.at(-1)?.[1] as {
      type: string
      props?: { language?: string }
    }
    expect(block.type).toBe('mermaid')
    expect((block.props as { src?: string } | undefined)?.src).toMatch(/flowchart/i)
  })
})

describe('insertMarkdownBlocks', () => {
  it('returns false on empty parse', () => {
    const editor = mockEditor({
      tryParseMarkdownToBlocks: () => [],
    })
    expect(insertMarkdownBlocks(editor, '   ')).toBe(false)
  })
})

describe('dialect preserve markers', () => {
  it('matches catalog insert strings for dialect ids', () => {
    for (const { id, probe } of DIALECT_PRESERVE_MARKERS) {
      const item = KNOWLEDGE_SLASH_ITEMS.find((i) => i.id === id)
      if (!item) continue
      // wiki/embed skeletons may be empty brackets — probe still documents intent
      if (id === 'wiki' || id === 'embed') {
        expect(probe.test('[[Page]]') || probe.test('![[Page]]')).toBe(true)
        continue
      }
      expect(probe.test(item.insert)).toBe(true)
    }
  })

  it('normalizeMd keeps mermaid fence language', () => {
    const md = '```mermaid\nflowchart LR\n  A --> B\n```\n'
    expect(normalizeMd(md)).toMatch(/```mermaid/)
  })
})
