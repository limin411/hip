// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import React from 'react'
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

const setDraftBody = vi.fn()
const getState = vi.fn()

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: Record<string, string>) => {
        if (key === 'knowledge.wiki.brokenHint') return `broken:${opts?.title}`
        if (key === 'knowledge.wiki.openHint') return `open:${opts?.title}`
        if (key === 'knowledge.doc.emptyTitle') return 'Empty'
        if (key === 'knowledge.doc.emptyHint') return 'Hint'
        if (key === 'knowledge.doc.edit') return 'Edit'
        return key
      },
      i18n: { language: 'en' },
    }),
    initReactI18next: actual.initReactI18next ?? {
      type: '3rdParty',
      init: () => {},
    },
  }
})

vi.mock('@/i18n', () => ({
  default: { t: (key: string) => key },
}))

const requestOutlineJump = vi.fn()
vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: Object.assign(
    (selector: (s: {
      setDraftBody: typeof setDraftBody
      activeSpaceId: string | null
      activeDocId: string | null
      requestOutlineJump: typeof requestOutlineJump
    }) => unknown) =>
      selector({
        setDraftBody,
        activeSpaceId: 'spc_test01',
        activeDocId: 'doc_cur',
        requestOutlineJump,
      }),
    {
      getState: () => getState(),
    },
  ),
}))

vi.mock('@/domain/knowledge/assetUrl', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/domain/knowledge/assetUrl')>()
  return {
    ...actual,
    resolveAssetDataUrl: vi.fn(async (_spaceId: string, rel: string) => {
      if (rel.includes('missing')) return null
      return { dataUrl: 'data:image/png;base64,aaa', mime: 'image/png' }
    }),
  }
})

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn(),
}))

const knowledgeReadDoc = vi.fn()
vi.mock('@/ipc/knowledge', () => ({
  knowledgeReadDoc: (...a: unknown[]) => knowledgeReadDoc(...a),
  knowledgeErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))

// Avoid chat CodeBlock → context-menu → sessionService graph in unit tests.
vi.mock('@/components/chat/CodeBlock', () => ({
  CodeBlock: ({ children }: { children?: React.ReactNode }) => (
    <pre data-testid="mock-code">{children}</pre>
  ),
}))

import { DocReader } from './DocReader'
import { open } from '@tauri-apps/plugin-shell'

afterEach(() => {
  cleanup()
  setDraftBody.mockReset()
  getState.mockReset()
  vi.mocked(open).mockReset()
})

beforeEach(() => {
  getState.mockReturnValue({
    draftBody: '',
    docBody: '',
    setDraftBody,
  })
})

const nodes = [
  {
    id: 'doc_alpha',
    parentId: null,
    kind: 'doc' as const,
    title: 'Alpha',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  },
  {
    id: 'doc_beta',
    parentId: null,
    kind: 'doc' as const,
    title: 'Beta',
    order: 1,
    createdAt: 1,
    updatedAt: 1,
  },
]

describe('DocReader preview tasks + anchors', () => {
  it('renders interactive task checkboxes and write-backs via setDraftBody persist now', () => {
    const md = '- [ ] first\n- [x] second\n'
    getState.mockReturnValue({ draftBody: md, docBody: md, setDraftBody })

    render(<DocReader content={md} />)

    const boxes = screen.getAllByTestId('knowledge-task-checkbox') as HTMLInputElement[]
    expect(boxes).toHaveLength(2)
    expect(boxes[0]).not.toBeChecked()
    expect(boxes[1]).toBeChecked()

    fireEvent.click(boxes[0])
    expect(setDraftBody).toHaveBeenCalledWith('- [x] first\n- [x] second\n', {
      persist: 'now',
    })
  })

  it('keeps correct task toggle after re-render with same content', () => {
    const md = '- [ ] a\n- [ ] b\n'
    getState.mockReturnValue({ draftBody: md, docBody: md, setDraftBody })

    const { rerender } = render(<DocReader content={md} />)
    rerender(<DocReader content={md} />)

    fireEvent.click(screen.getAllByTestId('knowledge-task-checkbox')[1])
    expect(setDraftBody).toHaveBeenCalledWith('- [ ] a\n- [x] b\n', { persist: 'now' })
  })

  it('keeps correct task toggle after content updates (post-toggle / flush)', () => {
    const md0 = '- [ ] a\n- [ ] b\n'
    const md1 = '- [x] a\n- [ ] b\n'
    getState.mockReturnValue({ draftBody: md0, docBody: md0, setDraftBody })

    const { rerender } = render(<DocReader content={md0} />)
    fireEvent.click(screen.getAllByTestId('knowledge-task-checkbox')[0])
    expect(setDraftBody).toHaveBeenLastCalledWith(md1, { persist: 'now' })

    getState.mockReturnValue({ draftBody: md1, docBody: md1, setDraftBody })
    rerender(<DocReader content={md1} />)

    const boxes = screen.getAllByTestId('knowledge-task-checkbox') as HTMLInputElement[]
    expect(boxes[0]).toBeChecked()
    expect(boxes[1]).not.toBeChecked()

    fireEvent.click(boxes[1])
    expect(setDraftBody).toHaveBeenLastCalledWith('- [x] a\n- [x] b\n', { persist: 'now' })
  })

  it('assigns stable heading ids across re-renders and hash-scrolls without shell open', () => {
    const md = '## Intro\n\n## Intro\n\nSee [jump](#intro)\n'
    getState.mockReturnValue({ draftBody: md, docBody: md, setDraftBody })

    const scrollIntoView = vi.fn()
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = scrollIntoView

    try {
      const { rerender } = render(<DocReader content={md} />)
      expect(document.getElementById('intro')).toBeTruthy()
      expect(document.getElementById('intro-1')).toBeTruthy()

      rerender(<DocReader content={md} />)
      expect(document.getElementById('intro')).toBeTruthy()
      expect(document.getElementById('intro-1')).toBeTruthy()
      expect(document.getElementById('intro-2')).toBeNull()

      const link = screen.getByRole('link', { name: 'jump' })
      fireEvent.click(link)
      expect(scrollIntoView).toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
    } finally {
      Element.prototype.scrollIntoView = original
    }
  })

  it('hash scroll uses the DocReader root (scoped lookup)', () => {
    const md = '## Scoped\n\n[go](#scoped)\n'
    getState.mockReturnValue({ draftBody: md, docBody: md, setDraftBody })

    const poison = document.createElement('h2')
    poison.id = 'scoped'
    document.body.appendChild(poison)
    const poisonScroll = vi.fn()
    poison.scrollIntoView = poisonScroll

    try {
      render(<DocReader content={md} />)
      const reader = screen.getByTestId('knowledge-doc-reader')
      const heading = reader.querySelector('#scoped') as HTMLElement
      expect(heading).toBeTruthy()
      const headingScroll = vi.fn()
      heading.scrollIntoView = headingScroll

      fireEvent.click(screen.getByRole('link', { name: 'go' }))
      expect(headingScroll).toHaveBeenCalled()
      expect(poisonScroll).not.toHaveBeenCalled()
      expect(open).not.toHaveBeenCalled()
    } finally {
      poison.remove()
    }
  })

  it('optimistic content prop reflects draft before flush (checked state)', () => {
    const after = '- [x] only\n'
    getState.mockReturnValue({ draftBody: after, docBody: '- [ ] only\n', setDraftBody })
    render(<DocReader content={after} />)
    expect(screen.getByTestId('knowledge-task-checkbox')).toBeChecked()
  })

  it('StrictMode: task indices and heading ids stay correct', () => {
    const md = '## Intro\n\n## Intro\n\n- [ ] a\n- [ ] b\n'
    getState.mockReturnValue({ draftBody: md, docBody: md, setDraftBody })

    render(
      <React.StrictMode>
        <DocReader content={md} />
      </React.StrictMode>,
    )

    expect(document.getElementById('intro')).toBeTruthy()
    expect(document.getElementById('intro-1')).toBeTruthy()
    expect(document.getElementById('intro-2')).toBeNull()

    const boxes = screen.getAllByTestId('knowledge-task-checkbox')
    expect(boxes).toHaveLength(2)

    fireEvent.click(boxes[1])
    expect(setDraftBody).toHaveBeenCalledWith('## Intro\n\n## Intro\n\n- [ ] a\n- [x] b\n', {
      persist: 'now',
    })
  })

  it('shows empty state when content is blank', () => {
    render(<DocReader content="   " />)
    expect(screen.getByTestId('knowledge-doc-empty')).toBeInTheDocument()
  })
})

describe('DocReader wiki links', () => {
  it('renders resolved wiki links as clickable and navigates', () => {
    const onWikiNavigate = vi.fn()
    render(
      <DocReader
        content="See [[Alpha]] please."
        nodes={nodes}
        onWikiNavigate={onWikiNavigate}
      />,
    )
    const link = screen.getByTestId('knowledge-wiki-link')
    expect(link).toHaveTextContent('Alpha')
    fireEvent.click(link)
    expect(onWikiNavigate).toHaveBeenCalledWith('doc_alpha', null)
  })

  it('renders broken style and requests create', () => {
    const onWikiBroken = vi.fn()
    render(
      <DocReader
        content="Missing [[Ghost]]"
        nodes={nodes}
        onWikiBroken={onWikiBroken}
      />,
    )
    const link = screen.getByTestId('knowledge-wiki-link-broken')
    expect(link.className).toMatch(/text-danger/)
    fireEvent.click(link)
    expect(onWikiBroken).toHaveBeenCalledWith('Ghost')
  })

  it('uses pipe display text', () => {
    render(
      <DocReader
        content="[[Alpha|Shown]]"
        nodes={nodes}
        onWikiNavigate={() => {}}
      />,
    )
    expect(screen.getByTestId('knowledge-wiki-link')).toHaveTextContent('Shown')
  })
})

describe('DocReader embeds', () => {
  beforeEach(() => {
    knowledgeReadDoc.mockReset()
    knowledgeReadDoc.mockResolvedValue('# Alpha body\n\nHello embed.\n')
  })

  it('renders embed card for ![[Title]] when space is active', async () => {
    render(
      <DocReader content="Intro\n\n![[Alpha]]\n\nOutro" nodes={nodes} onWikiNavigate={() => {}} />,
    )
    expect(await screen.findByTestId('knowledge-embed')).toBeInTheDocument()
    expect(await screen.findByTestId('knowledge-embed-body')).toHaveTextContent('Hello embed')
    expect(knowledgeReadDoc).toHaveBeenCalledWith('spc_test01', 'doc_alpha')
  })
})
