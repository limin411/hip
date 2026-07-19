// @vitest-environment happy-dom
/**
 * Thin CI lock for paper overflow (Live/Source).
 * Design risk: Live/Source need overflow-hidden on the paper surface.
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { KNOWLEDGE_LIVE_FLAG_KEY } from '@/domain/knowledge/editorMode'
import type { EditorMode } from '@/domain/knowledge/editorMode'
import { KnowledgeWorkspace } from './KnowledgeWorkspace'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('./SpaceTree', () => ({
  SpaceTree: () => <div data-testid="mock-space-tree" />,
}))

vi.mock('./DocEditor', async () => {
  const { forwardRef } = await import('react')
  return {
    DocEditor: forwardRef(function MockDocEditor() {
      return <div data-testid="knowledge-doc-editor" />
    }),
  }
})

vi.mock('./DocLiveEditor', () => ({
  DocLiveEditor: () => <div data-testid="knowledge-doc-live-editor" />,
}))

vi.mock('./MarkdownToolbar', () => ({
  MarkdownToolbar: () => <div data-testid="knowledge-md-toolbar" />,
}))

vi.mock('@/ipc/dialog', () => ({
  pickAttachmentFiles: vi.fn(),
  pickSavePath: vi.fn(),
}))

vi.mock('@/ipc/knowledge', () => ({
  knowledgeErrorMessage: (e: unknown) => String(e),
  knowledgeExportDoc: vi.fn(),
  knowledgeExportSpaceZip: vi.fn(),
  knowledgeRevealDoc: vi.fn(),
}))

function seedWorkspace(editorMode: EditorMode) {
  useKnowledgeStore.setState({
    loaded: true,
    spaces: [{ id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 }],
    activeSpaceId: 'spc_1',
    nodes: [
      {
        id: 'doc_1',
        parentId: null,
        kind: 'doc',
        title: 'Note',
        order: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    activeDocId: 'doc_1',
    treeFocusId: 'doc_1',
    docBody: '# hi',
    draftBody: '# hi',
    editorMode,
    mode: 'workspace',
    searchQuery: '',
    searchHits: [],
    indexStatus: 'idle',
    spaceDocCounts: { spc_1: 1 },
    recent: [],
    expandedFolderIds: {},
    busy: false,
    error: null,
    saveState: 'idle',
  })
}

describe('KnowledgeWorkspace paper overflow contract', () => {
  beforeEach(() => {
    localStorage.setItem(KNOWLEDGE_LIVE_FLAG_KEY, 'true')
  })

  afterEach(() => {
    cleanup()
    localStorage.removeItem(KNOWLEDGE_LIVE_FLAG_KEY)
  })

  it('Source paper uses overflow-hidden', () => {
    seedWorkspace('source')
    render(<KnowledgeWorkspace />)
    const paper = screen.getByTestId('knowledge-doc-paper')
    expect(paper.className).toContain('overflow-hidden')
    expect(paper.className).not.toContain('overflow-visible')
    expect(screen.getByTestId('knowledge-doc-canvas')).toBeInTheDocument()
  })

  it('Live paper uses overflow-hidden', () => {
    seedWorkspace('live')
    render(<KnowledgeWorkspace />)
    const paper = screen.getByTestId('knowledge-doc-paper')
    expect(paper.className).toContain('overflow-hidden')
    expect(paper.className).not.toContain('overflow-visible')
    expect(screen.queryByTestId('knowledge-edit-toggle')).toBeNull()
  })
})
