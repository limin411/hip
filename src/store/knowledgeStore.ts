import { create } from 'zustand'
import { toast } from 'sonner'
import i18n from '@/i18n'
import type {
  KnowledgeNode,
  KnowledgeRecentItem,
  KnowledgeSpace,
  KnowledgeVersionEntry,
} from '@/domain/knowledge/types'
import { newDocId, newFolderId } from '@/domain/knowledge/ids'
import { localDayKey } from '@/domain/knowledge/limits'
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
import { isSpaceNameTaken, normalizeSpaceName } from '@/domain/knowledge/spaceName'
import {
  knowledgeCreateSpace,
  knowledgeDeleteDocFile,
  knowledgeDeleteSpace,
  knowledgeEnsureRoot,
  knowledgeErrorMessage,
  knowledgeGetTree,
  knowledgeListSpaces,
  knowledgeListVersions,
  knowledgeReadDoc,
  knowledgeRestoreVersion,
  knowledgeSaveTree,
  knowledgeSaveVersion,
  knowledgeUpdateSpace,
  knowledgeWriteDoc,
} from '@/ipc/knowledge'

/** Module-level index (not serializable; not stored in zustand state). */
let kbIndex = createKnowledgeIndex()
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
  /** @returns false when validation or IPC fails (or busy). */
  renameSpace: (id: string, name: string, icon?: string) => Promise<boolean>
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
  /**
   * Update draft body. Default persist mode: 'auto' while editing (schedule
   * autosave), 'none' otherwise. Pass `persist: 'now'` for immediate flush
   * (e.g. preview task write-back).
   */
  setDraftBody: (v: string, opts?: { persist?: 'auto' | 'now' | 'none' }) => void
  /**
   * Returns false if a write was attempted and failed.
   * On successful write, awaits the daily snapshot on the same chain so callers
   * (delete / manual version) never race an in-flight daily.
   */
  flushSave: () => Promise<boolean>
  /** Manual snapshot of the active (or given) doc; flushes first, then serializes on saveChain. */
  saveVersionManual: (docId?: string) => Promise<KnowledgeVersionEntry | null>
  listVersions: (docId?: string) => Promise<KnowledgeVersionEntry[]>
  /** Restore snapshot into live doc + active buffer when that doc is open. */
  restoreVersion: (versionId: string, docId?: string) => Promise<boolean>
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

function cancelScheduledSave() {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
}

function scheduleSave(get: () => KnowledgeState) {
  cancelScheduledSave()
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
        })
      }
      await knowledgeDeleteSpace(id)
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
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ busy: false, error: msg })
      toast.error(msg)
    }
  },

  openSpace: async (id, opts) => {
    const ok = await get().flushSave()
    if (!ok) return // stay on current space/doc; saveState error + retry chrome
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
    const ok = await get().flushSave()
    if (!ok) return // stay in workspace; saveState error + retry chrome
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
    // Flush-gate before creating so a failed dirty save cannot orphan a new empty doc.
    const flushed = await get().flushSave()
    if (!flushed) return
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
    const ok = await get().flushSave()
    if (!ok) return // stay on current activeDocId; saveState error + retry chrome
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

  setDraftBody: (v, opts) => {
    set({ draftBody: v })
    // Until editorMode lands: derive default from editing (source autosave vs preview none).
    const editing = get().editing
    const persist = opts?.persist ?? (editing ? 'auto' : 'none')
    if (persist === 'auto') scheduleSave(get)
    else if (persist === 'now') void get().flushSave()
    else cancelScheduledSave() // 'none': draft only; drop any pending autosave
  },

  flushSave: () => {
    cancelScheduledSave()
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
        // Daily snapshot on the same chain step so await flushSave drains it
        // (delete/manual must not race an in-flight daily).
        try {
          await knowledgeSaveVersion(
            s.activeSpaceId,
            s.activeDocId,
            'daily',
            localDayKey(),
          )
        } catch {
          // Snapshots must not surface as save failures.
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

  saveVersionManual: async (docId) => {
    const spaceId = get().activeSpaceId
    const id = docId ?? get().activeDocId
    if (!spaceId || !id) return null
    const ok = await get().flushSave()
    if (!ok) return null
    // Serialize on saveChain so manual never RMW-races a concurrent daily.
    let entry: KnowledgeVersionEntry | null = null
    let errMsg: string | null = null
    saveChain = saveChain.then(async (prev) => {
      if (!prev) return prev
      try {
        entry = await knowledgeSaveVersion(spaceId, id, 'manual')
      } catch (e) {
        errMsg = knowledgeErrorMessage(e)
      }
      return prev
    })
    await saveChain
    if (errMsg) {
      toast.error(errMsg)
      return null
    }
    if (entry) toast.success(i18n.t('knowledge.versions.saved'))
    return entry
  },

  listVersions: async (docId) => {
    const spaceId = get().activeSpaceId
    const id = docId ?? get().activeDocId
    if (!spaceId || !id) return []
    try {
      return await knowledgeListVersions(spaceId, id)
    } catch (e) {
      toast.error(knowledgeErrorMessage(e))
      return []
    }
  },

  restoreVersion: async (versionId, docId) => {
    const spaceId = get().activeSpaceId
    const id = docId ?? get().activeDocId
    if (!spaceId || !id) return false
    // Flush current dirty buffer first so we don't silently drop it.
    const ok = await get().flushSave()
    if (!ok) return false
    try {
      const body = await knowledgeRestoreVersion(spaceId, id, versionId)
      if (get().activeDocId === id) {
        set({ docBody: body, draftBody: body, saveState: 'idle' })
      }
      const node = get().nodes.find((n) => n.id === id)
      const spaceName = get().spaces.find((sp) => sp.id === spaceId)?.name ?? ''
      if (node) {
        indexCurrentDoc(spaceId, id, node.title, body, spaceName, get().nodes)
        get().runSearch(get().searchQuery)
      }
      toast.success(i18n.t('knowledge.versions.restored'))
      return true
    } catch (e) {
      toast.error(knowledgeErrorMessage(e))
      return false
    }
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
