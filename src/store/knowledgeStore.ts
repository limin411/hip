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
import { newDocId, newFolderId, newTableId } from '@/domain/knowledge/ids'
import {
  KNOWLEDGE_INDEX_YIELD_EVERY,
  KNOWLEDGE_LARGE_DOC_CHARS,
  KNOWLEDGE_RECENT_CAP,
  localDayKey,
} from '@/domain/knowledge/limits'
import {
  installKnowledgePerfWindowApi,
  isKnowledgePerfEnabled,
  kbPerfDraftSet,
  kbPerfOpenIpc,
  kbPerfOpenStart,
  kbPerfOpenStore,
} from '@/domain/knowledge/knowledgePerf'
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
import { createEmptyTable, metaFromTable, tableToCsv } from '@/domain/knowledge/tableModel'
import { expandTemplateVariables } from '@/domain/knowledge/templateVars'
import {
  type EditorMode,
  resolveEditorMode,
  shouldAutosave,
} from '@/domain/knowledge/editorMode'
import {
  knowledgeCreateSpace,
  knowledgeDeleteTemplate,
  knowledgeEnsureRoot,
  knowledgeSoftDeleteSpace,
  knowledgeSoftDeleteNodes,
  knowledgeReconcileTrash,
  knowledgePurgeExpiredTrash,
  knowledgeErrorMessage,
  knowledgeGetTree,
  knowledgeListSpaces,
  knowledgeListTemplates,
  knowledgeReadDoc,
  knowledgeReadTable,
  knowledgeSaveTemplate,
  knowledgeListVersions,
  knowledgeRestoreVersion,
  knowledgeSaveTree,
  knowledgeSaveVersion,
  knowledgeUpdateSpace,
  knowledgeWriteDoc,
  knowledgeWriteTable,
  knowledgeLinkIndexUpsert,
  knowledgeLinkIndexRemoveDoc,
  knowledgeLinkIndexReplaceAll,
  knowledgeLinkIndexBacklinks,
  knowledgeLinkIndexBroken,
  knowledgeLinkIndexOutbound,
  knowledgeLinkIndexDocCount,
  type KnowledgeLinkBacklink,
  type KnowledgeLinkBrokenRow,
  type KnowledgeLinkOutboundRow,
} from '@/ipc/knowledge'
import { buildDocIndexPayload } from '@/domain/knowledge/linkIndex'
import {
  applyWikiRewrites,
  planWikiTitleRewrites,
} from '@/domain/knowledge/rewriteWikiTitles'
import {
  cloneDocMeta,
  parseFrontmatter,
  type KnowledgeDocMeta,
} from '@/domain/knowledge/frontmatter'
import { applyMetaToDocument } from '@/domain/knowledge/frontmatterWrite'

export type { EditorMode }
export { shouldAutosave }

/** 离开文档视图时清空的编辑器字段。 */
const resetDocFields = {
  activeDocId: null,
  treeFocusId: null,
  docBody: '',
  draftBody: '',
  editorMode: 'live' as const,
  pendingReveal: null,
  backlinks: [] as KnowledgeLinkBacklink[],
  outboundLinks: [] as KnowledgeLinkOutboundRow[],
  brokenLinks: [] as KnowledgeLinkBrokenRow[],
  linkPanelStatus: 'idle' as const,
}

/** 应用到目录位置（离开文档时 flush + 重置编辑器字段）。 */
async function applyFolderEntry(folderId: string | null): Promise<void> {
  const s = useKnowledgeStore.getState()
  if (s.activeDocId) {
    syncActiveEditorToDraft({ leaveActiveLeaf: true })
    const ok = await s.flushSave()
    if (!ok) return
  }
  useKnowledgeStore.setState({
    ...resetDocFields,
    currentFolderId: folderId,
  })
}

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
  /** 块引用锚点（V2-E1）：优先 BN 块 id，其次标题/文本匹配。 */
  fragment?: string | null
}

/** Right-rail outline click → KnowledgeWorkspace scrolls Source / Live / Preview. */
export type KnowledgePendingOutlineJump = {
  id: string
  level: 1 | 2 | 3 | 4 | 5 | 6
  text: string
  /** 1-based ATX source line. */
  line: number
  /** Bumps so re-clicking the same heading re-triggers the effect. */
  nonce: number
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
  /** V2-E0: 恒为 'live'（用户路径）；'source' 仅内部兜底；'preview' 仅历史兼容。 */
  editorMode: EditorMode
  mode: 'home' | 'workspace'
  /** 当前目录 id（null = 根目录）。文档管理 v2 单层级导航：侧边栏/主区只显示当前层级。 */
  currentFolderId: string | null
  searchQuery: string
  searchHits: KnowledgeSearchHit[]
  indexStatus: IndexStatus
  /** n/N progress while `indexStatus === 'building'`; null when idle/ready. */
  indexProgress: KnowledgeIndexProgress | null
  /** After opening a search hit, UI scrolls near this query (best-effort). */
  pendingReveal: KnowledgePendingReveal | null
  /** Outline (TOC) click — consumed by KnowledgeWorkspace for mode-aware scroll. */
  pendingOutlineJump: KnowledgePendingOutlineJump | null
  /** SQLite link-index panel (active doc). */
  backlinks: KnowledgeLinkBacklink[]
  outboundLinks: KnowledgeLinkOutboundRow[]
  /** 断链（V2-L1 T5.1）：目标标题解析失败的外部/wiki 链接。 */
  brokenLinks: KnowledgeLinkBrokenRow[]
  linkPanelStatus: 'idle' | 'loading' | 'ready' | 'error'
  /**
   * Doc counts per space. Tree-derived counts land as soon as trees load during
   * index rebuild (before body reads); finalized when indexStatus is ready.
   */
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
  /** Active table leaf (knowledge-table): on-disk baseline + in-memory draft + save state. */
  tableDoc: { id: string; csv: string; meta: string } | null
  tableDraft: { id: string; csv: string; meta: string } | null
  tableSaveState: 'idle' | 'saving' | 'error'
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
  /** Set a reveal target (⌘K doc hit) so the workspace scrolls + flashes on open. */
  setPendingReveal: (pending: KnowledgePendingReveal | null) => void
  /**
   * Request scroll to an outline heading. Workspace applies based on editorMode
   * (source line / live text match).
   */
  requestOutlineJump: (item: {
    id: string
    level: 1 | 2 | 3 | 4 | 5 | 6
    text: string
    line: number
  }) => void
  clearPendingOutlineJump: () => void
  /** Refresh backlinks + outbound + broken for the active doc (or given id). */
  refreshLinkPanel: (docId?: string) => Promise<void>
  /**
   * 断链一键创建（V2-L1 T5.3）：创建缺失文档（重名自动加序号），把引用方的
   * `raw` 链接改写为新标题，最后重建索引（索引最后写——失败时索引不变）。
   * 返回新文档 id；失败返回 null。
   */
  repairBrokenLink: (fromDocId: string, raw: string, targetTitle: string) => Promise<string | null>
  /**
   * 断链重新指向（V2-L1 T5.4）：把引用方 `raw` 链接改写为新的目标标题。
   */
  repointBrokenLink: (fromDocId: string, raw: string, newTargetTitle: string) => Promise<boolean>
  /** Full rebuild of space link index from disk docs. */
  rebuildSpaceLinkIndex: (spaceId?: string) => Promise<void>
  /**
   * After rename: rewrite `[[oldTitle]]` / embeds in all other docs to newTitle.
   * Returns number of files changed.
   */
  rewriteWikiLinksAfterRename: (
    oldTitle: string,
    newTitle: string,
  ) => Promise<number>
  openHome: () => Promise<void>
  /** v2 目录导航：移动到指定目录/文档。 */
  navigateTo: (folderId: string | null, docId?: string | null) => Promise<void>
  enterFolder: (id: string) => Promise<void>
  /** 返回上一层（根目录时 no-op）。 */
  goUp: () => Promise<void>
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
  /** Create a blank table (3×3) under parentId and open it. No template picker. */
  createTable: (parentId: string | null, title: string) => Promise<void>
  requestCreateTable: (parentId: string | null, defaultTitle: string) => Promise<void>
  /** Confirm picker: `null` templateId → empty body; cancel via `cancelTemplateCreate`. */
  confirmTemplateCreate: (templateId: string | null) => Promise<void>
  cancelTemplateCreate: () => void
  /** Save current doc draft body as a new space template. */
  saveDocAsTemplate: (name: string) => Promise<boolean>
  deleteTemplate: (id: string) => Promise<void>
  renameNode: (id: string, title: string) => Promise<void>
  deleteNode: (id: string) => Promise<void>
  moveNode: (id: string, parentId: string | null, toIndex?: number) => Promise<void>
  /** 批量删除（doc-ux-polish-2 X4）：逐节点走既有 deleteNode 清理路径。 */
  deleteNodes: (ids: string[]) => Promise<void>
  /** 批量移动（X4）：逐节点追加到目标层末尾，保持传入顺序。 */
  moveNodes: (ids: string[], parentId: string | null) => Promise<void>
  openDoc: (id: string) => Promise<void>
  /** Open a table leaf: reads csv + meta into tableDoc/tableDraft. */
  openTable: (id: string) => Promise<void>
  /** Table editor buffer → store draft (marks tableSaveState 'saving'). */
  updateTableDraft: (id: string, csv: string, meta: string) => void
  /** Persist table draft to disk; returns false on IPC failure (editor keeps local state). */
  commitTable: (id?: string) => Promise<boolean>
  /** Leave the active leaf (table editor back) and show browse for the current folder. */
  backToBrowse: () => Promise<void>
  /** Switch Live / Source / Preview. Live without flag clamps to Source. */
  setEditorMode: (mode: EditorMode) => Promise<void>
  /**
   * Update draft body. Default persist mode: 'auto' when shouldAutosave(mode)
   * (V2-E0: live/source 均可写；preview 已无写入路径). Pass `persist: 'now'`
   * for immediate flush.
   *
   * Pass `docId` from the editor instance that produced the draft. If it does
   * not match `activeDocId`, the update is ignored (prevents Live unmount after
   * a doc switch from writing doc A into doc B's buffer).
   */
  setDraftBody: (
    v: string,
    opts?: { persist?: 'auto' | 'now' | 'none'; docId?: string },
  ) => void
  /** True when draft differs from last-saved body (or saveState is error mid-edit). */
  hasUnsavedChanges: () => boolean
  /**
   * Patch active doc frontmatter (icon/cover/tags/…) without renaming the tree title.
   * Rewrites draft/doc body FM fence; schedules autosave.
   */
  updateActiveDocMeta: (patch: Partial<KnowledgeDocMeta>) => void
  /**
   * Persist dirty draft to disk.
   * - `phase: 'full'` (default): write + link-index + daily version (for delete/manual safety).
   * - `phase: 'write'`: resolves as soon as the file write finishes; secondary work still
   *   runs on the same chain afterward (openDoc uses this so doc switch is not blocked on
   *   link-index / daily snapshot IPC).
   * Returns false if a write was attempted and failed.
   */
  flushSave: (opts?: { phase?: 'full' | 'write' }) => Promise<boolean>
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

/** Doc identity for title/alias wiki resolution within a space. */
type WikiResolveDoc = {
  id: string
  title: string
  aliases?: readonly string[]
  order?: number
}

/** Wiki resolve list for a space from live meta map (titles + aliases). */
function wikiDocsForSpace(spaceId: string): WikiResolveDoc[] {
  const out: WikiResolveDoc[] = []
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

/** Best-effort SQLite link-index upsert (parse in TS). */
async function upsertLinkIndexDoc(
  spaceId: string,
  docId: string,
  title: string,
  body: string,
  nodes: KnowledgeNode[],
): Promise<void> {
  try {
    const payload = buildDocIndexPayload(docId, title, body, nodes)
    await knowledgeLinkIndexUpsert(spaceId, payload)
  } catch (e) {
    console.warn('knowledge link index upsert failed', e)
  }
}

async function removeLinkIndexDocs(spaceId: string, docIds: string[]): Promise<void> {
  for (const docId of docIds) {
    try {
      await knowledgeLinkIndexRemoveDoc(spaceId, docId)
    } catch (e) {
      console.warn('knowledge link index remove failed', e)
    }
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
/**
 * Monotonic token for openDoc. After `await knowledgeReadDoc`,
 * only apply state if this open is still the latest — otherwise rapid tree clicks
 * write the wrong body into the active buffer (data cross-talk).
 */
let openDocGeneration = 0

/** Options for {@link syncActiveEditorToDraft} / Workspace dispatcher. */
export type SyncActiveEditorOpts = {
  /** true when active leaf will change after the following flushSave. */
  leaveActiveLeaf?: boolean
}

type BeforeOpenDocFlush = (opts?: SyncActiveEditorOpts) => void

/** Optional UI hook: push Live/Source editor buffer into draftBody before flushSave. */
let beforeOpenDocFlush: BeforeOpenDocFlush | null = null

/** Register (or clear with null) the pre-flush editor sync callback. */
export function registerBeforeOpenDocFlush(fn: BeforeOpenDocFlush | null): void {
  beforeOpenDocFlush = fn
}

/** Call before flushSave that may leave or change the tree/space. Never throws. */
export function syncActiveEditorToDraft(opts?: SyncActiveEditorOpts): void {
  try {
    beforeOpenDocFlush?.(opts)
  } catch {
    // never block structural ops on UI flush errors
  }
}

/** Test helper: supersede in-flight openDoc guards. */
export function __bumpOpenDocGenerationForTests(): number {
  return ++openDocGeneration
}

/**
 * Test helper: replace the in-memory search index with the given docs
 * (⌘K palette interaction tests). Not used in production paths.
 */
export function __seedKbIndexForTests(
  docs: Array<
    Omit<
      Parameters<typeof upsertSearchDoc>[1],
      'bodyPreview' | 'tags' | 'status' | 'aliases' | 'tagList' | 'statusValue' | 'aliasList'
    > & { body: string }
  >,
): void {
  kbIndex = createKnowledgeIndex()
  kbMeta = new Map()
  for (const d of docs) upsertSearchDoc(kbIndex, d)
}

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
  editorMode: 'live',
  mode: 'home',
  currentFolderId: null,
  searchQuery: '',
  searchHits: [],
  indexStatus: 'idle',
  indexProgress: null,
  pendingReveal: null,
  pendingOutlineJump: null,
  backlinks: [],
  outboundLinks: [],
  brokenLinks: [],
  linkPanelStatus: 'idle',
  spaceDocCounts: {},
  availableTags: [],
  availableStatuses: [],
  filterTag: null,
  filterStatus: null,
  recent: [],
  expandedFolderIds: {},
  treeFocusId: null,
  templatePicker: null,
  tableDoc: null,
  tableDraft: null,
  tableSaveState: 'idle',
  busy: false,
  error: null,
  saveState: 'idle',

  loadSpaces: async () => {
    set({ error: null })
    try {
      await knowledgeEnsureRoot()
      // Best-effort trash reconcile + retention purge on knowledge bootstrap / app launch.
      try {
        await knowledgeReconcileTrash()
        const { resolveTrashRetentionDays } = await import('@/lib/trashRetention')
        const { useHipConfigStore } = await import('@/store/hipConfigStore')
        const days = resolveTrashRetentionDays(
          useHipConfigStore.getState().config.trash?.retentionDays,
        )
        await knowledgePurgeExpiredTrash(days)
      } catch {
        // non-Tauri / trash unavailable
      }
      const spaces = await knowledgeListSpaces()
      // v2 文档管理：存储层保持单空间；空库时自动创建唯一空间（根目录）。
      if (spaces.length === 0) {
        const created = await knowledgeCreateSpace('文档管理', '📁')
        spaces.push(created)
      }
      set({ spaces, loaded: true, recent: loadRecent() })
      void get().rebuildSearchIndex()
      // Refresh knowledge trash badge when list is available.
      try {
        const { knowledgeListTrash } = await import('@/ipc/knowledge')
        const items = await knowledgeListTrash()
        const { useTrashBadgeStore } = await import('@/store/trashBadgeStore')
        useTrashBadgeStore.getState().setKnowledgeCount(items.length)
      } catch {
        /* ignore */
      }
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
      // Preload trees so we can report accurate n/N progress and early doc counts
      // without waiting for full body reads (counts ≠ index ready).
      const loaded: { space: (typeof spaces)[number]; nodes: KnowledgeNode[] }[] = []
      let total = 0
      for (const space of spaces) {
        if (gen !== indexBuildGen) return
        const tree = await knowledgeGetTree(space.id)
        const nodes = tree.nodes ?? []
        const docs = nodes.reduce((n, node) => n + (node.kind === 'doc' ? 1 : 0), 0)
        total += docs
        counts[space.id] = docs
        loaded.push({ space, nodes })
      }
      if (gen !== indexBuildGen) return
      // Tree-derived counts available before body indexing finishes.
      set({ indexProgress: { done: 0, total }, spaceDocCounts: { ...counts } })

      let done = 0
      for (const { space, nodes } of loaded) {
        if (gen !== indexBuildGen) return
        for (const node of nodes) {
          if (gen !== indexBuildGen) return
          if (node.kind !== 'doc') continue
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
      // KD-14 / R4: sync → flushSave success → clear UI → soft-delete.
      // Flush fail aborts (stay in workspace); never clear buffer before persist.
      if (wasActive) {
        syncActiveEditorToDraft({ leaveActiveLeaf: true })
        const ok = await get().flushSave()
        if (!ok) {
          set({ busy: false })
          return
        }
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
          editorMode: 'live',
          tableDoc: null,
          tableDraft: null,
          tableSaveState: 'idle',
          nodes: [],
          expandedFolderIds: {},
          currentFolderId: null,
          templatePicker: null,
          saveState: 'idle',
          pendingReveal: null,
        })
      }
      await knowledgeSoftDeleteSpace(id)
      dropExpandedForSpace(id)
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
      void import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
        useTrashBadgeStore.getState().adjustKnowledge(1)
      })
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ busy: false, error: msg })
      toast.error(msg)
    }
  },

  openSpace: async (id, opts) => {
    syncActiveEditorToDraft({ leaveActiveLeaf: true })
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
        // 文档管理 v2：打开即根目录
        currentFolderId: null,
        // Drop stale picker: confirm must not write into a different space.
        templatePicker: null,
        backlinks: [],
        outboundLinks: [],
        linkPanelStatus: 'idle',
      })
      // Ensure SQLite link index exists (rebuild when empty / first open).
      void (async () => {
        try {
          const count = await knowledgeLinkIndexDocCount(id)
          const docCount = nodes.filter((n) => n.kind === 'doc').length
          if (count === 0 && docCount > 0) {
            await get().rebuildSpaceLinkIndex(id)
          }
        } catch (e) {
          console.warn('link index ensure failed', e)
        }
      })()
      if (opts?.selectDocId) {
        // 文档管理 v2：打开文档时记录其所在目录，作为返回/历史上下文。
        const parent = nodes.find((n) => n.id === opts.selectDocId)?.parentId ?? null
        set({ currentFolderId: parent })
        const target = nodes.find((n) => n.id === opts.selectDocId)
        if (target?.kind === 'table') {
          await get().openTable(opts.selectDocId)
        } else {
          await get().openDoc(opts.selectDocId)
        }
      } else {
        set({
          activeDocId: null,
          docBody: '',
          draftBody: '',
          editorMode: 'live',
          tableDoc: null,
          tableDraft: null,
          tableSaveState: 'idle',
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

  /** Set a reveal target (⌘K doc hit) so the workspace scrolls + flashes on open. */
  setPendingReveal: (pending: KnowledgePendingReveal | null) => set({ pendingReveal: pending }),

  requestOutlineJump: (item) =>
    set((s) => ({
      pendingOutlineJump: {
        id: item.id,
        level: item.level,
        text: item.text,
        line: item.line,
        nonce: (s.pendingOutlineJump?.nonce ?? 0) + 1,
      },
    })),
  clearPendingOutlineJump: () => set({ pendingOutlineJump: null }),


  refreshLinkPanel: async (docId) => {
    const spaceId = get().activeSpaceId
    const id = docId ?? get().activeDocId
    if (!spaceId || !id) {
      set({ backlinks: [], outboundLinks: [], brokenLinks: [], linkPanelStatus: 'idle' })
      return
    }
    set({ linkPanelStatus: 'loading' })
    try {
      const [backlinks, outboundLinks, brokenLinks] = await Promise.all([
        knowledgeLinkIndexBacklinks(spaceId, id),
        knowledgeLinkIndexOutbound(spaceId, id),
        knowledgeLinkIndexBroken(spaceId).catch(() => []),
      ])
      // Stale guard
      if (get().activeSpaceId !== spaceId || get().activeDocId !== id) return
      // 断链按引用方过滤当前文档相关的条目。
      set({
        backlinks,
        outboundLinks,
        brokenLinks: brokenLinks.filter((b) => b.fromDocId === id),
        linkPanelStatus: 'ready',
      })
    } catch (e) {
      console.warn('refreshLinkPanel failed', e)
      if (get().activeSpaceId === spaceId && get().activeDocId === id) {
        set({ backlinks: [], outboundLinks: [], brokenLinks: [], linkPanelStatus: 'error' })
      }
    }
  },

  /** 标题去重：同名加 (2)/(3)…（V2-L1 T5.3）。 */
  repairBrokenLink: async (fromDocId, raw, targetTitle) => {
    const spaceId = get().activeSpaceId
    const nodes = get().nodes
    if (!spaceId || !fromDocId || !raw || !targetTitle) return null
    const existing = new Set(
      nodes.filter((n) => n.kind === 'doc').map((n) => n.title.toLowerCase()),
    )
    let title = targetTitle.trim()
    let n = 2
    while (existing.has(title.toLowerCase())) {
      title = `${targetTitle.trim()} (${n})`
      n += 1
    }
    try {
      // 1) 创建新文档（磁盘写失败 → 中止，索引不动）。
      const now = Date.now()
      const id = newDocId()
      await knowledgeWriteDoc(spaceId, id, '')
      const node = {
        id,
        parentId: null,
        kind: 'doc' as const,
        title,
        order: nextOrder(nodes, null),
        createdAt: now,
        updatedAt: now,
      }
      const nextNodes = insertNode(nodes, node)
      await knowledgeSaveTree(spaceId, { version: 1, nodes: nextNodes })
      // 2) 改写引用方文档中的 raw 链接。
      let fromBody = ''
      try {
        fromBody = await knowledgeReadDoc(spaceId, fromDocId)
      } catch {
        fromBody = ''
      }
      const oldToken = raw.trim()
      const newToken = oldToken.replace(/\[\[[^\]]+\]\]/, `[[${title}]]`)
      const nextFromBody = fromBody.replace(oldToken, newToken)
      if (nextFromBody !== fromBody) {
        await knowledgeWriteDoc(spaceId, fromDocId, nextFromBody)
      }
      // 3) 索引最后写（失败回滚语义：前面任何一步失败都不会污染索引）。
      const spaceName = get().spaces.find((s) => s.id === spaceId)?.name ?? ''
      indexCurrentDoc(spaceId, id, title, '', spaceName, nextNodes)
      void upsertLinkIndexDoc(spaceId, id, title, '', nextNodes)
      if (nextFromBody !== fromBody) {
        void upsertLinkIndexDoc(spaceId, fromDocId, get().nodes.find((x) => x.id === fromDocId)?.title ?? '', nextFromBody, nextNodes)
      }
      set({ nodes: nextNodes })
      void get().refreshLinkPanel()
      return id
    } catch {
      return null
    }
  },

  repointBrokenLink: async (fromDocId, raw, newTargetTitle) => {
    const spaceId = get().activeSpaceId
    if (!spaceId || !fromDocId || !raw || !newTargetTitle) return false
    try {
      let fromBody = ''
      try {
        fromBody = await knowledgeReadDoc(spaceId, fromDocId)
      } catch {
        fromBody = ''
      }
      const oldToken = raw.trim()
      const newToken = oldToken.replace(/\[\[[^\]]+\]\]/, `[[${newTargetTitle.trim()}]]`)
      const nextFromBody = fromBody.replace(oldToken, newToken)
      if (nextFromBody === fromBody) return false
      await knowledgeWriteDoc(spaceId, fromDocId, nextFromBody)
      const node = get().nodes.find((x) => x.id === fromDocId)
      void upsertLinkIndexDoc(spaceId, fromDocId, node?.title ?? '', nextFromBody, get().nodes)
      void get().refreshLinkPanel()
      return true
    } catch {
      return false
    }
  },

  rebuildSpaceLinkIndex: async (spaceIdArg) => {
    const spaceId = spaceIdArg ?? get().activeSpaceId
    if (!spaceId) return
    const nodes =
      spaceId === get().activeSpaceId
        ? get().nodes
        : ((await knowledgeGetTree(spaceId)).nodes ?? [])
    const docs = nodes.filter((n) => n.kind === 'doc')
    const payloads = []
    for (const d of docs) {
      let body = ''
      try {
        body = await knowledgeReadDoc(spaceId, d.id)
      } catch {
        body = ''
      }
      payloads.push(buildDocIndexPayload(d.id, d.title, body, nodes))
    }
    try {
      await knowledgeLinkIndexReplaceAll(spaceId, payloads)
    } catch (e) {
      console.warn('rebuildSpaceLinkIndex failed', e)
      return
    }
    if (get().activeSpaceId === spaceId && get().activeDocId) {
      void get().refreshLinkPanel()
    }
  },




  rewriteWikiLinksAfterRename: async (oldTitle, newTitle) => {
    const spaceId = get().activeSpaceId
    if (!spaceId) return 0
    const docs = get().nodes.filter((n) => n.kind === 'doc')
    let changed = 0
    const spaceName = get().spaces.find((s) => s.id === spaceId)?.name ?? ''
    for (const d of docs) {
      try {
        let body =
          get().activeDocId === d.id
            ? get().draftBody || get().docBody
            : await knowledgeReadDoc(spaceId, d.id)
        const hits = planWikiTitleRewrites(body, oldTitle, newTitle)
        if (hits.length === 0) continue
        const next = applyWikiRewrites(body, hits)
        await knowledgeWriteDoc(spaceId, d.id, next)
        indexCurrentDoc(spaceId, d.id, d.title, next, spaceName, get().nodes)
        void upsertLinkIndexDoc(spaceId, d.id, d.title, next, get().nodes)
        if (get().activeDocId === d.id) {
          set({ docBody: next, draftBody: next })
        }
        changed += 1
      } catch (e) {
        console.warn('rewrite wiki in', d.id, e)
      }
    }
    if (changed > 0) {
      void get().rebuildSpaceLinkIndex(spaceId)
      syncFacetsToState(set)
      get().runSearch(get().searchQuery)
    }
    return changed
  },

  openHome: async () => {
    syncActiveEditorToDraft({ leaveActiveLeaf: true })
    const ok = await get().flushSave()
    if (!ok) return // stay in workspace; saveState error + retry chrome
    flushPendingExpandPersist(get)
    set({
      mode: 'home',
      activeDocId: null,
      treeFocusId: null,
      docBody: '',
      draftBody: '',
      editorMode: 'live',
      tableDoc: null,
      tableDraft: null,
      tableSaveState: 'idle',
      // keep activeSpaceId for chip? design: clear active doc; can keep space or clear
      activeSpaceId: null,
      nodes: [],
      currentFolderId: null,
      pendingReveal: null,
      filterTag: null,
      filterStatus: null,
      expandedFolderIds: {},
      templatePicker: null,
    })
    get().runSearch(get().searchQuery)
  },

  navigateTo: async (folderId, docId) => {
    const s = get()
    const targetDoc = docId ?? null
    // 同位置 no-op
    if (s.currentFolderId === folderId && s.activeDocId === targetDoc) return
    if (targetDoc) {
      await get().openDoc(targetDoc)
      return
    }
    await applyFolderEntry(folderId)
  },

  enterFolder: async (id) => {
    await get().navigateTo(id, null)
  },

  goUp: async () => {
    const s = get()
    const node = s.currentFolderId
      ? s.nodes.find((n) => n.id === s.currentFolderId)
      : null
    await get().navigateTo(node?.parentId ?? null, null)
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
    // Pre-sync current leaf (snapshot: still on it until openDoc(new)).
    syncActiveEditorToDraft({ leaveActiveLeaf: false })
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
      indexCurrentDoc(spaceId, id, node.title, body, spaceName, nodes)
      void upsertLinkIndexDoc(spaceId, id, node.title, body, nodes)
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

  createTable: async (parentId, title) => {
    const spaceId = get().activeSpaceId
    if (!spaceId || get().busy) return
    // Flush-gate before creating so a failed dirty save cannot orphan a new empty table.
    syncActiveEditorToDraft({ leaveActiveLeaf: false })
    const flushed = await get().flushSave()
    if (!flushed) return
    set({ busy: true })
    try {
      const now = Date.now()
      const id = newTableId()
      // Blank 3×3 table: csv + meta twin files written first, then tree node.
      const t = createEmptyTable()
      await knowledgeWriteTable(spaceId, id, tableToCsv(t), JSON.stringify(metaFromTable(t)))
      const node = {
        id,
        parentId,
        kind: 'table' as const,
        title: title.trim() || i18n.t('knowledge.table.untitled'),
        order: nextOrder(get().nodes, parentId),
        createdAt: now,
        updatedAt: now,
      }
      const nodes = insertNode(get().nodes, node)
      await knowledgeSaveTree(spaceId, { version: 1, nodes })
      const spaceName = get().spaces.find((s) => s.id === spaceId)?.name ?? ''
      // Title-only search entry (table bodies are CSV; not body-indexed in P0).
      indexCurrentDoc(spaceId, id, node.title, '', spaceName, nodes)
      set({ nodes, busy: false })
      syncFacetsToState(set)
      if (parentId) {
        set((s) => ({ expandedFolderIds: { ...s.expandedFolderIds, [parentId]: true } }))
        schedulePersistExpand(spaceId, get)
      }
      get().runSearch(get().searchQuery)
      await get().openTable(id)
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ busy: false, error: msg })
      toast.error(msg)
    }
  },

  requestCreateTable: async (parentId, defaultTitle) => {
    const spaceId = get().activeSpaceId
    if (!spaceId || get().busy) return
    // Tables have no template flow — create straight through.
    await get().createTable(parentId, defaultTitle)
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
    // V2-E1 T4.10: 模板变量替换（{{date}} / {{title}}；未知变量原样保留）。
    const body = expandTemplateVariables(tpl.body, {
      title: picker.defaultTitle,
    })
    await get().createDoc(picker.parentId, picker.defaultTitle, { body })
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
      const nextTitle = title.trim() || 'Untitled'
      const nodes = renameNode(get().nodes, id, nextTitle)
      await knowledgeSaveTree(spaceId, { version: 1, nodes })
      set({ nodes, busy: false })
      const renamed = nodes.find((n) => n.id === id)
      if (renamed?.kind === 'table') {
        // 表格标题仅参与标题索引（正文为 CSV，不索引）。
        const spaceName = get().spaces.find((s) => s.id === spaceId)?.name ?? ''
        indexCurrentDoc(spaceId, id, renamed.title, '', spaceName, nodes)
        get().runSearch(get().searchQuery)
      }
      if (renamed?.kind === 'doc') {
        const spaceName = get().spaces.find((s) => s.id === spaceId)?.name ?? ''
        let body = ''
        try {
          body = await knowledgeReadDoc(spaceId, id)
        } catch {
          body = get().activeDocId === id ? get().docBody : ''
        }
        indexCurrentDoc(spaceId, id, renamed.title, body, spaceName, nodes)
        void upsertLinkIndexDoc(spaceId, id, renamed.title, body, nodes)
        // Title change may re-resolve other docs' wiki targets — rebuild space links.
         void get().rebuildSpaceLinkIndex(spaceId)
        syncFacetsToState(set)
        get().runSearch(get().searchQuery)
      }
      // update recent title if needed
      set((s) => ({
        recent: s.recent.map((r) =>
          r.spaceId === spaceId && r.docId === id ? { ...r, title: nextTitle } : r,
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
    // Active usually stays open → snapshot (keep pending board imports).
    syncActiveEditorToDraft({ leaveActiveLeaf: false })
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

      syncFacetsToState(set)
      get().runSearch(get().searchQuery)
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ busy: false, error: msg })
      toast.error(msg)
    }
  },

  deleteNodes: async (ids) => {
    for (const id of ids) {
      await get().deleteNode(id)
    }
  },

  moveNodes: async (ids, parentId) => {
    for (const id of ids) {
      await get().moveNode(id, parentId)
    }
  },

  deleteNode: async (id) => {
    const spaceId = get().activeSpaceId
    if (!spaceId || get().busy) return
    // Preview subtree so leaveActiveLeaf is correct for folder deletes that nest active.
    const preview = removeNodeSubtree(get().nodes, id)
    const leaveActive =
      get().activeDocId != null && preview.removedLeafIds.includes(get().activeDocId!)
    syncActiveEditorToDraft({ leaveActiveLeaf: leaveActive })
    const flushed = await get().flushSave()
    if (!flushed) return
    set({ busy: true })
    try {
      const { nodes, removedDocIds, removedLeafIds } = removeNodeSubtree(get().nodes, id)
      // Soft-delete into recycle bin (tree + files moved by Tauri).
      await knowledgeSoftDeleteNodes(spaceId, [id])
      for (const leafId of removedLeafIds) {
        removeSearchDoc(kbIndex, docKey(spaceId, leafId), kbMeta)
      }
      // Boards: no link-index; docs only.
      await removeLinkIndexDocs(spaceId, removedDocIds)
      void import('@/store/trashBadgeStore').then(({ useTrashBadgeStore }) => {
        useTrashBadgeStore.getState().adjustKnowledge(1)
      })
      const activeRemoved =
        get().activeDocId != null && removedLeafIds.includes(get().activeDocId!)
      set((s) => {
        const prevCount = s.spaceDocCounts[spaceId]
        // Option B: counts are doc-only.
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
          removedLeafIds.includes(s.pendingReveal.docId)
        const expandedFolderIds = pruneExpandedToFolders(s.expandedFolderIds, nodes)
        return {
          nodes,
          busy: false,
          spaceDocCounts: nextCounts,
          expandedFolderIds,
          recent: s.recent.filter(
            (r) => !(r.spaceId === spaceId && removedLeafIds.includes(r.docId)),
          ),
          ...(activeRemoved
            ? {
                activeDocId: null,
                docBody: '',
                draftBody: '',
                editorMode: 'live' as const,
                tableDoc: null,
                tableDraft: null,
                tableSaveState: 'idle' as const,
                pendingReveal: null,
                backlinks: [],
                outboundLinks: [],
                linkPanelStatus: 'idle' as const,
                    }
            : pendingTargetsRemoved
              ? { pendingReveal: null }
              : {}),
          treeFocusId:
            s.treeFocusId != null &&
            (removedLeafIds.includes(s.treeFocusId) ||
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
    // Already focused: avoid flush + disk read + Live remount (main jank source).
    if (get().activeDocId === id) {
      if (get().treeFocusId !== id) set({ treeFocusId: id })
      return
    }

    // Sync in-editor buffer → draftBody while activeDocId is still the old leaf.
    syncActiveEditorToDraft({ leaveActiveLeaf: true })

    // Only await a disk write when dirty or upgrade-retry pending. Clean switches
    // must NOT wait on saveChain (prior link-index / daily version IPC would freeze tree clicks).
    const cur = get()
    const leaveNeedsWrite =
      !!cur.activeDocId && cur.draftBody !== cur.docBody
    const tableNeedsWrite =
      !!cur.tableDraft &&
      !!cur.tableDoc &&
      (cur.tableDraft.csv !== cur.tableDoc.csv || cur.tableDraft.meta !== cur.tableDoc.meta)
    if (leaveNeedsWrite || tableNeedsWrite) {
      const ok = await get().flushSave({ phase: 'write' })
      if (!ok) return
    }

    const spaceId = get().activeSpaceId
    const node = get().nodes.find((n) => n.id === id)
    const isDoc = node?.kind === 'doc' && id.startsWith('doc_')
    if (!spaceId || !node || !isDoc) {
      toast.error(
        id.startsWith('brd_') || node?.kind === 'board'
          ? i18n.t('knowledge.doc.loadFailed')
          : i18n.t('knowledge.doc.loadFailed'),
      )
      get().dropRecent(spaceId, id)
      set({
        activeDocId: null,
        treeFocusId: null,
        docBody: '',
        draftBody: '',
        editorMode: 'live',
        tableDoc: null,
        tableDraft: null,
        tableSaveState: 'idle',
        pendingReveal: null,
        backlinks: [],
        outboundLinks: [],
        linkPanelStatus: 'idle',
      })
      return
    }
    // Claim this open; any prior in-flight openDoc must not apply after us.
    const gen = ++openDocGeneration
    try {
      kbPerfOpenStart()
      const ipcT0 = isKnowledgePerfEnabled() ? performance.now() : 0
      const body = await knowledgeReadDoc(spaceId, id)
      if (isKnowledgePerfEnabled()) {
        kbPerfOpenIpc(performance.now() - ipcT0)
      }
      // Superseded by a newer openDoc (rapid tree clicks) — drop this result.
      if (gen !== openDocGeneration) return
      // Space may have changed while we awaited disk.
      if (get().activeSpaceId !== spaceId) return

      // Drop pending reveal if it targets a different leaf (tree/recent nav mid-flight).
      const pending = get().pendingReveal
      const revealMatches =
        pending != null && pending.spaceId === spaceId && pending.docId === id
      // Expand ancestors so the focused row is mounted for keyboard/roving tabindex.
      const expandedFolderIds = expandAncestorsOf(get().nodes, id, get().expandedFolderIds)
      const spaceName = get().spaces.find((s) => s.id === spaceId)?.name ?? ''
      const item: KnowledgeRecentItem = {
        spaceId,
        docId: id,
        title: node.title,
        spaceName,
        at: Date.now(),
      }


      // V2-E0: live 恒为唯一编辑表面；超大文档自动降级 source（内部兜底，无 toast——
      // 非侵入提示由 KnowledgeWorkspace 的兼容视图 banner 负责）。
      let editorMode = resolveEditorMode('live')
      if (editorMode === 'live' && body.length > KNOWLEDGE_LARGE_DOC_CHARS) {
        editorMode = 'source'
      }
      // Single set: body + selection + recent — avoid double React render on open.
      set((s) => {
        const rest = s.recent.filter(
          (r) => !(r.spaceId === item.spaceId && r.docId === item.docId),
        )
        const recent = [item, ...rest].slice(0, RECENT_CAP)
        persistRecent(recent)
        return {
          activeDocId: id,
          docBody: body,
          draftBody: body,
          editorMode,
          saveState: 'idle' as const,
          tableDoc: null,
          tableDraft: null,
          tableSaveState: 'idle' as const,
          treeFocusId: id,
          expandedFolderIds,
          backlinks: [],
          outboundLinks: [],
          linkPanelStatus: 'loading' as const,
          recent,
          ...(revealMatches ? {} : { pendingReveal: null }),
        }
      })
      kbPerfOpenStore(body.length, editorMode)
      schedulePersistExpand(spaceId, get)
      void upsertLinkIndexDoc(spaceId, id, node.title, body, get().nodes).then(() => {
        // Only refresh link panel if this open is still current and doc still active.
        if (gen === openDocGeneration && get().activeDocId === id) {
          get().refreshLinkPanel(id)
        }
      })
    } catch (e) {
      // Stale open failure must not clear a newer successful open.
      if (gen !== openDocGeneration) return
      // Catch path: surface IPC detail (gate path keeps a generic string).
      toast.error(knowledgeErrorMessage(e))
      get().dropRecent(spaceId, id)
      set({
        activeDocId: null,
        treeFocusId: null,
        docBody: '',
        draftBody: '',
        editorMode: 'live',
        tableDoc: null,
        tableDraft: null,
        tableSaveState: 'idle',
        pendingReveal: null,
        backlinks: [],
        outboundLinks: [],
        linkPanelStatus: 'idle',
      })
    }
  },

  openTable: async (id) => {
    // Already focused: no flush + disk read + remount.
    if (get().activeDocId === id && get().tableDraft?.id === id) {
      if (get().treeFocusId !== id) set({ treeFocusId: id })
      return
    }

    // Sync in-editor doc buffer → draftBody while activeDocId is still the old leaf.
    syncActiveEditorToDraft({ leaveActiveLeaf: true })
    const cur = get()
    const leaveNeedsWrite = !!cur.activeDocId && cur.draftBody !== cur.docBody
    if (leaveNeedsWrite) {
      const ok = await get().flushSave({ phase: 'write' })
      if (!ok) return
    }

    const spaceId = get().activeSpaceId
    const node = get().nodes.find((n) => n.id === id)
    const isTable = node?.kind === 'table' && id.startsWith('tbl_')
    if (!spaceId || !node || !isTable) {
      toast.error(i18n.t('knowledge.table.loadFailed'))
      get().dropRecent(spaceId, id)
      set({
        activeDocId: null,
        treeFocusId: null,
        docBody: '',
        draftBody: '',
        editorMode: 'live',
        tableDoc: null,
        tableDraft: null,
        tableSaveState: 'idle',
        pendingReveal: null,
        backlinks: [],
        outboundLinks: [],
        linkPanelStatus: 'idle',
      })
      return
    }
    // Claim this open; any prior in-flight open must not apply after us.
    const gen = ++openDocGeneration
    try {
      const payload = await knowledgeReadTable(spaceId, id)
      if (gen !== openDocGeneration) return
      if (get().activeSpaceId !== spaceId) return

      const expandedFolderIds = expandAncestorsOf(get().nodes, id, get().expandedFolderIds)
      const spaceName = get().spaces.find((s) => s.id === spaceId)?.name ?? ''
      const item: KnowledgeRecentItem = {
        spaceId,
        docId: id,
        title: node.title,
        spaceName,
        at: Date.now(),
      }
      // Single set: table payload + selection + recent — avoid double React render.
      set((s) => {
        const rest = s.recent.filter(
          (r) => !(r.spaceId === item.spaceId && r.docId === item.docId),
        )
        const recent = [item, ...rest].slice(0, RECENT_CAP)
        persistRecent(recent)
        return {
          activeDocId: id,
          docBody: '',
          draftBody: '',
          editorMode: 'live' as const,
          saveState: 'idle' as const,
          tableDoc: { id, csv: payload.csv, meta: payload.meta ?? '' },
          tableDraft: { id, csv: payload.csv, meta: payload.meta ?? '' },
          tableSaveState: 'idle' as const,
          treeFocusId: id,
          expandedFolderIds,
          backlinks: [],
          outboundLinks: [],
          linkPanelStatus: 'idle' as const,
          recent,
          pendingReveal: null,
        }
      })
      schedulePersistExpand(spaceId, get)
      // Title-only search entry refresh (body is CSV; not body-indexed in P0).
      indexCurrentDoc(spaceId, id, node.title, '', spaceName, get().nodes)
      get().runSearch(get().searchQuery)
    } catch (e) {
      // Stale open failure must not clear a newer successful open.
      if (gen !== openDocGeneration) return
      toast.error(knowledgeErrorMessage(e))
      get().dropRecent(spaceId, id)
      set({
        activeDocId: null,
        treeFocusId: null,
        docBody: '',
        draftBody: '',
        editorMode: 'live',
        tableDoc: null,
        tableDraft: null,
        tableSaveState: 'idle',
        pendingReveal: null,
        backlinks: [],
        outboundLinks: [],
        linkPanelStatus: 'idle',
      })
    }
  },

  updateTableDraft: (id, csv, meta) => {
    set((s) =>
      s.activeDocId === id && s.tableDraft
        ? { tableDraft: { id, csv, meta }, tableSaveState: 'saving' }
        : {},
    )
  },

  commitTable: async (id) => {
    const s = get()
    const tid = id ?? s.tableDraft?.id
    if (!tid || !s.tableDraft || s.tableDraft.id !== tid) return true
    const draft = s.tableDraft
    // Already on disk — nothing to write.
    if (s.tableDoc && s.tableDoc.csv === draft.csv && s.tableDoc.meta === draft.meta) {
      if (s.tableSaveState === 'saving') set({ tableSaveState: 'idle' })
      return true
    }
    const spaceId = s.activeSpaceId
    if (!spaceId) return false
    set({ tableSaveState: 'saving' })
    try {
      await knowledgeWriteTable(spaceId, tid, draft.csv, draft.meta)
      // A newer draft may have arrived during the await — only mark clean if unchanged.
      set((s2) => {
        const curDraft = s2.tableDraft
        if (curDraft && curDraft.id === tid && curDraft.csv === draft.csv && curDraft.meta === draft.meta) {
          return {
            tableDoc: { id: tid, csv: draft.csv, meta: draft.meta },
            tableSaveState: 'idle',
          }
        }
        return curDraft ? { tableSaveState: 'saving' } : { tableSaveState: 'idle' }
      })
      return true
    } catch (e) {
      const msg = knowledgeErrorMessage(e)
      set({ tableSaveState: 'error' })
      toast.error(msg)
      return false
    }
  },

  backToBrowse: async () => {
    const s = get()
    syncActiveEditorToDraft({ leaveActiveLeaf: true })
    const tableDirty =
      !!s.tableDraft &&
      !!s.tableDoc &&
      (s.tableDraft.csv !== s.tableDoc.csv || s.tableDraft.meta !== s.tableDoc.meta)
    if (tableDirty) {
      const ok = await get().flushSave({ phase: 'write' })
      if (!ok) return
    }
    set({
      activeDocId: null,
      treeFocusId: null,
      docBody: '',
      draftBody: '',
      editorMode: 'live',
      tableDoc: null,
      tableDraft: null,
      tableSaveState: 'idle',
      pendingReveal: null,
      backlinks: [],
      outboundLinks: [],
      linkPanelStatus: 'idle',
    })
  },

  setEditorMode: async (mode) => {
    let next = resolveEditorMode(mode)
    if (next === 'live') {
      const len = Math.max(get().draftBody.length, get().docBody.length)
      if (len > KNOWLEDGE_LARGE_DOC_CHARS) {
        next = 'source'
      }
    }
    if (next === get().editorMode) return
    set({ editorMode: next })
  },

  setDraftBody: (v, opts) => {
    // Live/Source unmount or throttled emit after a doc switch must not clobber
    // the newly active buffer (would "cross" doc A text into doc B).
    if (opts?.docId != null && get().activeDocId !== opts.docId) {
      return
    }
    kbPerfDraftSet()
    set({ draftBody: v })
    const persist =
      opts?.persist ?? (shouldAutosave(get().editorMode) ? 'auto' : 'none')
    if (persist === 'auto') scheduleSave(get)
    else if (persist === 'now') void get().flushSave()
    else cancelScheduledSave() // 'none': draft only; drop any pending autosave
  },

  hasUnsavedChanges: () => {
    const s = get()
    if (!s.activeDocId) return false
    if (s.saveState === 'saving' || s.saveState === 'error') return true
    return s.draftBody !== s.docBody
  },

  updateActiveDocMeta: (patch) => {
    const s = get()
    if (!s.activeDocId || !s.activeSpaceId) return
    const raw = s.draftBody || s.docBody
    const { meta } = parseFrontmatter(raw)
    const next = cloneDocMeta(meta)
    if (patch.tags) next.tags = [...patch.tags]
    if (patch.aliases) next.aliases = [...patch.aliases]
    if ('status' in patch) next.status = patch.status ?? null
    if ('date' in patch) next.date = patch.date ?? null
    if ('priority' in patch) next.priority = patch.priority ?? null
    if ('icon' in patch) next.icon = patch.icon ?? null
    if ('cover' in patch) next.cover = patch.cover ?? null
    if ('coverY' in patch) next.coverY = patch.coverY ?? null
    if ('starred' in patch) next.starred = patch.starred === true
    if (patch.props) next.props = { ...next.props, ...patch.props }
    const body = applyMetaToDocument(raw, next)
    get().setDraftBody(body, { docId: s.activeDocId, persist: 'auto' })
  },

  flushSave: (opts) => {
    cancelScheduledSave()
    const phase = opts?.phase ?? 'full'
    /** When phase==='write', resolve as soon as disk write finishes (secondary still chained). */
    let resolveWrite: ((ok: boolean) => void) | null = null
    const writeGate =
      phase === 'write'
        ? new Promise<boolean>((res) => {
            resolveWrite = res
          })
        : null

    const run = async (): Promise<boolean> => {
      const s = get()
      if (!s.activeSpaceId || !s.activeDocId) {
        resolveWrite?.(true)
        return true
      }
      // Capture targets up front — openDoc may switch activeDoc mid-await.
      const spaceId = s.activeSpaceId
      const docId = s.activeDocId
      const node = s.nodes.find((n) => n.id === docId)
      // Design: missing node → no-op success (avoid mis-routing board drafts to write_doc).
      if (!node) {
        resolveWrite?.(true)
        return true
      }
      const spaceName = s.spaces.find((sp) => sp.id === spaceId)?.name ?? ''
      const nodesSnap = s.nodes
      // Table leaf: flush csv + meta draft (before the doc branch).
      if (node.kind === 'table' || docId.startsWith('tbl_')) {
        const draft = get().tableDraft
        if (!draft || draft.id !== docId) {
          resolveWrite?.(true)
          return true
        }
        const base = s.tableDoc
        if (base && base.csv === draft.csv && base.meta === draft.meta) {
          if (get().tableSaveState === 'saving') set({ tableSaveState: 'idle' })
          resolveWrite?.(true)
          return true
        }
        try {
          await knowledgeWriteTable(spaceId, docId, draft.csv, draft.meta)
          set((s2) => {
            const curDraft = s2.tableDraft
            if (
              curDraft &&
              curDraft.id === docId &&
              curDraft.csv === draft.csv &&
              curDraft.meta === draft.meta
            ) {
              return {
                tableDoc: { id: docId, csv: draft.csv, meta: draft.meta },
                tableSaveState: 'idle' as const,
                nodes: s2.nodes.map((n) =>
                  n.id === docId ? { ...n, updatedAt: Date.now() } : n,
                ),
              }
            }
            return curDraft ? { tableSaveState: 'saving' as const } : {}
          })
        } catch (e) {
          set({ tableSaveState: 'error' })
          const msg = knowledgeErrorMessage(e)
          toast.error(msg)
          resolveWrite?.(false)
          resolveWrite = null
          return false
        }
        resolveWrite?.(true)
        resolveWrite = null
        return true
      }
      if (node.kind !== 'doc' || !docId.startsWith('doc_')) {
        resolveWrite?.(true)
        return true
      }
      if (s.draftBody === s.docBody) {
        resolveWrite?.(true)
        return true
      }

      const body = get().draftBody

      set({ saveState: 'saving' })
      try {
        await knowledgeWriteDoc(spaceId, docId, body)
        // 内容保存成功 → 节点更新时间（标题下元数据行 / 列表实时反映）。
        // tree 写盘失败不阻断内容保存（单独容错）。
        const now = Date.now()
        const s2 = get()
        if (s2.activeSpaceId === spaceId && s2.activeDocId === docId) {
          set((s) => ({
            nodes: s.nodes.map((n) => (n.id === docId ? { ...n, updatedAt: now } : n)),
          }))
        }
        try {
          await knowledgeSaveTree(spaceId, { version: 1, nodes: get().nodes })
        } catch {
          // 忽略：内容已写盘，tree 更新时间下一次保存会补写。
        }
        // Prefer not to clobber a newer doc's docBody if the user already switched.
        if (get().activeDocId === docId && get().activeSpaceId === spaceId) {
          set({ docBody: body, saveState: 'saved' })
        } else if (get().saveState === 'saving') {
          set({ saveState: 'idle' })
        }
        // openDoc(write) can proceed — secondary work continues on this chain.
        resolveWrite?.(true)
        resolveWrite = null

        indexCurrentDoc(spaceId, docId, node.title, body, spaceName, nodesSnap)
        await upsertLinkIndexDoc(spaceId, docId, node.title, body, nodesSnap)
        if (get().activeDocId === docId && get().activeSpaceId === spaceId) {
          syncFacetsToState(set)
          get().runSearch(get().searchQuery)
          void get().refreshLinkPanel(docId)
        }
        // Daily snapshot stays on the chain so delete/manual never race it.
        try {
          await knowledgeSaveVersion(spaceId, docId, 'daily', localDayKey())
        } catch {
          // Snapshots must not surface as save failures.
        }
        setTimeout(() => {
          if (get().saveState === 'saved') set({ saveState: 'idle' })
        }, 2000)
        return true
      } catch (e) {
        resolveWrite?.(false)
        resolveWrite = null
        const msg = knowledgeErrorMessage(e)
        set({ saveState: 'error' })
        toast.error(msg)
        return false
      }
    }
    saveChain = saveChain.then(run, () => run())
    return writeGate ?? saveChain
  },

  saveVersionManual: async (docId) => {
    const spaceId = get().activeSpaceId
    const id = docId ?? get().activeDocId
    if (!spaceId || !id) return null
    if (id.startsWith('brd_')) return null
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
    if (id.startsWith('brd_')) return []
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
    if (id.startsWith('brd_')) return false
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

/** Debounced persist for the active space’s expand map (e.g. after import expand-all). */
export function scheduleActiveExpandPersist() {
  const spaceId = useKnowledgeStore.getState().activeSpaceId
  if (spaceId) schedulePersistExpand(spaceId, () => useKnowledgeStore.getState())
}

// E2E / diagnosis: window.__hipKnowledgePerf (collection off until enable()).
installKnowledgePerfWindowApi()

