/**
 * @vitest-environment happy-dom
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { createRef } from 'react'
import { DocLiveEditor, type DocLiveEditorHandle } from './DocLiveEditor'
import {
  joinYamlFrontmatter,
  splitYamlFrontmatter,
} from '@/domain/knowledge/frontmatter'
import {
  importAssetFromClipboardItems,
  importAssetFromFile,
} from '@/domain/knowledge/importAsset'
import {
  KNOWLEDGE_SLASH_ITEMS,
  filterSlashItemsForLive,
  liveAllowsBlockSlash,
} from '@/domain/knowledge/slashMenu'
import { KnowledgeSlashMenu } from './KnowledgeSlashMenu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string }) =>
      opts?.defaultValue ?? key,
  }),
}))

vi.mock('@/domain/knowledge/importAsset', () => ({
  importAssetFromClipboardItems: vi.fn(),
  importAssetFromFile: vi.fn(),
}))

afterEach(() => {
  cleanup()
  vi.mocked(importAssetFromClipboardItems).mockReset()
  vi.mocked(importAssetFromFile).mockReset()
})

async function waitForProseMirror(timeout = 15_000) {
  await waitFor(
    () => {
      const host = screen.getByTestId('knowledge-doc-live-editor')
      expect(host.querySelector('.ProseMirror')).toBeTruthy()
    },
    { timeout },
  )
}

function proseMirror(): HTMLElement {
  return screen
    .getByTestId('knowledge-doc-live-editor')
    .querySelector('.ProseMirror') as HTMLElement
}

/** Best-effort: put caret at end of ProseMirror and fire keyup so Live syncs slash. */
async function syncSlashFromCaret() {
  const pm = proseMirror()
  pm.focus()
  const sel = window.getSelection()
  if (sel) {
    const range = document.createRange()
    range.selectNodeContents(pm)
    range.collapse(false)
    sel.removeAllRanges()
    sel.addRange(range)
  }
  await act(async () => {
    fireEvent.click(pm)
    fireEvent.keyUp(pm, { key: '/' })
    await new Promise((r) => requestAnimationFrame(() => r(null)))
    await new Promise((r) => requestAnimationFrame(() => r(null)))
  })
}

async function openSlashMenu(initialMarkdown = '/') {
  const onDraftChange = vi.fn()
  render(
    <DocLiveEditor
      docId={`d-slash-${initialMarkdown}`}
      initialMarkdown={initialMarkdown}
      onDraftChange={onDraftChange}
    />,
  )
  await waitForProseMirror()
  await syncSlashFromCaret()
  await waitFor(
    () => {
      expect(screen.getByTestId('knowledge-slash-menu')).toBeInTheDocument()
    },
    { timeout: 8_000 },
  )
  return { onDraftChange }
}

describe('DocLiveEditor', () => {
  it('mounts with knowledge live editor testid', async () => {
    render(
      <DocLiveEditor
        docId="d1"
        initialMarkdown="# Hello\n"
        onDraftChange={() => {}}
      />,
    )
    expect(screen.getByTestId('knowledge-doc-live-editor')).toBeInTheDocument()
    await waitForProseMirror()
  }, 20_000)

  it('strips frontmatter from editable region (YAML not in ProseMirror)', async () => {
    const onDraftChange = vi.fn()
    const md = '---\ntags: [a]\n---\n\n# Body\n'
    render(
      <DocLiveEditor
        docId="d2"
        initialMarkdown={md}
        onDraftChange={onDraftChange}
      />,
    )
    await waitForProseMirror()
    const pm = proseMirror()
    expect(pm?.textContent ?? '').toContain('Body')
    expect(pm?.textContent ?? '').not.toContain('tags: [a]')
  }, 20_000)

  it('split/join helpers used by Live preserve FM round-trip', () => {
    const md = '---\nstatus: draft\n---\n\npara\n'
    const { fmText, body } = splitYamlFrontmatter(md)
    expect(joinYamlFrontmatter(fmText, body)).toBe(md)
  })

  it('insertMarkdown inserts structured markdown into the Live doc', async () => {
    const onDraftChange = vi.fn()
    const ref = createRef<DocLiveEditorHandle>()
    render(
      <DocLiveEditor
        ref={ref}
        docId="d-insert"
        initialMarkdown="hello"
        onDraftChange={onDraftChange}
      />,
    )
    await waitForProseMirror()
    await act(async () => {
      const ok = ref.current?.insertMarkdown('**bold**')
      expect(ok).toBe(true)
    })
    await waitFor(() => {
      expect(onDraftChange).toHaveBeenCalled()
      const last = onDraftChange.mock.calls.at(-1)?.[0] as string
      expect(last).toMatch(/bold/)
    })
    await act(async () => {
      expect(ref.current?.insertMarkdown('```\ncode\n```')).toBe(true)
    })
    await waitFor(() => {
      const pm = proseMirror()
      expect(pm?.querySelector('pre') || pm?.textContent?.includes('code')).toBeTruthy()
    })
  }, 20_000)

  it('opens slash menu for line-start / with block catalog items', async () => {
    await openSlashMenu('/')
    expect(screen.getByTestId('knowledge-slash-h1')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-slash-table')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-slash-wiki')).toBeInTheDocument()
  }, 25_000)

  it('selecting h1 produces a real heading node (not plain paragraph)', async () => {
    const { onDraftChange } = await openSlashMenu('/')
    await act(async () => {
      fireEvent.click(screen.getByTestId('knowledge-slash-h1'))
    })
    await waitFor(() => {
      expect(screen.queryByTestId('knowledge-slash-menu')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      const pm = proseMirror()
      expect(pm.querySelector('h1')).toBeTruthy()
    })
    await waitFor(() => {
      const drafts = onDraftChange.mock.calls.map((c) => c[0] as string)
      expect(drafts.some((d) => /^#\s/m.test(d) || d.includes('# '))).toBe(true)
    })
  }, 25_000)

  it('selecting fence produces a pre/code block', async () => {
    await openSlashMenu('/')
    await act(async () => {
      fireEvent.click(screen.getByTestId('knowledge-slash-fence'))
    })
    await waitFor(() => {
      expect(screen.queryByTestId('knowledge-slash-menu')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      const pm = proseMirror()
      expect(pm.querySelector('pre')).toBeTruthy()
    })
  }, 25_000)

  it('selecting table produces a table node', async () => {
    await openSlashMenu('/')
    await act(async () => {
      fireEvent.click(screen.getByTestId('knowledge-slash-table'))
    })
    await waitFor(() => {
      expect(screen.queryByTestId('knowledge-slash-menu')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      const pm = proseMirror()
      expect(pm.querySelector('table')).toBeTruthy()
    })
  }, 25_000)

  it('selecting wiki replaces / token with wiki skeleton', async () => {
    await openSlashMenu('/')
    await act(async () => {
      fireEvent.click(screen.getByTestId('knowledge-slash-wiki'))
    })
    await waitFor(() => {
      expect(screen.queryByTestId('knowledge-slash-menu')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      const text = proseMirror().textContent ?? ''
      expect(text.includes('[[') || text.includes(']]')).toBe(true)
      expect(text.trim()).not.toBe('/')
    })
  }, 25_000)

  it('Escape dismiss deletes the / token via tr.delete', async () => {
    await openSlashMenu('/')
    expect(proseMirror().textContent ?? '').toContain('/')
    await act(async () => {
      fireEvent.keyDown(document, { key: 'Escape' })
    })
    await waitFor(() => {
      expect(screen.queryByTestId('knowledge-slash-menu')).not.toBeInTheDocument()
    })
    await waitFor(() => {
      const text = (proseMirror().textContent ?? '').trim()
      expect(text).not.toContain('/')
    })
  }, 25_000)

  it('mid-line host slash menu excludes block items', async () => {
    render(
      <DocLiveEditor
        docId="d-mid"
        initialMarkdown="hello /"
        onDraftChange={() => {}}
      />,
    )
    await waitForProseMirror()
    await syncSlashFromCaret()
    await waitFor(
      () => {
        expect(screen.getByTestId('knowledge-slash-menu')).toBeInTheDocument()
      },
      { timeout: 8_000 },
    )
    expect(screen.getByTestId('knowledge-slash-wiki')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-slash-embed')).toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-slash-table')).not.toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-slash-h1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-slash-fence')).not.toBeInTheDocument()
  }, 25_000)

  it('paste image imports asset and inserts markdown via structured insert', async () => {
    const onDraftChange = vi.fn()
    const onAssetImported = vi.fn()
    const md = '![paste.png](assets/paste.png)'
    vi.mocked(importAssetFromClipboardItems).mockResolvedValue({
      ok: true,
      meta: {
        relPath: 'assets/paste.png',
        mime: 'image/png',
        byteLength: 12,
      },
      markdown: md,
    })

    render(
      <DocLiveEditor
        docId="d-paste"
        initialMarkdown="hello"
        spaceId="spc_1"
        onDraftChange={onDraftChange}
        onAssetImported={onAssetImported}
      />,
    )
    await waitForProseMirror()

    const root = screen.getByTestId('knowledge-doc-live-editor')
    const item = {
      kind: 'file' as const,
      type: 'image/png',
      getAsFile: () =>
        new File([new Uint8Array([1, 2, 3])], 'paste.png', {
          type: 'image/png',
        }),
    }
    // Array-like list with length (matches clipboard DataTransferItemList usage).
    const items = Object.assign([item], { length: 1 }) as unknown as DataTransferItemList
    const clipboardData = {
      items,
      files: [] as unknown as FileList,
      types: ['Files'],
      getData: () => '',
    }

    await act(async () => {
      fireEvent.paste(root, { clipboardData })
    })

    await waitFor(() => {
      expect(importAssetFromClipboardItems).toHaveBeenCalledWith(
        'spc_1',
        items,
      )
    })
    await waitFor(() => {
      expect(onAssetImported).toHaveBeenCalled()
      const last = onDraftChange.mock.calls.at(-1)?.[0] as string
      expect(last).toMatch(/assets\/paste\.png/)
    })
  }, 20_000)

  it('paste skips image/svg+xml (same as Source)', async () => {
    const onAssetImported = vi.fn()
    render(
      <DocLiveEditor
        docId="d-paste-svg"
        initialMarkdown="hello"
        spaceId="spc_1"
        onDraftChange={() => {}}
        onAssetImported={onAssetImported}
      />,
    )
    await waitForProseMirror()

    const root = screen.getByTestId('knowledge-doc-live-editor')
    const item = {
      kind: 'file' as const,
      type: 'image/svg+xml',
      getAsFile: () =>
        new File(['<svg/>'], 'x.svg', { type: 'image/svg+xml' }),
    }
    const items = Object.assign([item], { length: 1 }) as unknown as DataTransferItemList

    await act(async () => {
      fireEvent.paste(root, {
        clipboardData: {
          items,
          files: [],
          types: ['Files'],
          getData: () => '',
        },
      })
    })

    expect(importAssetFromClipboardItems).not.toHaveBeenCalled()
    expect(onAssetImported).not.toHaveBeenCalled()
  }, 20_000)

  it('drop image imports via importAssetFromFile and inserts markdown', async () => {
    const onDraftChange = vi.fn()
    const onAssetImportError = vi.fn()
    const file = new File([new Uint8Array([1])], 'drop.png', {
      type: 'image/png',
    })
    vi.mocked(importAssetFromFile).mockResolvedValue({
      ok: true,
      meta: {
        relPath: 'assets/drop.png',
        mime: 'image/png',
        byteLength: 1,
      },
      markdown: '![drop.png](assets/drop.png)',
    })

    render(
      <DocLiveEditor
        docId="d-drop"
        initialMarkdown="x"
        spaceId="spc_1"
        onDraftChange={onDraftChange}
        onAssetImportError={onAssetImportError}
      />,
    )
    await waitForProseMirror()

    const root = screen.getByTestId('knowledge-doc-live-editor')
    // FileList-like: length + numeric index (Array.from uses these).
    const files = {
      0: file,
      length: 1,
      item: (i: number) => (i === 0 ? file : null),
      *[Symbol.iterator]() {
        yield file
      },
    } as unknown as FileList

    await act(async () => {
      fireEvent.drop(root, {
        dataTransfer: {
          files,
          types: ['Files'],
          dropEffect: 'none',
        },
      })
    })

    await waitFor(() => {
      expect(importAssetFromFile).toHaveBeenCalledWith('spc_1', file)
    })
    await waitFor(() => {
      const last = onDraftChange.mock.calls.at(-1)?.[0] as string
      expect(last).toMatch(/assets\/drop\.png/)
    })
    expect(onAssetImportError).not.toHaveBeenCalled()
  }, 20_000)

  it('paste import failure surfaces onAssetImportError', async () => {
    const onAssetImportError = vi.fn()
    vi.mocked(importAssetFromClipboardItems).mockResolvedValue({
      ok: false,
      reason: 'too_large_paste',
    })

    render(
      <DocLiveEditor
        docId="d-paste-err"
        initialMarkdown="hello"
        spaceId="spc_1"
        onDraftChange={() => {}}
        onAssetImportError={onAssetImportError}
      />,
    )
    await waitForProseMirror()

    const root = screen.getByTestId('knowledge-doc-live-editor')
    const item = {
      kind: 'file' as const,
      type: 'image/png',
      getAsFile: () =>
        new File([new Uint8Array([1])], 'big.png', { type: 'image/png' }),
    }
    const items = Object.assign([item], { length: 1 }) as unknown as DataTransferItemList

    await act(async () => {
      fireEvent.paste(root, {
        clipboardData: {
          items,
          files: [],
          types: ['Files'],
          getData: () => '',
        },
      })
    })

    await waitFor(() => {
      expect(onAssetImportError).toHaveBeenCalledWith('too_large_paste')
    })
  }, 20_000)
})

describe('DocLiveEditor slash catalog gating (domain + menu)', () => {
  it('mid-line does not allow block slash; menu items exclude blocks', () => {
    const blockText = 'hello /'
    const slashFrom = 6
    expect(liveAllowsBlockSlash(blockText, slashFrom)).toBe(false)
    const items = filterSlashItemsForLive(KNOWLEDGE_SLASH_ITEMS, {
      allowBlocks: false,
    })
    render(
      <KnowledgeSlashMenu
        query=""
        items={items}
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByTestId('knowledge-slash-wiki')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-slash-embed')).toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-slash-table')).not.toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-slash-h1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-slash-mermaid')).not.toBeInTheDocument()
  })

  it('line-start allows block slash and menu shows table/h1', () => {
    expect(liveAllowsBlockSlash('/', 0)).toBe(true)
    const items = filterSlashItemsForLive(KNOWLEDGE_SLASH_ITEMS, {
      allowBlocks: true,
    })
    render(
      <KnowledgeSlashMenu
        query=""
        items={items}
        onSelect={() => {}}
        onDismiss={() => {}}
      />,
    )
    expect(screen.getByTestId('knowledge-slash-h1')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-slash-table')).toBeInTheDocument()
  })
})
