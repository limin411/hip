// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const knowledgeReadDoc = vi.fn()
const knowledgeWriteDoc = vi.fn()
const knowledgeGetTree = vi.fn()
const knowledgeEnsureRoot = vi.fn()
const knowledgeListSpaces = vi.fn()
const knowledgeDeleteSpace = vi.fn()
const knowledgeCreateSpace = vi.fn()
const knowledgeUpdateSpace = vi.fn()

vi.mock('@/ipc/knowledge', () => ({
  knowledgeEnsureRoot: (...a: unknown[]) => knowledgeEnsureRoot(...a),
  knowledgeListSpaces: (...a: unknown[]) => knowledgeListSpaces(...a),
  knowledgeCreateSpace: (...a: unknown[]) => knowledgeCreateSpace(...a),
  knowledgeUpdateSpace: (...a: unknown[]) => knowledgeUpdateSpace(...a),
  knowledgeDeleteSpace: (...a: unknown[]) => knowledgeDeleteSpace(...a),
  knowledgeGetTree: (...a: unknown[]) => knowledgeGetTree(...a),
  knowledgeSaveTree: vi.fn(),
  knowledgeReadDoc: (...a: unknown[]) => knowledgeReadDoc(...a),
  knowledgeWriteDoc: (...a: unknown[]) => knowledgeWriteDoc(...a),
  knowledgeDeleteDocFile: vi.fn(),
  knowledgeErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), message: vi.fn() },
}))

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string, opts?: { name?: string }) =>
      opts?.name ? `${key}:${opts.name}` : key,
  },
}))

import { toast } from 'sonner'
import {
  getKnowledgeBacklinks,
  getKnowledgeBrokenOutboundCount,
  listKnowledgeDocsForWiki,
  useKnowledgeStore,
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

  it('openDoc sets editorMode source with body (live flag off)', async () => {
    knowledgeReadDoc.mockResolvedValueOnce('# hello')
    await useKnowledgeStore.getState().openDoc('doc_1')
    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBe('doc_1')
    expect(s.docBody).toBe('# hello')
    expect(s.draftBody).toBe('# hello')
    expect(s.editorMode).toBe('source')
    expect(knowledgeReadDoc).toHaveBeenCalledWith('spc_1', 'doc_1')
  })

  it('openDoc sets editorMode live when flag on and no pref', async () => {
    localStorage.setItem('hip-knowledge-live', 'true')
    knowledgeReadDoc.mockResolvedValueOnce('# hello')
    await useKnowledgeStore.getState().openDoc('doc_1')
    expect(useKnowledgeStore.getState().editorMode).toBe('live')
  })

  it('openDoc forces source when live flag on but body is large', async () => {
    localStorage.setItem('hip-knowledge-live', 'true')
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
    knowledgeDeleteSpace.mockResolvedValue(undefined)
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

  it('leaves workspace before disk delete and does not flush dirty draft', async () => {
    useKnowledgeStore.setState({
      pendingReveal: { query: 'q', spaceId: 'spc_1', docId: 'doc_1' },
    })
    await useKnowledgeStore.getState().deleteSpace('spc_1')
    const s = useKnowledgeStore.getState()
    expect(knowledgeDeleteSpace).toHaveBeenCalledWith('spc_1')
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    expect(s.mode).toBe('home')
    expect(s.activeSpaceId).toBeNull()
    expect(s.activeDocId).toBeNull()
    expect(s.nodes).toEqual([])
    expect(s.spaces.map((x) => x.id)).toEqual(['spc_2'])
    expect(s.recent).toEqual([])
    expect(s.busy).toBe(false)
    expect(s.pendingReveal).toBeNull()
  })

  it('deletes non-active space without changing mode', async () => {
    useKnowledgeStore.setState({
      activeSpaceId: 'spc_2',
      mode: 'workspace',
      activeDocId: null,
      draftBody: '',
      docBody: '',
    })
    await useKnowledgeStore.getState().deleteSpace('spc_1')
    const s = useKnowledgeStore.getState()
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

  it('defaults to none in preview (no autosave schedule)', async () => {
    useKnowledgeStore.getState().setDraftBody('preview-dirty')
    expect(useKnowledgeStore.getState().draftBody).toBe('preview-dirty')
    await vi.advanceTimersByTimeAsync(600)
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().docBody).toBe('saved')
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

  it('entering preview flushes dirty draft', async () => {
    await useKnowledgeStore.getState().setEditorMode('preview')
    expect(knowledgeWriteDoc).toHaveBeenCalledWith('spc_1', 'doc_1', 'dirty')
    expect(useKnowledgeStore.getState().editorMode).toBe('preview')
    expect(useKnowledgeStore.getState().docBody).toBe('dirty')
  })

  it('leaving preview reseeds draft from docBody', async () => {
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

  it('clamps live to source when flag is off', async () => {
    await useKnowledgeStore.getState().setEditorMode('live')
    expect(useKnowledgeStore.getState().editorMode).toBe('source')
  })

  it('allows live when flag is on', async () => {
    localStorage.setItem('hip-knowledge-live', 'true')
    await useKnowledgeStore.getState().setEditorMode('live')
    expect(useKnowledgeStore.getState().editorMode).toBe('live')
    expect(localStorage.getItem('hip-knowledge-editor-mode')).toBe('live')
  })

  it('live ↔ source keeps dirty draft (no silent reseed)', async () => {
    localStorage.setItem('hip-knowledge-live', 'true')
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
    localStorage.setItem('hip-knowledge-live', 'true')
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

describe('knowledgeStore link index (backlinks)', () => {
  beforeEach(() => {
    knowledgeReadDoc.mockReset()
    knowledgeGetTree.mockReset()
    knowledgeWriteDoc.mockReset()
    knowledgeWriteDoc.mockResolvedValue(undefined)
    knowledgeEnsureRoot.mockReset()
    knowledgeListSpaces.mockReset()
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [{ id: 'spc_1', name: 'S1', createdAt: 1, updatedAt: 1 }],
      activeSpaceId: 'spc_1',
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
      activeDocId: null,
      docBody: '',
      draftBody: '',
      editorMode: 'preview',
      mode: 'workspace',
      searchQuery: '',
      searchHits: [],
      indexStatus: 'idle',
      indexProgress: null,
      pendingReveal: null,
      spaceDocCounts: { spc_1: 2 },
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

  it('rebuild indexes backlinks and broken outbound (title + alias)', async () => {
    knowledgeGetTree.mockResolvedValue({
      version: 1,
      nodes: useKnowledgeStore.getState().nodes,
    })
    knowledgeReadDoc.mockImplementation(async (_s: string, docId: string) => {
      if (docId === 'doc_a') {
        return `---
aliases: [A1]
---
See [[Beta]] and [[Missing]].
`
      }
      if (docId === 'doc_b') return 'Mentions [[A1]] only.'
      return ''
    })
    await useKnowledgeStore.getState().rebuildSearchIndex()
    expect(useKnowledgeStore.getState().indexStatus).toBe('ready')

    const backsToB = getKnowledgeBacklinks('spc_1', 'doc_b')
    expect(backsToB.map((e) => e.fromDocId)).toEqual(['doc_a'])

    // Alias resolution: doc_b links to Alpha via A1
    const backsToA = getKnowledgeBacklinks('spc_1', 'doc_a')
    expect(backsToA.map((e) => e.fromDocId)).toEqual(['doc_b'])

    expect(getKnowledgeBrokenOutboundCount('spc_1', 'doc_a')).toBe(1)
    expect(getKnowledgeBrokenOutboundCount('spc_1', 'doc_b')).toBe(0)
  })

  it('flushSave reindexes outbound of active doc', async () => {
    knowledgeGetTree.mockResolvedValue({
      version: 1,
      nodes: useKnowledgeStore.getState().nodes,
    })
    knowledgeReadDoc.mockResolvedValue('plain')
    await useKnowledgeStore.getState().rebuildSearchIndex()

    useKnowledgeStore.setState({
      activeDocId: 'doc_a',
      docBody: 'plain',
      draftBody: 'Now [[Beta]]',
      editorMode: 'source',
    })
    const ok = await useKnowledgeStore.getState().flushSave()
    expect(ok).toBe(true)
    expect(getKnowledgeBacklinks('spc_1', 'doc_b').map((e) => e.fromDocId)).toEqual([
      'doc_a',
    ])
  })
})
