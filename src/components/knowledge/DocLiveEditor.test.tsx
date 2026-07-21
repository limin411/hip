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
