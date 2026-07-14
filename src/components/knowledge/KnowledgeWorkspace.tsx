import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Download,
  FilePlus,
  FileText,
  FolderPlus,
  ImagePlus,
  MoreHorizontal,
  Plus,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { setExpandPersistSuspended, useKnowledgeStore } from '@/store/knowledgeStore'
import { filterTreeVisible, getPath } from '@/domain/knowledge/tree'
import { resolveParentForNew } from '@/domain/knowledge/parentForNew'
import { isSpaceNameTaken, normalizeSpaceName } from '@/domain/knowledge/spaceName'
import {
  isKnowledgeLiveEnabled,
  loadEditorModePref,
  type EditorMode,
} from '@/domain/knowledge/editorMode'
import { KNOWLEDGE_LARGE_DOC_CHARS } from '@/domain/knowledge/limits'
import { insertTextAtCursor } from '@/domain/knowledge/mdEdit'
import { importAssetFromPath } from '@/domain/knowledge/importAsset'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu'
import { pickAttachmentFiles, pickSavePath } from '@/ipc/dialog'
import {
  knowledgeErrorMessage,
  knowledgeExportDoc,
  knowledgeExportSpaceZip,
  knowledgeRevealDoc,
} from '@/ipc/knowledge'
import { revealInCodeMirror, revealInPreviewRoot } from '@/domain/knowledge/searchReveal'
import { SpaceTree } from './SpaceTree'
import { DocReader } from './DocReader'
import { DocEditor, type DocEditorHandle } from './DocEditor'
import { InlineDocTitle } from './InlineDocTitle'
import { DocPropertiesRow } from './DocPropertiesRow'
import { MarkdownToolbar } from './MarkdownToolbar'
import { KnowledgeDocCanvas } from './KnowledgeDocCanvas'
import { WikiCreateModal } from './WikiCreateModal'
import { BacklinksPanel } from './BacklinksPanel'

/** Lazy so Source-only sessions pay 0 for Milkdown kit. */
const DocLiveEditor = lazy(() =>
  import('./DocLiveEditor').then((m) => ({ default: m.DocLiveEditor })),
)
import { TemplatePickerModal } from './TemplatePickerModal'

export function KnowledgeWorkspace() {
  const { t } = useTranslation()
  const spaces = useKnowledgeStore((s) => s.spaces)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const nodes = useKnowledgeStore((s) => s.nodes)
  const activeDocId = useKnowledgeStore((s) => s.activeDocId)
  const treeFocusId = useKnowledgeStore((s) => s.treeFocusId)
  const docBody = useKnowledgeStore((s) => s.docBody)
  const draftBody = useKnowledgeStore((s) => s.draftBody)
  const editorMode = useKnowledgeStore((s) => s.editorMode)
  const editing = useKnowledgeStore((s) => s.editing)
  const busy = useKnowledgeStore((s) => s.busy)
  const saveState = useKnowledgeStore((s) => s.saveState)
  const openHome = useKnowledgeStore((s) => s.openHome)
  const requestCreateDoc = useKnowledgeStore((s) => s.requestCreateDoc)
  const createFolder = useKnowledgeStore((s) => s.createFolder)
  const renameSpace = useKnowledgeStore((s) => s.renameSpace)
  const deleteSpace = useKnowledgeStore((s) => s.deleteSpace)
  const renameNode = useKnowledgeStore((s) => s.renameNode)
  const deleteNode = useKnowledgeStore((s) => s.deleteNode)
  const setEditorMode = useKnowledgeStore((s) => s.setEditorMode)
  const setDraftBody = useKnowledgeStore((s) => s.setDraftBody)
  const flushSave = useKnowledgeStore((s) => s.flushSave)
  const toggleFolder = useKnowledgeStore((s) => s.toggleFolder)
  const openDoc = useKnowledgeStore((s) => s.openDoc)
  const saveDocAsTemplate = useKnowledgeStore((s) => s.saveDocAsTemplate)

  const space = spaces.find((s) => s.id === activeSpaceId)
  const activeNode = nodes.find((n) => n.id === activeDocId)
  const pathNodes = useMemo(
    () => (activeDocId ? getPath(nodes, activeDocId) : []),
    [nodes, activeDocId],
  )

  const editorRef = useRef<DocEditorHandle>(null)
  const [treeFilter, setTreeFilter] = useState('')
  const [filterExpandSnapshot, setFilterExpandSnapshot] = useState<Record<
    string,
    boolean
  > | null>(null)
  /** Only re-expand ancestors when the filter *string* changes (not on nodes ticks). */
  const lastFilterExpandQuery = useRef('')

  const visibleIds = useMemo(
    () => filterTreeVisible(nodes, treeFilter),
    [nodes, treeFilter],
  )

  // Expand ancestors when filter query changes; restore snapshot on clear.
  // Suspend expand LS writes while filter inflates expand (avoid polluting persist).
  useEffect(() => {
    const q = treeFilter.trim()
    if (!q) {
      lastFilterExpandQuery.current = ''
      if (filterExpandSnapshot) {
        useKnowledgeStore.setState({ expandedFolderIds: filterExpandSnapshot })
        setFilterExpandSnapshot(null)
      }
      setExpandPersistSuspended(false)
      return
    }
    setExpandPersistSuspended(true)
    if (lastFilterExpandQuery.current === q || !visibleIds) return
    lastFilterExpandQuery.current = q
    if (!filterExpandSnapshot) {
      setFilterExpandSnapshot(useKnowledgeStore.getState().expandedFolderIds)
    }
    const expand: Record<string, boolean> = {
      ...useKnowledgeStore.getState().expandedFolderIds,
    }
    for (const id of visibleIds) {
      const n = nodes.find((x) => x.id === id)
      if (n?.kind === 'folder') expand[id] = true
      let cur = n
      while (cur?.parentId) {
        expand[cur.parentId] = true
        cur = nodes.find((x) => x.id === cur?.parentId)
      }
    }
    useKnowledgeStore.setState({ expandedFolderIds: expand })
  }, [treeFilter, visibleIds, nodes, filterExpandSnapshot])

  // Best-effort scroll-to-match after opening a search hit (`pendingReveal`).
  useEffect(() => {
    if (!activeDocId || !activeSpaceId) return
    const pending = useKnowledgeStore.getState().pendingReveal
    if (!pending?.query) return
    // Only reveal when the pending target is still the active doc.
    if (pending.spaceId !== activeSpaceId || pending.docId !== activeDocId) return

    let cancelled = false
    let attempts = 0
    // Large CM docs can take >350ms to mount; allow ~2s of retries.
    const maxAttempts = 24
    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const schedule = (ms: number) => {
      timeoutId = setTimeout(tryReveal, ms)
    }

    const tryReveal = () => {
      if (cancelled) return
      const still = useKnowledgeStore.getState().pendingReveal
      if (!still?.query) return
      if (still.spaceId !== activeSpaceId || still.docId !== activeDocId) {
        useKnowledgeStore.getState().clearPendingReveal()
        return
      }

      // Source/Live: CM source editor; Preview: markdown reader.
      if (editorMode !== 'preview') {
        const view = editorRef.current?.getView()
        if (view) {
          revealInCodeMirror(view, still.query)
          useKnowledgeStore.getState().clearPendingReveal()
          return
        }
      } else {
        const root = document.querySelector('[data-testid="knowledge-doc-reader"]')
        if (root instanceof HTMLElement) {
          revealInPreviewRoot(root, still.query)
          useKnowledgeStore.getState().clearPendingReveal()
          return
        }
      }

      attempts += 1
      if (attempts < maxAttempts) {
        schedule(80)
      } else {
        // Give up without blocking later navigations.
        useKnowledgeStore.getState().clearPendingReveal()
      }
    }

    schedule(30)
    return () => {
      cancelled = true
      if (timeoutId != null) clearTimeout(timeoutId)
    }
  }, [activeDocId, activeSpaceId, editorMode, docBody])
    return () => setExpandPersistSuspended(false)
  }, [])

  const [renameSpaceOpen, setRenameSpaceOpen] = useState(false)
  const [spaceName, setSpaceName] = useState('')
  const spaceNameTrimmed = normalizeSpaceName(spaceName)
  const spaceNameTaken =
    activeSpaceId != null &&
    spaceNameTrimmed.length > 0 &&
    isSpaceNameTaken(spaces, spaceNameTrimmed, activeSpaceId)
  const [deleteSpaceOpen, setDeleteSpaceOpen] = useState(false)
  const [nodeEdit, setNodeEdit] = useState<KnowledgeNode | null>(null)
  const [nodeTitle, setNodeTitle] = useState('')
  const [nodeDelete, setNodeDelete] = useState<KnowledgeNode | null>(null)
  /** Broken wiki link → confirm create (K20). Never silent. */
  const [wikiCreateTitle, setWikiCreateTitle] = useState<string | null>(null)

  // Toolbar create: siblings of open doc (or root). Context menu creates under folders.
  // Wiki create-on-confirm uses the same parent (resolveParentForNew = parentForNew).
  const parentForNew: string | null = activeNode?.parentId ?? null
  const [saveTemplateOpen, setSaveTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')
  // Toolbar create: focused folder / sibling of focused|active doc / root.
  const parentForNew = resolveParentForNew({ treeFocusId, activeDocId, nodes })
  const newDoc = (parentId: string | null) => {
    void requestCreateDoc(parentId, t('knowledge.doc.untitled'))
  }

  // Live option only when flag on; parse failures force Source for the session.
  const liveEnabled = isKnowledgeLiveEnabled()
  /** Doc ids that failed Live parse this session — stay on Source. */
  const [liveBlockedDocIds, setLiveBlockedDocIds] = useState<Record<string, true>>(
    {},
  )
  const modeOptions = useMemo(() => {
    if (liveEnabled) {
      return [
        { value: 'live' as const, label: t('knowledge.doc.live') },
        { value: 'source' as const, label: t('knowledge.doc.source') },
        { value: 'preview' as const, label: t('knowledge.doc.preview') },
      ]
    }
    // Flag off: keep familiar Edit | Preview labels (source maps to Edit).
    return [
      { value: 'source' as const, label: t('knowledge.doc.edit') },
      { value: 'preview' as const, label: t('knowledge.doc.preview') },
    ]
  }, [liveEnabled, t])
  const bodyLen = Math.max(docBody.length, draftBody.length)
  const liveBlocked = Boolean(activeDocId && liveBlockedDocIds[activeDocId])
  // Host and control share the same suppressions so the segment never lies.
  const liveSuppressed =
    liveBlocked || bodyLen > KNOWLEDGE_LARGE_DOC_CHARS
  const toggleMode: EditorMode =
    editorMode === 'live' && (!liveEnabled || liveSuppressed) ? 'source' : editorMode
  const showLiveEditor =
    editorMode === 'live' && liveEnabled && !liveSuppressed
  const showSourceEditor = editorMode !== 'preview' && !showLiveEditor
  const showPreview = editorMode === 'preview'

  const onLiveParseError = () => {
    toast.error(t('knowledge.doc.liveParseFailed'))
    if (activeDocId) {
      setLiveBlockedDocIds((prev) => ({ ...prev, [activeDocId]: true }))
    }
    void setEditorMode('source')
  }

  /** Mode toggle: refuse Live re-entry when session-blocked; large clamp is in store. */
  const onEditorModeChange = (v: EditorMode) => {
    if (v === 'live' && liveBlocked) {
      toast.error(t('knowledge.doc.liveParseFailed'))
      return
    }
    void setEditorMode(v)
  }

  const exportActiveDoc = async () => {
    if (!activeSpaceId || !activeDocId) return
    await flushSave()
    const title = activeNode?.title ?? 'document'
    const safe = title.replace(/[<>:"/\\|?*]/g, '_').slice(0, 80) || 'document'
    const dest = await pickSavePath({
      defaultPath: `${safe}.md`,
      title: t('knowledge.export.doc'),
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (!dest) return
    try {
      await knowledgeExportDoc(activeSpaceId, activeDocId, dest)
      toast.success(t('knowledge.export.docDone'))
    } catch (e) {
      toast.error(knowledgeErrorMessage(e))
    }
  }

  const exportSpaceZip = async () => {
    if (!activeSpaceId) return
    await flushSave()
    const safe =
      (space?.name ?? 'space').replace(/[<>:"/\\|?*]/g, '_').slice(0, 80) || 'space'
    const dest = await pickSavePath({
      defaultPath: `${safe}.zip`,
      title: t('knowledge.export.spaceZip'),
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    })
    if (!dest) return
    try {
      await knowledgeExportSpaceZip(activeSpaceId, dest)
      toast.success(t('knowledge.export.spaceDone'))
    } catch (e) {
      toast.error(knowledgeErrorMessage(e))
    }
  }

  const toastAssetError = (
    reason: 'too_large_paste' | 'too_large_disk' | 'unsupported' | 'error',
  ) => {
    if (reason === 'too_large_paste') {
      toast.error(t('knowledge.asset.tooLargePaste'))
    } else if (reason === 'too_large_disk') {
      toast.error(t('knowledge.asset.tooLargeDisk'))
    } else if (reason === 'unsupported') {
      toast.error(t('knowledge.asset.unsupported'))
    } else {
      toast.error(t('knowledge.asset.importFailed'))
    }
  }

  const attachFiles = async () => {
    if (!activeSpaceId || !activeDocId || !editing) return
    const paths = await pickAttachmentFiles()
    if (!paths?.length) return
    const view = editorRef.current?.getView()
    if (!view) return
    for (const sourcePath of paths) {
      const result = await importAssetFromPath(activeSpaceId, sourcePath)
      if (!result.ok) {
        toastAssetError(result.reason)
        continue
      }
      const pos = view.state.selection.main.from
      const before = pos > 0 ? view.state.sliceDoc(pos - 1, pos) : '\n'
      let snippet = result.markdown
      if (before !== '\n') snippet = `\n${snippet}`
      snippet = `${snippet}\n`
      if (insertTextAtCursor(view, snippet)) {
        setDraftBody(view.state.doc.toString())
      }
    }
  }

  const onCrumbClick = (node: KnowledgeNode) => {
    if (node.kind === 'folder') {
      toggleFolder(node.id)
      // keep active doc; only expand
    } else {
      void openDoc(node.id)
    }
  }

  /** Prefer first + last crumbs when the path is deep (max 4 visible nodes). */
  const crumbItems = useMemo(() => {
    if (pathNodes.length <= 4) {
      return pathNodes.map((node, index) => ({ kind: 'node' as const, node, index }))
    }
    const last = pathNodes.length - 1
    return [
      { kind: 'node' as const, node: pathNodes[0], index: 0 },
      { kind: 'ellipsis' as const },
      { kind: 'node' as const, node: pathNodes[last - 1], index: last - 1 },
      { kind: 'node' as const, node: pathNodes[last], index: last },
    ]
  }, [pathNodes])

  return (
    <div className="flex min-h-0 flex-1" data-testid="knowledge-workspace">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-surface-subtle">
        <div className="flex flex-col gap-2 border-b border-border p-2.5">
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              data-testid="knowledge-back-home"
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-state-hover"
              onClick={() => void openHome()}
              title={t('knowledge.home.mySpaces')}
            >
              <ArrowLeft size={14} className="shrink-0 text-ink-tertiary" />
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface">
                {space?.icon ? (
                  <span className="text-meta leading-none">{space.icon}</span>
                ) : (
                  <BookOpen size={14} className="text-accent-strong" />
                )}
              </span>
              <span className="truncate text-body font-semibold text-ink">
                {space?.name ?? t('tabs.knowledge')}
              </span>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  disabled={busy}
                  data-testid="knowledge-new-menu"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-secondary hover:bg-state-hover hover:text-ink disabled:opacity-50"
                  title={t('knowledge.tree.newDoc')}
                  aria-label={t('knowledge.workspace.new')}
                >
                  <Plus size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="knowledge-new-doc"
                  onClick={() => newDoc(parentForNew)}
                >
                  <FilePlus size={14} />
                  {t('knowledge.tree.newDoc')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="knowledge-new-folder"
                  onClick={() =>
                    void createFolder(parentForNew, t('knowledge.folder.untitled'))
                  }
                >
                  <FolderPlus size={14} />
                  {t('knowledge.tree.newFolder')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* modal={false}: modal menu + rename/delete Modal both lock body
                pointer-events; stacking leaves the app unclickable after close. */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="knowledge-space-menu"
                  className="flex h-7 w-7 items-center justify-center rounded-md text-ink-tertiary hover:bg-state-hover hover:text-ink"
                  aria-label={t('knowledge.space.menu')}
                >
                  <MoreHorizontal size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  data-testid="knowledge-space-rename"
                  onClick={() => {
                    setSpaceName(space?.name ?? '')
                    setRenameSpaceOpen(true)
                  }}
                >
                  {t('knowledge.tree.rename')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  data-testid="knowledge-space-export"
                  onClick={() => void exportSpaceZip()}
                >
                  {t('knowledge.export.spaceZip')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid="knowledge-space-delete"
                  onClick={() => setDeleteSpaceOpen(true)}
                >
                  {t('knowledge.tree.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="relative">
            <Search
              size={14}
              className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-ink-tertiary"
            />
            <Input
              data-testid="knowledge-tree-filter"
              value={treeFilter}
              onChange={(e) => setTreeFilter(e.target.value)}
              placeholder={t('knowledge.tree.filterPlaceholder')}
              className="h-8 border-border bg-surface pl-7 text-meta"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1.5 py-2">
          <SpaceTree
            visibleIds={visibleIds}
            onRename={(node) => {
              setNodeEdit(node)
              setNodeTitle(node.title)
            }}
            onDelete={(node) => setNodeDelete(node)}
            onNewDoc={(parentId) => newDoc(parentId)}
            onNewFolder={(parentId) =>
              void createFolder(parentId, t('knowledge.folder.untitled'))
            }
            onReveal={(node) => {
              if (!activeSpaceId || node.kind !== 'doc') return
              void knowledgeRevealDoc(activeSpaceId, node.id).catch((e) => {
                toast.error(knowledgeErrorMessage(e))
              })
            }}
          />
          {visibleIds && visibleIds.size === 0 && (
            <p className="px-2 py-2 text-meta text-ink-tertiary">
              {t('knowledge.tree.filterEmpty')}
            </p>
          )}
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col bg-surface">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
          <div className="flex min-w-0 flex-1 items-center gap-0.5 truncate text-meta">
            {pathNodes.length === 0 ? (
              <span className="truncate text-ink-tertiary">{space?.name}</span>
            ) : (
              crumbItems.map((item, i) => {
                if (item.kind === 'ellipsis') {
                  return (
                    <span key="crumb-ellipsis" className="flex min-w-0 items-center gap-0.5">
                      {i > 0 && (
                        <ChevronRight
                          size={12}
                          className="shrink-0 text-ink-tertiary"
                          aria-hidden
                        />
                      )}
                      <span className="shrink-0 text-ink-tertiary" aria-hidden>
                        …
                      </span>
                    </span>
                  )
                }
                const n = item.node
                const isLast = item.index === pathNodes.length - 1
                return (
                  <span key={n.id} className="flex min-w-0 items-center gap-0.5">
                    {i > 0 && (
                      <ChevronRight
                        size={12}
                        className="shrink-0 text-ink-tertiary"
                        aria-hidden
                      />
                    )}
                    {!isLast ? (
                      <button
                        type="button"
                        className="truncate text-ink-secondary hover:text-ink"
                        onClick={() => onCrumbClick(n)}
                      >
                        {n.title}
                      </button>
                    ) : (
                      <span className="truncate font-medium text-ink">{n.title}</span>
                    )}
                  </span>
                )
              })
            )}
          </div>
          {(saveState === 'saving' || saveState === 'saved') && (
            <span
              className="flex shrink-0 items-center gap-1.5 text-meta text-ink-tertiary"
              data-testid="knowledge-save-status"
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full',
                  saveState === 'saving' ? 'bg-warning animate-pulse' : 'bg-success',
                )}
                aria-hidden
              />
              {saveState === 'saving' ? t('knowledge.doc.saving') : t('knowledge.doc.saved')}
            </span>
          )}
          {activeDocId && (
            <>
              <SegmentedControl
                data-testid="knowledge-edit-toggle"
                aria-label={t('knowledge.doc.modeLabel')}
                size="sm"
                value={toggleMode}
                onChange={onEditorModeChange}
                options={modeOptions}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="rounded-md p-1.5 text-ink-tertiary hover:bg-state-hover hover:text-ink"
                    aria-label={t('knowledge.space.menu')}
                    data-testid="knowledge-doc-menu"
                  >
                    <MoreHorizontal size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    data-testid="knowledge-export-doc"
                    onClick={() => void exportActiveDoc()}
                  >
                    <Download size={14} />
                    {t('knowledge.export.doc')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    data-testid="knowledge-save-as-template"
                    onClick={() => {
                      setTemplateName(activeNode?.title ?? t('knowledge.doc.untitled'))
                      setSaveTemplateOpen(true)
                    }}
                  >
                    <FilePlus size={14} />
                    {t('knowledge.template.saveAs')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
        </div>
        {!activeDocId ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-6">
            <EmptyState
              icon={FileText}
              title={t('knowledge.workspace.noDocTitle')}
              description={t('knowledge.workspace.noDocHint')}
              className="w-full max-w-md border-0 py-16"
              action={{
                label: t('knowledge.tree.newDoc'),
                onClick: () => newDoc(null),
              }}
            />
          </div>
        ) : showLiveEditor ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <KnowledgeDocCanvas className="min-h-0 flex-1">
              <InlineDocTitle
                docId={activeDocId}
                title={activeNode?.title ?? t('knowledge.doc.untitled')}
                onCommit={(title) => void renameNode(activeDocId, title)}
              />
              <Suspense
                fallback={
                  <div
                    className="flex flex-1 items-center justify-center text-meta text-ink-tertiary"
                    data-testid="knowledge-doc-live-loading"
                  >
                    {t('knowledge.doc.liveLoading')}
                  </div>
                }
              >
                <DocLiveEditor
                  key={`${activeDocId}-live`}
                  docId={activeDocId}
                  initialMarkdown={draftBody}
                  onDraftChange={setDraftBody}
                  onBlur={() => void flushSave()}
                  onSave={() => void flushSave()}
                  onParseError={onLiveParseError}
                  placeholder={t('knowledge.doc.placeholder')}
                  wikiNodes={nodes}
                />
              </Suspense>
            </KnowledgeDocCanvas>
          </div>
        ) : showSourceEditor ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <KnowledgeDocCanvas className="min-h-0 flex-1">
              <InlineDocTitle
                docId={activeDocId}
                title={activeNode?.title ?? t('knowledge.doc.untitled')}
                onCommit={(title) => void renameNode(activeDocId, title)}
              />
              <div className="flex items-center gap-1">
                <MarkdownToolbar
                  getView={() => editorRef.current?.getView() ?? null}
                  onAfterEdit={(text) => setDraftBody(text)}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title={t('knowledge.asset.attach')}
                  aria-label={t('knowledge.asset.attach')}
                  data-testid="knowledge-attach-asset"
                  disabled={busy || !activeSpaceId}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void attachFiles()}
                >
                  <ImagePlus size={14} />
                </Button>
              </div>
              <DocPropertiesRow body={draftBody} />
              <MarkdownToolbar
                getView={() => editorRef.current?.getView() ?? null}
                onAfterEdit={(text) => setDraftBody(text)}
              />
              <DocEditor
                ref={editorRef}
                key={`${activeDocId}-source`}
                docId={activeDocId}
                initialValue={draftBody}
                spaceId={activeSpaceId}
                initialValue={docBody}
                onDraftChange={setDraftBody}
                onBlur={() => void flushSave()}
                onSave={() => void flushSave()}
                onAssetImportError={toastAssetError}
                placeholder={t('knowledge.doc.placeholder')}
                wikiNodes={nodes}
              />
            </KnowledgeDocCanvas>
          </div>
        ) : showPreview ? (
          <div className="min-h-0 flex-1 overflow-y-auto pb-24">
            <KnowledgeDocCanvas>
              <InlineDocTitle
                docId={activeDocId}
                title={activeNode?.title ?? t('knowledge.doc.untitled')}
                readOnly
                onCommit={() => {}}
              />
              <DocPropertiesRow body={docBody} />
              <DocReader
                content={docBody}
                onStartEdit={() => void setEditorMode(loadEditorModePref())}
                // Prefer draft so preview task toggles are optimistic before flush.
                content={draftBody || docBody}
                onStartEdit={() => void setEditing(true)}
                nodes={nodes}
                onWikiNavigate={(docId) => void openDoc(docId)}
                onWikiBroken={(title) => setWikiCreateTitle(title)}
              />
            </KnowledgeDocCanvas>
          </div>
        ) : null}
      </main>

      {activeDocId && activeSpaceId ? (
        <BacklinksPanel
          spaceId={activeSpaceId}
          docId={activeDocId}
          onOpenDoc={(id) => void openDoc(id)}
        />
      ) : null}

      <Modal
        open={renameSpaceOpen}
        onOpenChange={setRenameSpaceOpen}
        title={t('knowledge.tree.rename')}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="knowledge-rename-space-cancel"
              onClick={() => setRenameSpaceOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              data-testid="knowledge-rename-space-confirm"
              disabled={!spaceNameTrimmed || spaceNameTaken || busy || !activeSpaceId}
              onClick={() => {
                if (!activeSpaceId || !spaceNameTrimmed || spaceNameTaken) return
                void renameSpace(activeSpaceId, spaceNameTrimmed).then((ok) => {
                  if (ok) setRenameSpaceOpen(false)
                })
              }}
            >
              {t('common.confirm', { defaultValue: 'OK' })}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 px-5 py-4">
          <label className="flex flex-col gap-2">
            <span className="text-body text-ink-secondary">{t('knowledge.space.nameLabel')}</span>
            <Input
              data-testid="knowledge-rename-space-name"
              value={spaceName}
              onChange={(e) => setSpaceName(e.target.value)}
              placeholder={t('knowledge.space.namePlaceholder')}
              aria-invalid={spaceNameTaken || undefined}
              className={
                spaceNameTaken
                  ? 'border-danger focus-visible:border-danger focus-visible:ring-danger/10'
                  : undefined
              }
              autoFocus
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !activeSpaceId || !spaceNameTrimmed || spaceNameTaken) return
                e.preventDefault()
                void renameSpace(activeSpaceId, spaceNameTrimmed).then((ok) => {
                  if (ok) setRenameSpaceOpen(false)
                })
              }}
            />
          </label>
          {spaceNameTaken && (
            <p
              className="rounded-md bg-danger/10 px-3 py-2 text-meta text-danger"
              data-testid="knowledge-rename-space-name-error"
              role="alert"
            >
              {t('knowledge.space.nameDuplicate', { name: spaceNameTrimmed })}
            </p>
          )}
        </div>
      </Modal>

      <Modal
        open={deleteSpaceOpen}
        onOpenChange={setDeleteSpaceOpen}
        title={t('knowledge.space.deleteTitle', {
          name: space?.name ?? '',
        })}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="knowledge-delete-space-cancel"
              onClick={() => setDeleteSpaceOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              data-testid="knowledge-delete-space-confirm"
              disabled={busy || !activeSpaceId}
              onClick={() => {
                // Close first so RemoveScroll unlocks body before workspace unmounts.
                const id = activeSpaceId
                setDeleteSpaceOpen(false)
                if (id) void deleteSpace(id)
              }}
            >
              {t('knowledge.tree.delete')}
            </Button>
          </div>
        }
      >
        <div className="px-5 py-4">
          <p className="text-body leading-relaxed text-ink-secondary">
            {t('knowledge.space.deleteBody')}
          </p>
        </div>
      </Modal>

      <Modal
        open={nodeEdit != null}
        onOpenChange={(o) => !o && setNodeEdit(null)}
        title={t('knowledge.tree.rename')}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="knowledge-rename-node-cancel"
              onClick={() => setNodeEdit(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              data-testid="knowledge-rename-node-confirm"
              disabled={!nodeTitle.trim() || busy}
              onClick={() => {
                if (nodeEdit && nodeTitle.trim()) {
                  void renameNode(nodeEdit.id, nodeTitle.trim())
                }
                setNodeEdit(null)
              }}
            >
              {t('common.confirm', { defaultValue: 'OK' })}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 px-5 py-4">
          <label className="flex flex-col gap-2">
            <span className="text-body text-ink-secondary">{t('knowledge.tree.nameLabel')}</span>
            <Input
              data-testid="knowledge-rename-node-name"
              value={nodeTitle}
              onChange={(e) => setNodeTitle(e.target.value)}
              autoFocus
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !nodeTitle.trim() || !nodeEdit) return
                e.preventDefault()
                void renameNode(nodeEdit.id, nodeTitle.trim())
                setNodeEdit(null)
              }}
            />
          </label>
        </div>
      </Modal>

      <Modal
        open={nodeDelete != null}
        onOpenChange={(o) => !o && setNodeDelete(null)}
        title={t('knowledge.tree.deleteTitle', {
          title: nodeDelete?.title ?? '',
        })}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="knowledge-delete-node-cancel"
              onClick={() => setNodeDelete(null)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              data-testid="knowledge-delete-node-confirm"
              disabled={busy}
              onClick={() => {
                if (nodeDelete) void deleteNode(nodeDelete.id)
                setNodeDelete(null)
              }}
            >
              {t('knowledge.tree.delete')}
            </Button>
          </div>
        }
      >
        <div className="px-5 py-4">
          <p className="text-body leading-relaxed text-ink-secondary">
            {nodeDelete?.kind === 'folder'
              ? t('knowledge.tree.deleteFolderBody')
              : t('knowledge.tree.deleteDocBody')}
          </p>
        </div>
      </Modal>

      <WikiCreateModal
        open={wikiCreateTitle != null}
        title={wikiCreateTitle ?? ''}
        busy={busy}
        onOpenChange={(o) => {
          if (!o) setWikiCreateTitle(null)
        }}
        onConfirm={() => {
          const title = wikiCreateTitle?.trim()
          if (!title) return
          setWikiCreateTitle(null)
          void createDoc(parentForNew, title)
        }}
      />
      <Modal
        open={saveTemplateOpen}
        onOpenChange={setSaveTemplateOpen}
        title={t('knowledge.template.saveAsTitle')}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="knowledge-save-template-cancel"
              onClick={() => setSaveTemplateOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              data-testid="knowledge-save-template-confirm"
              disabled={!templateName.trim() || busy}
              onClick={() => {
                void saveDocAsTemplate(templateName).then((ok) => {
                  if (ok) setSaveTemplateOpen(false)
                })
              }}
            >
              {t('common.confirm', { defaultValue: 'OK' })}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 px-5 py-4">
          <label className="flex flex-col gap-2">
            <span className="text-body text-ink-secondary">
              {t('knowledge.template.nameLabel')}
            </span>
            <Input
              data-testid="knowledge-save-template-name"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              placeholder={t('knowledge.template.namePlaceholder')}
              autoFocus
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || !templateName.trim()) return
                e.preventDefault()
                void saveDocAsTemplate(templateName).then((ok) => {
                  if (ok) setSaveTemplateOpen(false)
                })
              }}
            />
          </label>
        </div>
      </Modal>

      <TemplatePickerModal />
    </div>
  )
}
