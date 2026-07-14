// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

vi.mock('@/i18n', () => ({
  default: {
    t: (key: string, opts?: { name?: string }) =>
      opts?.name ? `${key}:${opts.name}` : key,
  },
}))

import { toast } from 'sonner'
import { useKnowledgeStore } from './knowledgeStore'

describe('knowledgeStore openDoc editing default', () => {
  beforeEach(() => {
    knowledgeReadDoc.mockReset()
    knowledgeWriteDoc.mockReset()
    knowledgeGetTree.mockReset()
    knowledgeEnsureRoot.mockReset()
    knowledgeListSpaces.mockReset()
    knowledgeDeleteSpace.mockReset()
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
      editing: false,
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

  it('openDoc sets editing true with body', async () => {
    knowledgeReadDoc.mockResolvedValueOnce('# hello')
    await useKnowledgeStore.getState().openDoc('doc_1')
    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBe('doc_1')
    expect(s.docBody).toBe('# hello')
    expect(s.draftBody).toBe('# hello')
    expect(s.editing).toBe(true)
    expect(knowledgeReadDoc).toHaveBeenCalledWith('spc_1', 'doc_1')
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
      editing: true,
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
      editing: false,
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
      editing: false,
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
      editing: true,
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

