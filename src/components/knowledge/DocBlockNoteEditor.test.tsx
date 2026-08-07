/** @vitest-environment happy-dom */
import { createRef } from 'react'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, act, cleanup } from '@testing-library/react'
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
const focus = vi.fn()
const setTextCursorPosition = vi.fn()
const getTextCursorPosition = vi.fn(() => ({
  block: { id: 'b0', type: 'paragraph', content: '', props: {}, children: [] },
}))

vi.mock('@blocknote/core', () => ({
  insertOrUpdateBlockForSlashMenu: vi.fn(),
  BlockNoteSchema: { create: () => ({}) },
  defaultBlockSpecs: {},
  defaultInlineContentSpecs: {},
  defaultStyleSpecs: {},
}))

vi.mock('@blocknote/react', () => ({
  useCreateBlockNote: () => ({
    document: [{ id: 'b0', type: 'paragraph', content: '', props: {}, children: [] }],
    tryParseMarkdownToBlocks,
    blocksToMarkdownLossy,
    replaceBlocks,
    insertBlocks,
    updateBlock,
    focus,
    setTextCursorPosition,
    getTextCursorPosition,
    _tiptapEditor: { isDestroyed: false },
  }),
  SuggestionMenuController: () => null,
  FormattingToolbarController: () => null,
  FormattingToolbar: ({ children }: { children?: React.ReactNode }) => (
    <div>{children}</div>
  ),
  BasicTextStyleButton: () => null,
  BlockTypeSelect: () => null,
  CreateLinkButton: () => null,
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

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { defaultValue?: string }) => opts?.defaultValue ?? k,
  }),
}))

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
})
