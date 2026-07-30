// @vitest-environment happy-dom
/**
 * PR-3: board route shell — no Milkdown on board; dispatcher routes leave/snapshot.
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import {
  useKnowledgeStore,
  registerBeforeOpenDocFlush,
  syncActiveEditorToDraft,
} from '@/store/knowledgeStore'
import { EMPTY_BOARD_SCENE_JSON } from '@/domain/knowledge/boardScene'
import { KNOWLEDGE_LIVE_FLAG_KEY } from '@/domain/knowledge/editorMode'
import { KnowledgeWorkspace } from './KnowledgeWorkspace'
import type { HipBoardCanvasHandle } from './HipBoardCanvas'

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
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    DocEditor: forwardRef(function MockDocEditor(
      _props: unknown,
      ref: React.ForwardedRef<{ getView: () => null }>,
    ) {
      useImperativeHandle(ref, () => ({ getView: () => null }))
      return <div data-testid="knowledge-doc-editor" />
    }),
  }
})

const liveFlushDraft = vi.fn()

vi.mock('./DocLiveEditor', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    DocLiveEditor: forwardRef(function MockDocLiveEditor(
      _props: unknown,
      ref: React.ForwardedRef<{ flushDraft: () => void }>,
    ) {
      useImperativeHandle(ref, () => ({
        insertMarkdown: () => true,
        focus: () => true,
        flushDraft: () => liveFlushDraft(),
      }))
      return <div data-testid="knowledge-doc-live-editor" />
    }),
  }
})

const boardFlushToStore = vi.fn()
const boardCanvasHandleRef = createRef<HipBoardCanvasHandle>()

vi.mock('./HipBoardCanvas', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    HipBoardCanvas: forwardRef(function MockBoardCanvas(
      props: { boardId: string; spaceId: string; initialJson: string },
      ref: React.ForwardedRef<HipBoardCanvasHandle>,
    ) {
      const handle: HipBoardCanvasHandle = {
        flushToStore: (opts) => boardFlushToStore(opts),
        exportPngBlob: async () => null,
        isReady: () => true,
        resumeEditing: () => {},
        selectAndScrollTo: () => {},
        applyStylePatch: () => {},
        updateText: () => {},
        getCamera: () => ({ x: 0, y: 0, zoom: 1 }),
        getTool: () => 'select' as const,
        getSelectedIds: () => [],
        getElements: () => [],
        getFilesRel: () => ({}),
        getHistoryPastLength: () => 0,
        undo: () => {},
        redo: () => {},
      }
      useImperativeHandle(ref, () => handle)
      // Keep a side-channel for assertions if needed
      ;(boardCanvasHandleRef as { current: HipBoardCanvasHandle | null }).current = handle
      return (
        <div
          data-testid="knowledge-board-canvas"
          data-board-id={props.boardId}
          data-initial-len={props.initialJson.length}
        />
      )
    }),
  }
})

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
  knowledgeExportText: vi.fn(),
  knowledgeExportSpaceZip: vi.fn(),
  knowledgeReadVersion: vi.fn(),
  knowledgeRevealDoc: vi.fn(),
  knowledgeRevealPath: vi.fn(),
}))

function seedBoardWorkspace() {
  useKnowledgeStore.setState({
    loaded: true,
    spaces: [{ id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 }],
    activeSpaceId: 'spc_1',
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
      {
        id: 'doc_1',
        parentId: null,
        kind: 'doc',
        title: 'Note',
        order: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    activeDocId: 'brd_board000001',
    treeFocusId: 'brd_board000001',
    docBody: EMPTY_BOARD_SCENE_JSON,
    draftBody: EMPTY_BOARD_SCENE_JSON,
    editorMode: 'live',
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

function seedDocWorkspace() {
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
    editorMode: 'live',
    mode: 'workspace',
    activeViewId: null,
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

describe('KnowledgeWorkspace board route shell', () => {
  beforeEach(() => {
    localStorage.setItem(KNOWLEDGE_LIVE_FLAG_KEY, 'true')
    liveFlushDraft.mockClear()
    boardFlushToStore.mockClear()
    registerBeforeOpenDocFlush(null)
  })

  afterEach(() => {
    cleanup()
    registerBeforeOpenDocFlush(null)
    localStorage.removeItem(KNOWLEDGE_LIVE_FLAG_KEY)
  })

  it('mounts HipBoardCanvas for board leaf and does not mount Milkdown', () => {
    seedBoardWorkspace()
    render(<KnowledgeWorkspace />)
    expect(screen.getByTestId('knowledge-board-canvas')).toBeInTheDocument()
    expect(screen.queryByTestId('knowledge-doc-live-editor')).toBeNull()
    expect(screen.queryByTestId('knowledge-doc-editor')).toBeNull()
    expect(screen.queryByTestId('knowledge-doc-menu')).toBeNull()
  })

  it('empty workspace shows secondary New Whiteboard action', () => {
    seedDocWorkspace()
    useKnowledgeStore.setState({ activeDocId: null, treeFocusId: null })
    render(<KnowledgeWorkspace />)
    expect(screen.getByTestId('knowledge-empty-new-board')).toBeInTheDocument()
    expect(screen.getByTestId('knowledge-empty-new-board').textContent).toContain(
      'knowledge.tree.newBoard',
    )
  })

  it('dispatcher routes board flush with leave/snapshot modes (KD-9/13)', () => {
    seedBoardWorkspace()
    render(<KnowledgeWorkspace />)
    // Workspace registered the hook; invoke the same path store uses.
    syncActiveEditorToDraft({ leaveActiveLeaf: true })
    expect(boardFlushToStore).toHaveBeenCalledWith({ mode: 'leave' })
    boardFlushToStore.mockClear()
    syncActiveEditorToDraft({ leaveActiveLeaf: false })
    expect(boardFlushToStore).toHaveBeenCalledWith({ mode: 'snapshot' })
    expect(liveFlushDraft).not.toHaveBeenCalled()
  })

  it('dispatcher routes Live flushDraft for docs (not board)', async () => {
    seedDocWorkspace()
    render(<KnowledgeWorkspace />)
    await waitFor(() => {
      expect(screen.getByTestId('knowledge-doc-live-editor')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('knowledge-board-canvas')).toBeNull()
    syncActiveEditorToDraft({ leaveActiveLeaf: true })
    expect(liveFlushDraft).toHaveBeenCalled()
    expect(boardFlushToStore).not.toHaveBeenCalled()
  })
})
