// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const knowledgeReadDoc = vi.fn()
const knowledgeWriteDoc = vi.fn()
const knowledgeReadBoard = vi.fn()
const knowledgeWriteBoard = vi.fn()
const knowledgeGetTree = vi.fn()
const knowledgeEnsureRoot = vi.fn()
const knowledgeListSpaces = vi.fn()
const knowledgeDeleteSpace = vi.fn()
const knowledgeSoftDeleteSpace = vi.fn()
const knowledgeSoftDeleteNodes = vi.fn()
const knowledgeReconcileTrash = vi.fn()
const knowledgePurgeExpiredTrash = vi.fn()
const knowledgeListTrash = vi.fn()
const knowledgeSaveTree = vi.fn()
const knowledgeListTemplates = vi.fn()
const knowledgeSaveTemplate = vi.fn()
const knowledgeDeleteTemplate = vi.fn()
const knowledgeSaveVersion = vi.fn()
const knowledgeListVersions = vi.fn()
const knowledgeReadVersion = vi.fn()
const knowledgeRestoreVersion = vi.fn()
const knowledgeCreateSpace = vi.fn()
const knowledgeUpdateSpace = vi.fn()
const knowledgeLinkIndexUpsert = vi.fn()
const knowledgeLinkIndexRemoveDoc = vi.fn()

const EXPANDED_KEY = 'hip-knowledge-expanded-v1'

vi.mock('@/ipc/knowledge', () => ({
  knowledgeEnsureRoot: (...a: unknown[]) => knowledgeEnsureRoot(...a),
  knowledgeListSpaces: (...a: unknown[]) => knowledgeListSpaces(...a),
  knowledgeCreateSpace: (...a: unknown[]) => knowledgeCreateSpace(...a),
  knowledgeUpdateSpace: (...a: unknown[]) => knowledgeUpdateSpace(...a),
  knowledgeDeleteSpace: (...a: unknown[]) => knowledgeDeleteSpace(...a),
  knowledgeSoftDeleteSpace: (...a: unknown[]) => knowledgeSoftDeleteSpace(...a),
  knowledgeSoftDeleteNodes: (...a: unknown[]) => knowledgeSoftDeleteNodes(...a),
  knowledgeReconcileTrash: (...a: unknown[]) => knowledgeReconcileTrash(...a),
  knowledgePurgeExpiredTrash: (...a: unknown[]) => knowledgePurgeExpiredTrash(...a),
  knowledgeListTrash: (...a: unknown[]) => knowledgeListTrash(...a),
  knowledgeGetTree: (...a: unknown[]) => knowledgeGetTree(...a),
  knowledgeSaveTree: (...a: unknown[]) => knowledgeSaveTree(...a),
  knowledgeReadDoc: (...a: unknown[]) => knowledgeReadDoc(...a),
  knowledgeWriteDoc: (...a: unknown[]) => knowledgeWriteDoc(...a),
  knowledgeReadBoard: (...a: unknown[]) => knowledgeReadBoard(...a),
  knowledgeWriteBoard: (...a: unknown[]) => knowledgeWriteBoard(...a),
  knowledgeDeleteDocFile: vi.fn(),
  knowledgeDeleteBoardFile: vi.fn(),
  knowledgeListTemplates: (...a: unknown[]) => knowledgeListTemplates(...a),
  knowledgeSaveTemplate: (...a: unknown[]) => knowledgeSaveTemplate(...a),
  knowledgeDeleteTemplate: (...a: unknown[]) => knowledgeDeleteTemplate(...a),
  knowledgeSaveVersion: (...a: unknown[]) => knowledgeSaveVersion(...a),
  knowledgeListVersions: (...a: unknown[]) => knowledgeListVersions(...a),
  knowledgeReadVersion: (...a: unknown[]) => knowledgeReadVersion(...a),
  knowledgeRestoreVersion: (...a: unknown[]) => knowledgeRestoreVersion(...a),
  knowledgeLinkIndexUpsert: (...a: unknown[]) => knowledgeLinkIndexUpsert(...a),
  knowledgeLinkIndexRemoveDoc: (...a: unknown[]) => knowledgeLinkIndexRemoveDoc(...a),
  knowledgeLinkIndexReplaceAll: vi.fn().mockResolvedValue(undefined),
  knowledgeLinkIndexBacklinks: vi.fn().mockResolvedValue([]),
  knowledgeLinkIndexOutbound: vi.fn().mockResolvedValue([]),
  knowledgeLinkIndexBroken: vi.fn().mockResolvedValue([]),
  knowledgeLinkIndexDocCount: vi.fn().mockResolvedValue(0),
  knowledgeGetSchema: vi.fn().mockResolvedValue(null),
  knowledgeSetSchema: vi.fn().mockResolvedValue(undefined),
  knowledgeGetViews: vi.fn().mockResolvedValue(null),
  knowledgeSetViews: vi.fn().mockResolvedValue(undefined),
  knowledgeErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string, opts?: { name?: string }) =>
      opts?.name ? `${key}:${opts.name}` : key,
  },
}))

import { toast } from 'sonner'
import {
  EMPTY_BOARD_SCENE_JSON,
  stableSerializeBoard,
} from '@/domain/knowledge/boardScene'
import {
  listKnowledgeDocsForWiki,
  registerBeforeOpenDocFlush,
  registerOnBoardFlushAbort,
  setExpandPersistSuspended,
  syncActiveEditorToDraft,
  useKnowledgeStore,
  __resetBoardSessionFlagsForTests,
  __legacyPreserveRawHasForTests,
  __pendingUpgradeRetryHasForTests,
  __bumpOpenDocGenerationForTests,
} from './knowledgeStore'

describe('knowledgeStore openDoc editorMode default', () => {
  beforeEach(() => {
    knowledgeReadDoc.mockReset()
    knowledgeWriteDoc.mockReset()
    knowledgeGetTree.mockReset()
    knowledgeEnsureRoot.mockReset()
    knowledgeListSpaces.mockReset()
    knowledgeDeleteSpace.mockReset()
    localStorage.removeItem('hip-knowledge-live')
    localStorage.removeItem('hip-knowledge-editor-mode')
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
      activeDocId: null,
      docBody: '',
      draftBody: '',
      editorMode: 'preview',
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
  })

  it('openDoc sets editorMode live by default (所见即所得 / product-on)', async () => {
    knowledgeReadDoc.mockResolvedValueOnce('# hello')
    await useKnowledgeStore.getState().openDoc('doc_1')
    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBe('doc_1')
    expect(s.docBody).toBe('# hello')
    expect(s.draftBody).toBe('# hello')
    expect(s.editorMode).toBe('live')
    expect(knowledgeReadDoc).toHaveBeenCalledWith('spc_1', 'doc_1')
  })

  it('openDoc sets editorMode source when live flag explicitly off', async () => {
    localStorage.setItem('hip-knowledge-live', 'false')
    knowledgeReadDoc.mockResolvedValueOnce('# hello')
    await useKnowledgeStore.getState().openDoc('doc_1')
    expect(useKnowledgeStore.getState().editorMode).toBe('source')
  })

  it('openDoc always opens Live even when a prior source pref is stored', async () => {
    localStorage.setItem('hip-knowledge-editor-mode', 'source')
    knowledgeReadDoc.mockResolvedValueOnce('# hello')
    await useKnowledgeStore.getState().openDoc('doc_1')
    expect(useKnowledgeStore.getState().editorMode).toBe('live')
  })

  it('openDoc forces source when live on but body is large', async () => {
    const { KNOWLEDGE_LARGE_DOC_CHARS } = await import('@/domain/knowledge/limits')
    const big = 'y'.repeat(KNOWLEDGE_LARGE_DOC_CHARS + 10)
    knowledgeReadDoc.mockResolvedValueOnce(big)
    await useKnowledgeStore.getState().openDoc('doc_1')
    expect(useKnowledgeStore.getState().editorMode).toBe('source')
    expect(useKnowledgeStore.getState().docBody.length).toBe(big.length)
    expect(toast.message).toHaveBeenCalled()
  })
})

describe('knowledgeStore deleteSpace', () => {
  beforeEach(() => {
    knowledgeWriteDoc.mockReset()
    knowledgeDeleteSpace.mockReset()
    knowledgeSoftDeleteSpace.mockReset()
    knowledgeSoftDeleteSpace.mockResolvedValue(undefined)
    knowledgeReconcileTrash.mockResolvedValue(0)
    knowledgePurgeExpiredTrash.mockResolvedValue([])
    knowledgeListTrash.mockResolvedValue([])
    knowledgeGetTree.mockReset()
    knowledgeGetTree.mockResolvedValue({ version: 1, nodes: [] })
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [
        { id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 },
        { id: 'spc_2', name: 'T', createdAt: 1, updatedAt: 1 },
      ],
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
      docBody: 'saved',
      draftBody: 'dirty-unsaved',
      editorMode: 'source',
      mode: 'workspace',
      searchQuery: '',
      searchHits: [],
      indexStatus: 'ready',
      spaceDocCounts: { spc_1: 1, spc_2: 0 },
      recent: [
        {
          spaceId: 'spc_1',
          docId: 'doc_1',
          title: 'Note',
          spaceName: 'S',
          at: 1,
        },
      ],
      expandedFolderIds: {},
      busy: false,
      error: null,
      saveState: 'idle',
    })
  })

  it('flushes dirty draft then clears workspace then soft-deletes (KD-14)', async () => {
    knowledgeWriteDoc.mockResolvedValueOnce(undefined)
    knowledgeSaveVersion.mockResolvedValue(undefined)
    useKnowledgeStore.setState({
      pendingReveal: { query: 'q', spaceId: 'spc_1', docId: 'doc_1' },
    })
    await useKnowledgeStore.getState().deleteSpace('spc_1')
    const s = useKnowledgeStore.getState()
    expect(knowledgeWriteDoc).toHaveBeenCalledWith('spc_1', 'doc_1', 'dirty-unsaved')
    expect(knowledgeSoftDeleteSpace).toHaveBeenCalledWith('spc_1')
    // Write before soft-delete.
    const writeOrder = knowledgeWriteDoc.mock.invocationCallOrder[0]
    const delOrder = knowledgeSoftDeleteSpace.mock.invocationCallOrder[0]
    expect(writeOrder).toBeLessThan(delOrder)
    expect(s.mode).toBe('home')
    expect(s.activeSpaceId).toBeNull()
    expect(s.activeDocId).toBeNull()
    expect(s.nodes).toEqual([])
    expect(s.spaces.map((x) => x.id)).toEqual(['spc_2'])
    expect(s.recent).toEqual([])
    expect(s.busy).toBe(false)
    expect(s.pendingReveal).toBeNull()
  })

  it('aborts soft-delete when flush fails and stays in workspace', async () => {
    knowledgeWriteDoc.mockRejectedValueOnce(new Error('disk full'))
    await useKnowledgeStore.getState().deleteSpace('spc_1')
    const s = useKnowledgeStore.getState()
    expect(knowledgeSoftDeleteSpace).not.toHaveBeenCalled()
    expect(s.mode).toBe('workspace')
    expect(s.activeSpaceId).toBe('spc_1')
    expect(s.activeDocId).toBe('doc_1')
    expect(s.draftBody).toBe('dirty-unsaved')
    expect(s.saveState).toBe('error')
    expect(s.busy).toBe(false)
  })

  it('deletes non-active space without flush or mode change', async () => {
    useKnowledgeStore.setState({
      activeSpaceId: 'spc_2',
      mode: 'workspace',
      activeDocId: null,
      draftBody: '',
      docBody: '',
    })
    knowledgeWriteDoc.mockClear()
    await useKnowledgeStore.getState().deleteSpace('spc_1')
    const s = useKnowledgeStore.getState()
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    expect(s.mode).toBe('workspace')
    expect(s.activeSpaceId).toBe('spc_2')
    expect(s.spaces.map((x) => x.id)).toEqual(['spc_2'])
  })
})

describe('knowledgeStore space name uniqueness', () => {
  beforeEach(() => {
    knowledgeCreateSpace.mockReset()
    knowledgeUpdateSpace.mockReset()
    vi.mocked(toast.error).mockClear()
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [
        { id: 'spc_1', name: '产品', createdAt: 1, updatedAt: 1 },
        { id: 'spc_2', name: 'Notes', createdAt: 1, updatedAt: 1 },
      ],
      activeSpaceId: null,
      nodes: [],
      activeDocId: null,
      docBody: '',
      draftBody: '',
      editorMode: 'preview',
      mode: 'home',
      searchQuery: '',
      searchHits: [],
      indexStatus: 'idle',
      spaceDocCounts: { spc_1: 0, spc_2: 0 },
      recent: [],
      expandedFolderIds: {},
      busy: false,
      error: null,
      saveState: 'idle',
    })
  })

  it('createSpace rejects duplicate names without IPC', async () => {
    const space = await useKnowledgeStore.getState().createSpace('  产品  ')
    expect(space).toBeNull()
    expect(knowledgeCreateSpace).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().error).toBe('knowledge.space.nameDuplicate:产品')
    expect(toast.error).toHaveBeenCalled()
  })

  it('createSpace rejects case-insensitive Latin duplicates', async () => {
    const space = await useKnowledgeStore.getState().createSpace('notes')
    expect(space).toBeNull()
    expect(knowledgeCreateSpace).not.toHaveBeenCalled()
  })

  it('createSpace allows a new unique name', async () => {
    knowledgeCreateSpace.mockResolvedValueOnce({
      id: 'spc_3',
      name: '新空间',
      createdAt: 2,
      updatedAt: 2,
    })
    const space = await useKnowledgeStore.getState().createSpace('新空间')
    expect(space?.id).toBe('spc_3')
    expect(knowledgeCreateSpace).toHaveBeenCalledWith('新空间', undefined)
    expect(useKnowledgeStore.getState().spaces).toHaveLength(3)
  })

  it('renameSpace rejects collision with another space', async () => {
    const ok = await useKnowledgeStore.getState().renameSpace('spc_2', '产品')
    expect(ok).toBe(false)
    expect(knowledgeUpdateSpace).not.toHaveBeenCalled()
  })

  it('renameSpace allows keeping the same name', async () => {
    knowledgeUpdateSpace.mockResolvedValueOnce({
      id: 'spc_1',
      name: '产品',
      createdAt: 1,
      updatedAt: 3,
    })
    const ok = await useKnowledgeStore.getState().renameSpace('spc_1', '产品')
    expect(ok).toBe(true)
    expect(knowledgeUpdateSpace).toHaveBeenCalledWith('spc_1', {
      name: '产品',
      icon: undefined,
    })
  })
})

describe('knowledgeStore flush-abort navigation', () => {
  const docA = {
    id: 'doc_a',
    parentId: null,
    kind: 'doc' as const,
    title: 'A',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  }
  const docB = {
    id: 'doc_b',
    parentId: null,
    kind: 'doc' as const,
    title: 'B',
    order: 1,
    createdAt: 1,
    updatedAt: 1,
  }

  beforeEach(() => {
    knowledgeReadDoc.mockReset()
    knowledgeWriteDoc.mockReset()
    knowledgeGetTree.mockReset()
    vi.mocked(toast.error).mockClear()
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [
        { id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 },
        { id: 'spc_2', name: 'T', createdAt: 1, updatedAt: 1 },
      ],
      activeSpaceId: 'spc_1',
      nodes: [docA, docB],
      activeDocId: 'doc_a',
      docBody: 'saved-a',
      draftBody: 'dirty-a',
      editorMode: 'source',
      mode: 'workspace',
      searchQuery: '',
      searchHits: [],
      indexStatus: 'idle',
      spaceDocCounts: { spc_1: 2, spc_2: 0 },
      recent: [],
      expandedFolderIds: {},
      busy: false,
      error: null,
      saveState: 'idle',
    })
  })

  it('openDoc aborts when flushSave fails and keeps activeDocId', async () => {
    knowledgeWriteDoc.mockRejectedValueOnce(new Error('disk full'))
    knowledgeReadDoc.mockResolvedValue('# b')

    await useKnowledgeStore.getState().openDoc('doc_b')

    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBe('doc_a')
    expect(s.draftBody).toBe('dirty-a')
    expect(s.docBody).toBe('saved-a')
    expect(s.saveState).toBe('error')
    expect(knowledgeReadDoc).not.toHaveBeenCalled()
    expect(knowledgeWriteDoc).toHaveBeenCalledWith('spc_1', 'doc_a', 'dirty-a')
  })

  it('openDoc switches after successful flush', async () => {
    knowledgeWriteDoc.mockResolvedValueOnce(undefined)
    knowledgeReadDoc.mockResolvedValueOnce('# b')

    await useKnowledgeStore.getState().openDoc('doc_b')

    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBe('doc_b')
    expect(s.docBody).toBe('# b')
    expect(s.draftBody).toBe('# b')
    expect(knowledgeWriteDoc).toHaveBeenCalledWith('spc_1', 'doc_a', 'dirty-a')
    expect(knowledgeReadDoc).toHaveBeenCalledWith('spc_1', 'doc_b')
  })

  it('openDoc same id is a no-op (no read / no write)', async () => {
    knowledgeReadDoc.mockClear()
    knowledgeWriteDoc.mockClear()
    useKnowledgeStore.setState({ draftBody: 'saved-a', docBody: 'saved-a' })

    await useKnowledgeStore.getState().openDoc('doc_a')

    expect(knowledgeReadDoc).not.toHaveBeenCalled()
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().activeDocId).toBe('doc_a')
  })

  it('openDoc clean switch skips flushSave write (no write IPC)', async () => {
    knowledgeWriteDoc.mockClear()
    knowledgeReadDoc.mockResolvedValueOnce('# b-clean')
    useKnowledgeStore.setState({ draftBody: 'saved-a', docBody: 'saved-a' })

    await useKnowledgeStore.getState().openDoc('doc_b')

    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    expect(knowledgeReadDoc).toHaveBeenCalledWith('spc_1', 'doc_b')
    expect(useKnowledgeStore.getState().draftBody).toBe('# b-clean')
  })

  it('openSpace aborts when flush fails and leaves prior space', async () => {
    knowledgeWriteDoc.mockRejectedValueOnce(new Error('write failed'))
    knowledgeGetTree.mockResolvedValue({ version: 1, nodes: [] })

    await useKnowledgeStore.getState().openSpace('spc_2')

    const s = useKnowledgeStore.getState()
    expect(s.activeSpaceId).toBe('spc_1')
    expect(s.activeDocId).toBe('doc_a')
    expect(s.mode).toBe('workspace')
    expect(s.draftBody).toBe('dirty-a')
    expect(s.saveState).toBe('error')
    expect(knowledgeGetTree).not.toHaveBeenCalled()
  })

  it('openSpace switches after successful flush', async () => {
    knowledgeWriteDoc.mockResolvedValueOnce(undefined)
    knowledgeGetTree.mockResolvedValueOnce({
      version: 1,
      nodes: [
        {
          id: 'doc_t',
          parentId: null,
          kind: 'doc',
          title: 'T',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    await useKnowledgeStore.getState().openSpace('spc_2')

    const s = useKnowledgeStore.getState()
    expect(s.activeSpaceId).toBe('spc_2')
    expect(s.mode).toBe('workspace')
    expect(s.activeDocId).toBeNull()
    expect(knowledgeWriteDoc).toHaveBeenCalledWith('spc_1', 'doc_a', 'dirty-a')
    expect(knowledgeGetTree).toHaveBeenCalledWith('spc_2')
  })

  it('openHome aborts when flush fails and stays in workspace', async () => {
    knowledgeWriteDoc.mockRejectedValueOnce(new Error('write failed'))

    await useKnowledgeStore.getState().openHome()

    const s = useKnowledgeStore.getState()
    expect(s.mode).toBe('workspace')
    expect(s.activeSpaceId).toBe('spc_1')
    expect(s.activeDocId).toBe('doc_a')
    expect(s.draftBody).toBe('dirty-a')
    expect(s.saveState).toBe('error')
  })

  it('openHome leaves workspace after successful flush', async () => {
    knowledgeWriteDoc.mockResolvedValueOnce(undefined)

    await useKnowledgeStore.getState().openHome()

    const s = useKnowledgeStore.getState()
    expect(s.mode).toBe('home')
    expect(s.activeSpaceId).toBeNull()
    expect(s.activeDocId).toBeNull()
    expect(knowledgeWriteDoc).toHaveBeenCalledWith('spc_1', 'doc_a', 'dirty-a')
  })
})

describe('knowledgeStore setDraftBody persist modes', () => {
  beforeEach(() => {
    knowledgeWriteDoc.mockReset()
    knowledgeWriteDoc.mockResolvedValue(undefined)
    vi.useFakeTimers()
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
      docBody: 'saved',
      draftBody: 'saved',
      editorMode: 'preview',
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
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to auto for legacy preview (writable Live surface)', async () => {
    useKnowledgeStore.getState().setDraftBody('preview-dirty')
    expect(useKnowledgeStore.getState().draftBody).toBe('preview-dirty')
    await vi.advanceTimersByTimeAsync(500)
    expect(knowledgeWriteDoc).toHaveBeenCalledWith('spc_1', 'doc_1', 'preview-dirty')
    expect(useKnowledgeStore.getState().docBody).toBe('preview-dirty')
  })

  it('defaults to auto in source mode (schedules flush)', async () => {
    useKnowledgeStore.setState({ editorMode: 'source' })
    useKnowledgeStore.getState().setDraftBody('edited')
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(knowledgeWriteDoc).toHaveBeenCalledWith('spc_1', 'doc_1', 'edited')
    expect(useKnowledgeStore.getState().docBody).toBe('edited')
    expect(useKnowledgeStore.getState().saveState).toBe('saved')
  })

  it('defaults to auto in live mode (schedules flush)', async () => {
    useKnowledgeStore.setState({ editorMode: 'live' })
    useKnowledgeStore.getState().setDraftBody('live-edit')
    await vi.advanceTimersByTimeAsync(500)
    expect(knowledgeWriteDoc).toHaveBeenCalledWith('spc_1', 'doc_1', 'live-edit')
    expect(useKnowledgeStore.getState().docBody).toBe('live-edit')
  })

  it('persist now flushes immediately even in preview', async () => {
    useKnowledgeStore.getState().setDraftBody('- [x] task', { persist: 'now' })
    // Drain saveChain: setDraftBody fire-and-forgets flushSave; chaining awaits completion.
    await useKnowledgeStore.getState().flushSave()
    expect(knowledgeWriteDoc).toHaveBeenCalledWith('spc_1', 'doc_1', '- [x] task')
    expect(useKnowledgeStore.getState().docBody).toBe('- [x] task')
    expect(useKnowledgeStore.getState().draftBody).toBe('- [x] task')
  })

  it('persist none skips schedule even in source mode', async () => {
    useKnowledgeStore.setState({ editorMode: 'source' })
    useKnowledgeStore.getState().setDraftBody('no-save', { persist: 'none' })
    await vi.advanceTimersByTimeAsync(600)
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().draftBody).toBe('no-save')
    expect(useKnowledgeStore.getState().docBody).toBe('saved')
  })

  it('persist none cancels a pending auto schedule', async () => {
    useKnowledgeStore.setState({ editorMode: 'source' })
    useKnowledgeStore.getState().setDraftBody('a') // schedules autosave
    useKnowledgeStore.getState().setDraftBody('b', { persist: 'none' })
    await vi.advanceTimersByTimeAsync(600)
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().draftBody).toBe('b')
    expect(useKnowledgeStore.getState().docBody).toBe('saved')
  })

  it('ignores setDraftBody when docId does not match activeDocId (cross-doc guard)', () => {
    useKnowledgeStore.setState({
      activeDocId: 'doc_1',
      draftBody: 'body-of-doc-1',
      editorMode: 'live',
    })
    // Simulate Live unmount for a previous doc after tree switch already moved activeDocId.
    useKnowledgeStore.getState().setDraftBody('STALE-FROM-OTHER-DOC', {
      docId: 'doc_other',
      persist: 'none',
    })
    expect(useKnowledgeStore.getState().draftBody).toBe('body-of-doc-1')
  })

  it('accepts setDraftBody when docId matches activeDocId', () => {
    useKnowledgeStore.setState({
      activeDocId: 'doc_1',
      draftBody: 'old',
      editorMode: 'live',
    })
    useKnowledgeStore.getState().setDraftBody('fresh', {
      docId: 'doc_1',
      persist: 'none',
    })
    expect(useKnowledgeStore.getState().draftBody).toBe('fresh')
  })
})

describe('knowledgeStore openDoc generation (rapid switch)', () => {
  beforeEach(() => {
    knowledgeWriteDoc.mockReset()
    knowledgeReadDoc.mockReset()
    knowledgeWriteDoc.mockResolvedValue(undefined)
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [{ id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 }],
      activeSpaceId: 'spc_1',
      nodes: [
        {
          id: 'doc_a',
          parentId: null,
          kind: 'doc',
          title: 'A',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'doc_b',
          parentId: null,
          kind: 'doc',
          title: 'B',
          order: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'doc_c',
          parentId: null,
          kind: 'doc',
          title: 'C',
          order: 2,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeDocId: 'doc_a',
      docBody: '# a',
      draftBody: '# a',
      editorMode: 'live',
      mode: 'workspace',
      searchQuery: '',
      searchHits: [],
      indexStatus: 'idle',
      spaceDocCounts: { spc_1: 3 },
      recent: [],
      expandedFolderIds: {},
      busy: false,
      error: null,
      saveState: 'idle',
    })
  })

  it('flushSave phase write resolves before daily version IPC', async () => {
    let resolveDaily!: () => void
    const dailyP = new Promise<void>((r) => {
      resolveDaily = r
    })
    knowledgeWriteDoc.mockResolvedValue(undefined)
    knowledgeSaveVersion.mockImplementation(() => dailyP as never)

    useKnowledgeStore.setState({
      activeDocId: 'doc_a',
      docBody: 'saved',
      draftBody: 'dirty-write-phase',
      editorMode: 'live',
      saveState: 'idle',
    })

    const writeDone = useKnowledgeStore.getState().flushSave({ phase: 'write' })
    // Write gate must not wait for daily snapshot.
    await expect(writeDone).resolves.toBe(true)
    expect(knowledgeWriteDoc).toHaveBeenCalledWith(
      'spc_1',
      'doc_a',
      'dirty-write-phase',
    )
    expect(useKnowledgeStore.getState().docBody).toBe('dirty-write-phase')

    resolveDaily()
    // Drain full chain so the suite does not leak pending work.
    await useKnowledgeStore.getState().flushSave()
  })

  it('stale openDoc result does not overwrite a newer open', async () => {
    let resolveB!: (v: string) => void
    let resolveC!: (v: string) => void
    const pB = new Promise<string>((r) => {
      resolveB = r
    })
    const pC = new Promise<string>((r) => {
      resolveC = r
    })
    knowledgeReadDoc.mockImplementation(async (_space: string, id: string) => {
      if (id === 'doc_b') return pB
      if (id === 'doc_c') return pC
      return '# a'
    })

    const openB = useKnowledgeStore.getState().openDoc('doc_b')
    const openC = useKnowledgeStore.getState().openDoc('doc_c')

    // C finishes first (user's last click), then B returns late.
    resolveC('# c-body')
    await openC
    expect(useKnowledgeStore.getState().activeDocId).toBe('doc_c')
    expect(useKnowledgeStore.getState().draftBody).toBe('# c-body')

    resolveB('# b-body-STALE')
    await openB
    // Must still be C — B must not cross into the buffer.
    expect(useKnowledgeStore.getState().activeDocId).toBe('doc_c')
    expect(useKnowledgeStore.getState().draftBody).toBe('# c-body')
    expect(useKnowledgeStore.getState().docBody).toBe('# c-body')
  })
})

describe('knowledgeStore setEditorMode', () => {
  beforeEach(() => {
    knowledgeWriteDoc.mockReset()
    knowledgeWriteDoc.mockResolvedValue(undefined)
    localStorage.removeItem('hip-knowledge-live')
    localStorage.removeItem('hip-knowledge-editor-mode')
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
      docBody: 'saved',
      draftBody: 'dirty',
      editorMode: 'source',
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
  })

  it('setEditorMode preview normalizes to live (deprecated writing mode)', async () => {
    await useKnowledgeStore.getState().setEditorMode('preview')
    // No flush-to-enter-preview path; preview is not a writing surface.
    expect(useKnowledgeStore.getState().editorMode).toBe('live')
    expect(localStorage.getItem('hip-knowledge-editor-mode')).toBe('live')
  })

  it('leaving legacy preview state reseeds draft from docBody', async () => {
    useKnowledgeStore.setState({
      editorMode: 'preview',
      docBody: 'on-disk',
      draftBody: 'stale-preview',
    })
    await useKnowledgeStore.getState().setEditorMode('source')
    expect(useKnowledgeStore.getState().editorMode).toBe('source')
    expect(useKnowledgeStore.getState().draftBody).toBe('on-disk')
    expect(localStorage.getItem('hip-knowledge-editor-mode')).toBe('source')
  })

  it('clamps live to source when flag is explicitly off', async () => {
    localStorage.setItem('hip-knowledge-live', 'false')
    await useKnowledgeStore.getState().setEditorMode('live')
    expect(useKnowledgeStore.getState().editorMode).toBe('source')
  })

  it('allows live when flag is on (product default)', async () => {
    await useKnowledgeStore.getState().setEditorMode('live')
    expect(useKnowledgeStore.getState().editorMode).toBe('live')
    expect(localStorage.getItem('hip-knowledge-editor-mode')).toBe('live')
  })

  it('live ↔ source keeps dirty draft (no silent reseed)', async () => {
    vi.useFakeTimers()
    useKnowledgeStore.setState({
      editorMode: 'source',
      docBody: 'saved',
      draftBody: 'dirty-in-source',
    })
    // Pending autosave window — mode switch must not discard draft.
    useKnowledgeStore.getState().setDraftBody('dirty-in-source')
    await useKnowledgeStore.getState().setEditorMode('live')
    expect(useKnowledgeStore.getState().editorMode).toBe('live')
    expect(useKnowledgeStore.getState().draftBody).toBe('dirty-in-source')
    expect(useKnowledgeStore.getState().docBody).toBe('saved')
    // Autosave still lands after switch.
    await vi.advanceTimersByTimeAsync(500)
    expect(knowledgeWriteDoc).toHaveBeenCalledWith('spc_1', 'doc_1', 'dirty-in-source')
    expect(useKnowledgeStore.getState().docBody).toBe('dirty-in-source')
    vi.useRealTimers()
  })

  it('setEditorMode live clamps to source when body exceeds large-doc threshold', async () => {
    const { KNOWLEDGE_LARGE_DOC_CHARS } = await import('@/domain/knowledge/limits')
    const big = 'x'.repeat(KNOWLEDGE_LARGE_DOC_CHARS + 1)
    useKnowledgeStore.setState({
      editorMode: 'source',
      docBody: big,
      draftBody: big,
    })
    await useKnowledgeStore.getState().setEditorMode('live')
    expect(useKnowledgeStore.getState().editorMode).toBe('source')
  })
})

describe('knowledgeStore loadSpaces early hydrate (cold-start counts)', () => {
  beforeEach(() => {
    knowledgeReadDoc.mockReset()
    knowledgeGetTree.mockReset()
    knowledgeEnsureRoot.mockReset()
    knowledgeListSpaces.mockReset()
    knowledgeEnsureRoot.mockResolvedValue(undefined)
    knowledgeListSpaces.mockResolvedValue([
      { id: 'spc_1', name: 'Notes', createdAt: 1, updatedAt: 1 },
      { id: 'spc_2', name: 'Wiki', createdAt: 1, updatedAt: 1 },
    ])
    knowledgeGetTree.mockImplementation(async (spaceId: string) => {
      if (spaceId === 'spc_1') {
        return {
          version: 1,
          nodes: [
            {
              id: 'doc_a',
              parentId: null,
              kind: 'doc',
              title: 'A',
              order: 0,
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: 'doc_b',
              parentId: null,
              kind: 'doc',
              title: 'B',
              order: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        }
      }
      return {
        version: 1,
        nodes: [
          {
            id: 'doc_c',
            parentId: null,
            kind: 'doc',
            title: 'C',
            order: 0,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }
    })
    knowledgeReadDoc.mockResolvedValue('body')
    useKnowledgeStore.setState({
      loaded: false,
      spaces: [],
      activeSpaceId: null,
      nodes: [],
      activeDocId: null,
      docBody: '',
      draftBody: '',
      editorMode: 'preview',
      mode: 'home',
      searchQuery: '',
      searchHits: [],
      indexStatus: 'idle',
      indexProgress: null,
      pendingReveal: null,
      spaceDocCounts: {},
      recent: [],
      expandedFolderIds: {},
      busy: false,
      error: null,
      saveState: 'idle',
    })
  })

  it('loadSpaces hydrates spaces from IPC without requiring Knowledge enter', async () => {
    expect(useKnowledgeStore.getState().spaces).toEqual([])
    expect(useKnowledgeStore.getState().loaded).toBe(false)

    await useKnowledgeStore.getState().loadSpaces()

    const s = useKnowledgeStore.getState()
    expect(s.loaded).toBe(true)
    expect(s.spaces).toHaveLength(2)
    expect(s.spaces.map((sp) => sp.id)).toEqual(['spc_1', 'spc_2'])
    expect(knowledgeEnsureRoot).toHaveBeenCalled()
    expect(knowledgeListSpaces).toHaveBeenCalled()
    // Same fields the sidebar badge reads (spaces.length).
    expect(s.spaces.length > 0 ? s.spaces.length : undefined).toBe(2)
  })

  it('loadSpaces kicks rebuild so spaceDocCounts fill from trees (before index ready finishes)', async () => {
    // Slow body reads so we can observe tree-derived counts mid-build.
    let releaseBodies!: () => void
    const bodyGate = new Promise<void>((resolve) => {
      releaseBodies = resolve
    })
    knowledgeReadDoc.mockImplementation(async () => {
      await bodyGate
      return 'body'
    })

    const loadPromise = useKnowledgeStore.getState().loadSpaces()

    // Wait until tree-derived counts land (index may still be building).
    await vi.waitFor(() => {
      const s = useKnowledgeStore.getState()
      expect(s.spaces).toHaveLength(2)
      expect(s.spaceDocCounts).toEqual({ spc_1: 2, spc_2: 1 })
    })

    // Counts available while bodies still pending (index not ready yet).
    expect(useKnowledgeStore.getState().indexStatus).not.toBe('ready')

    releaseBodies()
    await loadPromise
    await vi.waitFor(() => {
      expect(useKnowledgeStore.getState().indexStatus).toBe('ready')
    })
    expect(useKnowledgeStore.getState().spaceDocCounts).toEqual({ spc_1: 2, spc_2: 1 })
  })
})

describe('knowledgeStore index progress + openSearchHit', () => {
  beforeEach(() => {
    knowledgeReadDoc.mockReset()
    knowledgeGetTree.mockReset()
    knowledgeEnsureRoot.mockReset()
    knowledgeListSpaces.mockReset()
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [
        { id: 'spc_1', name: 'S1', createdAt: 1, updatedAt: 1 },
        { id: 'spc_2', name: 'S2', createdAt: 1, updatedAt: 1 },
      ],
      activeSpaceId: null,
      nodes: [],
      activeDocId: null,
      docBody: '',
      draftBody: '',
      editorMode: 'preview',
      mode: 'home',
      searchQuery: '',
      searchHits: [],
      indexStatus: 'idle',
      indexProgress: null,
      pendingReveal: null,
      spaceDocCounts: {},
      recent: [],
      expandedFolderIds: {},
      busy: false,
      error: null,
      saveState: 'idle',
    })
  })

  it('rebuildSearchIndex reports progress n/N then clears', async () => {
    knowledgeGetTree.mockImplementation(async (spaceId: string) => {
      if (spaceId === 'spc_1') {
        return {
          version: 1,
          nodes: [
            {
              id: 'doc_a',
              parentId: null,
              kind: 'doc',
              title: 'A',
              order: 0,
              createdAt: 1,
              updatedAt: 1,
            },
            {
              id: 'doc_b',
              parentId: null,
              kind: 'doc',
              title: 'B',
              order: 1,
              createdAt: 1,
              updatedAt: 1,
            },
          ],
        }
      }
      return {
        version: 1,
        nodes: [
          {
            id: 'doc_c',
            parentId: null,
            kind: 'doc',
            title: 'C',
            order: 0,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      }
    })
    knowledgeReadDoc.mockResolvedValue('body token_xyz')

    const progressSamples: Array<{ done: number; total: number } | null> = []
    const unsub = useKnowledgeStore.subscribe((s) => {
      if (s.indexStatus === 'building' && s.indexProgress) {
        progressSamples.push({ done: s.indexProgress.done, total: s.indexProgress.total })
      }
    })

    await useKnowledgeStore.getState().rebuildSearchIndex()
    unsub()

    const s = useKnowledgeStore.getState()
    expect(s.indexStatus).toBe('ready')
    expect(s.indexProgress).toBeNull()
    expect(s.spaceDocCounts).toEqual({ spc_1: 2, spc_2: 1 })
    // At least one sample with total=3
    expect(progressSamples.some((p) => p && p.total === 3)).toBe(true)
    expect(progressSamples.some((p) => p && p.done === 3)).toBe(true)
  })

  it('openSearchHit sets pendingReveal scoped to space/doc', async () => {
    knowledgeGetTree.mockResolvedValue({
      version: 1,
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
    })
    knowledgeReadDoc.mockResolvedValue('hello match_token world')
    useKnowledgeStore.setState({ searchQuery: '  match_token  ' })

    await useKnowledgeStore.getState().openSearchHit({
      spaceId: 'spc_1',
      docId: 'doc_1',
      title: 'Note',
      spaceName: 'S1',
      path: 'Note',
      score: 1,
    })

    const s = useKnowledgeStore.getState()
    expect(s.pendingReveal).toEqual({
      query: 'match_token',
      spaceId: 'spc_1',
      docId: 'doc_1',
    })
    expect(s.activeDocId).toBe('doc_1')
    expect(s.mode).toBe('workspace')
  })

  it('clearPendingReveal clears the flag', () => {
    useKnowledgeStore.setState({
      pendingReveal: { query: 'x', spaceId: 'spc_1', docId: 'doc_1' },
    })
    useKnowledgeStore.getState().clearPendingReveal()
    expect(useKnowledgeStore.getState().pendingReveal).toBeNull()
  })

  it('openHome clears pendingReveal', async () => {
    useKnowledgeStore.setState({
      mode: 'workspace',
      activeSpaceId: 'spc_1',
      activeDocId: 'doc_1',
      pendingReveal: { query: 'old', spaceId: 'spc_1', docId: 'doc_1' },
    })
    await useKnowledgeStore.getState().openHome()
    expect(useKnowledgeStore.getState().pendingReveal).toBeNull()
    expect(useKnowledgeStore.getState().mode).toBe('home')
  })

  it('failed openDoc clears pendingReveal', async () => {
    useKnowledgeStore.setState({
      activeSpaceId: 'spc_1',
      mode: 'workspace',
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
      pendingReveal: { query: 'q', spaceId: 'spc_1', docId: 'doc_1' },
    })
    knowledgeReadDoc.mockRejectedValueOnce(new Error('missing'))
    await useKnowledgeStore.getState().openDoc('doc_1')
    expect(useKnowledgeStore.getState().pendingReveal).toBeNull()
    expect(useKnowledgeStore.getState().activeDocId).toBeNull()
  })

  it('openDoc to a different doc clears pendingReveal', async () => {
    useKnowledgeStore.setState({
      activeSpaceId: 'spc_1',
      mode: 'workspace',
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
        {
          id: 'doc_2',
          parentId: null,
          kind: 'doc',
          title: 'Other',
          order: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      pendingReveal: { query: 'q', spaceId: 'spc_1', docId: 'doc_1' },
    })
    knowledgeReadDoc.mockResolvedValueOnce('other body')
    await useKnowledgeStore.getState().openDoc('doc_2')
    expect(useKnowledgeStore.getState().activeDocId).toBe('doc_2')
    expect(useKnowledgeStore.getState().pendingReveal).toBeNull()
  })

  it('deleteNode of active doc clears pendingReveal', async () => {
    knowledgeSoftDeleteNodes.mockReset()
    knowledgeSoftDeleteNodes.mockResolvedValue(['tentry_1'])
    knowledgeSaveTree.mockResolvedValue(undefined)
    useKnowledgeStore.setState({
      activeSpaceId: 'spc_1',
      mode: 'workspace',
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
      docBody: 'saved',
      draftBody: 'saved',
      editorMode: 'source',
      pendingReveal: { query: 'q', spaceId: 'spc_1', docId: 'doc_1' },
      spaceDocCounts: { spc_1: 1 },
      busy: false,
    })
    await useKnowledgeStore.getState().deleteNode('doc_1')
    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBeNull()
    expect(s.pendingReveal).toBeNull()
  })

  it('superseded rebuild does not publish stale kbIndex or final ready from old gen', async () => {
    knowledgeGetTree.mockResolvedValue({
      version: 1,
      nodes: [
        {
          id: 'doc_a',
          parentId: null,
          kind: 'doc',
          title: 'A',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })

    let releaseA: (() => void) | null = null
    const stallA = new Promise<string>((resolve) => {
      releaseA = () => resolve('body-from-A')
    })
    let readCalls = 0
    knowledgeReadDoc.mockImplementation(async () => {
      readCalls += 1
      if (readCalls === 1) return stallA
      return 'body-from-B'
    })

    const pA = useKnowledgeStore.getState().rebuildSearchIndex()
    // Let A start and hit the stall
    await Promise.resolve()
    await Promise.resolve()

    // Start B while A is stalled
    const pB = useKnowledgeStore.getState().rebuildSearchIndex()
    await pB

    const afterB = useKnowledgeStore.getState()
    expect(afterB.indexStatus).toBe('ready')
    expect(afterB.indexProgress).toBeNull()

    // Release stale A; it must not clobber ready/progress
    releaseA!()
    await pA

    const afterA = useKnowledgeStore.getState()
    expect(afterA.indexStatus).toBe('ready')
    expect(afterA.indexProgress).toBeNull()
  })
})

describe('knowledgeStore frontmatter facets + filters', () => {
  beforeEach(() => {
    knowledgeReadDoc.mockReset()
    knowledgeGetTree.mockReset()
    knowledgeEnsureRoot.mockReset()
    knowledgeListSpaces.mockReset()
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [{ id: 'spc_1', name: 'S1', createdAt: 1, updatedAt: 1 }],
      activeSpaceId: null,
      nodes: [],
      activeDocId: null,
      docBody: '',
      draftBody: '',
      editorMode: 'preview',
      mode: 'home',
      searchQuery: '',
      searchHits: [],
      indexStatus: 'idle',
      indexProgress: null,
      pendingReveal: null,
      spaceDocCounts: {},
      availableTags: [],
      availableStatuses: [],
      filterTag: null,
      filterStatus: null,
      recent: [],
      expandedFolderIds: {},
      busy: false,
      error: null,
      saveState: 'idle',
    })
  })

  it('rebuild populates availableTags and filterTag lists matching docs', async () => {
    knowledgeGetTree.mockResolvedValue({
      version: 1,
      nodes: [
        {
          id: 'doc_a',
          parentId: null,
          kind: 'doc',
          title: 'Design',
          order: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'doc_b',
          parentId: null,
          kind: 'doc',
          title: 'Ops',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })
    knowledgeReadDoc.mockImplementation(async (_spaceId: string, docId: string) => {
      if (docId === 'doc_a') {
        return `---
tags: [design]
status: draft
aliases: [KB]
---
design body
`
      }
      return `---
tags: [ops]
---
ops body
`
    })

    await useKnowledgeStore.getState().rebuildSearchIndex()
    const s = useKnowledgeStore.getState()
    expect(s.indexStatus).toBe('ready')
    expect(s.availableTags).toEqual(expect.arrayContaining(['design', 'ops']))
    expect(s.availableStatuses).toContain('draft')

    useKnowledgeStore.getState().setFilterTag('design')
    const filtered = useKnowledgeStore.getState()
    expect(filtered.filterTag).toBe('design')
    expect(filtered.searchHits.map((h) => h.docId)).toEqual(['doc_a'])
  })

  it('clears stale filterTag when facets no longer include it', async () => {
    knowledgeGetTree.mockResolvedValue({
      version: 1,
      nodes: [
        {
          id: 'doc_a',
          parentId: null,
          kind: 'doc',
          title: 'Design',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })
    knowledgeReadDoc.mockResolvedValue(`---
tags: [design]
---
body
`)

    await useKnowledgeStore.getState().rebuildSearchIndex()
    useKnowledgeStore.getState().setFilterTag('design')
    expect(useKnowledgeStore.getState().filterTag).toBe('design')
    expect(useKnowledgeStore.getState().searchHits).toHaveLength(1)

    // Rebuild with no frontmatter → facets empty → filter cleared
    knowledgeReadDoc.mockResolvedValue('plain body only')
    await useKnowledgeStore.getState().rebuildSearchIndex()
    const s = useKnowledgeStore.getState()
    expect(s.availableTags).toEqual([])
    expect(s.filterTag).toBeNull()
    expect(s.searchHits).toEqual([])
  })

  it('listKnowledgeDocsForWiki sorts by order then title then id', async () => {
    knowledgeGetTree.mockResolvedValue({
      version: 1,
      nodes: [
        {
          id: 'doc_z',
          parentId: null,
          kind: 'doc',
          title: 'Zed',
          order: 2,
          createdAt: 1,
          updatedAt: 1,
        },
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
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })
    knowledgeReadDoc.mockImplementation(async (_s: string, docId: string) => {
      if (docId === 'doc_a') {
        return `---
aliases: [A1]
---
x
`
      }
      return 'plain'
    })

    await useKnowledgeStore.getState().rebuildSearchIndex()
    const wiki = listKnowledgeDocsForWiki('spc_1')
    expect(wiki.map((d) => d.id)).toEqual(['doc_a', 'doc_b', 'doc_z'])
    expect(wiki[0]?.aliases).toEqual(['A1'])
  })

  it('openHome clears active meta filters', async () => {
    useKnowledgeStore.setState({
      mode: 'workspace',
      activeSpaceId: 'spc_1',
      filterTag: 'design',
      filterStatus: 'draft',
      searchHits: [{ spaceId: 'spc_1', docId: 'x', title: 't', spaceName: 'S', path: 't', score: 0 }],
    })
    await useKnowledgeStore.getState().openHome()
    const s = useKnowledgeStore.getState()
    expect(s.mode).toBe('home')
    expect(s.filterTag).toBeNull()
    expect(s.filterStatus).toBeNull()
    expect(s.searchHits).toEqual([])
  })
})

describe('knowledgeStore expand persist + treeFocusId', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useFakeTimers()
    knowledgeGetTree.mockReset()
    knowledgeWriteDoc.mockReset()
    knowledgeReadDoc.mockReset()
    knowledgeGetTree.mockResolvedValue({
      version: 1,
      nodes: [
        {
          id: 'fld_1',
          parentId: null,
          kind: 'folder',
          title: 'F',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [{ id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 }],
      activeSpaceId: 'spc_1',
      nodes: [
        {
          id: 'fld_1',
          parentId: null,
          kind: 'folder',
          title: 'F',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeDocId: null,
      treeFocusId: null,
      docBody: '',
      draftBody: '',
      editorMode: 'preview',
      mode: 'workspace',
      searchQuery: '',
      searchHits: [],
      indexStatus: 'idle',
      spaceDocCounts: { spc_1: 0 },
      recent: [],
      expandedFolderIds: {},
      busy: false,
      error: null,
      saveState: 'idle',
    })
  })

  afterEach(() => {
    setExpandPersistSuspended(false)
    vi.useRealTimers()
    localStorage.clear()
  })

  it('toggleFolder persists expanded map per space (debounced)', () => {
    useKnowledgeStore.getState().toggleFolder('fld_1')
    expect(useKnowledgeStore.getState().expandedFolderIds.fld_1).toBe(true)
    expect(localStorage.getItem(EXPANDED_KEY)).toBeNull()
    vi.advanceTimersByTime(100)
    const stored = JSON.parse(localStorage.getItem(EXPANDED_KEY)!)
    expect(stored).toEqual({ spc_1: { fld_1: true } })
  })

  it('openSpace restores expanded folders from localStorage and prunes stale ids', async () => {
    localStorage.setItem(
      EXPANDED_KEY,
      JSON.stringify({ spc_1: { fld_1: true, fld_gone: true } }),
    )
    await useKnowledgeStore.getState().openSpace('spc_1')
    const s = useKnowledgeStore.getState()
    expect(s.expandedFolderIds.fld_1).toBe(true)
    expect(s.expandedFolderIds.fld_gone).toBeUndefined()
    expect(s.mode).toBe('workspace')
  })

  it('openSpace does not wipe expand to empty when nothing stored', async () => {
    localStorage.removeItem(EXPANDED_KEY)
    useKnowledgeStore.setState({ expandedFolderIds: { fld_1: true } })
    await useKnowledgeStore.getState().openSpace('spc_1')
    // no stored map → load empty (in-memory map is replaced, not preserved)
    expect(useKnowledgeStore.getState().expandedFolderIds).toEqual({})
  })

  it('setTreeFocusId updates focus without changing activeDocId', () => {
    useKnowledgeStore.setState({ activeDocId: 'doc_1', treeFocusId: null })
    useKnowledgeStore.getState().setTreeFocusId('fld_1')
    expect(useKnowledgeStore.getState().treeFocusId).toBe('fld_1')
    expect(useKnowledgeStore.getState().activeDocId).toBe('doc_1')
  })

  it('does not write another space map when switching before debounce fires', async () => {
    useKnowledgeStore.getState().toggleFolder('fld_1')
    knowledgeGetTree.mockResolvedValueOnce({ version: 1, nodes: [] })
    useKnowledgeStore.setState({
      spaces: [
        { id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 },
        { id: 'spc_2', name: 'T', createdAt: 1, updatedAt: 1 },
      ],
    })
    await useKnowledgeStore.getState().openSpace('spc_2')
    // flush on switch should have written spc_1 with fld_1
    const afterSwitch = JSON.parse(localStorage.getItem(EXPANDED_KEY)!)
    expect(afterSwitch.spc_1).toEqual({ fld_1: true })
    // advance leftover timer: must not overwrite spc_1 with spc_2's empty map
    vi.advanceTimersByTime(100)
    const later = JSON.parse(localStorage.getItem(EXPANDED_KEY)!)
    expect(later.spc_1).toEqual({ fld_1: true })
  })

  it('openDoc expands ancestor folders for treeFocusId', async () => {
    useKnowledgeStore.setState({
      nodes: [
        {
          id: 'fld_1',
          parentId: null,
          kind: 'folder',
          title: 'F',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'doc_nested',
          parentId: 'fld_1',
          kind: 'doc',
          title: 'Nested',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      expandedFolderIds: {},
    })
    knowledgeReadDoc.mockResolvedValueOnce('body')
    await useKnowledgeStore.getState().openDoc('doc_nested')
    const s = useKnowledgeStore.getState()
    expect(s.treeFocusId).toBe('doc_nested')
    expect(s.expandedFolderIds.fld_1).toBe(true)
  })

  it('suspended expand persist skips LS writes (filter mode)', () => {
    setExpandPersistSuspended(true)
    useKnowledgeStore.setState({
      expandedFolderIds: { fld_1: true, fld_filter_only: true },
    })
    useKnowledgeStore.getState().toggleFolder('fld_1')
    vi.advanceTimersByTime(100)
    expect(localStorage.getItem(EXPANDED_KEY)).toBeNull()
    setExpandPersistSuspended(false)
  })

  it('createFolder under parent persists expand', async () => {
    knowledgeSaveTree.mockResolvedValue(undefined)
    await useKnowledgeStore.getState().createFolder('fld_1', 'Child')
    expect(useKnowledgeStore.getState().expandedFolderIds.fld_1).toBe(true)
    vi.advanceTimersByTime(100)
    const stored = JSON.parse(localStorage.getItem(EXPANDED_KEY)!)
    expect(stored.spc_1.fld_1).toBe(true)
  })
})

describe('knowledgeStore templates create flow (no orphans)', () => {
  beforeEach(() => {
    knowledgeWriteDoc.mockReset()
    knowledgeSaveTree.mockReset()
    knowledgeReadDoc.mockReset()
    knowledgeListTemplates.mockReset()
    knowledgeSaveTemplate.mockReset()
    knowledgeDeleteTemplate.mockReset()
    knowledgeWriteDoc.mockResolvedValue(undefined)
    knowledgeSaveTree.mockResolvedValue(undefined)
    knowledgeReadDoc.mockResolvedValue('')
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [{ id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 }],
      activeSpaceId: 'spc_1',
      nodes: [],
      activeDocId: null,
      treeFocusId: null,
      docBody: '',
      draftBody: '',
      editorMode: 'preview',
      mode: 'workspace',
      searchQuery: '',
      searchHits: [],
      indexStatus: 'idle',
      spaceDocCounts: { spc_1: 0 },
      recent: [],
      expandedFolderIds: {},
      templatePicker: null,
      busy: false,
      error: null,
      saveState: 'idle',
    })
  })

  it('requestCreateDoc creates immediately when space has no templates', async () => {
    knowledgeListTemplates.mockResolvedValueOnce([])
    await useKnowledgeStore.getState().requestCreateDoc(null, 'Untitled')
    expect(knowledgeWriteDoc).toHaveBeenCalled()
    expect(useKnowledgeStore.getState().templatePicker).toBeNull()
    expect(useKnowledgeStore.getState().nodes).toHaveLength(1)
  })

  it('requestCreateDoc opens picker without writing when templates exist', async () => {
    knowledgeListTemplates.mockResolvedValueOnce([
      {
        id: 'tpl_meetnotes01',
        name: 'Meeting',
        body: '# Agenda\n',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    await useKnowledgeStore.getState().requestCreateDoc('nod_parent01', 'Untitled')
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    expect(knowledgeSaveTree).not.toHaveBeenCalled()
    const picker = useKnowledgeStore.getState().templatePicker
    expect(picker?.spaceId).toBe('spc_1')
    expect(picker?.parentId).toBe('nod_parent01')
    expect(picker?.templates).toHaveLength(1)
  })

  it('cancelTemplateCreate leaves no doc', async () => {
    knowledgeListTemplates.mockResolvedValueOnce([
      {
        id: 'tpl_meetnotes01',
        name: 'Meeting',
        body: '# Agenda\n',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    await useKnowledgeStore.getState().requestCreateDoc(null, 'Untitled')
    useKnowledgeStore.getState().cancelTemplateCreate()
    expect(useKnowledgeStore.getState().templatePicker).toBeNull()
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().nodes).toHaveLength(0)
    expect(useKnowledgeStore.getState().spaceDocCounts.spc_1).toBe(0)
    expect(useKnowledgeStore.getState().activeDocId).toBeNull()
  })

  it('openSpace clears templatePicker so confirm cannot write into another space', async () => {
    knowledgeListTemplates.mockResolvedValueOnce([
      {
        id: 'tpl_meetnotes01',
        name: 'Meeting',
        body: '# Agenda\n',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    await useKnowledgeStore.getState().requestCreateDoc(null, 'Untitled')
    expect(useKnowledgeStore.getState().templatePicker).not.toBeNull()

    knowledgeGetTree.mockResolvedValueOnce({ version: 1, nodes: [] })
    useKnowledgeStore.setState({
      spaces: [
        { id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 },
        { id: 'spc_2', name: 'T', createdAt: 1, updatedAt: 1 },
      ],
    })
    await useKnowledgeStore.getState().openSpace('spc_2')
    expect(useKnowledgeStore.getState().templatePicker).toBeNull()
    expect(useKnowledgeStore.getState().activeSpaceId).toBe('spc_2')
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
  })

  it('confirmTemplateCreate no-ops when picker spaceId ≠ activeSpaceId', async () => {
    useKnowledgeStore.setState({
      templatePicker: {
        spaceId: 'spc_oldspace01',
        parentId: null,
        defaultTitle: 'Untitled',
        templates: [
          {
            id: 'tpl_meetnotes01',
            name: 'Meeting',
            body: '# Agenda\n',
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
    })
    await useKnowledgeStore.getState().confirmTemplateCreate('tpl_meetnotes01')
    expect(useKnowledgeStore.getState().templatePicker).toBeNull()
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().nodes).toHaveLength(0)
  })

  it('confirmTemplateCreate with template writes body then opens', async () => {
    knowledgeListTemplates.mockResolvedValueOnce([
      {
        id: 'tpl_meetnotes01',
        name: 'Meeting',
        body: '# Agenda\n',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    knowledgeReadDoc.mockResolvedValueOnce('# Agenda\n')
    await useKnowledgeStore.getState().requestCreateDoc(null, 'Untitled')
    await useKnowledgeStore.getState().confirmTemplateCreate('tpl_meetnotes01')
    expect(knowledgeWriteDoc).toHaveBeenCalledWith(
      'spc_1',
      expect.stringMatching(/^doc_/),
      '# Agenda\n',
    )
    expect(useKnowledgeStore.getState().templatePicker).toBeNull()
    expect(useKnowledgeStore.getState().nodes).toHaveLength(1)
  })

  it('confirmTemplateCreate with null uses empty body', async () => {
    knowledgeListTemplates.mockResolvedValueOnce([
      {
        id: 'tpl_meetnotes01',
        name: 'Meeting',
        body: '# Agenda\n',
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    await useKnowledgeStore.getState().requestCreateDoc(null, 'Untitled')
    await useKnowledgeStore.getState().confirmTemplateCreate(null)
    expect(knowledgeWriteDoc).toHaveBeenCalledWith(
      'spc_1',
      expect.stringMatching(/^doc_/),
      '',
    )
  })

  it('saveDocAsTemplate writes current draft', async () => {
    useKnowledgeStore.setState({
      activeDocId: 'doc_1',
      draftBody: '## Notes\n',
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
    })
    knowledgeSaveTemplate.mockResolvedValueOnce({
      id: 'tpl_newtemplate1',
      name: 'Notes',
      body: '## Notes\n',
      createdAt: 2,
      updatedAt: 2,
    })
    const ok = await useKnowledgeStore.getState().saveDocAsTemplate('Notes')
    expect(ok).toBe(true)
    expect(knowledgeSaveTemplate).toHaveBeenCalledWith('spc_1', {
      name: 'Notes',
      body: '## Notes\n',
    })
  })
})

describe('knowledgeStore version snapshots', () => {
  beforeEach(() => {
    knowledgeWriteDoc.mockReset()
    knowledgeWriteDoc.mockResolvedValue(undefined)
    knowledgeSaveVersion.mockReset()
    knowledgeSaveVersion.mockResolvedValue({
      id: 'v1',
      file: 'v1.md',
      createdAt: 1,
      kind: 'daily',
      dayKey: '2026-07-14',
      byteLength: 5,
    })
    knowledgeListVersions.mockReset()
    knowledgeRestoreVersion.mockReset()
    vi.mocked(toast.success).mockClear()
    vi.mocked(toast.error).mockClear()
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
      docBody: 'saved',
      draftBody: 'dirty',
      editorMode: 'source',
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
  })

  it('flushSave awaits daily snapshot after successful write', async () => {
    await useKnowledgeStore.getState().flushSave()
    expect(knowledgeWriteDoc).toHaveBeenCalledWith('spc_1', 'doc_1', 'dirty')
    expect(knowledgeSaveVersion).toHaveBeenCalled()
    const call = knowledgeSaveVersion.mock.calls[0]
    expect(call[0]).toBe('spc_1')
    expect(call[1]).toBe('doc_1')
    expect(call[2]).toBe('daily')
    expect(typeof call[3]).toBe('string')
    expect(call[3]).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('does not daily-snapshot when write fails', async () => {
    knowledgeWriteDoc.mockRejectedValue(new Error('disk full'))
    const ok = await useKnowledgeStore.getState().flushSave()
    expect(ok).toBe(false)
    expect(knowledgeSaveVersion).not.toHaveBeenCalled()
  })

  it('saveVersionManual flushes then creates manual snapshot on chain', async () => {
    // Dirty flush may call daily first; then manual is chained.
    knowledgeSaveVersion.mockImplementation(async (_s, _d, kind: string) => {
      if (kind === 'manual') {
        return {
          id: 'm1',
          file: 'm1.md',
          createdAt: 2,
          kind: 'manual',
          byteLength: 5,
        }
      }
      return {
        id: 'd1',
        file: 'd1.md',
        createdAt: 1,
        kind: 'daily',
        dayKey: '2026-07-14',
        byteLength: 5,
      }
    })
    const entry = await useKnowledgeStore.getState().saveVersionManual()
    expect(entry?.kind).toBe('manual')
    expect(knowledgeWriteDoc).toHaveBeenCalledWith('spc_1', 'doc_1', 'dirty')
    expect(knowledgeSaveVersion).toHaveBeenCalledWith('spc_1', 'doc_1', 'manual')
    // Manual call happens after daily when flush wrote.
    const kinds = knowledgeSaveVersion.mock.calls.map((c) => c[2])
    expect(kinds).toContain('daily')
    expect(kinds[kinds.length - 1]).toBe('manual')
    expect(toast.success).toHaveBeenCalled()
  })

  it('restoreVersion writes body into active buffer', async () => {
    useKnowledgeStore.setState({ draftBody: 'saved', docBody: 'saved' })
    knowledgeRestoreVersion.mockResolvedValueOnce('# restored')
    const ok = await useKnowledgeStore.getState().restoreVersion('v1')
    expect(ok).toBe(true)
    expect(knowledgeRestoreVersion).toHaveBeenCalledWith('spc_1', 'doc_1', 'v1')
    const s = useKnowledgeStore.getState()
    expect(s.docBody).toBe('# restored')
    expect(s.draftBody).toBe('# restored')
  })

  it('listVersions proxies IPC', async () => {
    knowledgeListVersions.mockResolvedValueOnce([
      {
        id: 'v1',
        file: 'v1.md',
        createdAt: 1,
        kind: 'manual',
        byteLength: 1,
      },
    ])
    const list = await useKnowledgeStore.getState().listVersions()
    expect(list).toHaveLength(1)
    expect(knowledgeListVersions).toHaveBeenCalledWith('spc_1', 'doc_1')
  })
})

describe('knowledgeStore board shell (PR-C hip cutover)', () => {
  const emptyScene = EMPTY_BOARD_SCENE_JSON
  const boardNode = {
    id: 'brd_board000001',
    parentId: null as string | null,
    kind: 'board' as const,
    title: 'Sketch',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  }
  const docNode = {
    id: 'doc_doc00000001',
    parentId: null as string | null,
    kind: 'doc' as const,
    title: 'Note',
    order: 1,
    createdAt: 1,
    updatedAt: 1,
  }

  beforeEach(() => {
    __resetBoardSessionFlagsForTests()
    knowledgeReadDoc.mockReset()
    knowledgeWriteDoc.mockReset()
    knowledgeReadBoard.mockReset()
    knowledgeWriteBoard.mockReset()
    knowledgeSaveTree.mockReset()
    knowledgeSoftDeleteNodes.mockReset()
    knowledgeSoftDeleteSpace.mockReset()
    knowledgeSaveVersion.mockReset()
    knowledgeLinkIndexUpsert.mockReset()
    knowledgeLinkIndexRemoveDoc.mockReset()
    knowledgeWriteDoc.mockResolvedValue(undefined)
    knowledgeWriteBoard.mockResolvedValue(undefined)
    knowledgeSaveTree.mockResolvedValue(undefined)
    knowledgeSoftDeleteNodes.mockResolvedValue(['tentry_1'])
    knowledgeSoftDeleteSpace.mockResolvedValue(undefined)
    knowledgeSaveVersion.mockResolvedValue(undefined)
    knowledgeLinkIndexUpsert.mockResolvedValue(undefined)
    knowledgeLinkIndexRemoveDoc.mockResolvedValue(undefined)
    knowledgeReadBoard.mockResolvedValue(emptyScene)
    vi.mocked(toast.error).mockClear()
    vi.mocked(toast.message).mockClear()
    vi.mocked(toast.warning).mockClear()
    registerBeforeOpenDocFlush(null)
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [{ id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 }],
      activeSpaceId: 'spc_1',
      nodes: [boardNode, docNode],
      activeDocId: null,
      docBody: '',
      draftBody: '',
      editorMode: 'live',
      mode: 'workspace',
      searchQuery: '',
      searchHits: [],
      indexStatus: 'ready',
      spaceDocCounts: { spc_1: 1 },
      recent: [],
      expandedFolderIds: {},
      busy: false,
      error: null,
      saveState: 'idle',
      backlinks: [
        {
          fromDocId: 'x',
          fromTitle: 'X',
          raw: 'y',
          kind: 'wiki',
          fragment: null,
        },
      ],
      outboundLinks: [],
      linkPanelStatus: 'ready',
    })
  })

  afterEach(() => {
    registerBeforeOpenDocFlush(null)
  })

  it('createBoard writes hip-board empty scene, does not bump spaceDocCounts, opens board', async () => {
    await useKnowledgeStore.getState().createBoard(null, 'Arch')
    expect(knowledgeWriteBoard).toHaveBeenCalled()
    const [spaceId, boardId, body] = knowledgeWriteBoard.mock.calls[0]
    expect(spaceId).toBe('spc_1')
    expect(String(boardId)).toMatch(/^brd_/)
    expect(body).toBe(emptyScene)
    expect(String(body)).toContain('"type":"hip-board"')
    expect(knowledgeReadDoc).not.toHaveBeenCalled()
    expect(knowledgeReadBoard).toHaveBeenCalledWith('spc_1', boardId)
    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBe(boardId)
    // open stamps hip.boardId so leave serialize is not false-dirty
    expect(s.docBody).toContain('"type":"hip-board"')
    expect(s.docBody).toContain(String(boardId))
    expect(s.draftBody).toBe(s.docBody)
    expect(s.spaceDocCounts.spc_1).toBe(1) // Option B: unchanged
    expect(s.nodes.some((n) => n.id === boardId && n.kind === 'board')).toBe(true)
    expect(knowledgeLinkIndexUpsert).not.toHaveBeenCalled()
  })

  it('openDoc board uses knowledgeReadBoard and skips large-doc / link panel', async () => {
    const huge = emptyScene // size irrelevant; boards skip large-doc path
    knowledgeReadBoard.mockResolvedValueOnce(huge)
    useKnowledgeStore.setState({ editorMode: 'source' })
    await useKnowledgeStore.getState().openDoc('brd_board000001')
    const s = useKnowledgeStore.getState()
    expect(knowledgeReadBoard).toHaveBeenCalledWith('spc_1', 'brd_board000001')
    expect(knowledgeReadDoc).not.toHaveBeenCalled()
    expect(s.activeDocId).toBe('brd_board000001')
    // boardId stamped on open for dirty-check alignment with canvas
    expect(s.docBody).toContain('"type":"hip-board"')
    expect(s.docBody).toContain('brd_board000001')
    expect(s.draftBody).toBe(s.docBody)
    // editorMode left unchanged for boards
    expect(s.editorMode).toBe('source')
    expect(s.backlinks).toEqual([])
    expect(s.linkPanelStatus).toBe('idle')
    expect(toast.message).not.toHaveBeenCalledWith('knowledge.doc.largeDocForceSource')
    expect(knowledgeLinkIndexUpsert).not.toHaveBeenCalled()
    expect(s.recent[0]?.docId).toBe('brd_board000001')
  })

  it('openDoc board does not force source for large body', async () => {
    const { KNOWLEDGE_LARGE_DOC_CHARS } = await import('@/domain/knowledge/limits')
    const big =
      '{"type":"hip-board","version":1,"source":"hip","elements":[],"appState":{},"files":{},"pad":"' +
      'x'.repeat(KNOWLEDGE_LARGE_DOC_CHARS + 10) +
      '"}'
    knowledgeReadBoard.mockResolvedValueOnce(big)
    useKnowledgeStore.setState({ editorMode: 'live' })
    await useKnowledgeStore.getState().openDoc('brd_board000001')
    expect(useKnowledgeStore.getState().editorMode).toBe('live')
    // large pad is not a legacy upgrade toast
    expect(toast.message).not.toHaveBeenCalledWith('knowledge.board.legacyImported')
  })

  it('flushSave dirty board writes via knowledgeWriteBoard and skips version/link', async () => {
    const dirty =
      '{"type":"hip-board","version":1,"source":"hip","elements":[{"id":"e1","type":"rect","x":0,"y":0,"w":10,"h":10,"fill":"#fff","stroke":"#111","strokeWidth":2,"cornerRadius":0}],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}'
    useKnowledgeStore.setState({
      activeDocId: 'brd_board000001',
      docBody: emptyScene,
      draftBody: dirty,
      nodes: [boardNode],
    })
    const ok = await useKnowledgeStore.getState().flushSave()
    expect(ok).toBe(true)
    expect(knowledgeWriteBoard).toHaveBeenCalledWith('spc_1', 'brd_board000001', dirty)
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    expect(knowledgeSaveVersion).not.toHaveBeenCalled()
    expect(knowledgeLinkIndexUpsert).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().docBody).toBe(dirty)
  })

  it('flushSave rejects board draft with files.*.dataURL', async () => {
    const bad = JSON.stringify({
      type: 'hip-board',
      version: 1,
      source: 'hip',
      elements: [],
      appState: {},
      files: { f1: { id: 'f1', mimeType: 'image/png', created: 1, dataURL: 'data:x' } },
    })
    useKnowledgeStore.setState({
      activeDocId: 'brd_board000001',
      docBody: emptyScene,
      draftBody: bad,
      nodes: [boardNode],
    })
    const ok = await useKnowledgeStore.getState().flushSave()
    expect(ok).toBe(false)
    expect(knowledgeWriteBoard).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().saveState).toBe('error')
  })

  it('openDoc abort on dirty board keeps draft when write fails', async () => {
    const dirty =
      '{"type":"hip-board","version":1,"source":"hip","elements":[{"id":"e1"}],"appState":{},"files":{}}'
    useKnowledgeStore.setState({
      activeDocId: 'brd_board000001',
      docBody: emptyScene,
      draftBody: dirty,
      nodes: [boardNode, docNode],
    })
    knowledgeWriteBoard.mockRejectedValueOnce(new Error('disk full'))
    knowledgeReadDoc.mockResolvedValueOnce('# note')
    await useKnowledgeStore.getState().openDoc('doc_doc00000001')
    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBe('brd_board000001')
    expect(s.draftBody).toBe(dirty)
    expect(knowledgeReadDoc).not.toHaveBeenCalled()
  })

  it('openDoc legacy excalidraw upgrades to hip-board and writes primary', async () => {
    const legacy = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'hip',
      elements: [
        {
          id: 'r1',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 40,
          height: 20,
          backgroundColor: '#fff',
          strokeColor: '#111',
          strokeWidth: 2,
        },
      ],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    })
    knowledgeReadBoard.mockResolvedValueOnce(legacy)
    knowledgeWriteBoard.mockReset()
    knowledgeWriteBoard.mockResolvedValue(undefined)
    vi.mocked(toast.message).mockClear()
    await useKnowledgeStore.getState().openDoc('brd_board000001')
    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBe('brd_board000001')
    expect(s.docBody).toContain('"type":"hip-board"')
    expect(s.draftBody).toContain('"type":"hip-board"')
    expect(s.docBody).toContain('"type":"rect"')
    // open upgrade write on saveChain
    await vi.waitFor(() => {
      expect(
        knowledgeWriteBoard.mock.calls.some(
          (c) => c[1] === 'brd_board000001' && String(c[2]).includes('hip-board'),
        ),
      ).toBe(true)
    })
    await vi.waitFor(() => {
      expect(toast.message).toHaveBeenCalledWith('knowledge.board.legacyImported')
    })
    expect(__legacyPreserveRawHasForTests('brd_board000001')).toBe(false)
    expect(__pendingUpgradeRetryHasForTests('brd_board000001')).toBe(false)
  })

  it('openDoc upgrade write failure keeps memory hip, sets pendingUpgradeRetry, no legacy delete side-effect', async () => {
    const legacy = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'hip',
      elements: [
        {
          id: 'r1',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          backgroundColor: '#fff',
          strokeColor: '#000',
          strokeWidth: 1,
        },
      ],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    })
    knowledgeReadBoard.mockResolvedValueOnce(legacy)
    knowledgeWriteBoard.mockRejectedValueOnce(new Error('disk full'))
    await useKnowledgeStore.getState().openDoc('brd_board000001')
    await vi.waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('knowledge.board.legacyUpgradeFailed')
    })
    const s = useKnowledgeStore.getState()
    expect(s.docBody).toContain('"type":"hip-board"')
    expect(s.draftBody).toContain('"type":"hip-board"')
    expect(__pendingUpgradeRetryHasForTests('brd_board000001')).toBe(true)
    // Force retry even when draft===doc
    knowledgeWriteBoard.mockResolvedValueOnce(undefined)
    knowledgeWriteBoard.mockClear()
    const ok = await useKnowledgeStore.getState().flushSave()
    expect(ok).toBe(true)
    expect(knowledgeWriteBoard).toHaveBeenCalledWith(
      'spc_1',
      'brd_board000001',
      s.draftBody,
    )
    expect(__pendingUpgradeRetryHasForTests('brd_board000001')).toBe(false)
  })

  it('unsupported board: flush blocked until confirm', async () => {
    const unsupported = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'hip',
      elements: [
        { id: 'd1', type: 'diamond', x: 0, y: 0, width: 10, height: 10 },
        { id: 'f1', type: 'freedraw', x: 0, y: 0, points: [[0, 0]] },
      ],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    })
    knowledgeReadBoard.mockResolvedValueOnce(unsupported)
    await useKnowledgeStore.getState().openDoc('brd_board000001')
    expect(toast.warning).toHaveBeenCalledWith('knowledge.board.legacyUnsupported')
    expect(__legacyPreserveRawHasForTests('brd_board000001')).toBe(true)
    // Memory is empty hip with boardId stamp; disk not written on open
    const opened = useKnowledgeStore.getState().docBody
    expect(opened).toContain('"type":"hip-board"')
    expect(opened).toContain('brd_board000001')
    expect(opened).toContain('"elements":[]')
    expect(useKnowledgeStore.getState().draftBody).toBe(opened)
    // No upgrade write on unsupported
    expect(
      knowledgeWriteBoard.mock.calls.every((c) => c[1] !== 'brd_board000001'),
    ).toBe(true)

    // Make dirty so flush attempts a write
    const dirty = stableSerializeBoard({
      type: 'hip-board',
      version: 1,
      source: 'hip',
      hip: { schemaVersion: 1, boardId: 'brd_board000001' },
      elements: [
        {
          id: 'r1',
          type: 'rect',
          x: 0,
          y: 0,
          w: 20,
          h: 20,
          fill: '#fff',
          stroke: '#111',
          strokeWidth: 2,
          cornerRadius: 0,
        },
      ],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    })
    useKnowledgeStore.setState({ draftBody: dirty })

    const resume = vi.fn()
    registerOnBoardFlushAbort(resume)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    knowledgeWriteBoard.mockClear()
    const blocked = await useKnowledgeStore.getState().flushSave()
    expect(blocked).toBe(false)
    expect(knowledgeWriteBoard).not.toHaveBeenCalled()
    expect(toast.message).toHaveBeenCalledWith('knowledge.board.legacyWriteBlocked')
    expect(__legacyPreserveRawHasForTests('brd_board000001')).toBe(true)
    expect(resume).toHaveBeenCalled()

    confirmSpy.mockReturnValue(true)
    const allowed = await useKnowledgeStore.getState().flushSave()
    expect(allowed).toBe(true)
    expect(knowledgeWriteBoard).toHaveBeenCalledWith('spc_1', 'brd_board000001', dirty)
    expect(__legacyPreserveRawHasForTests('brd_board000001')).toBe(false)
    confirmSpy.mockRestore()
    registerOnBoardFlushAbort(null)
  })

  it('unsupported leave with no edits does not confirm or write', async () => {
    const unsupported = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'hip',
      elements: [{ id: 'd1', type: 'diamond', x: 0, y: 0, width: 10, height: 10 }],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    })
    knowledgeReadBoard.mockResolvedValueOnce(unsupported)
    await useKnowledgeStore.getState().openDoc('brd_board000001')
    expect(__legacyPreserveRawHasForTests('brd_board000001')).toBe(true)
    const s = useKnowledgeStore.getState()
    expect(s.draftBody).toBe(s.docBody)

    const confirmSpy = vi.spyOn(window, 'confirm')
    knowledgeWriteBoard.mockClear()
    knowledgeReadDoc.mockResolvedValueOnce('# note')
    // leave flush uses leaveActiveLeaf; register a sync that does not change draft
    registerBeforeOpenDocFlush(() => {
      /* canvas would stamp boardId; store already stamped on open */
    })
    await useKnowledgeStore.getState().openDoc('doc_doc00000001')
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(knowledgeWriteBoard).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().activeDocId).toBe('doc_doc00000001')
    confirmSpy.mockRestore()
    registerBeforeOpenDocFlush(null)
  })

  it('open upgrade writes current draft after concurrent edit (not stale migrate body)', async () => {
    const legacy = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'hip',
      elements: [
        {
          id: 'r1',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          backgroundColor: '#fff',
          strokeColor: '#000',
          strokeWidth: 1,
        },
      ],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    })
    let releaseWrite!: (v?: unknown) => void
    const hold = new Promise<void>((res) => {
      releaseWrite = () => res()
    })
    const writtenBodies: string[] = []
    knowledgeReadBoard.mockResolvedValueOnce(legacy)
    knowledgeWriteBoard.mockImplementation(async (_s: string, _id: string, body: string) => {
      writtenBodies.push(body)
      await hold
    })

    const openP = useKnowledgeStore.getState().openDoc('brd_board000001')
    await openP
    await vi.waitFor(() => {
      expect(useKnowledgeStore.getState().activeDocId).toBe('brd_board000001')
    })
    // Wait until upgrade write is in-flight (saveChain started knowledgeWriteBoard)
    await vi.waitFor(() => {
      expect(writtenBodies.length).toBeGreaterThanOrEqual(1)
    })
    const firstAttempt = writtenBodies[0]
    expect(firstAttempt).toContain('"type":"rect"')

    // Concurrent edit while upgrade write is held
    const dirtier = stableSerializeBoard({
      type: 'hip-board',
      version: 1,
      source: 'hip',
      hip: { schemaVersion: 1, boardId: 'brd_board000001' },
      elements: [
        {
          id: 'r1',
          type: 'rect',
          x: 0,
          y: 0,
          w: 10,
          h: 10,
          fill: '#fff',
          stroke: '#000',
          strokeWidth: 1,
          cornerRadius: 0,
        },
        {
          id: 'r2',
          type: 'rect',
          x: 20,
          y: 20,
          w: 30,
          h: 30,
          fill: '#eee',
          stroke: '#111',
          strokeWidth: 2,
          cornerRadius: 0,
        },
      ],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    })
    useKnowledgeStore.getState().setDraftBody(dirtier, {
      docId: 'brd_board000001',
      persist: 'none',
    })
    releaseWrite()
    await vi.waitFor(() => {
      expect(writtenBodies.some((b) => b.includes('r2'))).toBe(true)
    })
    // Must not leave disk as only the first stale body without user strokes.
    const last = writtenBodies[writtenBodies.length - 1]
    expect(last).toContain('r2')
    expect(last).not.toBe(firstAttempt)
    knowledgeWriteBoard.mockReset()
    knowledgeWriteBoard.mockResolvedValue(undefined)
  })

  it('open upgrade gen miss skips write silently', async () => {
    const legacy = JSON.stringify({
      type: 'excalidraw',
      version: 2,
      source: 'hip',
      elements: [
        {
          id: 'r1',
          type: 'rectangle',
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          backgroundColor: '#fff',
          strokeColor: '#000',
          strokeWidth: 1,
        },
      ],
      appState: { viewBackgroundColor: '#ffffff' },
      files: {},
    })
    // Hold saveChain after disk write (link-index) so open-upgrade stays queued behind it.
    let releaseLink!: () => void
    const linkHold = new Promise<void>((res) => {
      releaseLink = () => res()
    })
    knowledgeLinkIndexUpsert.mockImplementationOnce(async () => {
      await linkHold
    })
    useKnowledgeStore.setState({
      activeDocId: 'doc_doc00000001',
      docBody: 'a',
      draftBody: 'b',
      nodes: [boardNode, docNode],
    })
    // phase write returns after knowledgeWriteDoc; run stays on chain in link-index hold.
    const flushP = useKnowledgeStore.getState().flushSave({ phase: 'write' })
    await flushP

    knowledgeReadBoard.mockResolvedValueOnce(legacy)
    knowledgeWriteBoard.mockClear()
    vi.mocked(toast.message).mockClear()
    // openDoc: no dirty wait (doc flush already wrote). Opens board and enqueues upgrade
    // after the still-held flush run on saveChain.
    await useKnowledgeStore.getState().openDoc('brd_board000001')
    expect(useKnowledgeStore.getState().activeDocId).toBe('brd_board000001')
    // Supersede before upgrade runs.
    __bumpOpenDocGenerationForTests()
    useKnowledgeStore.setState({
      activeDocId: 'doc_doc00000001',
      docBody: 'b',
      draftBody: 'b',
    })
    releaseLink()
    await new Promise((r) => setTimeout(r, 30))
    expect(knowledgeWriteBoard).not.toHaveBeenCalled()
    expect(toast.message).not.toHaveBeenCalledWith('knowledge.board.legacyImported')
    knowledgeLinkIndexUpsert.mockResolvedValue(undefined)
  })

  it('setDraftBody docId guard ignores cross-leaf board write', () => {
    useKnowledgeStore.setState({
      activeDocId: 'brd_board000001',
      docBody: emptyScene,
      draftBody: emptyScene,
    })
    useKnowledgeStore.getState().setDraftBody('other', { docId: 'brd_other000001', persist: 'none' })
    expect(useKnowledgeStore.getState().draftBody).toBe(emptyScene)
    useKnowledgeStore.getState().setDraftBody('ok', { docId: 'brd_board000001', persist: 'none' })
    expect(useKnowledgeStore.getState().draftBody).toBe('ok')
  })

  it('deleteNode active board clears activeDocId/draft and does not decrement doc counts', async () => {
    useKnowledgeStore.setState({
      activeDocId: 'brd_board000001',
      docBody: emptyScene,
      draftBody: emptyScene,
      spaceDocCounts: { spc_1: 1 },
      recent: [
        { spaceId: 'spc_1', docId: 'brd_board000001', title: 'Sketch', spaceName: 'S', at: 1 },
        { spaceId: 'spc_1', docId: 'doc_doc00000001', title: 'Note', spaceName: 'S', at: 2 },
      ],
    })
    await useKnowledgeStore.getState().deleteNode('brd_board000001')
    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBeNull()
    expect(s.docBody).toBe('')
    expect(s.draftBody).toBe('')
    expect(s.spaceDocCounts.spc_1).toBe(1)
    expect(s.nodes.find((n) => n.id === 'brd_board000001')).toBeUndefined()
    expect(s.recent.map((r) => r.docId)).toEqual(['doc_doc00000001'])
    expect(knowledgeSoftDeleteNodes).toHaveBeenCalledWith('spc_1', ['brd_board000001'])
    // boards: no link-index remove for board-only leaf
    expect(knowledgeLinkIndexRemoveDoc).not.toHaveBeenCalled()
  })

  it('deleteNode folder with doc+board decrements only docs and clears active board', async () => {
    const folder = {
      id: 'nod_folder00001',
      parentId: null as string | null,
      kind: 'folder' as const,
      title: 'F',
      order: 0,
      createdAt: 1,
      updatedAt: 1,
    }
    const nestedDoc = { ...docNode, id: 'doc_nested00001', parentId: 'nod_folder00001' }
    const nestedBoard = { ...boardNode, id: 'brd_nested00001', parentId: 'nod_folder00001' }
    useKnowledgeStore.setState({
      nodes: [folder, nestedDoc, nestedBoard],
      activeDocId: 'brd_nested00001',
      docBody: emptyScene,
      draftBody: emptyScene,
      spaceDocCounts: { spc_1: 1 },
    })
    await useKnowledgeStore.getState().deleteNode('nod_folder00001')
    const s = useKnowledgeStore.getState()
    expect(s.nodes).toEqual([])
    expect(s.activeDocId).toBeNull()
    expect(s.spaceDocCounts.spc_1).toBe(0)
    expect(knowledgeLinkIndexRemoveDoc).toHaveBeenCalledWith('spc_1', 'doc_nested00001')
  })

  it('renameNode board updates recent title without reading board body', async () => {
    useKnowledgeStore.setState({
      recent: [
        { spaceId: 'spc_1', docId: 'brd_board000001', title: 'Sketch', spaceName: 'S', at: 1 },
      ],
    })
    await useKnowledgeStore.getState().renameNode('brd_board000001', 'New board')
    expect(knowledgeReadBoard).not.toHaveBeenCalled()
    expect(knowledgeReadDoc).not.toHaveBeenCalled()
    expect(knowledgeLinkIndexUpsert).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().nodes.find((n) => n.id === 'brd_board000001')?.title).toBe(
      'New board',
    )
    expect(useKnowledgeStore.getState().recent[0]?.title).toBe('New board')
  })

  it('syncActiveEditorToDraft is invoked before structural flush paths with leave flags', async () => {
    const spy = vi.fn()
    registerBeforeOpenDocFlush(spy)

    // openDoc leave=true
    knowledgeReadDoc.mockResolvedValueOnce('# b')
    useKnowledgeStore.setState({
      activeDocId: 'doc_doc00000001',
      docBody: 'clean',
      draftBody: 'clean',
      nodes: [docNode, boardNode],
    })
    await useKnowledgeStore.getState().openDoc('brd_board000001')
    expect(spy).toHaveBeenCalledWith({ leaveActiveLeaf: true })
    spy.mockClear()

    // deleteNode active → leave true
    useKnowledgeStore.setState({
      activeDocId: 'brd_board000001',
      docBody: emptyScene,
      draftBody: emptyScene,
      nodes: [boardNode, docNode],
      busy: false,
    })
    await useKnowledgeStore.getState().deleteNode('brd_board000001')
    expect(spy).toHaveBeenCalledWith({ leaveActiveLeaf: true })
    spy.mockClear()

    // deleteNode other → leave false
    useKnowledgeStore.setState({
      activeDocId: 'doc_doc00000001',
      docBody: 'x',
      draftBody: 'x',
      nodes: [boardNode, docNode],
      busy: false,
    })
    await useKnowledgeStore.getState().deleteNode('brd_board000001')
    expect(spy).toHaveBeenCalledWith({ leaveActiveLeaf: false })
    spy.mockClear()

    // moveNode → leave false
    useKnowledgeStore.setState({
      activeDocId: 'doc_doc00000001',
      docBody: 'x',
      draftBody: 'x',
      nodes: [
        { ...boardNode },
        { ...docNode },
        {
          id: 'nod_folder00001',
          parentId: null,
          kind: 'folder',
          title: 'F',
          order: 2,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      busy: false,
    })
    await useKnowledgeStore.getState().moveNode('brd_board000001', 'nod_folder00001')
    expect(spy).toHaveBeenCalledWith({ leaveActiveLeaf: false })
    spy.mockClear()

    // createBoard → leave false (snapshot of current)
    useKnowledgeStore.setState({
      activeDocId: 'doc_doc00000001',
      docBody: 'x',
      draftBody: 'x',
      nodes: [docNode],
      busy: false,
    })
    await useKnowledgeStore.getState().createBoard(null, 'B')
    expect(spy).toHaveBeenCalledWith({ leaveActiveLeaf: false })
    // createBoard then openDoc(new) also fires leave true
    expect(spy).toHaveBeenCalledWith({ leaveActiveLeaf: true })
    spy.mockClear()

    // createDoc → leave false
    knowledgeListTemplates.mockResolvedValue([])
    useKnowledgeStore.setState({
      activeDocId: 'brd_board000001',
      docBody: emptyScene,
      draftBody: emptyScene,
      nodes: [boardNode],
      busy: false,
    })
    knowledgeWriteDoc.mockResolvedValue(undefined)
    knowledgeReadDoc.mockResolvedValue('')
    await useKnowledgeStore.getState().createDoc(null, 'D')
    expect(spy).toHaveBeenCalledWith({ leaveActiveLeaf: false })
    spy.mockClear()

    // openHome leave true
    useKnowledgeStore.setState({
      activeDocId: 'doc_doc00000001',
      docBody: 'x',
      draftBody: 'x',
      mode: 'workspace',
      activeSpaceId: 'spc_1',
      busy: false,
    })
    await useKnowledgeStore.getState().openHome()
    expect(spy).toHaveBeenCalledWith({ leaveActiveLeaf: true })
    spy.mockClear()

    // openSpace leave true
    knowledgeGetTree.mockResolvedValueOnce({ version: 1, nodes: [] })
    useKnowledgeStore.setState({
      activeDocId: 'doc_doc00000001',
      docBody: 'x',
      draftBody: 'x',
      mode: 'workspace',
      activeSpaceId: 'spc_1',
      spaces: [
        { id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 },
        { id: 'spc_2', name: 'T', createdAt: 1, updatedAt: 1 },
      ],
      busy: false,
    })
    await useKnowledgeStore.getState().openSpace('spc_2')
    expect(spy).toHaveBeenCalledWith({ leaveActiveLeaf: true })
    spy.mockClear()

    // deleteSpace active leave true
    knowledgeWriteDoc.mockResolvedValue(undefined)
    useKnowledgeStore.setState({
      activeDocId: 'doc_doc00000001',
      docBody: 'x',
      draftBody: 'dirty',
      mode: 'workspace',
      activeSpaceId: 'spc_1',
      spaces: [
        { id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 },
        { id: 'spc_2', name: 'T', createdAt: 1, updatedAt: 1 },
      ],
      nodes: [docNode],
      busy: false,
    })
    await useKnowledgeStore.getState().deleteSpace('spc_1')
    expect(spy).toHaveBeenCalledWith({ leaveActiveLeaf: true })
  })

  it('pre-sync hook dirtying draft is persisted by deleteNode', async () => {
    const dirty =
      '{"type":"hip-board","version":1,"source":"hip","elements":[{"id":"stroke","type":"rect","x":0,"y":0,"w":1,"h":1,"fill":"#fff","stroke":"#111","strokeWidth":1,"cornerRadius":0}],"appState":{"viewBackgroundColor":"#ffffff"},"files":{}}'
    registerBeforeOpenDocFlush(() => {
      useKnowledgeStore.getState().setDraftBody(dirty, {
        docId: 'brd_board000001',
        persist: 'none',
      })
    })
    useKnowledgeStore.setState({
      activeDocId: 'brd_board000001',
      docBody: emptyScene,
      draftBody: emptyScene, // clean until sync
      nodes: [boardNode],
      busy: false,
    })
    await useKnowledgeStore.getState().deleteNode('brd_board000001')
    expect(knowledgeWriteBoard).toHaveBeenCalledWith('spc_1', 'brd_board000001', dirty)
    expect(knowledgeSoftDeleteNodes).toHaveBeenCalled()
  })

  it('export syncActiveEditorToDraft is callable and swallows hook errors', () => {
    registerBeforeOpenDocFlush(() => {
      throw new Error('boom')
    })
    expect(() => syncActiveEditorToDraft({ leaveActiveLeaf: true })).not.toThrow()
  })

  it('openRecent brd_* opens board path', async () => {
    knowledgeGetTree.mockResolvedValueOnce({
      version: 1,
      nodes: [boardNode],
    })
    knowledgeReadBoard.mockResolvedValueOnce(emptyScene)
    useKnowledgeStore.setState({
      activeSpaceId: null,
      mode: 'home',
      activeDocId: null,
      docBody: '',
      draftBody: '',
      spaces: [{ id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 }],
    })
    await useKnowledgeStore.getState().openRecent({
      spaceId: 'spc_1',
      docId: 'brd_board000001',
      title: 'Sketch',
      spaceName: 'S',
      at: 1,
    })
    expect(knowledgeReadBoard).toHaveBeenCalledWith('spc_1', 'brd_board000001')
    expect(useKnowledgeStore.getState().activeDocId).toBe('brd_board000001')
  })

  it('createBoard aborts when flush of current dirty leaf fails', async () => {
    knowledgeWriteDoc.mockRejectedValueOnce(new Error('disk full'))
    useKnowledgeStore.setState({
      activeDocId: 'doc_doc00000001',
      docBody: 'saved',
      draftBody: 'dirty',
      nodes: [docNode],
      busy: false,
    })
    await useKnowledgeStore.getState().createBoard(null, 'New board')
    expect(knowledgeWriteBoard).not.toHaveBeenCalled()
    expect(knowledgeSaveTree).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().activeDocId).toBe('doc_doc00000001')
    expect(useKnowledgeStore.getState().saveState).toBe('error')
  })

  it('rebuildSearchIndex indexes boards title-only without knowledgeReadBoard; counts stay doc-only', async () => {
    knowledgeGetTree.mockResolvedValueOnce({
      version: 1,
      nodes: [
        {
          id: 'doc_rebuild0001',
          parentId: null,
          kind: 'doc',
          title: 'DocOnly',
          order: 0,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'brd_rebuild0001',
          parentId: null,
          kind: 'board',
          title: 'BoardSketchTitle',
          order: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    })
    knowledgeReadDoc.mockResolvedValueOnce('# doc body content unique')
    knowledgeReadBoard.mockClear()
    useKnowledgeStore.setState({
      spaces: [{ id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 }],
      spaceDocCounts: {},
      indexStatus: 'idle',
      searchQuery: '',
      searchHits: [],
    })
    await useKnowledgeStore.getState().rebuildSearchIndex()
    const s = useKnowledgeStore.getState()
    expect(s.indexStatus).toBe('ready')
    expect(s.spaceDocCounts.spc_1).toBe(1) // Option B: doc only
    expect(knowledgeReadBoard).not.toHaveBeenCalled()
    expect(knowledgeReadDoc).toHaveBeenCalledWith('spc_1', 'doc_rebuild0001')
    useKnowledgeStore.getState().runSearch('BoardSketchTitle')
    const hits = useKnowledgeStore.getState().searchHits
    expect(hits.some((h) => h.docId === 'brd_rebuild0001')).toBe(true)
  })

  it('flushSave no-ops when activeDocId has no node in tree', async () => {
    useKnowledgeStore.setState({
      activeDocId: 'brd_missing00001',
      docBody: emptyScene,
      draftBody:
        '{"type":"hip-board","version":1,"source":"hip","elements":[{"id":"e1"}],"appState":{},"files":{}}',
      nodes: [docNode],
    })
    const ok = await useKnowledgeStore.getState().flushSave()
    expect(ok).toBe(true)
    expect(knowledgeWriteBoard).not.toHaveBeenCalled()
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
  })

  it('setEditorMode is a no-op while active leaf is a board', async () => {
    const { KNOWLEDGE_LARGE_DOC_CHARS } = await import('@/domain/knowledge/limits')
    const big = 'x'.repeat(KNOWLEDGE_LARGE_DOC_CHARS + 10)
    useKnowledgeStore.setState({
      activeDocId: 'brd_board000001',
      nodes: [boardNode],
      docBody: big,
      draftBody: big,
      editorMode: 'live',
    })
    vi.mocked(toast.message).mockClear()
    await useKnowledgeStore.getState().setEditorMode('source')
    expect(useKnowledgeStore.getState().editorMode).toBe('live')
    expect(toast.message).not.toHaveBeenCalled()
  })

  it('version APIs early-return for board leaves', async () => {
    useKnowledgeStore.setState({
      activeDocId: 'brd_board000001',
      nodes: [boardNode],
      docBody: emptyScene,
      draftBody: emptyScene,
    })
    knowledgeSaveVersion.mockClear()
    knowledgeListVersions.mockClear()
    knowledgeRestoreVersion.mockClear()
    expect(await useKnowledgeStore.getState().saveVersionManual()).toBeNull()
    expect(await useKnowledgeStore.getState().listVersions()).toEqual([])
    expect(await useKnowledgeStore.getState().restoreVersion('v1')).toBe(false)
    expect(knowledgeSaveVersion).not.toHaveBeenCalled()
    expect(knowledgeListVersions).not.toHaveBeenCalled()
    expect(knowledgeRestoreVersion).not.toHaveBeenCalled()
  })

  it('renameNode empty board title becomes Untitled whiteboard', async () => {
    useKnowledgeStore.setState({
      recent: [
        { spaceId: 'spc_1', docId: 'brd_board000001', title: 'Sketch', spaceName: 'S', at: 1 },
      ],
    })
    await useKnowledgeStore.getState().renameNode('brd_board000001', '   ')
    expect(useKnowledgeStore.getState().nodes.find((n) => n.id === 'brd_board000001')?.title).toBe(
      'Untitled whiteboard',
    )
    expect(useKnowledgeStore.getState().recent[0]?.title).toBe('Untitled whiteboard')
  })

  it('deleteNode active leaf clears link panel state', async () => {
    useKnowledgeStore.setState({
      activeDocId: 'doc_doc00000001',
      docBody: 'x',
      draftBody: 'x',
      nodes: [docNode],
      backlinks: [
        { fromDocId: 'a', fromTitle: 'A', raw: 'b', kind: 'wiki', fragment: null },
      ],
      outboundLinks: [
        {
          kind: 'wiki',
          raw: 'x',
          targetTitle: null,
          targetDocId: null,
          fragment: null,
          display: null,
        },
      ],
      linkPanelStatus: 'ready',
      spaceDocCounts: { spc_1: 1 },
      busy: false,
    })
    await useKnowledgeStore.getState().deleteNode('doc_doc00000001')
    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBeNull()
    expect(s.backlinks).toEqual([])
    expect(s.outboundLinks).toEqual([])
    expect(s.linkPanelStatus).toBe('idle')
  })
})

describe('knowledgeStore board companion rail (PR-4)', () => {
  const boardNode = {
    id: 'brd_board000001',
    parentId: null as string | null,
    kind: 'board' as const,
    title: 'Board',
    order: 0,
    createdAt: 1,
    updatedAt: 1,
  }
  const docNode = {
    id: 'doc_1',
    parentId: null as string | null,
    kind: 'doc' as const,
    title: 'Doc',
    order: 1,
    createdAt: 1,
    updatedAt: 1,
  }
  const emptySel = {
    boardId: 'brd_board000001',
    ids: [] as string[],
    items: [] as [],
    style: {},
  }
  const selWithRect = {
    boardId: 'brd_board000001',
    ids: ['r1'],
    items: [
      {
        id: 'r1',
        type: 'rect' as const,
        label: 'rect r1',
        depth: 0,
        locked: false,
        order: 0,
      },
    ],
    style: { fill: '#ffffff', stroke: '#111111', strokeWidth: 2 },
  }
  const outlineSnap = {
    boardId: 'brd_board000001',
    items: selWithRect.items,
    totalElements: 1,
    truncated: false,
    imageCount: 0,
  }

  beforeEach(() => {
    knowledgeEnsureRoot.mockResolvedValue(undefined)
    knowledgeListSpaces.mockResolvedValue([
      { id: 'spc_1', name: 'Space', icon: '📚', createdAt: 1, updatedAt: 1 },
    ])
    knowledgeGetTree.mockResolvedValue({ version: 1, nodes: [boardNode, docNode] })
    knowledgeReadBoard.mockResolvedValue(EMPTY_BOARD_SCENE_JSON)
    knowledgeReadDoc.mockResolvedValue('# hi')
    knowledgeWriteBoard.mockResolvedValue(undefined)
    knowledgeWriteDoc.mockResolvedValue(undefined)
    knowledgeSaveTree.mockResolvedValue(undefined)
    __resetBoardSessionFlagsForTests()
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [{ id: 'spc_1', name: 'Space', icon: '📚', createdAt: 1, updatedAt: 1 }],
      activeSpaceId: 'spc_1',
      nodes: [boardNode, docNode],
      activeDocId: 'brd_board000001',
      docBody: EMPTY_BOARD_SCENE_JSON,
      draftBody: EMPTY_BOARD_SCENE_JSON,
      mode: 'workspace',
      boardOutline: outlineSnap,
      boardSelection: selWithRect,
      pendingBoardFocus: {
        ids: ['r1'],
        nonce: 1,
        scroll: true,
        boardId: 'brd_board000001',
      },
      busy: false,
      error: null,
      saveState: 'idle',
      pendingReveal: null,
      pendingOutlineJump: null,
    })
  })

  it('setBoardSelection equality no-op when ids+style signature unchanged', () => {
    const before = useKnowledgeStore.getState().boardSelection
    useKnowledgeStore.getState().setBoardSelection({
      ...selWithRect,
      ids: ['r1'],
      style: { fill: '#ffffff', stroke: '#111111', strokeWidth: 2 },
    })
    expect(useKnowledgeStore.getState().boardSelection).toBe(before)

    useKnowledgeStore.getState().setBoardSelection({
      ...selWithRect,
      style: { fill: '#ff0000', stroke: '#111111', strokeWidth: 2 },
    })
    expect(useKnowledgeStore.getState().boardSelection?.style.fill).toBe('#ff0000')
  })

  it('setBoardSelection ignores boardId !== activeDocId', () => {
    useKnowledgeStore.getState().setBoardSelection({
      ...selWithRect,
      boardId: 'brd_other',
      style: { fill: '#00ff00' },
    })
    expect(useKnowledgeStore.getState().boardSelection?.style.fill).toBe('#ffffff')
  })

  it('setBoardOutline equality no-op', () => {
    const before = useKnowledgeStore.getState().boardOutline
    useKnowledgeStore.getState().setBoardOutline({ ...outlineSnap })
    expect(useKnowledgeStore.getState().boardOutline).toBe(before)
  })

  it('clearBoardPanelState nulls outline, selection, pending focus', () => {
    useKnowledgeStore.getState().clearBoardPanelState()
    const s = useKnowledgeStore.getState()
    expect(s.boardOutline).toBeNull()
    expect(s.boardSelection).toBeNull()
    expect(s.pendingBoardFocus).toBeNull()
  })

  it('openDoc to doc clears board panel state', async () => {
    await useKnowledgeStore.getState().openDoc('doc_1')
    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBe('doc_1')
    expect(s.boardOutline).toBeNull()
    expect(s.boardSelection).toBeNull()
    expect(s.pendingBoardFocus).toBeNull()
  })

  it('openDoc boardA→boardB clears then allows new canvas to publish', async () => {
    const boardB = {
      ...boardNode,
      id: 'brd_board000002',
      title: 'B',
      order: 2,
    }
    useKnowledgeStore.setState({ nodes: [boardNode, boardB, docNode] })
    knowledgeGetTree.mockResolvedValue({
      version: 1,
      nodes: [boardNode, boardB, docNode],
    })
    knowledgeReadBoard.mockResolvedValue(EMPTY_BOARD_SCENE_JSON)
    await useKnowledgeStore.getState().openDoc('brd_board000002')
    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBe('brd_board000002')
    expect(s.boardOutline).toBeNull()
    expect(s.boardSelection).toBeNull()
    expect(s.pendingBoardFocus).toBeNull()
  })

  it('openHome clears board panel state', async () => {
    await useKnowledgeStore.getState().openHome()
    const s = useKnowledgeStore.getState()
    expect(s.mode).toBe('home')
    expect(s.boardOutline).toBeNull()
    expect(s.boardSelection).toBeNull()
    expect(s.pendingBoardFocus).toBeNull()
  })

  it('requestBoardFocus stamps boardId and bumps nonce', () => {
    useKnowledgeStore.getState().requestBoardFocus(['r1', 'r2'], { scroll: true })
    const p = useKnowledgeStore.getState().pendingBoardFocus
    expect(p?.boardId).toBe('brd_board000001')
    expect(p?.ids).toEqual(['r1', 'r2'])
    expect(p?.scroll).toBe(true)
    expect(p?.nonce).toBe(2)
  })
})
