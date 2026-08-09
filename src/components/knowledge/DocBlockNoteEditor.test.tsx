/** @vitest-environment happy-dom */
import { createRef } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
import { en as bnEn, zh as bnZh } from '@blocknote/core/locales'
import i18n from '@/i18n'
import {
  DocBlockNoteEditor,
  type DocBlockNoteEditorHandle,
} from './DocBlockNoteEditor'

const replaceBlocks = vi.fn()
const insertBlocks = vi.fn()
const updateBlock = vi.fn()
const tryParseMarkdownToBlocks = vi.fn((md: string) =>
  md.trim()
    ? [{ id: 'b1', type: 'paragraph', content: md, props: {}, children: [] }]
    : [],
)
const blocksToMarkdownLossy = vi.fn(() => 'serialized body')
const blocksToHTMLLossy = vi.fn(() => '<p>serialized body</p>')
const tryParseHTMLToBlocks = vi.fn(() => [
  { id: 'b1', type: 'paragraph', content: 'serialized body', props: {}, children: [] },
])
const focus = vi.fn()
const setTextCursorPosition = vi.fn()
const getTextCursorPosition = vi.fn(() => ({
  block: { id: 'b0', type: 'paragraph', content: '', props: {}, children: [] },
}))
const useCreateBlockNote = vi.fn((..._args: unknown[]) => ({
  document: [{ id: 'b0', type: 'paragraph', content: '', props: {}, children: [] }],
  tryParseMarkdownToBlocks,
  blocksToMarkdownLossy,
  blocksToHTMLLossy,
  tryParseHTMLToBlocks,
  replaceBlocks,
  insertBlocks,
  updateBlock,
  focus,
  setTextCursorPosition,
  getTextCursorPosition,
  _tiptapEditor: {
    isDestroyed: false,
    state: { tr: { setMeta: (k: string, v: unknown) => ({ meta: { [k]: v } }) } },
    view: {
      dispatch: vi.fn(),
      setProps: vi.fn(),
      destroy: vi.fn(),
    },
  },
}))

vi.mock('@blocknote/core', () => ({
  insertOrUpdateBlockForSlashMenu: vi.fn(),
  BlockNoteSchema: { create: () => ({}) },
  defaultBlockSpecs: {},
  defaultInlineContentSpecs: {},
  defaultStyleSpecs: {},
  blockHasType: () => false,
  editorHasBlockWithType: () => false,
}))

vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: (...args: unknown[]) => useCreateBlockNote(...args),
  SuggestionMenuController: () => null,
  FormattingToolbarController: () => null,
  SideMenuController: () => null,
  FormattingToolbar: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  BasicTextStyleButton: () => null,
  BlockTypeSelect: () => null,
  CreateLinkButton: () => null,
  ColorStyleButton: () => null,
  useBlockNoteEditor: () => ({}),
  useExtension: () => ({
    freezeMenu: vi.fn(),
    unfreezeMenu: vi.fn(),
    blockDragStart: vi.fn(),
    blockDragEnd: vi.fn(),
  }),
  useExtensionState: () => undefined,
  DragHandleMenu: () => null,
  useComponentsContext: () => null,
  createReactBlockSpec: () => () => ({}),
  createReactInlineContentSpec: () => ({}),
  createReactStyleSpec: () => ({}),
}))

vi.mock('@/domain/knowledge/blocks/schema', () => ({
  knowledgeBlockSchema: {},
}))

vi.mock('sonner', () => ({
  toast: { message: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

vi.mock('@blocknote/mantine', () => ({
  BlockNoteView: (props: {
    onChange?: () => void
    children?: React.ReactNode
  }) => (
    <div data-testid="blocknote-view">
      <button type="button" data-testid="bn-type" onClick={() => props.onChange?.()}>
        type
      </button>
      {props.children}
    </div>
  ),
}))

vi.mock('@mantine/core', () => ({
  MantineProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="mantine">{children}</div>
  ),
}))

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? k,
    }),
  }
})

vi.mock('@/domain/knowledge/importAsset', () => ({
  importAssetFromFile: vi.fn(),
  importAssetFromClipboardItems: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/domain/knowledge/assetUrl', () => ({
  resolveAssetDataUrl: vi.fn().mockResolvedValue(null),
}))

let mockCodeBlockTheme = 'follow'
vi.mock('@/store/hipConfigStore', () => ({
  useHipConfigStore: (sel: (s: { config: { codeBlock?: { colorTheme?: string } } }) => unknown) =>
    sel({ config: { codeBlock: { colorTheme: mockCodeBlockTheme } } }),
}))

describe('DocBlockNoteEditor', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    mockCodeBlockTheme = 'follow'
    tryParseMarkdownToBlocks.mockImplementation((md: string) =>
      md.trim()
        ? [{ id: 'b1', type: 'paragraph', content: md, props: {}, children: [] }]
        : [],
    )
    blocksToMarkdownLossy.mockReturnValue('serialized body')
  })

  it('applies light code-block chrome CSS vars from settings', async () => {
    mockCodeBlockTheme = 'light'
    await act(async () => {
      render(
        <DocBlockNoteEditor
          docId="doc_theme"
          initialMarkdown="```\nx\n```"
          onDraftChange={() => {}}
        />,
      )
    })
    const host = screen.getAllByTestId('knowledge-doc-live-editor')[0]
    expect(host.getAttribute('data-code-block-theme')).toBe('light')
    expect(host.style.getPropertyValue('--kb-code-bg')).toBe('#ffffff')
    expect(host.style.getPropertyValue('--kb-code-fg')).toBe('#1f2328')
  })

  it('renders host testid and seeds markdown via replaceBlocks', async () => {
    const onDraft = vi.fn()
    await act(async () => {
      render(
        <DocBlockNoteEditor
          docId="doc_1"
          initialMarkdown="# Hello\n\nWorld"
          onDraftChange={onDraft}
        />,
      )
    })
    expect(screen.getAllByTestId('knowledge-doc-live-editor').length).toBeGreaterThan(0)
    expect(tryParseMarkdownToBlocks).toHaveBeenCalled()
    expect(replaceBlocks).toHaveBeenCalled()
  })

  it('scrollport is full-width (measure stays off the overflow root)', async () => {
    await act(async () => {
      render(
        <DocBlockNoteEditor
          docId="doc_scroll"
          initialMarkdown="# Hi"
          onDraftChange={() => {}}
        />,
      )
    })
    const host = screen.getAllByTestId('knowledge-doc-live-editor')[0]
    expect(host.className).toContain('overflow-y-auto')
    expect(host.className).toContain('knowledge-doc-inline-pad')
    expect(host.className).toContain('w-full')
    // Measure on the scroller pinned the bar to the prose column; keep it off.
    expect(host.className).not.toContain('knowledge-doc-measure')
  })

  it('onChange + flushDraft emits markdown with frontmatter prefix', async () => {
    const onDraft = vi.fn()
    const ref = createRef<DocBlockNoteEditorHandle>()
    const md = `---
tags: [a]
---

Body`
    await act(async () => {
      render(
        <DocBlockNoteEditor
          ref={ref}
          docId="doc_fm"
          initialMarkdown={md}
          onDraftChange={onDraft}
        />,
      )
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    await act(async () => {
      screen.getAllByTestId('bn-type')[0].click()
    })
    await act(async () => {
      ref.current?.flushDraft()
    })
    expect(onDraft).toHaveBeenCalled()
    const last = onDraft.mock.calls.at(-1)?.[0] as string
    expect(last.startsWith('---')).toBe(true)
    expect(last).toContain('tags:')
    expect(last).toContain('serialized body')
  })

  it('insertMarkdown and focus handle', async () => {
    const ref = createRef<DocBlockNoteEditorHandle>()
    await act(async () => {
      render(
        <DocBlockNoteEditor
          ref={ref}
          docId="doc_3"
          initialMarkdown="start"
          onDraftChange={() => {}}
        />,
      )
    })
    expect(ref.current?.insertMarkdown('## X')).toBe(true)
    expect(insertBlocks).toHaveBeenCalled()
    expect(ref.current?.focus({ at: 'start' })).toBe(true)
    expect(focus).toHaveBeenCalled()
  })

  it('maps the app language to a BlockNote dictionary for table UI', async () => {
    const prev = i18n.language
    try {
      await i18n.changeLanguage('zh-CN')
      await act(async () => {
        render(
          <DocBlockNoteEditor docId="doc_i18n" initialMarkdown="" onDraftChange={() => {}} />,
        )
      })
      const first = useCreateBlockNote.mock.calls[0]?.[0] as { dictionary?: unknown }
      expect(first?.dictionary).toBe(bnZh)

      cleanup()
      useCreateBlockNote.mockClear()
      await i18n.changeLanguage('en')
      await act(async () => {
        render(
          <DocBlockNoteEditor docId="doc_i18n" initialMarkdown="" onDraftChange={() => {}} />,
        )
      })
      const second = useCreateBlockNote.mock.calls[0]?.[0] as { dictionary?: unknown }
      expect(second?.dictionary).toBe(bnEn)
      // The picked dictionary actually carries the table handle strings.
      expect(second?.dictionary).toMatchObject({
        table_handle: {
          add_above_menuitem: expect.any(String),
          delete_row_menuitem: expect.any(String),
        },
      })
    } finally {
      await i18n.changeLanguage(prev)
    }
  })
})
