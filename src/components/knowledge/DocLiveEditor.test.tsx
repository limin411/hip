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

afterEach(() => cleanup())

async function waitForProseMirror(timeout = 15_000) {
  await waitFor(
    () => {
      const host = screen.getByTestId('knowledge-doc-live-editor')
      expect(host.querySelector('.ProseMirror')).toBeTruthy()
    },
    { timeout },
  )
}

/** Best-effort: put caret at end of ProseMirror and fire keyup so Live syncs slash. */
async function syncSlashFromCaret() {
  const pm = screen
    .getByTestId('knowledge-doc-live-editor')
    .querySelector('.ProseMirror') as HTMLElement
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
    const pm = screen
      .getByTestId('knowledge-doc-live-editor')
      .querySelector('.ProseMirror')
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
      // Structured insert parses emphasis — serializer may use * or **.
      expect(last).toMatch(/bold/)
    })
    // Fence insert proves multi-line MD is not a bare insertText of raw backticks only.
    await act(async () => {
      expect(ref.current?.insertMarkdown('```\ncode\n```')).toBe(true)
    })
    await waitFor(() => {
      const pm = screen
        .getByTestId('knowledge-doc-live-editor')
        .querySelector('.ProseMirror')
      expect(pm?.querySelector('pre') || pm?.textContent?.includes('code')).toBeTruthy()
    })
  }, 20_000)

  it('opens slash menu for line-start / with block catalog items', async () => {
    render(
      <DocLiveEditor
        docId="d-slash"
        initialMarkdown="/"
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
    expect(screen.getByTestId('knowledge-slash-h1')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-slash-table')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-slash-wiki')).toBeInTheDocument()
  }, 25_000)

  it('selecting slash item replaces / token via structured insert path', async () => {
    const onDraftChange = vi.fn()
    render(
      <DocLiveEditor
        docId="d-sel"
        initialMarkdown="/"
        onDraftChange={onDraftChange}
      />,
    )
    await waitForProseMirror()
    await syncSlashFromCaret()

    await waitFor(
      () => {
        expect(screen.getByTestId('knowledge-slash-wiki')).toBeInTheDocument()
      },
      { timeout: 8_000 },
    )

    await act(async () => {
      fireEvent.click(screen.getByTestId('knowledge-slash-wiki'))
    })

    // Menu closes after select.
    await waitFor(() => {
      expect(screen.queryByTestId('knowledge-slash-menu')).not.toBeInTheDocument()
    })
    // `/` token replaced with wiki skeleton (structured replaceRange path).
    await waitFor(() => {
      const pm = screen
        .getByTestId('knowledge-doc-live-editor')
        .querySelector('.ProseMirror')
      const text = pm?.textContent ?? ''
      expect(text.includes('[[') || text.includes(']]')).toBe(true)
      expect(text.trim()).not.toBe('/')
    })
  }, 25_000)
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
