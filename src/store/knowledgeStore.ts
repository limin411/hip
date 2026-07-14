import { create } from 'zustand'
import { toast } from 'sonner'
import i18n from '@/i18n'
import type {
  KnowledgeNode,
  KnowledgeRecentItem,
  KnowledgeSpace,
  KnowledgeTemplate,
  KnowledgeVersionEntry,
} from '@/domain/knowledge/types'
import { newDocId, newFolderId } from '@/domain/knowledge/ids'
import {
  KNOWLEDGE_INDEX_YIELD_EVERY,
  KNOWLEDGE_LARGE_DOC_CHARS,
  KNOWLEDGE_RECENT_CAP,
  localDayKey,
} from '@/domain/knowledge/limits'
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
import { isSpaceNameTaken, normalizeSpaceName } from '@/domain/knowledge/spaceName'
import {
  type EditorMode,
  loadEditorModePref,
  persistEditorModePref,
  resolveEditorMode,
  shouldAutosave,
} from '@/domain/knowledge/editorMode'
import {
  countBrokenOutbound,
  createLinkIndex,
  getBacklinks,
  getOutbound,
  indexDocLinks,
  type LinkEdge,
  type LinkResolveDoc,
  removeSourceDoc,
  removeSpaceFromLinkIndex,
  reresolveSpaceLinks,
} from '@/domain/knowledge/linkIndex'
import {
  knowledgeCreateSpace,
  knowledgeDeleteDocFile,
  knowledgeDeleteSpace,
  knowledgeDeleteTemplate,
  knowledgeEnsureRoot,
  knowledgeErrorMessage,
  knowledgeGetTree,
  knowledgeListSpaces,
  knowledgeListTemplates,
  knowledgeReadDoc,
  knowledgeSaveTemplate,
  knowledgeListVersions,
  knowledgeRestoreVersion,
  knowledgeSaveTree,
  knowledgeSaveVersion,
  knowledgeUpdateSpace,
  knowledgeWriteDoc,
} from '@/ipc/knowledge'

export type { EditorMode, LinkEdge }
export { shouldAutosave }

/** Module-level index (not serializable; not stored in zustand state). */
let kbIndex = createKnowledgeIndex()
/** Structured frontmatter meta parallel to MiniSearch (facets + wiki aliases). */
let kbMeta = new Map<string, KnowledgeDocMetaEntry>()
/** Wiki link graph (composite keys). Rebuilt with search index + incremental on save. */
let kbLinkIndex = createLinkIndex()
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
const RECENT_CAP = KNOWLEDGE_RECENT_CAP
/** Per-space folder expand map: `Record<spaceId, Record<folderId, true>>`. */
const EXPANDED_KEY = 'hip-knowledge-expanded-v1'

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

function compactExpand(expanded: Record<string, boolean>): Record<string, true> {
  const out: Record<string, true> = {}
  for (const [id, on] of Object.entries(expanded)) {
    if (on) out[id] = true
  }
  return out
}

function loadExpandedForSpace(spaceId: string): Record<string, boolean> {
  if (typeof localStorage === 'undefined') return {}
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Record<string, unknown>>
    const forSpace = parsed?.[spaceId]
    if (!forSpace || typeof forSpace !== 'object') return {}
    const out: Record<string, boolean> = {}
    for (const [id, on] of Object.entries(forSpace)) {
      if (on) out[id] = true
    }
    return out
  } catch {
    return {}
  }
}

function persistExpandedForSpace(spaceId: string, expanded: Record<string, boolean>) {
  if (typeof localStorage === 'undefined') return
  try {
    let all: Record<string, Record<string, true>> = {}
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          all = parsed as Record<string, Record<string, true>>
        }
      } catch {
        // replace corrupt blob
      }
    }
    all[spaceId] = compactExpand(expanded)
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(all))
  } catch {
    // ignore quota
  }
}

function dropExpandedForSpace(spaceId: string) {
  if (typeof localStorage === 'undefined') return
  try {
    const raw = localStorage.getItem(EXPANDED_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    const all = { ...(parsed as Record<string, Record<string, true>>) }
    delete all[spaceId]
    localStorage.setItem(EXPANDED_KEY, JSON.stringify(all))
  } catch {
    // ignore
  }
}

/** Keep only expand keys that still exist as folders in the tree. */
function pruneExpandedToFolders(
  expanded: Record<string, boolean>,
  nodes: KnowledgeNode[],
): Record<string, boolean> {
  const folderIds = new Set(nodes.filter((n) => n.kind === 'folder').map((n) => n.id))
  const out: Record<string, boolean> = {}
  for (const [id, on] of Object.entries(expanded)) {
    if (on && folderIds.has(id)) out[id] = true
  }
  return out
}

/** Ensure every ancestor folder of nodeId is expanded so the row is mountable. */
function expandAncestorsOf(
  nodes: KnowledgeNode[],
  nodeId: string,
  expanded: Record<string, boolean>,
): Record<string, boolean> {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const next = { ...expanded }
  let cur = byId.get(nodeId)
  while (cur?.parentId) {
    next[cur.parentId] = true
    cur = byId.get(cur.parentId)
  }
  return next
}

let expandPersistTimer: ReturnType<typeof setTimeout> | null = null
/** When true, skip LS writes (tree filter temporarily inflates expand). */
let expandPersistSuspended = false

/**
 * Suspend expand localStorage writes while the workspace filter temporarily
 * expands ancestors. Cancels any pending timer without writing.
 */
export function setExpandPersistSuspended(suspended: boolean) {
  expandPersistSuspended = suspended
  if (suspended && expandPersistTimer) {
    clearTimeout(expandPersistTimer)
    expandPersistTimer = null
  }
}

/** Flush pending expand write for the current space before switching spaces. */
function flushPendingExpandPersist(get: () => KnowledgeState) {
  if (!expandPersistTimer) return
  clearTimeout(expandPersistTimer)
  expandPersistTimer = null
  if (expandPersistSuspended) return
  const spaceId = get().activeSpaceId
  if (spaceId) persistExpandedForSpace(spaceId, get().expandedFolderIds)
}

function schedulePersistExpand(spaceId: string, get: () => KnowledgeState) {
  if (expandPersistSuspended) return
  if (expandPersistTimer) clearTimeout(expandPersistTimer)
  expandPersistTimer = setTimeout(() => {
    expandPersistTimer = null
    if (expandPersistSuspended) return
    // Guard: never write another space’s map under this spaceId after a switch.
    if (get().activeSpaceId !== spaceId) return
    persistExpandedForSpace(spaceId, get().expandedFolderIds)
  }, 100)
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

/** Pending new-doc flow: modal open only after templates exist; no node until confirm. */
export interface TemplatePickerState {
  /** Space the templates were listed for; ignore confirm if activeSpaceId diverges. */
  spaceId: string
  parentId: string | null
  defaultTitle: string
  templates: KnowledgeTemplate[]
}

interface KnowledgeState {
  loaded: boolean
  spaces: KnowledgeSpace[]
  activeSpaceId: string | null
  nodes: KnowledgeNode[]
  activeDocId: string | null
  docBody: string
  draftBody: string
  /** live | source | preview — Live UI gated by hip-knowledge-live flag. */
  editorMode: EditorMode
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
  /** Keyboard / roving focus in the space tree (separate from activeDocId). */
  treeFocusId: string | null
  /** Template pick modal; set by `requestCreateDoc` when space has templates. */
  templatePicker: TemplatePickerState | null
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
  /**
   * Create a doc node and open it. Prefer `requestCreateDoc` from UI so templates
   * can be chosen before any node is written.
   */
  createDoc: (
    parentId: string | null,
    title: string,
    opts?: { body?: string },
  ) => Promise<void>
  /**
   * If the space has templates, open the picker (no node yet). Otherwise create empty.
   * Cancel on the picker leaves no orphan empty doc.
   */
  requestCreateDoc: (parentId: string | null, defaultTitle: string) => Promise<void>
  /** Confirm picker: `null` templateId → empty body; cancel via `cancelTemplateCreate`. */
  confirmTemplateCreate: (templateId: string | null) => Promise<void>
  cancelTemplateCreate: () => void
  /** Save current doc draft body as a new space template. */
  saveDocAsTemplate: (name: string) => Promise<boolean>
  deleteTemplate: (id: string) => Promise<void>
  renameNode: (id: string, title: string) => Promise<void>
  deleteNode: (id: string) => Promise<void>
  moveNode: (id: string, parentId: string | null, toIndex?: number) => Promise<void>
  openDoc: (id: string) => Promise<void>
  /** Switch Live / Source / Preview. Live without flag clamps to Source. */
  setEditorMode: (mode: EditorMode) => Promise<void>
  /**
   * Update draft body. Default persist mode: 'auto' when shouldAutosave(mode)
   * (live|source), 'none' in preview. Pass `persist: 'now'` for immediate flush
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
  setFilterTag: (tag: string | null) => void
  setFilterStatus: (status: string | null) => void
  toggleFolder: (id: string) => void
  setTreeFocusId: (id: string | null) => void
  dropRecent: (spaceId: string | null, docId: string) => void
}

/** Wiki resolve list for a space from live meta map (titles + aliases). */
function wikiDocsForSpace(spaceId: string): LinkResolveDoc[] {
  const out: LinkResolveDoc[] = []
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
    const orderA = a.order ?? Number.MAX_SAFE_INTEGER
    const orderB = b.order ?? Number.MAX_SAFE_INTEGER
    if (orderA !== orderB) return orderA - orderB
    const t = a.title.localeCompare(b.title)
    if (t !== 0) return t
    return a.id.localeCompare(b.id)
  })
  return out
}

/**
 * Wiki resolve list from tree nodes + optional meta aliases (used mid-rebuild
 * when kbMeta is still the previous generation).
 */
function wikiDocsFromNodes(
  spaceId: string,
  nodes: KnowledgeNode[],
  meta?: Map<string, KnowledgeDocMetaEntry>,
): LinkResolveDoc[] {
  const out: LinkResolveDoc[] = []
  for (const n of nodes) {
    if (n.kind !== 'doc') continue
    const aliases = meta?.get(docKey(spaceId, n.id))?.aliases ?? []
    out.push({ id: n.id, title: n.title, aliases, order: n.order })
  }
  out.sort((a, b) => {
    const orderA = a.order ?? Number.MAX_SAFE_INTEGER
    const orderB = b.order ?? Number.MAX_SAFE_INTEGER
    if (orderA !== orderB) return orderA - orderB
    const t = a.title.localeCompare(b.title)
    if (t !== 0) return t
    return a.id.localeCompare(b.id)
  })
  return out
}

function indexCurrentDoc(
  spaceId: string,
  docId: string,
  title: string,
  body: string,
  spaceName: string,
  nodes: KnowledgeNode[],
  opts?: { reresolveSpace?: boolean },
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
  // Incremental link index for this source (uses updated meta for aliases).
  indexDocLinks(kbLinkIndex, spaceId, docId, body, wikiDocsForSpace(spaceId))
  // Title/alias identity changes need other sources re-resolved (rename / FM aliases).
  if (opts?.reresolveSpace) {
    reresolveSpaceLinks(kbLinkIndex, spaceId, wikiDocsForSpace(spaceId))
  }
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
  treeFocusId: null,
  templatePicker: null,
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
    const nextLinks = createLinkIndex()
    /** Bodies retained for a second pass link index (after all meta/aliases known). */
    const bodiesBySpace = new Map<string, Map<string, string>>()
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
        const bodyMap = new Map<string, string>()
        bodiesBySpace.set(space.id, bodyMap)
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
          bodyMap.set(node.id, body)
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
      // Second pass: link index with full meta (aliases) available.
      for (const { space, nodes } of loaded) {
        if (gen !== indexBuildGen) return
        const bodyMap = bodiesBySpace.get(space.id) ?? new Map()
        const wikiDocs = wikiDocsFromNodes(space.id, nodes, nextMeta)
        for (const node of nodes) {
          if (node.kind !== 'doc') continue
          indexDocLinks(
            nextLinks,
            space.id,
            node.id,
            bodyMap.get(node.id) ?? '',
            wikiDocs,
          )
        }
      }
      if (gen !== indexBuildGen) return
      kbIndex = next
      kbMeta = nextMeta
      kbLinkIndex = nextLinks
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
        // Cancel pending expand write (space is going away).
        if (expandPersistTimer) {
          clearTimeout(expandPersistTimer)
          expandPersistTimer = null
        }
        set({
          mode: 'home',
          activeSpaceId: null,
          activeDocId: null,
          treeFocusId: null,
          docBody: '',
          draftBody: '',
          editorMode: 'preview',
          nodes: [],
          expandedFolderIds: {},
          templatePicker: null,
          saveState: 'idle',
          pendingReveal: null,
        })
      }
      await knowledgeDeleteSpace(id)
      dropExpandedForSpace(id)
      // Drop all index entries for this space (best-effort full rebuild also fine).
      for (const hit of get().searchHits) {
        if (hit.spaceId === id) removeSearchDoc(kbIndex, docKey(id, hit.docId), kbMeta)
      }
      removeSpaceFromLinkIndex(kbLinkIndex, id)
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
    const ok = await get().flushSave()
    if (!ok) return // stay on current space/doc; saveState error + retry chrome
    // Write current space expand before replacing the in-memory map.
    flushPendingExpandPersist(get)
    set({ error: null })
    try {
      const tree = await knowledgeGetTree(id)
      const nodes = tree.nodes ?? []
      const expanded = pruneExpandedToFolders(loadExpandedForSpace(id), nodes)
      set({
        activeSpaceId: id,
        nodes,
        mode: 'workspace',
        expandedFolderIds: expanded,
        treeFocusId: opts?.selectDocId ?? null,
        // Drop stale picker: confirm must not write into a different space.
        templatePicker: null,
      })
      if (opts?.selectDocId) {
        await get().openDoc(opts.selectDocId)
      } else {
        set({
          activeDocId: null,
          docBody: '',
          draftBody: '',
          editorMode: 'preview',
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
    const ok = await get().flushSave()
    if (!ok) return // stay in workspace; saveState error + retry chrome
    flushPendingExpandPersist(get)
    set({
      mode: 'home',
      activeDocId: null,
      treeFocusId: null,
      docBody: '',
      draftBody: '',
      editorMode: 'preview',
      // keep activeSpaceId for chip? design: clear active doc; can keep space or clear
      activeSpaceId: null,
      nodes: [],
      pendingReveal: null,
      filterTag: null,
      filterStatus: null,
      expandedFolderIds: {},
      templatePicker: null,
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
        schedulePersistExpand(spaceId, get)
      }
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ busy: false, error: msg })
      toast.error(msg)
    }
  },

  createDoc: async (parentId, title, opts) => {
    const spaceId = get().activeSpaceId
    if (!spaceId || get().busy) return
    // Flush-gate before creating so a failed dirty save cannot orphan a new empty doc.
    const flushed = await get().flushSave()
    if (!flushed) return
    const body = opts?.body ?? ''
    set({ busy: true })
    try {
      const now = Date.now()
      const id = newDocId()
      await knowledgeWriteDoc(spaceId, id, body)
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
      // Re-resolve so Wiki-create-from-broken heals outbound broken flags + backlinks.
      indexCurrentDoc(spaceId, id, node.title, '', spaceName, nodes, {
        reresolveSpace: true,
      })
      indexCurrentDoc(spaceId, id, node.title, body, spaceName, nodes)
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
        schedulePersistExpand(spaceId, get)
      }
      get().runSearch(get().searchQuery)
      // openDoc defaults to preferred writable mode (source, or live when flag on)
      await get().openDoc(id)
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ busy: false, error: msg })
      toast.error(msg)
    }
  },

  requestCreateDoc: async (parentId, defaultTitle) => {
    const spaceId = get().activeSpaceId
    if (!spaceId || get().busy) return
    try {
      const templates = await knowledgeListTemplates(spaceId)
      if (templates.length === 0) {
        await get().createDoc(parentId, defaultTitle)
        return
      }
      // Modal first — no tree node / doc file until confirm.
      set({ templatePicker: { spaceId, parentId, defaultTitle, templates } })
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      toast.error(msg)
      // List failure should not block creation of a blank doc.
      await get().createDoc(parentId, defaultTitle)
    }
  },

  confirmTemplateCreate: async (templateId) => {
    const picker = get().templatePicker
    if (!picker) return
    set({ templatePicker: null })
    // Space switched (or picker was stale) — do not create under the wrong space.
    if (get().activeSpaceId !== picker.spaceId) return
    if (templateId == null) {
      await get().createDoc(picker.parentId, picker.defaultTitle)
      return
    }
    const tpl = picker.templates.find((t) => t.id === templateId)
    if (!tpl) {
      await get().createDoc(picker.parentId, picker.defaultTitle)
      return
    }
    await get().createDoc(picker.parentId, picker.defaultTitle, { body: tpl.body })
  },

  cancelTemplateCreate: () => {
    set({ templatePicker: null })
  },

  saveDocAsTemplate: async (name) => {
    const spaceId = get().activeSpaceId
    const docId = get().activeDocId
    if (!spaceId || !docId || get().busy) return false
    const trimmed = name.trim()
    if (!trimmed) return false
    set({ busy: true })
    try {
      const body = get().draftBody
      await knowledgeSaveTemplate(spaceId, { name: trimmed, body })
      set({ busy: false })
      toast.success(i18n.t('knowledge.template.saved'))
      return true
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ busy: false, error: msg })
      toast.error(msg)
      return false
    }
  },

  deleteTemplate: async (id) => {
    const spaceId = get().activeSpaceId
    if (!spaceId) return
    try {
      await knowledgeDeleteTemplate(spaceId, id)
      set((s) => {
        if (!s.templatePicker) return s
        const templates = s.templatePicker.templates.filter((t) => t.id !== id)
        // Empty choice remains even when no templates left.
        return { templatePicker: { ...s.templatePicker, templates } }
      })
    } catch (e) {
      toast.error(knowledgeErrorMessage(e))
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
        indexCurrentDoc(spaceId, id, renamed.title, body, spaceName, nodes, {
          reresolveSpace: true,
        })
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
        schedulePersistExpand(spaceId, get)
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
      // Path change only — titles unchanged; still refresh reverse maps once.
      reresolveSpaceLinks(kbLinkIndex, spaceId, wikiDocsForSpace(spaceId))
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
        removeSourceDoc(kbLinkIndex, spaceId, docId)
      }
      // Targets may have disappeared → re-resolve remaining edges in this space.
      reresolveSpaceLinks(kbLinkIndex, spaceId, wikiDocsForSpace(spaceId))
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
        const expandedFolderIds = pruneExpandedToFolders(s.expandedFolderIds, nodes)
        return {
          nodes,
          busy: false,
          spaceDocCounts: nextCounts,
          expandedFolderIds,
          recent: s.recent.filter(
            (r) => !(r.spaceId === spaceId && removedDocIds.includes(r.docId)),
          ),
          ...(activeRemoved
            ? {
                activeDocId: null,
                docBody: '',
                draftBody: '',
                editorMode: 'preview' as const,
                pendingReveal: null,
              }
            : pendingTargetsRemoved
              ? { pendingReveal: null }
              : {}),
          treeFocusId:
            s.treeFocusId != null &&
            (removedDocIds.includes(s.treeFocusId) ||
              !nodes.some((n) => n.id === s.treeFocusId))
              ? null
              : s.treeFocusId,
        }
      })
      schedulePersistExpand(spaceId, get)
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
    const ok = await get().flushSave()
    if (!ok) return // stay on current activeDocId; saveState error + retry chrome
    const spaceId = get().activeSpaceId
    const node = get().nodes.find((n) => n.id === id && n.kind === 'doc')
    if (!node || !spaceId) {
      toast.error('Could not load document')
      get().dropRecent(spaceId, id)
      set({
        activeDocId: null,
        treeFocusId: null,
        docBody: '',
        draftBody: '',
        editorMode: 'preview',
        pendingReveal: null,
      })
      return
    }
    try {
      const body = await knowledgeReadDoc(spaceId, id)
      let editorMode = resolveEditorMode(loadEditorModePref())
      // Large docs force Source (Live / Milkdown cost); toast once per open.
      if (editorMode === 'live' && body.length > KNOWLEDGE_LARGE_DOC_CHARS) {
        editorMode = 'source'
        toast.message(i18n.t('knowledge.doc.largeDocForceSource'))
      }
      // Drop pending reveal if it targets a different doc (tree/recent nav mid-flight).
      const pending = get().pendingReveal
      const revealMatches =
        pending != null && pending.spaceId === spaceId && pending.docId === id
      // Expand ancestors so the focused row is mounted for keyboard/roving tabindex.
      const expandedFolderIds = expandAncestorsOf(get().nodes, id, get().expandedFolderIds)
      set({
        activeDocId: id,
        docBody: body,
        draftBody: body,
        editorMode,
        saveState: 'idle',
        treeFocusId: id,
        expandedFolderIds,
        ...(revealMatches ? {} : { pendingReveal: null }),
      })
      schedulePersistExpand(spaceId, get)
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
        treeFocusId: null,
        docBody: '',
        draftBody: '',
        editorMode: 'preview',
        pendingReveal: null,
      })
    }
  },

  setEditorMode: async (mode) => {
    let next = resolveEditorMode(mode)
    if (next === 'live') {
      const len = Math.max(get().draftBody.length, get().docBody.length)
      if (len > KNOWLEDGE_LARGE_DOC_CHARS) {
        toast.message(i18n.t('knowledge.doc.largeDocForceSource'))
        next = 'source'
      }
    }
    if (next === get().editorMode) return
    if (next === 'preview') {
      await get().flushSave()
      set({ editorMode: 'preview' })
      return
    }
    // Leaving preview: reseed from last-saved body (preview uses docBody; task writes flush first).
    // live ↔ source: keep dirty draft — do not drop in-flight edits within the autosave window.
    if (get().editorMode === 'preview') {
      set({ editorMode: next, draftBody: get().docBody })
    } else {
      set({ editorMode: next })
    }
    persistEditorModePref(next)
  },

  setDraftBody: (v, opts) => {
    set({ draftBody: v })
    const persist =
      opts?.persist ?? (shouldAutosave(get().editorMode) ? 'auto' : 'none')
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
          // Body / frontmatter aliases may change → re-resolve space after upsert.
          indexCurrentDoc(
            s.activeSpaceId,
            s.activeDocId,
            node.title,
            s.draftBody,
            spaceName,
            get().nodes,
            { reresolveSpace: true },
          )
          syncFacetsToState(set)
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

  setFilterTag: (tag) => {
    set({ filterTag: tag })
    get().runSearch(get().searchQuery)
  },

  setFilterStatus: (status) => {
    set({ filterStatus: status })
    get().runSearch(get().searchQuery)
  },

  toggleFolder: (id) => {
    set((s) => ({
      expandedFolderIds: { ...s.expandedFolderIds, [id]: !s.expandedFolderIds[id] },
    }))
    const spaceId = get().activeSpaceId
    if (spaceId) schedulePersistExpand(spaceId, get)
  },

  setTreeFocusId: (id) => set({ treeFocusId: id }),

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
  return wikiDocsForSpace(spaceId).map((d) => ({
    id: d.id,
    title: d.title,
    aliases: [...(d.aliases ?? [])],
    order: d.order ?? Number.MAX_SAFE_INTEGER,
  }))
}

/** Resolved backlinks for a document (same-space sources that link here). */
export function getKnowledgeBacklinks(spaceId: string, docId: string): LinkEdge[] {
  return getBacklinks(kbLinkIndex, spaceId, docId)
}

/** Outbound wiki edges from a document (includes broken). */
export function getKnowledgeOutbound(spaceId: string, docId: string): LinkEdge[] {
  return getOutbound(kbLinkIndex, spaceId, docId)
}

/** Count of broken outbound `[[title]]` targets for the current source doc. */
export function getKnowledgeBrokenOutboundCount(spaceId: string, docId: string): number {
  return countBrokenOutbound(kbLinkIndex, spaceId, docId)
}

/** Debounced persist for the active space’s expand map (e.g. after import expand-all). */
export function scheduleActiveExpandPersist() {
  const spaceId = useKnowledgeStore.getState().activeSpaceId
  if (spaceId) schedulePersistExpand(spaceId, () => useKnowledgeStore.getState())
}

