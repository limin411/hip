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
    useUiStore.setState({ knowledgePanelOpen: true })
    useKnowledgeStore.setState({
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
