import { beforeEach, describe, expect, it, vi } from 'vitest'

const knowledgeReadDoc = vi.fn()
const knowledgeWriteDoc = vi.fn()
const knowledgeGetTree = vi.fn()
const knowledgeEnsureRoot = vi.fn()
const knowledgeListSpaces = vi.fn()

vi.mock('@/ipc/knowledge', () => ({
  knowledgeEnsureRoot: (...a: unknown[]) => knowledgeEnsureRoot(...a),
  knowledgeListSpaces: (...a: unknown[]) => knowledgeListSpaces(...a),
  knowledgeCreateSpace: vi.fn(),
  knowledgeUpdateSpace: vi.fn(),
  knowledgeDeleteSpace: vi.fn(),
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
