// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { useUiStore } from '@/store/uiStore'
import { KnowledgeOutlinePanel } from './KnowledgeOutlinePanel'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
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

  it('shows board companion rail (structure + selection + stats), not empty placeholder', () => {
    useKnowledgeStore.setState({
      activeDocId: 'brd_board000001',
      nodes: [
        {
          id: 'brd_board000001',
          parentId: null,
          kind: 'board',
          title: 'Arch',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      draftBody:
        '{"type":"hip-board","version":1,"source":"hip","elements":[],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}',
      docBody:
        '{"type":"hip-board","version":1,"source":"hip","elements":[],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}',
      backlinks: [],
      outboundLinks: [],
      linkPanelStatus: 'idle',
      boardOutline: {
        boardId: 'brd_board000001',
        items: [
          {
            id: 'r1',
            type: 'rect',
            label: 'rect r1',
            depth: 0,
            locked: false,
            order: 0,
          },
        ],
        totalElements: 1,
        truncated: false,
        imageCount: 0,
      },
      boardSelection: {
        boardId: 'brd_board000001',
        ids: [],
        items: [],
        style: {},
      },
    })
    render(<KnowledgeOutlinePanel />)
    expect(screen.queryByTestId('knowledge-outline-board-empty')).toBeNull()
    expect(screen.getByTestId('knowledge-board-companion')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-board-structure-list')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-board-selection-empty')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-board-stats')).toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-outline-section')).toBeNull()
    expect(screen.queryByTestId('knowledge-doc-outline')).toBeNull()
    expect(screen.getByTestId('panel-title').textContent).toBe('knowledge.board.panelTitle')
  })

  it('structure click requests board focus', () => {
    const requestBoardFocus = vi.fn()
    useKnowledgeStore.setState({
      activeDocId: 'brd_board000001',
      nodes: [
        {
          id: 'brd_board000001',
          parentId: null,
          kind: 'board',
          title: 'Arch',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      draftBody: '',
      docBody: '',
      boardOutline: {
        boardId: 'brd_board000001',
        items: [
          {
            id: 'r1',
            type: 'rect',
            label: 'rect r1',
            depth: 0,
            locked: false,
            order: 0,
          },
        ],
        totalElements: 1,
        truncated: false,
        imageCount: 0,
      },
      boardSelection: {
        boardId: 'brd_board000001',
        ids: ['r1'],
        items: [
          {
            id: 'r1',
            type: 'rect',
            label: 'rect r1',
            depth: 0,
            locked: false,
            order: 0,
          },
        ],
        style: { fill: '#ffffff', stroke: '#111111', strokeWidth: 2 },
      },
      requestBoardFocus,
    })
    render(<KnowledgeOutlinePanel />)
    fireEvent.click(screen.getByTestId('knowledge-board-structure-item-r1'))
    expect(requestBoardFocus).toHaveBeenCalledWith(['r1'], { scroll: true })
    expect(screen.getByTestId('knowledge-board-structure-item-r1')).toHaveAttribute(
      'aria-current',
      'true',
    )
    expect(screen.getByTestId('knowledge-board-style-fill')).toBeInTheDocument()
  })

  it('renders outline items and requests jump on click', () => {
    const requestOutlineJump = vi.fn()
    useKnowledgeStore.setState({
      activeDocId: 'doc_1',
      draftBody: '# Hello\n\n## Nested\n',
      docBody: '# Hello\n\n## Nested\n',
      backlinks: [],
      outboundLinks: [],
      linkPanelStatus: 'ready',
      requestOutlineJump,
    })
    render(<KnowledgeOutlinePanel />)
    expect(screen.getByTestId('knowledge-doc-outline')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-backlinks-section')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('knowledge-doc-outline-item-nested'))
    expect(requestOutlineJump).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'nested', level: 2, text: 'Nested', line: 3 }),
    )
  })

  it('lists backlinks and opens source on click', () => {
    const openDoc = vi.fn().mockResolvedValue(undefined)
    useKnowledgeStore.setState({
      activeDocId: 'doc_1',
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
      linkPanelStatus: 'ready',
      openDoc,
    })
    render(<KnowledgeOutlinePanel />)
    fireEvent.click(screen.getByTestId('knowledge-backlink-item'))
    expect(openDoc).toHaveBeenCalledWith('doc_other')
  })

  it('close button collapses the knowledge panel', () => {
    render(<KnowledgeOutlinePanel />)
    fireEvent.click(screen.getByTestId('knowledge-outline-panel-close'))
    expect(useUiStore.getState().knowledgePanelOpen).toBe(false)
  })
})
