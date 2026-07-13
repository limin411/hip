import { create } from 'zustand'
import { toast } from 'sonner'
import type { KnowledgeNode, KnowledgeRecentItem, KnowledgeSpace } from '@/domain/knowledge/types'
import { newDocId, newFolderId } from '@/domain/knowledge/ids'
import { insertNode, nextOrder, removeNodeSubtree, renameNode } from '@/domain/knowledge/tree'
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

const RECENT_KEY = 'hip-knowledge-recent'
const RECENT_CAP = 20

function loadRecent(): KnowledgeRecentItem[] {
  if (typeof localStorage === 'undefined') return []
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as KnowledgeRecentItem[]
    return Array.isArray(parsed) ? parsed : []
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
  recent: KnowledgeRecentItem[]
  expandedFolderIds: Record<string, boolean>
  busy: boolean
  error: string | null
  saveState: SaveState

  loadSpaces: () => Promise<void>
  createSpace: (name: string, icon?: string) => Promise<KnowledgeSpace | null>
  renameSpace: (id: string, name: string, icon?: string) => Promise<void>
  deleteSpace: (id: string) => Promise<void>
  openSpace: (id: string, opts?: { selectDocId?: string }) => Promise<void>
  openRecent: (item: KnowledgeRecentItem) => Promise<void>
  openHome: () => Promise<void>
  createFolder: (parentId: string | null) => Promise<void>
  createDoc: (parentId: string | null, title: string) => Promise<void>
  renameNode: (id: string, title: string) => Promise<void>
  deleteNode: (id: string) => Promise<void>
  openDoc: (id: string) => Promise<void>
  setEditing: (v: boolean) => Promise<void>
  setDraftBody: (v: string) => void
  flushSave: () => Promise<void>
  setSearchQuery: (q: string) => void
  toggleFolder: (id: string) => void
  dropRecent: (spaceId: string | null, docId: string) => void
}

let saveTimer: ReturnType<typeof setTimeout> | null = null
let saveChain: Promise<void> = Promise.resolve()

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
    } catch (e) {
      set({ error: knowledgeErrorMessage(e), loaded: true })
    }
  },

  createSpace: async (name, icon) => {
    if (get().busy) return null
    set({ busy: true, error: null })
    try {
      const space = await knowledgeCreateSpace(name, icon)
      set((s) => ({ spaces: [...s.spaces, space], busy: false }))
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
      set((s) => ({
        spaces: s.spaces.filter((x) => x.id !== id),
        recent: s.recent.filter((r) => r.spaceId !== id),
        busy: false,
      }))
      persistRecent(get().recent)
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

  createFolder: async (parentId) => {
    const spaceId = get().activeSpaceId
    if (!spaceId || get().busy) return
    set({ busy: true })
    try {
      const now = Date.now()
      const node = {
        id: newFolderId(),
        parentId,
        kind: 'folder' as const,
        title: 'New folder',
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
      set({ nodes, busy: false })
      await get().openDoc(id)
      await get().setEditing(true)
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

  deleteNode: async (id) => {
    const spaceId = get().activeSpaceId
    if (!spaceId || get().busy) return
    await get().flushSave()
    set({ busy: true })
    try {
      const { nodes, removedDocIds } = removeNodeSubtree(get().nodes, id)
      await knowledgeSaveTree(spaceId, { version: 1, nodes })
      for (const docId of removedDocIds) {
        await knowledgeDeleteDocFile(spaceId, docId)
      }
      const activeRemoved = get().activeDocId != null && removedDocIds.includes(get().activeDocId!)
      set((s) => ({
        nodes,
        busy: false,
        recent: s.recent.filter((r) => !(r.spaceId === spaceId && removedDocIds.includes(r.docId))),
        ...(activeRemoved
          ? { activeDocId: null, docBody: '', draftBody: '', editing: false }
          : {}),
      }))
      persistRecent(get().recent)
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
      set({ activeDocId: id, docBody: body, draftBody: body, editing: false, saveState: 'idle' })
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

  setDraftBody: (v) => {
    set({ draftBody: v })
    if (get().editing) scheduleSave(get)
  },

  flushSave: () => {
    if (saveTimer) {
      clearTimeout(saveTimer)
      saveTimer = null
    }
    const run = async () => {
      const s = get()
      if (!s.editing && s.draftBody === s.docBody) return
      if (!s.activeSpaceId || !s.activeDocId) return
      if (s.draftBody === s.docBody) return
      set({ saveState: 'saving' })
      try {
        await knowledgeWriteDoc(s.activeSpaceId, s.activeDocId, s.draftBody)
        set({ docBody: s.draftBody, saveState: 'saved' })
        setTimeout(() => {
          if (get().saveState === 'saved') set({ saveState: 'idle' })
        }, 1500)
      } catch (e) {
        const msg = knowledgeErrorMessage(e)
        set({ saveState: 'error' })
        toast.error(msg)
      }
    }
    saveChain = saveChain.then(run, run)
    return saveChain
  },

  setSearchQuery: (q) => set({ searchQuery: q }),

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
