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
const knowledgeSaveVersion = vi.fn()
const knowledgeListVersions = vi.fn()
const knowledgeRestoreVersion = vi.fn()

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
  knowledgeSaveVersion: (...a: unknown[]) => knowledgeSaveVersion(...a),
  knowledgeListVersions: (...a: unknown[]) => knowledgeListVersions(...a),
  knowledgeRestoreVersion: (...a: unknown[]) => knowledgeRestoreVersion(...a),
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
      editing: true,
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

  afterEach(() => {
    vi.useRealTimers()
  })

  it('defaults to none when not editing (no autosave schedule)', async () => {
    useKnowledgeStore.getState().setDraftBody('preview-dirty')
    expect(useKnowledgeStore.getState().draftBody).toBe('preview-dirty')
    await vi.advanceTimersByTimeAsync(600)
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().docBody).toBe('saved')
  })

  it('defaults to auto when editing (schedules flush)', async () => {
    useKnowledgeStore.setState({ editing: true })
    useKnowledgeStore.getState().setDraftBody('edited')
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(500)
    expect(knowledgeWriteDoc).toHaveBeenCalledWith('spc_1', 'doc_1', 'edited')
    expect(useKnowledgeStore.getState().docBody).toBe('edited')
    expect(useKnowledgeStore.getState().saveState).toBe('saved')
  })

  it('persist now flushes immediately even when not editing', async () => {
    useKnowledgeStore.getState().setDraftBody('- [x] task', { persist: 'now' })
    // Drain saveChain: setDraftBody fire-and-forgets flushSave; chaining awaits completion.
    await useKnowledgeStore.getState().flushSave()
    expect(knowledgeWriteDoc).toHaveBeenCalledWith('spc_1', 'doc_1', '- [x] task')
    expect(useKnowledgeStore.getState().docBody).toBe('- [x] task')
    expect(useKnowledgeStore.getState().draftBody).toBe('- [x] task')
  })

  it('persist none skips schedule even when editing', async () => {
    useKnowledgeStore.setState({ editing: true })
    useKnowledgeStore.getState().setDraftBody('no-save', { persist: 'none' })
    await vi.advanceTimersByTimeAsync(600)
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().draftBody).toBe('no-save')
    expect(useKnowledgeStore.getState().docBody).toBe('saved')
  })

  it('persist none cancels a pending auto schedule', async () => {
    useKnowledgeStore.setState({ editing: true })
    useKnowledgeStore.getState().setDraftBody('a') // schedules autosave
    useKnowledgeStore.getState().setDraftBody('b', { persist: 'none' })
    await vi.advanceTimersByTimeAsync(600)
    expect(knowledgeWriteDoc).not.toHaveBeenCalled()
    expect(useKnowledgeStore.getState().draftBody).toBe('b')
    expect(useKnowledgeStore.getState().docBody).toBe('saved')
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
      editing: true,
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

