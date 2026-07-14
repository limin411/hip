// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'

const knowledgeReadDoc = vi.fn()
const knowledgeWriteDoc = vi.fn()
const knowledgeGetTree = vi.fn()
const knowledgeEnsureRoot = vi.fn()
const knowledgeListSpaces = vi.fn()
const knowledgeDeleteSpace = vi.fn()

vi.mock('@/ipc/knowledge', () => ({
  knowledgeEnsureRoot: (...a: unknown[]) => knowledgeEnsureRoot(...a),
  knowledgeListSpaces: (...a: unknown[]) => knowledgeListSpaces(...a),
  knowledgeCreateSpace: vi.fn(),
  knowledgeUpdateSpace: vi.fn(),
  knowledgeDeleteSpace: (...a: unknown[]) => knowledgeDeleteSpace(...a),
  knowledgeGetTree: (...a: unknown[]) => knowledgeGetTree(...a),
  knowledgeSaveTree: vi.fn(),
  knowledgeReadDoc: (...a: unknown[]) => knowledgeReadDoc(...a),
  knowledgeWriteDoc: (...a: unknown[]) => knowledgeWriteDoc(...a),
  knowledgeDeleteDocFile: vi.fn(),
  knowledgeErrorMessage: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}))

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

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

