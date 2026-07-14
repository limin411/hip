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
const knowledgeSaveTree = vi.fn()
const knowledgeListTemplates = vi.fn()
const knowledgeSaveTemplate = vi.fn()
const knowledgeDeleteTemplate = vi.fn()

vi.mock('@/ipc/knowledge', () => ({
  knowledgeEnsureRoot: (...a: unknown[]) => knowledgeEnsureRoot(...a),
  knowledgeListSpaces: (...a: unknown[]) => knowledgeListSpaces(...a),
  knowledgeCreateSpace: (...a: unknown[]) => knowledgeCreateSpace(...a),
  knowledgeUpdateSpace: (...a: unknown[]) => knowledgeUpdateSpace(...a),
  knowledgeDeleteSpace: (...a: unknown[]) => knowledgeDeleteSpace(...a),
  knowledgeGetTree: (...a: unknown[]) => knowledgeGetTree(...a),
  knowledgeSaveTree: (...a: unknown[]) => knowledgeSaveTree(...a),
  knowledgeReadDoc: (...a: unknown[]) => knowledgeReadDoc(...a),
  knowledgeWriteDoc: (...a: unknown[]) => knowledgeWriteDoc(...a),
  knowledgeDeleteDocFile: vi.fn(),
  knowledgeListTemplates: (...a: unknown[]) => knowledgeListTemplates(...a),
  knowledgeSaveTemplate: (...a: unknown[]) => knowledgeSaveTemplate(...a),
  knowledgeDeleteTemplate: (...a: unknown[]) => knowledgeDeleteTemplate(...a),
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
import {
  setExpandPersistSuspended,
  useKnowledgeStore,
} from './knowledgeStore'

const EXPANDED_KEY = 'hip-knowledge-expanded-v1'

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
      treeFocusId: null,
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
    expect(s.treeFocusId).toBe('doc_1')
    expect(s.docBody).toBe('# hello')
    expect(s.draftBody).toBe('# hello')
    expect(s.editing).toBe(true)
    expect(knowledgeReadDoc).toHaveBeenCalledWith('spc_1', 'doc_1')
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
      editing: false,
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
    useKnowledgeStore.setState({ expandedFolderIds: { fld_1: true } })
    await useKnowledgeStore.getState().openSpace('spc_1')
    // no stored map → {}
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
      treeFocusId: 'doc_1',
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
      treeFocusId: null,
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
      editing: false,
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

