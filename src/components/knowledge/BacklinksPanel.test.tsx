// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BacklinksPanel } from './BacklinksPanel'

const getKnowledgeBacklinks = vi.fn()
const getKnowledgeBrokenOutboundCount = vi.fn()

vi.mock('@/store/knowledgeStore', () => ({
  useKnowledgeStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      nodes: [
        {
          id: 'doc_a',
          parentId: null,
          kind: 'doc',
          title: 'Alpha',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'doc_b',
          parentId: null,
          kind: 'doc',
          title: 'Beta',
          order: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      saveState: 'idle',
      indexStatus: 'ready',
      draftBody: '',
      docBody: '',
    }),
  getKnowledgeBacklinks: (...a: unknown[]) => getKnowledgeBacklinks(...a),
  getKnowledgeBrokenOutboundCount: (...a: unknown[]) =>
    getKnowledgeBrokenOutboundCount(...a),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number; title?: string }) => {
      if (key === 'knowledge.backlinks.brokenCount' && opts?.count != null) {
        return `${opts.count} broken`
      }
      if (key === 'knowledge.backlinks.openHint' && opts?.title) {
        return `Open ${opts.title}`
      }
      return key
    },
  }),
}))

describe('BacklinksPanel', () => {
  beforeEach(() => {
    getKnowledgeBacklinks.mockReset()
    getKnowledgeBrokenOutboundCount.mockReset()
    getKnowledgeBacklinks.mockReturnValue([])
    getKnowledgeBrokenOutboundCount.mockReturnValue(0)
  })

  it('shows empty state when no backlinks', () => {
    render(
      <BacklinksPanel spaceId="spc_1" docId="doc_b" onOpenDoc={vi.fn()} />,
    )
    expect(screen.getByTestId('knowledge-backlinks-empty')).toBeTruthy()
    expect(screen.queryByTestId('knowledge-backlinks-broken')).toBeNull()
  })

  it('lists backlinks and navigates on click', () => {
    getKnowledgeBacklinks.mockReturnValue([
      {
        fromSpaceId: 'spc_1',
        fromDocId: 'doc_a',
        toSpaceId: 'spc_1',
        toDocId: 'doc_b',
        title: 'Beta',
        broken: false,
      },
    ])
    const onOpen = vi.fn()
    render(
      <BacklinksPanel spaceId="spc_1" docId="doc_b" onOpenDoc={onOpen} />,
    )
    expect(screen.getByTestId('knowledge-backlinks-count').textContent).toBe('1')
    const item = screen.getByTestId('knowledge-backlink-item')
    expect(item.textContent).toContain('Alpha')
    fireEvent.click(item)
    expect(onOpen).toHaveBeenCalledWith('doc_a')
  })

  it('shows broken outbound badge', () => {
    getKnowledgeBrokenOutboundCount.mockReturnValue(2)
    render(
      <BacklinksPanel spaceId="spc_1" docId="doc_a" onOpenDoc={vi.fn()} />,
    )
    expect(screen.getByTestId('knowledge-backlinks-broken').textContent).toContain(
      '2 broken',
    )
  })
})
