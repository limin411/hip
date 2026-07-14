// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { DocReader } from './DocReader'

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

vi.mock('@tauri-apps/plugin-shell', () => ({
  open: vi.fn(),
}))

// Avoid chat CodeBlock → context-menu → sessionService graph in unit tests.
vi.mock('@/components/chat/CodeBlock', () => ({
  CodeBlock: ({ children }: { children?: React.ReactNode }) => (
    <pre data-testid="mock-code">{children}</pre>
  ),
}))

afterEach(() => cleanup())

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
    expect(onWikiNavigate).toHaveBeenCalledWith('doc_alpha')
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
