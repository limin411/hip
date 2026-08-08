// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeNode } from '@/domain/knowledge/types'

const knowledgeReadDoc = vi.fn()
const knowledgeWriteDoc = vi.fn()
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
  knowledgeDeleteDocFile: vi.fn(),
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
  listKnowledgeDocsForWiki,
  setExpandPersistSuspended,
  useKnowledgeStore,
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
    localStorage.removeItem('hip-knowledge-editor-mode-by-doc')
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

  it('V2-E0: residual hip-knowledge-live=false still opens live (flag retired)', async () => {
    localStorage.setItem('hip-knowledge-live', 'false')
    knowledgeReadDoc.mockResolvedValueOnce('# hello')
    await useKnowledgeStore.getState().openDoc('doc_1')
    expect(useKnowledgeStore.getState().editorMode).toBe('live')
  })

  it('V2-E0: global source pref is ignored — opens live', async () => {
    localStorage.setItem('hip-knowledge-editor-mode', 'source')
    knowledgeReadDoc.mockResolvedValueOnce('# hello')
    await useKnowledgeStore.getState().openDoc('doc_1')
    expect(useKnowledgeStore.getState().editorMode).toBe('live')
  })

  it('V2-E0: per-doc Source memory is retired — opens live', async () => {
    localStorage.setItem(
      'hip-knowledge-editor-mode-by-doc',
      JSON.stringify({ doc_1: 'source' }),
    )
    knowledgeReadDoc.mockResolvedValueOnce('# hello')
    await useKnowledgeStore.getState().openDoc('doc_1')
    expect(useKnowledgeStore.getState().editorMode).toBe('live')
  })

  it('openDoc forces source when live on but body is large (internal fallback)', async () => {
    const { KNOWLEDGE_LARGE_DOC_CHARS } = await import('@/domain/knowledge/limits')
    const big = 'y'.repeat(KNOWLEDGE_LARGE_DOC_CHARS + 10)
    knowledgeReadDoc.mockResolvedValueOnce(big)
    await useKnowledgeStore.getState().openDoc('doc_1')
    expect(useKnowledgeStore.getState().editorMode).toBe('source')
    expect(useKnowledgeStore.getState().docBody.length).toBe(big.length)
    // V2-E0: 非侵入提示由兼容视图 banner 负责，不再弹 toast。
    expect(toast.message).not.toHaveBeenCalled()
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

  it.skip('defaults to auto for legacy preview (writable Live surface)', async () => {
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
    // V2-E0: preview 不是写入表面；归一为 live，且不再写任何模式偏好。
    expect(useKnowledgeStore.getState().editorMode).toBe('live')
    expect(localStorage.getItem('hip-knowledge-editor-mode')).toBeNull()
  })

  it.skip('leaving legacy preview state reseeds draft from docBody', async () => {
    useKnowledgeStore.setState({
      editorMode: 'preview',
      docBody: 'on-disk',
      draftBody: 'stale-preview',
    })
    await useKnowledgeStore.getState().setEditorMode('source')
    expect(useKnowledgeStore.getState().editorMode).toBe('source')
    expect(useKnowledgeStore.getState().draftBody).toBe('on-disk')
    expect(localStorage.getItem('hip-knowledge-editor-mode')).toBeNull()
  })

  it('V2-E0: live flag false no longer clamps live to source', async () => {
    localStorage.setItem('hip-knowledge-live', 'false')
    await useKnowledgeStore.getState().setEditorMode('live')
    expect(useKnowledgeStore.getState().editorMode).toBe('live')
  })

  it('allows live by default and writes no mode preference', async () => {
    await useKnowledgeStore.getState().setEditorMode('live')
    expect(useKnowledgeStore.getState().editorMode).toBe('live')
    expect(localStorage.getItem('hip-knowledge-editor-mode')).toBeNull()
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

describe('knowledgeStore rejects boards / non-docs', () => {
  beforeEach(() => {
    knowledgeReadDoc.mockReset()
    knowledgeSaveVersion.mockReset()
    knowledgeListVersions.mockReset()
    knowledgeRestoreVersion.mockReset()
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
        {
          id: 'brd_legacy',
          parentId: null,
          kind: 'board',
          title: 'Old Board',
          order: 1,
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'fld_1',
          parentId: null,
          kind: 'folder',
          title: 'Folder',
          order: 2,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      activeDocId: 'doc_1',
      treeFocusId: 'doc_1',
      docBody: '# ok',
      draftBody: '# ok',
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
      backlinks: [],
      outboundLinks: [],
      linkPanelStatus: 'idle',
      pendingReveal: null,
    })
  })

  it('openDoc rejects board ids without reading disk', async () => {
    await useKnowledgeStore.getState().openDoc('brd_legacy')
    expect(knowledgeReadDoc).not.toHaveBeenCalled()
    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBeNull()
    expect(s.treeFocusId).toBeNull()
    expect(s.docBody).toBe('')
    expect(s.draftBody).toBe('')
    expect(toast.error).toHaveBeenCalledWith('knowledge.doc.loadFailed')
  })

  it('openDoc rejects folder ids', async () => {
    await useKnowledgeStore.getState().openDoc('fld_1')
    expect(knowledgeReadDoc).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().activeDocId).toBeNull()
    expect(toast.error).toHaveBeenCalled()
  })

  it('version APIs no-op for brd_ ids without IPC', async () => {
    useKnowledgeStore.setState({ activeDocId: 'brd_legacy' })
    await expect(useKnowledgeStore.getState().saveVersionManual()).resolves.toBeNull()
    await expect(useKnowledgeStore.getState().listVersions()).resolves.toEqual([])
    await expect(useKnowledgeStore.getState().restoreVersion('v1')).resolves.toBe(false)
    expect(knowledgeSaveVersion).not.toHaveBeenCalled()
    expect(knowledgeListVersions).not.toHaveBeenCalled()
    expect(knowledgeRestoreVersion).not.toHaveBeenCalled()
  })
})


describe('knowledgeStore hasUnsavedChanges + updateActiveDocMeta', () => {
  it('hasUnsavedChanges is false when clean', () => {
    useKnowledgeStore.setState({
      activeDocId: 'doc_1',
      docBody: 'hello',
      draftBody: 'hello',
      saveState: 'idle',
    })
    expect(useKnowledgeStore.getState().hasUnsavedChanges()).toBe(false)
  })

  it('hasUnsavedChanges is true when draft differs', () => {
    useKnowledgeStore.setState({
      activeDocId: 'doc_1',
      docBody: 'hello',
      draftBody: 'hello world',
      saveState: 'idle',
    })
    expect(useKnowledgeStore.getState().hasUnsavedChanges()).toBe(true)
  })

  it('updateActiveDocMeta writes icon/cover into FM without touching body', () => {
    useKnowledgeStore.setState({
      activeSpaceId: 'sp_1',
      activeDocId: 'doc_1',
      docBody: '# Body\n',
      draftBody: '# Body\n',
      saveState: 'idle',
    })
    useKnowledgeStore.getState().updateActiveDocMeta({
      icon: '📄',
      cover: 'assets/c.png',
      coverY: 40,
      tags: ['a'],
    })
    const draft = useKnowledgeStore.getState().draftBody
    expect(draft).toMatch(/icon:/)
    expect(draft).toMatch(/cover:/)
    expect(draft).toMatch(/coverY:\s*40/)
    expect(draft).toContain('# Body')
    expect(useKnowledgeStore.getState().hasUnsavedChanges()).toBe(true)
  })
})

describe('knowledgeStore 文档管理目录导航 (v2)', () => {
  const F1 = { id: 'nod_f1', parentId: null, kind: 'folder' as const, title: 'F1', order: 0, createdAt: 1, updatedAt: 1 }
  const F2 = { id: 'nod_f2', parentId: 'nod_f1', kind: 'folder' as const, title: 'F2', order: 0, createdAt: 2, updatedAt: 2 }
  const D1 = { id: 'doc_1', parentId: null, kind: 'doc' as const, title: 'D1', order: 1, createdAt: 3, updatedAt: 3 }
  const D2 = { id: 'doc_2', parentId: 'nod_f1', kind: 'doc' as const, title: 'D2', order: 0, createdAt: 4, updatedAt: 4 }
  const NODES: KnowledgeNode[] = [F1, F2, D1, D2]

  beforeEach(async () => {
    useKnowledgeStore.setState({
      loaded: true,
      activeSpaceId: 'sp_1',
      nodes: [...NODES],
      mode: 'workspace',
      currentFolderId: null,
      activeDocId: null,
      docBody: '',
      draftBody: '',
      saveState: 'idle',
      pendingReveal: null,
    })
    knowledgeGetTree.mockResolvedValue({ version: 1, nodes: [...NODES] })
    knowledgeReadDoc.mockResolvedValue('body')
  })

  it('enterFolder 更新 currentFolderId', async () => {
    const kb = useKnowledgeStore.getState()
    await kb.enterFolder('nod_f1')
    const s = useKnowledgeStore.getState()
    expect(s.currentFolderId).toBe('nod_f1')
  })

  it('goUp 返回父级', async () => {
    const kb = useKnowledgeStore.getState()
    await kb.enterFolder('nod_f1')
    await kb.enterFolder('nod_f2')
    await kb.goUp() // → nod_f1
    expect(useKnowledgeStore.getState().currentFolderId).toBe('nod_f1')
    await kb.goUp() // → root
    expect(useKnowledgeStore.getState().currentFolderId).toBeNull()
  })

  it('根目录 goUp 为 no-op', async () => {
    const kb = useKnowledgeStore.getState()
    await kb.goUp()
    expect(useKnowledgeStore.getState().currentFolderId).toBeNull()
  })

  it('openDoc 打开文档并保留目录上下文', async () => {
    const kb = useKnowledgeStore.getState()
    await kb.enterFolder('nod_f1')
    await kb.openDoc('doc_2')
    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBe('doc_2')
    expect(s.currentFolderId).toBe('nod_f1')
  })

  it('openDoc 相同文档 no-op', async () => {
    const kb = useKnowledgeStore.getState()
    await kb.openDoc('doc_1')
    await kb.openDoc('doc_1')
    expect(useKnowledgeStore.getState().activeDocId).toBe('doc_1')
  })

  it('navigateTo 文档后回到目录需先回文档所在目录', async () => {
    const kb = useKnowledgeStore.getState()
    await kb.enterFolder('nod_f1')
    await kb.navigateTo(null, 'doc_1') // 打开根文档
    const s = useKnowledgeStore.getState()
    expect(s.activeDocId).toBe('doc_1')
    expect(s.currentFolderId).toBe('nod_f1') // 文档视图保留目录上下文
  })
})

describe('knowledgeStore 深目录（20+ 层）', () => {
  /** 生成 20 层链：nod_0(root folder) → … → nod_19 → doc_deep */
  function deepChain(): KnowledgeNode[] {
    const nodes: KnowledgeNode[] = []
    for (let i = 0; i < 20; i++) {
      nodes.push({
        id: `nod_deep${i}`,
        parentId: i === 0 ? null : `nod_deep${i - 1}`,
        kind: 'folder',
        title: `L${i + 1}`,
        order: 0,
        createdAt: i,
        updatedAt: i,
      })
    }
    nodes.push({
      id: 'doc_deep',
      parentId: 'nod_deep19',
      kind: 'doc',
      title: 'deepend',
      order: 0,
      createdAt: 99,
      updatedAt: 99,
    })
    return nodes
  }

  beforeEach(async () => {
    const NODES = deepChain()
    useKnowledgeStore.setState({
      loaded: true,
      activeSpaceId: 'sp_1',
      nodes: NODES,
      mode: 'workspace',
      currentFolderId: null,
      activeDocId: null,
      docBody: '',
      draftBody: '',
      saveState: 'idle',
      pendingReveal: null,
    })
    knowledgeGetTree.mockResolvedValue({ version: 1, nodes: deepChain() })
    knowledgeReadDoc.mockResolvedValue('body')
  })

  it('20 层逐层进入 + ↑ 逐级返回', async () => {
    const kb = useKnowledgeStore.getState()
    for (let i = 0; i < 20; i++) {
      await kb.enterFolder(`nod_deep${i}`)
    }
    expect(useKnowledgeStore.getState().currentFolderId).toBe('nod_deep19')
    for (let i = 18; i >= 1; i--) {
      await kb.goUp()
      expect(useKnowledgeStore.getState().currentFolderId).toBe(`nod_deep${i}`)
    }
    await kb.goUp()
    expect(useKnowledgeStore.getState().currentFolderId).toBe('nod_deep0')
    await kb.goUp()
    expect(useKnowledgeStore.getState().currentFolderId).toBeNull()
    expect(useKnowledgeStore.getState().currentFolderId).toBeNull()
  })

  it('20 层深处打开文档，返回目录需 goUp 逐级或面包屑跳转', async () => {
    const kb = useKnowledgeStore.getState()
    for (let i = 0; i < 20; i++) {
      await kb.enterFolder(`nod_deep${i}`)
    }
    await kb.openDoc('doc_deep')
    expect(useKnowledgeStore.getState().activeDocId).toBe('doc_deep')
    expect(useKnowledgeStore.getState().currentFolderId).toBe('nod_deep19')
    // 返回文档所在目录（导航回目录位置）
    await kb.navigateTo('nod_deep19', null)
    expect(useKnowledgeStore.getState().activeDocId).toBeNull()
    expect(useKnowledgeStore.getState().currentFolderId).toBe('nod_deep19')
  })

  it('revealPath（navigateTo 目录）可从任意深度直达', async () => {
    const kb = useKnowledgeStore.getState()
    // 先进入深处，再直接跳回根
    for (let i = 0; i < 20; i++) {
      await kb.enterFolder(`nod_deep${i}`)
    }
    await kb.navigateTo(null, null)
    expect(useKnowledgeStore.getState().currentFolderId).toBeNull()
    // 直达第 15 层
    await kb.navigateTo('nod_deep14', null)
    expect(useKnowledgeStore.getState().currentFolderId).toBe('nod_deep14')
    // 直达深处文档
    await kb.navigateTo('nod_deep19', 'doc_deep')
    expect(useKnowledgeStore.getState().activeDocId).toBe('doc_deep')
  })
})

describe('knowledgeStore pendingReveal setter (V2-S1)', () => {
  it('setPendingReveal stores the reveal target; clear removes it', () => {
    const kb = useKnowledgeStore.getState()
    kb.setPendingReveal({ query: 'harness', spaceId: 'sp', docId: 'd1' })
    expect(useKnowledgeStore.getState().pendingReveal).toEqual({
      query: 'harness',
      spaceId: 'sp',
      docId: 'd1',
    })
    kb.clearPendingReveal()
    expect(useKnowledgeStore.getState().pendingReveal).toBeNull()
  })
})

describe('knowledgeStore recent list (V2-N1)', () => {
  function nodes(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      id: `doc_${i}`,
      parentId: null,
      kind: 'doc' as const,
      title: `Doc ${i}`,
      order: 0,
      createdAt: i,
      updatedAt: i,
    }))
  }

  beforeEach(() => {
    knowledgeReadDoc.mockReset()
    knowledgeReadDoc.mockResolvedValue('# hello')
    knowledgeGetTree.mockReset()
    knowledgeEnsureRoot.mockReset()
    knowledgeListSpaces.mockReset()
    localStorage.removeItem('hip-knowledge-recent')
    useKnowledgeStore.setState({
      loaded: true,
      spaces: [{ id: 'spc_1', name: 'S', createdAt: 1, updatedAt: 1 }],
      activeSpaceId: 'spc_1',
      nodes: nodes(3),
      activeDocId: null,
      docBody: '',
      draftBody: '',
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

  it('opening A → B → A dedupes A and moves it to the front', async () => {
    const kb = useKnowledgeStore.getState()
    await kb.openDoc('doc_0')
    await kb.openDoc('doc_1')
    await kb.openDoc('doc_0')
    const recent = useKnowledgeStore.getState().recent
    expect(recent.map((r) => r.docId)).toEqual(['doc_0', 'doc_1'])
    expect(recent[0]?.title).toBe('Doc 0')
    expect(recent[0]?.spaceName).toBe('S')
  })

  it('caps recent at RECENT_CAP and drops the oldest', async () => {
    // Pre-seed the cap with older docs (all different ids).
    const seeded = Array.from({ length: 16 }, (_, i) => ({
      spaceId: 'spc_1',
      docId: `old_${i}`,
      title: `Old ${i}`,
      spaceName: 'S',
      at: 1_000 + i,
    }))
    useKnowledgeStore.setState({ recent: seeded })
    await useKnowledgeStore.getState().openDoc('doc_0')
    const recent = useKnowledgeStore.getState().recent
    expect(recent).toHaveLength(16)
    expect(recent[0]?.docId).toBe('doc_0')
    expect(recent.some((r) => r.docId === 'old_15')).toBe(false)
  })

  it('persists to the legacy localStorage key hip-knowledge-recent', async () => {
    await useKnowledgeStore.getState().openDoc('doc_0')
    const raw = localStorage.getItem('hip-knowledge-recent')
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!) as Array<{ docId: string }>
    expect(parsed[0]?.docId).toBe('doc_0')
  })

  it('dropRecent removes a single entry and persists', async () => {
    useKnowledgeStore.setState({
      recent: [
        { spaceId: 'spc_1', docId: 'doc_0', title: 'A', spaceName: 'S', at: 1 },
        { spaceId: 'spc_1', docId: 'doc_1', title: 'B', spaceName: 'S', at: 2 },
      ],
    })
    useKnowledgeStore.getState().dropRecent('spc_1', 'doc_0')
    const recent = useKnowledgeStore.getState().recent
    expect(recent.map((r) => r.docId)).toEqual(['doc_1'])
    const parsed = JSON.parse(localStorage.getItem('hip-knowledge-recent')!) as Array<{
      docId: string
    }>
    expect(parsed.map((r) => r.docId)).toEqual(['doc_1'])
  })
})
