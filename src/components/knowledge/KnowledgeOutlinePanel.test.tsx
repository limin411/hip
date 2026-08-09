// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useUiStore } from '@/store/uiStore'
import { KnowledgeOutlinePanel } from './KnowledgeOutlinePanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) =>
      opts?.count != null ? `${key}:${opts.count}` : key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

describe('KnowledgeOutlinePanel', () => {
  beforeEach(() => {
    useUiStore.setState({
      activeView: 'knowledge',
      knowledgePanelOpen: true,
    })
    useKnowledgeStore.setState({
      mode: 'workspace',
      activeDocId: null,
      nodes: [],
      draftBody: '',
      docBody: '',
      backlinks: [],
      outboundLinks: [],
      linkPanelStatus: 'idle',
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('shows no-doc hint when no document is open', () => {
    render(<KnowledgeOutlinePanel />)
    expect(screen.getByTestId('knowledge-outline-panel')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-doc-outline-no-doc')).toBeInTheDocument()
  })

  it('renders outline items and requests jump on click', () => {
    const requestOutlineJump = vi.fn()
    useKnowledgeStore.setState({
      activeDocId: 'doc_1',
      nodes: [
        {
          id: 'doc_1',
          parentId: null,
          kind: 'doc',
          title: 'Hello',
          order: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      draftBody: '# Hello\n\n## Nested\n',
      docBody: '# Hello\n\n## Nested\n',
      backlinks: [],
      outboundLinks: [],
      linkPanelStatus: 'ready',
      requestOutlineJump,
    })
    render(<KnowledgeOutlinePanel />)
    expect(screen.getByTestId('knowledge-doc-outline')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-backlink-panel')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('knowledge-doc-outline-item-nested'))
    expect(requestOutlineJump).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'nested', level: 2, text: 'Nested', line: 3 }),
    )
  })

  it('lists backlinks in the tabbed panel and opens source on click', () => {
    const openDoc = vi.fn().mockResolvedValue(undefined)
    useKnowledgeStore.setState({
      activeDocId: 'doc_1',
      activeSpaceId: 'spc_1',
      spaces: [{ id: 'spc_1', name: 'S', createdAt: 0, updatedAt: 0 }],
      nodes: [
        {
          id: 'doc_1',
          parentId: null,
          kind: 'doc',
          title: 'Hello',
          order: 0,
          createdAt: 0,
          updatedAt: 0,
        },
        {
          id: 'doc_other',
          parentId: null,
          kind: 'doc',
          title: 'Other',
          order: 1,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      draftBody: '# Hello\n',
      docBody: '# Hello\n',
      backlinks: [
        {
          fromDocId: 'doc_other',
          fromTitle: 'Other',
          raw: '[[Hello]]',
          kind: 'wiki',
          fragment: null,
        },
      ],
      outboundLinks: [],
      brokenLinks: [],
      linkPanelStatus: 'ready',
      openDoc,
    })
    render(<KnowledgeOutlinePanel />)
    fireEvent.click(screen.getByTestId('knowledge-backlink-row-doc_other-[[Hello]]'))
    expect(openDoc).toHaveBeenCalledWith('doc_other')
  })

  it('shows doc stats (words + backlinks) stacked below the broken-links section', () => {
    useKnowledgeStore.setState({
      activeDocId: 'doc_1',
      nodes: [
        {
          id: 'doc_1',
          parentId: null,
          kind: 'doc',
          title: 'Hello',
          order: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      draftBody: 'a b c',
      docBody: 'a b c',
      backlinks: [
        {
          fromDocId: 'doc_a',
          fromTitle: 'A',
          raw: '[[Hello]]',
          kind: 'wiki',
          fragment: null,
        },
      ],
      outboundLinks: [],
      linkPanelStatus: 'ready',
    })
    render(<KnowledgeOutlinePanel />)
    const footer = screen.getByTestId('knowledge-panel-doc-stats')
    expect(footer).toBeInTheDocument()
    // 正文 3 个词。
    expect(screen.getByTestId('knowledge-doc-word-count')).toHaveTextContent(
      'knowledge.doc.wordCount:3',
    )
    expect(screen.queryByTestId('knowledge-doc-backlink-count')).not.toBeInTheDocument()
  })

  it('omits the stats and refresh when no doc is open', () => {
    render(<KnowledgeOutlinePanel />)
    expect(screen.queryByTestId('knowledge-panel-doc-stats')).not.toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-backlink-refresh')).not.toBeInTheDocument()
  })

  it('refreshes the link panel from the panel header', () => {
    const refreshLinkPanel = vi
      .spyOn(useKnowledgeStore.getState(), 'refreshLinkPanel')
      .mockResolvedValue(undefined)
    useKnowledgeStore.setState({
      activeDocId: 'doc_1',
      nodes: [
        {
          id: 'doc_1',
          parentId: null,
          kind: 'doc',
          title: 'Hello',
          order: 0,
          createdAt: 0,
          updatedAt: 0,
        },
      ],
      draftBody: 'a',
      docBody: 'a',
      backlinks: [],
      outboundLinks: [],
      linkPanelStatus: 'ready',
    })
    render(<KnowledgeOutlinePanel />)
    fireEvent.click(screen.getByTestId('knowledge-backlink-refresh'))
    expect(refreshLinkPanel).toHaveBeenCalled()
  })

  it('close button collapses the knowledge panel', () => {
    render(<KnowledgeOutlinePanel />)
    fireEvent.click(screen.getByTestId('knowledge-outline-panel-close'))
    expect(useUiStore.getState().knowledgePanelOpen).toBe(false)
  })
})
