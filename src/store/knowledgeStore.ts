import { create } from 'zustand'
import { toast } from 'sonner'
import type { KnowledgeNode, KnowledgeRecentItem, KnowledgeSpace } from '@/domain/knowledge/types'
import { newDocId, newFolderId } from '@/domain/knowledge/ids'
import {
  collectDocIdsInSubtree,
  getPathTitles,
  insertNode,
  moveNode as moveNodePure,
  nextOrder,
  removeNodeSubtree,
  renameNode,
} from '@/domain/knowledge/tree'
import {
  createKnowledgeIndex,
  docKey,
  removeSearchDoc,
  searchKnowledge,
  upsertSearchDoc,
  type KnowledgeSearchHit,
} from '@/domain/knowledge/search'
import {
  knowledgeCreateSpace,
  knowledgeDeleteDocFile,
  knowledgeDeleteSpace,
  knowledgeEnsureRoot,
  knowledgeErrorMessage,
  knowledgeGetTree,
  knowledgeListSpaces,
  knowledgeReadDoc,
  knowledgeSaveTree,
  knowledgeUpdateSpace,
  knowledgeWriteDoc,
} from '@/ipc/knowledge'

/** Module-level index (not serializable; not stored in zustand state). */
let kbIndex = createKnowledgeIndex()
let indexBuildGen = 0

const RECENT_KEY = 'hip-knowledge-recent'
/** Cap for “最近打开” on the knowledge home page (and localStorage). */
const RECENT_CAP = 8
const LAYOUT_KEY = 'hip-knowledge-source-layout'

export type KnowledgeSourceLayout = 'source' | 'split'

function loadSourceLayout(): KnowledgeSourceLayout {
  if (typeof localStorage === 'undefined') return 'source'
  try {
    const v = localStorage.getItem(LAYOUT_KEY)
    return v === 'split' ? 'split' : 'source'
  } catch {
    return 'source'
  }
}

function persistSourceLayout(layout: KnowledgeSourceLayout) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(LAYOUT_KEY, layout)
  } catch {
    // ignore quota
  }
}

function loadRecent(): KnowledgeRecentItem[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as KnowledgeRecentItem[]
    return Array.isArray(parsed) ? parsed.slice(0, RECENT_CAP) : []
  } catch {
    return []
  }
}

function persistRecent(recent: KnowledgeRecentItem[]) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, RECENT_CAP)))
  } catch {
    // ignore quota
  }
}

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
type IndexStatus = 'idle' | 'building' | 'ready' | 'error'

interface KnowledgeState {
  loaded: boolean
  spaces: KnowledgeSpace[]
  activeSpaceId: string | null
  nodes: KnowledgeNode[]
  activeDocId: string | null
  docBody: string
  draftBody: string
  editing: boolean
  /** Meaningful when editing; persisted in localStorage. */
  sourceLayout: KnowledgeSourceLayout
  mode: 'home' | 'workspace'
  searchQuery: string
  searchHits: KnowledgeSearchHit[]
  indexStatus: IndexStatus
  /** Doc counts per space, filled when the search index is built. */
  spaceDocCounts: Record<string, number>
  recent: KnowledgeRecentItem[]
  expandedFolderIds: Record<string, boolean>
  busy: boolean
  error: string | null
  saveState: SaveState

  loadSpaces: () => Promise<void>
  rebuildSearchIndex: () => Promise<void>
  runSearch: (q: string) => void
  createSpace: (name: string, icon?: string) => Promise<KnowledgeSpace | null>
  renameSpace: (id: string, name: string, icon?: string) => Promise<void>
  deleteSpace: (id: string) => Promise<void>
  openSpace: (id: string, opts?: { selectDocId?: string }) => Promise<void>
  openRecent: (item: KnowledgeRecentItem) => Promise<void>
  openHome: () => Promise<void>
  createFolder: (parentId: string | null, title: string) => Promise<void>
  createDoc: (parentId: string | null, title: string) => Promise<void>
  renameNode: (id: string, title: string) => Promise<void>
  deleteNode: (id: string) => Promise<void>
  moveNode: (id: string, parentId: string | null, toIndex?: number) => Promise<void>
  openDoc: (id: string) => Promise<void>
  setEditing: (v: boolean) => Promise<void>
  setSourceLayout: (layout: KnowledgeSourceLayout) => void
  setDraftBody: (v: string) => void
  /** Returns false if a write was attempted and failed. */
  flushSave: () => Promise<boolean>
  setSearchQuery: (q: string) => void
  toggleFolder: (id: string) => void
  dropRecent: (spaceId: string | null, docId: string) => void
}

function indexCurrentDoc(
  spaceId: string,
  docId: string,
  title: string,
  body: string,
  spaceName: string,
  nodes: KnowledgeNode[],
) {
  const path = getPathTitles(nodes, docId).join(' / ') || title
  upsertSearchDoc(kbIndex, {
    id: docKey(spaceId, docId),
    spaceId,
    docId,
    title,
    body,
    spaceName,
    path,
  })
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveChain: Promise<boolean> = Promise.resolve(true)

function scheduleSave(get: () => KnowledgeState) {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    saveTimer = null
    void get().flushSave()
  }, 500)
}

export const useKnowledgeStore = create<KnowledgeState>((set, get) => ({
  loaded: false,
  spaces: [],
  activeSpaceId: null,
  nodes: [],
  activeDocId: null,
  docBody: '',
  draftBody: '',
  editing: false,
  sourceLayout: loadSourceLayout(),
  mode: 'home',
  searchQuery: '',
  searchHits: [],
  indexStatus: 'idle',
  spaceDocCounts: {},
  recent: [],
  expandedFolderIds: {},
  busy: false,
  error: null,
  saveState: 'idle',

  loadSpaces: async () => {
    set({ error: null })
    try {
      await knowledgeEnsureRoot()
      const spaces = await knowledgeListSpaces()
      set({ spaces, loaded: true, recent: loadRecent() })
      void get().rebuildSearchIndex()
    } catch (e) {
      set({ error: knowledgeErrorMessage(e), loaded: true })
    }
  },

  rebuildSearchIndex: async () => {
    const gen = ++indexBuildGen
    set({ indexStatus: 'building' })
    const next = createKnowledgeIndex()
    const counts: Record<string, number> = {}
    try {
      const spaces = get().spaces
      for (const space of spaces) {
        if (gen !== indexBuildGen) return
        const tree = await knowledgeGetTree(space.id)
        const nodes = tree.nodes ?? []
        let docs = 0
        for (const node of nodes) {
          if (node.kind !== 'doc') continue
          docs += 1
          if (gen !== indexBuildGen) return
          let body = ''
          try {
            body = await knowledgeReadDoc(space.id, node.id)
          } catch {
            body = ''
          }
          const path = getPathTitles(nodes, node.id).join(' / ') || node.title
          upsertSearchDoc(next, {
            id: docKey(space.id, node.id),
            spaceId: space.id,
            docId: node.id,
            title: node.title,
            body,
            spaceName: space.name,
            path,
          })
        }
        counts[space.id] = docs
      }
      if (gen !== indexBuildGen) return
      kbIndex = next
      set({ indexStatus: 'ready', spaceDocCounts: counts })
      get().runSearch(get().searchQuery)
    } catch {
      if (gen !== indexBuildGen) return
      set({ indexStatus: 'error' })
    }
  },

  runSearch: (q) => {
    const query = q.trim()
    if (!query || get().indexStatus !== 'ready') {
      set({ searchHits: [] })
      return
    }
    set({ searchHits: searchKnowledge(kbIndex, query) })
  },

  createSpace: async (name, icon) => {
    if (get().busy) return null
    set({ busy: true, error: null })
    try {
      const space = await knowledgeCreateSpace(name, icon)
      set((s) => ({
        spaces: [...s.spaces, space],
        spaceDocCounts: { ...s.spaceDocCounts, [space.id]: 0 },
        busy: false,
      }))
      return space
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ busy: false, error: msg })
      toast.error(msg)
      return null
    }
  },

  renameSpace: async (id, name, icon) => {
    if (get().busy) return
    set({ busy: true, error: null })
    try {
      const updated = await knowledgeUpdateSpace(id, { name, icon })
      set((s) => ({
        spaces: s.spaces.map((x) => (x.id === id ? updated : x)),
        busy: false,
      }))
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ busy: false, error: msg })
      toast.error(msg)
    }
  },

  deleteSpace: async (id) => {
    if (get().busy) return
    set({ busy: true, error: null })
    try {
      await knowledgeDeleteSpace(id)
      const wasActive = get().activeSpaceId === id
      // Drop all index entries for this space (best-effort full rebuild also fine).
      for (const hit of get().searchHits) {
        if (hit.spaceId === id) removeSearchDoc(kbIndex, docKey(id, hit.docId))
      }
      // Also discard by scanning stored ids: MiniSearch has no list-all API cheaply —
      // rebuild keeps consistency after destructive space ops.
      set((s) => {
        const { [id]: _removed, ...restCounts } = s.spaceDocCounts
        return {
          spaces: s.spaces.filter((x) => x.id !== id),
          recent: s.recent.filter((r) => r.spaceId !== id),
          spaceDocCounts: restCounts,
          busy: false,
        }
      })
      persistRecent(get().recent)
      void get().rebuildSearchIndex()
      if (wasActive) await get().openHome()
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ busy: false, error: msg })
      toast.error(msg)
    }
  },

  openSpace: async (id, opts) => {
    await get().flushSave()
    set({ error: null })
    try {
      const tree = await knowledgeGetTree(id)
      set({
        activeSpaceId: id,
        nodes: tree.nodes ?? [],
        mode: 'workspace',
        expandedFolderIds: {},
      })
      if (opts?.selectDocId) {
        await get().openDoc(opts.selectDocId)
      } else {
        set({ activeDocId: null, docBody: '', draftBody: '', editing: false })
      }
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ error: msg })
      toast.error(msg)
    }
  },

  openRecent: async (item) => {
    await get().openSpace(item.spaceId, { selectDocId: item.docId })
  },

  openHome: async () => {
    await get().flushSave()
    set({
      mode: 'home',
      activeDocId: null,
      docBody: '',
      draftBody: '',
      editing: false,
      // keep activeSpaceId for chip? design: clear active doc; can keep space or clear
      activeSpaceId: null,
      nodes: [],
    })
  },

  createFolder: async (parentId, title) => {
    const spaceId = get().activeSpaceId
    if (!spaceId || get().busy) return
    set({ busy: true })
    try {
      const now = Date.now()
      const node = {
        id: newFolderId(),
        parentId,
        kind: 'folder' as const,
        title: title.trim() || 'New folder',
        order: nextOrder(get().nodes, parentId),
        createdAt: now,
        updatedAt: now,
      }
      const nodes = insertNode(get().nodes, node)
      await knowledgeSaveTree(spaceId, { version: 1, nodes })
      set({ nodes, busy: false })
      if (parentId) {
        set((s) => ({ expandedFolderIds: { ...s.expandedFolderIds, [parentId]: true } }))
      }
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ busy: false, error: msg })
      toast.error(msg)
    }
  },

  createDoc: async (parentId, title) => {
    const spaceId = get().activeSpaceId
    if (!spaceId || get().busy) return
    set({ busy: true })
    try {
      const now = Date.now()
      const id = newDocId()
      await knowledgeWriteDoc(spaceId, id, '')
      const node = {
        id,
        parentId,
        kind: 'doc' as const,
        title: title || 'Untitled',
        order: nextOrder(get().nodes, parentId),
        createdAt: now,
        updatedAt: now,
      }
      const nodes = insertNode(get().nodes, node)
      await knowledgeSaveTree(spaceId, { version: 1, nodes })
      const spaceName = get().spaces.find((s) => s.id === spaceId)?.name ?? ''
      indexCurrentDoc(spaceId, id, node.title, '', spaceName, nodes)
      set((s) => ({
        nodes,
        busy: false,
        spaceDocCounts: {
          ...s.spaceDocCounts,
          [spaceId]: (s.spaceDocCounts[spaceId] ?? 0) + 1,
        },
      }))
      if (parentId) {
        set((s) => ({ expandedFolderIds: { ...s.expandedFolderIds, [parentId]: true } }))
      }
      get().runSearch(get().searchQuery)
      // openDoc defaults to editing: true
      await get().openDoc(id)
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ busy: false, error: msg })
      toast.error(msg)
    }
  },

  renameNode: async (id, title) => {
    const spaceId = get().activeSpaceId
    if (!spaceId || get().busy) return
    set({ busy: true })
    try {
      const nodes = renameNode(get().nodes, id, title.trim() || 'Untitled')
      await knowledgeSaveTree(spaceId, { version: 1, nodes })
      set({ nodes, busy: false })
      const renamed = nodes.find((n) => n.id === id)
      if (renamed?.kind === 'doc') {
        const spaceName = get().spaces.find((s) => s.id === spaceId)?.name ?? ''
        let body = ''
        try {
          body = await knowledgeReadDoc(spaceId, id)
        } catch {
          body = get().activeDocId === id ? get().docBody : ''
        }
        indexCurrentDoc(spaceId, id, renamed.title, body, spaceName, nodes)
        get().runSearch(get().searchQuery)
      }
      // update recent title if needed
      set((s) => ({
        recent: s.recent.map((r) =>
          r.spaceId === spaceId && r.docId === id ? { ...r, title: title.trim() || 'Untitled' } : r,
        ),
      }))
      persistRecent(get().recent)
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ busy: false, error: msg })
      toast.error(msg)
    }
  },

  moveNode: async (id, parentId, toIndex) => {
    const spaceId = get().activeSpaceId
    if (!spaceId || get().busy) return
    const flushed = await get().flushSave()
    if (!flushed) return
    set({ busy: true })
    try {
      const nodes = moveNodePure(get().nodes, id, parentId, toIndex)
      await knowledgeSaveTree(spaceId, { version: 1, nodes })
      set({ nodes, busy: false })
      if (parentId) {
        set((s) => ({ expandedFolderIds: { ...s.expandedFolderIds, [parentId]: true } }))
      }
      const spaceName = get().spaces.find((s) => s.id === spaceId)?.name ?? ''
      const docIds = collectDocIdsInSubtree(nodes, id)
      for (const docId of docIds) {
        const title = nodes.find((n) => n.id === docId)?.title ?? ''
        let body = ''
        try {
          body = await knowledgeReadDoc(spaceId, docId)
        } catch {
          body = get().activeDocId === docId ? get().docBody : ''
        }
        indexCurrentDoc(spaceId, docId, title, body, spaceName, nodes)
      }
      get().runSearch(get().searchQuery)
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ busy: false, error: msg })
      toast.error(msg)
    }
  },

  deleteNode: async (id) => {
    const spaceId = get().activeSpaceId
    if (!spaceId || get().busy) return
    const flushed = await get().flushSave()
    if (!flushed) return
    set({ busy: true })
    try {
      const { nodes, removedDocIds } = removeNodeSubtree(get().nodes, id)
      await knowledgeSaveTree(spaceId, { version: 1, nodes })
      for (const docId of removedDocIds) {
        await knowledgeDeleteDocFile(spaceId, docId)
        removeSearchDoc(kbIndex, docKey(spaceId, docId))
      }
      const activeRemoved = get().activeDocId != null && removedDocIds.includes(get().activeDocId!)
      set((s) => {
        const prevCount = s.spaceDocCounts[spaceId]
        const nextCounts =
          prevCount == null
            ? s.spaceDocCounts
            : {
                ...s.spaceDocCounts,
                [spaceId]: Math.max(0, prevCount - removedDocIds.length),
              }
        return {
          nodes,
          busy: false,
          spaceDocCounts: nextCounts,
          recent: s.recent.filter(
            (r) => !(r.spaceId === spaceId && removedDocIds.includes(r.docId)),
          ),
          ...(activeRemoved
            ? { activeDocId: null, docBody: '', draftBody: '', editing: false }
            : {}),
        }
      })
      persistRecent(get().recent)
      get().runSearch(get().searchQuery)
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ busy: false, error: msg })
      toast.error(msg)
    }
  },

  openDoc: async (id) => {
    await get().flushSave()
    const spaceId = get().activeSpaceId
    const node = get().nodes.find((n) => n.id === id && n.kind === 'doc')
    if (!node || !spaceId) {
      toast.error('Could not load document')
      get().dropRecent(spaceId, id)
      set({ activeDocId: null, docBody: '', draftBody: '', editing: false })
      return
    }
    try {
      const body = await knowledgeReadDoc(spaceId, id)
      set({ activeDocId: id, docBody: body, draftBody: body, editing: true, saveState: 'idle' })
      const spaceName = get().spaces.find((s) => s.id === spaceId)?.name ?? ''
      const item: KnowledgeRecentItem = {
        spaceId,
        docId: id,
        title: node.title,
        spaceName,
        at: Date.now(),
      }
      set((s) => {
        const rest = s.recent.filter((r) => !(r.spaceId === item.spaceId && r.docId === item.docId))
        const recent = [item, ...rest].slice(0, RECENT_CAP)
        persistRecent(recent)
        return { recent }
      })
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      toast.error(msg)
      get().dropRecent(spaceId, id)
      set({ activeDocId: null, docBody: '', draftBody: '', editing: false })
    }
  },

  setEditing: async (v) => {
    if (v) {
      set({ editing: true, draftBody: get().docBody })
    } else {
      await get().flushSave()
      set({ editing: false })
    }
  },

  setSourceLayout: (layout) => {
    if (layout !== 'source' && layout !== 'split') return
    if (get().sourceLayout === layout) return
    persistSourceLayout(layout)
    set({ sourceLayout: layout })
  },

  setDraftBody: (v) => {
    set({ draftBody: v })
    if (get().editing) scheduleSave(get)
  },

  flushSave: () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const run = async (): Promise<boolean> => {
      const s = get()
      if (!s.activeSpaceId || !s.activeDocId) return true
      if (s.draftBody === s.docBody) return true
      set({ saveState: 'saving' })
      try {
        await knowledgeWriteDoc(s.activeSpaceId, s.activeDocId, s.draftBody)
        set({ docBody: s.draftBody, saveState: 'saved' })
        const node = get().nodes.find((n) => n.id === s.activeDocId)
        const spaceName = get().spaces.find((sp) => sp.id === s.activeSpaceId)?.name ?? ''
        if (node && s.activeSpaceId && s.activeDocId) {
          indexCurrentDoc(
            s.activeSpaceId,
            s.activeDocId,
            node.title,
            s.draftBody,
            spaceName,
            get().nodes,
          )
          get().runSearch(get().searchQuery)
        }
        setTimeout(() => {
          if (get().saveState === 'saved') set({ saveState: 'idle' })
        }, 1500)
        return true
      } catch (e) {
        const msg = knowledgeErrorMessage(e)
        set({ saveState: 'error' })
        toast.error(msg)
        return false
      }
    }
    saveChain = saveChain.then(run, () => run())
    return saveChain
  },

  setSearchQuery: (q) => {
    set({ searchQuery: q })
    get().runSearch(q)
  },

  toggleFolder: (id) =>
    set((s) => ({
      expandedFolderIds: { ...s.expandedFolderIds, [id]: !s.expandedFolderIds[id] },
    })),

  dropRecent: (spaceId, docId) => {
    if (!spaceId) return
    set((s) => {
      const recent = s.recent.filter((r) => !(r.spaceId === spaceId && r.docId === docId))
      persistRecent(recent)
      return { recent }
    })
  },
}))

/** Palette / external search against the live MiniSearch index. */
export function searchKnowledgeDocs(q: string, limit = 20): KnowledgeSearchHit[] {
  return searchKnowledge(kbIndex, q, limit)
}

export function isKnowledgeIndexReady(): boolean {
  return useKnowledgeStore.getState().indexStatus === 'ready'
}
