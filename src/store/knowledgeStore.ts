import { create } from 'zustand'
import { toast } from 'sonner'
import i18n from '@/i18n'
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
  collectSearchFacets,
  createKnowledgeIndex,
  docKey,
  filterHitsByMeta,
  listDocsByMeta,
  removeSearchDoc,
  searchKnowledge,
  upsertSearchDoc,
  type KnowledgeDocMetaEntry,
  type KnowledgeSearchHit,
} from '@/domain/knowledge/search'
import { KNOWLEDGE_INDEX_YIELD_EVERY } from '@/domain/knowledge/limits'
import { isSpaceNameTaken, normalizeSpaceName } from '@/domain/knowledge/spaceName'
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
/** Structured frontmatter meta parallel to MiniSearch (facets + wiki aliases). */
let kbMeta = new Map<string, KnowledgeDocMetaEntry>()
let indexBuildGen = 0

/** Map stable backend name errors to localized copy. */
function mapSpaceNameError(raw: string, name: string): string {
  if (raw === 'space name already exists') {
    return i18n.t('knowledge.space.nameDuplicate', { name })
  }
  if (raw === 'space name is empty') {
    return i18n.t('knowledge.space.nameEmpty')
  }
  return raw
}

const RECENT_KEY = 'hip-knowledge-recent'
/** Cap for “最近打开” on the knowledge home page (and localStorage). */
const RECENT_CAP = 8

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

export type KnowledgeIndexProgress = {
  done: number
  total: number
  spaceName?: string
}

export type KnowledgePendingReveal = {
  query: string
  /** Only apply reveal when this space/doc is still active. */
  spaceId: string
  docId: string
}

/** Yield so React can paint index progress (and avoid long freezes). */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

interface KnowledgeState {
  loaded: boolean
  spaces: KnowledgeSpace[]
  activeSpaceId: string | null
  nodes: KnowledgeNode[]
  activeDocId: string | null
  docBody: string
  draftBody: string
  editing: boolean
  mode: 'home' | 'workspace'
  searchQuery: string
  searchHits: KnowledgeSearchHit[]
  indexStatus: IndexStatus
  /** n/N progress while `indexStatus === 'building'`; null when idle/ready. */
  indexProgress: KnowledgeIndexProgress | null
  /** After opening a search hit, UI scrolls near this query (best-effort). */
  pendingReveal: KnowledgePendingReveal | null
  /** Doc counts per space, filled when the search index is built. */
  spaceDocCounts: Record<string, number>
  /** Facet values from indexed frontmatter (sorted). */
  availableTags: string[]
  availableStatuses: string[]
  /** Home filter chips (null = no filter). */
  filterTag: string | null
  filterStatus: string | null
  recent: KnowledgeRecentItem[]
  expandedFolderIds: Record<string, boolean>
  busy: boolean
  error: string | null
  saveState: SaveState

  loadSpaces: () => Promise<void>
  rebuildSearchIndex: () => Promise<void>
  runSearch: (q: string) => void
  createSpace: (name: string, icon?: string) => Promise<KnowledgeSpace | null>
  /** @returns false when validation or IPC fails (or busy). */
  renameSpace: (id: string, name: string, icon?: string) => Promise<boolean>
  deleteSpace: (id: string) => Promise<void>
  openSpace: (id: string, opts?: { selectDocId?: string }) => Promise<void>
  openRecent: (item: KnowledgeRecentItem) => Promise<void>
  /** Open a search hit and request scroll-to-match via `pendingReveal`. */
  openSearchHit: (hit: KnowledgeSearchHit) => Promise<void>
  clearPendingReveal: () => void
  openHome: () => Promise<void>
  createFolder: (parentId: string | null, title: string) => Promise<void>
  createDoc: (parentId: string | null, title: string) => Promise<void>
  renameNode: (id: string, title: string) => Promise<void>
  deleteNode: (id: string) => Promise<void>
  moveNode: (id: string, parentId: string | null, toIndex?: number) => Promise<void>
  openDoc: (id: string) => Promise<void>
  setEditing: (v: boolean) => Promise<void>
  setDraftBody: (v: string) => void
  /** Returns false if a write was attempted and failed. */
  flushSave: () => Promise<boolean>
  setSearchQuery: (q: string) => void
  setFilterTag: (tag: string | null) => void
  setFilterStatus: (status: string | null) => void
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
  const order = nodes.find((n) => n.id === docId)?.order ?? Number.MAX_SAFE_INTEGER
  upsertSearchDoc(kbIndex, {
    id: docKey(spaceId, docId),
    spaceId,
    docId,
    title,
    body,
    spaceName,
    path,
    order,
    metaSink: kbMeta,
  })
}

/**
 * Refresh facet lists and drop stale filterTag/filterStatus that no longer exist
 * (avoids Home empty-results trap when last tagged doc is deleted).
 */
function syncFacetsToState(set: (partial: Partial<KnowledgeState>) => void) {
  const facets = collectSearchFacets(kbMeta)
  const { filterTag, filterStatus } = useKnowledgeStore.getState()
  const nextTag =
    filterTag && facets.tags.some((t) => t.toLowerCase() === filterTag.toLowerCase())
      ? filterTag
      : null
  const nextStatus =
    filterStatus &&
    facets.statuses.some((s) => s.toLowerCase() === filterStatus.toLowerCase())
      ? filterStatus
      : null
  set({
    availableTags: facets.tags,
    availableStatuses: facets.statuses,
    filterTag: nextTag,
    filterStatus: nextStatus,
  })
}

function applySearchFilters(hits: KnowledgeSearchHit[]): KnowledgeSearchHit[] {
  const { filterTag, filterStatus } = useKnowledgeStore.getState()
  return filterHitsByMeta(hits, { tag: filterTag, status: filterStatus })
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
    set({ indexStatus: 'building', indexProgress: { done: 0, total: 0 } })
    const next = createKnowledgeIndex()
    const nextMeta = new Map<string, KnowledgeDocMetaEntry>()
    const counts: Record<string, number> = {}
    try {
      const spaces = get().spaces
      // Preload trees so we can report accurate n/N progress.
      const loaded: { space: (typeof spaces)[number]; nodes: KnowledgeNode[] }[] = []
      let total = 0
      for (const space of spaces) {
        if (gen !== indexBuildGen) return
        const tree = await knowledgeGetTree(space.id)
        const nodes = tree.nodes ?? []
        total += nodes.reduce((n, node) => n + (node.kind === 'doc' ? 1 : 0), 0)
        loaded.push({ space, nodes })
      }
      if (gen !== indexBuildGen) return
      set({ indexProgress: { done: 0, total } })

      let done = 0
      for (const { space, nodes } of loaded) {
        if (gen !== indexBuildGen) return
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
          // Body is stripped of frontmatter + capped inside upsertSearchDoc.
          upsertSearchDoc(next, {
            id: docKey(space.id, node.id),
            spaceId: space.id,
            docId: node.id,
            title: node.title,
            body,
            spaceName: space.name,
            path,
            order: node.order,
            metaSink: nextMeta,
          })
          done += 1
          if (done % KNOWLEDGE_INDEX_YIELD_EVERY === 0) {
            if (gen !== indexBuildGen) return
            set({ indexProgress: { done, total, spaceName: space.name } })
            await yieldToUi()
            if (gen !== indexBuildGen) return
          }
        }
        counts[space.id] = docs
        if (gen !== indexBuildGen) return
        set({ indexProgress: { done, total, spaceName: space.name } })
      }
      if (gen !== indexBuildGen) return
      kbIndex = next
      kbMeta = nextMeta
      set({
        indexStatus: 'ready',
        spaceDocCounts: counts,
        indexProgress: null,
      })
      // Also drops stale filterTag/filterStatus when facets no longer include them.
      syncFacetsToState(set)
      get().runSearch(get().searchQuery)
    } catch {
      if (gen !== indexBuildGen) return
      set({ indexStatus: 'error', indexProgress: null })
    }
  },

  runSearch: (q) => {
    if (get().indexStatus !== 'ready') {
      set({ searchHits: [] })
      return
    }
    const query = q.trim()
    const { filterTag, filterStatus } = get()
    if (!query) {
      // Tag/status-only browse: list matching docs from meta map.
      if (filterTag || filterStatus) {
        set({
          searchHits: listDocsByMeta(kbMeta, { tag: filterTag, status: filterStatus }),
        })
        return
      }
      set({ searchHits: [] })
      return
    }
    set({ searchHits: applySearchFilters(searchKnowledge(kbIndex, query)) })
  },

  createSpace: async (name, icon) => {
    if (get().busy) return null
    const trimmed = normalizeSpaceName(name)
    if (!trimmed) {
      const msg = i18n.t('knowledge.space.nameEmpty')
      set({ error: msg })
      toast.error(msg)
      return null
    }
    if (isSpaceNameTaken(get().spaces, trimmed)) {
      const msg = i18n.t('knowledge.space.nameDuplicate', { name: trimmed })
      set({ error: msg })
      toast.error(msg)
      return null
    }
    set({ busy: true, error: null })
    try {
      const space = await knowledgeCreateSpace(trimmed, icon)
      set((s) => ({
        spaces: [...s.spaces, space],
        spaceDocCounts: { ...s.spaceDocCounts, [space.id]: 0 },
        busy: false,
      }))
      return space
    } catch (e) {
      const msg = mapSpaceNameError(knowledgeErrorMessage(e), trimmed)
      set({ busy: false, error: msg })
      toast.error(msg)
      return null
    }
  },

  renameSpace: async (id, name, icon) => {
    if (get().busy) return false
    const trimmed = normalizeSpaceName(name)
    if (!trimmed) {
      const msg = i18n.t('knowledge.space.nameEmpty')
      set({ error: msg })
      toast.error(msg)
      return false
    }
    if (isSpaceNameTaken(get().spaces, trimmed, id)) {
      const msg = i18n.t('knowledge.space.nameDuplicate', { name: trimmed })
      set({ error: msg })
      toast.error(msg)
      return false
    }
    set({ busy: true, error: null })
    try {
      const updated = await knowledgeUpdateSpace(id, { name: trimmed, icon })
      set((s) => ({
        spaces: s.spaces.map((x) => (x.id === id ? updated : x)),
        busy: false,
      }))
      return true
    } catch (e) {
      const msg = mapSpaceNameError(knowledgeErrorMessage(e), trimmed)
      set({ busy: false, error: msg })
      toast.error(msg)
      return false
    }
  },

  deleteSpace: async (id) => {
    if (get().busy) return
    set({ busy: true, error: null })
    try {
      const wasActive = get().activeSpaceId === id
      // Leave workspace *before* disk delete: avoid flushSave rewriting into a wiped
      // tree, and unmount workspace dialogs cleanly while the space still exists in UI.
      if (wasActive) {
        if (saveTimer) {
          clearTimeout(saveTimer)
          saveTimer = null
        }
        set({
          mode: 'home',
          activeSpaceId: null,
          activeDocId: null,
          docBody: '',
          draftBody: '',
          editing: false,
          nodes: [],
          saveState: 'idle',
          pendingReveal: null,
        })
      }
      await knowledgeDeleteSpace(id)
      // Drop all index entries for this space (best-effort full rebuild also fine).
      for (const hit of get().searchHits) {
        if (hit.spaceId === id) removeSearchDoc(kbIndex, docKey(id, hit.docId), kbMeta)
      }
      // Also discard by scanning stored ids: MiniSearch has no list-all API cheaply —
      // rebuild keeps consistency after destructive space ops.
      set((s) => {
        const { [id]: _removed, ...restCounts } = s.spaceDocCounts
        const pendingTargetsDeleted = s.pendingReveal?.spaceId === id
        return {
          spaces: s.spaces.filter((x) => x.id !== id),
          recent: s.recent.filter((r) => r.spaceId !== id),
          spaceDocCounts: restCounts,
          busy: false,
          ...(pendingTargetsDeleted ? { pendingReveal: null } : {}),
        }
      })
      persistRecent(get().recent)
      void get().rebuildSearchIndex()
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
        set({
          activeDocId: null,
          docBody: '',
          draftBody: '',
          editing: false,
          pendingReveal: null,
        })
      }
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ error: msg, pendingReveal: null })
      toast.error(msg)
    }
  },

  openRecent: async (item) => {
    await get().openSpace(item.spaceId, { selectDocId: item.docId })
  },

  openSearchHit: async (hit) => {
    const query = get().searchQuery.trim()
    set({
      pendingReveal: query
        ? { query, spaceId: hit.spaceId, docId: hit.docId }
        : null,
    })
    await get().openRecent({
      spaceId: hit.spaceId,
      docId: hit.docId,
      title: hit.title,
      spaceName: hit.spaceName,
      at: Date.now(),
    })
  },

  clearPendingReveal: () => set({ pendingReveal: null }),

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
      pendingReveal: null,
      filterTag: null,
      filterStatus: null,
    })
    get().runSearch(get().searchQuery)
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
      syncFacetsToState(set)
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
        syncFacetsToState(set)
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
      syncFacetsToState(set)
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
        removeSearchDoc(kbIndex, docKey(spaceId, docId), kbMeta)
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
        const pendingTargetsRemoved =
          s.pendingReveal != null &&
          s.pendingReveal.spaceId === spaceId &&
          removedDocIds.includes(s.pendingReveal.docId)
        return {
          nodes,
          busy: false,
          spaceDocCounts: nextCounts,
          recent: s.recent.filter(
            (r) => !(r.spaceId === spaceId && removedDocIds.includes(r.docId)),
          ),
          ...(activeRemoved
            ? {
                activeDocId: null,
                docBody: '',
                draftBody: '',
                editing: false,
                pendingReveal: null,
              }
            : pendingTargetsRemoved
              ? { pendingReveal: null }
              : {}),
        }
      })
      persistRecent(get().recent)
      syncFacetsToState(set)
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
      set({
        activeDocId: null,
        docBody: '',
        draftBody: '',
        editing: false,
        pendingReveal: null,
      })
      return
    }
    try {
      const body = await knowledgeReadDoc(spaceId, id)
      // Drop pending reveal if it targets a different doc (tree/recent nav mid-flight).
      const pending = get().pendingReveal
      const revealMatches =
        pending != null && pending.spaceId === spaceId && pending.docId === id
      set({
        activeDocId: id,
        docBody: body,
        draftBody: body,
        editing: true,
        saveState: 'idle',
        ...(revealMatches ? {} : { pendingReveal: null }),
      })
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
      set({
        activeDocId: null,
        docBody: '',
        draftBody: '',
        editing: false,
        pendingReveal: null,
      })
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
          syncFacetsToState(set)
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

  setFilterTag: (tag) => {
    set({ filterTag: tag })
    get().runSearch(get().searchQuery)
  },

  setFilterStatus: (status) => {
    set({ filterStatus: status })
    get().runSearch(get().searchQuery)
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

/**
 * Docs in a space with titles + aliases for wiki resolution (PR-12 step 2 / PR-14).
 * Sorted stable tree order: `order` asc, then `title`, then `id` (first-wins).
 */
export function listKnowledgeDocsForWiki(spaceId: string): Array<{
  id: string
  title: string
  aliases: string[]
  order: number
}> {
  const out: Array<{ id: string; title: string; aliases: string[]; order: number }> = []
  for (const entry of kbMeta.values()) {
    if (entry.spaceId !== spaceId) continue
    out.push({
      id: entry.docId,
      title: entry.title,
      aliases: entry.aliases,
      order: entry.order,
    })
  }
  out.sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order
    const titleCmp = a.title.localeCompare(b.title)
    if (titleCmp !== 0) return titleCmp
    return a.id.localeCompare(b.id)
  })
  return out
}
