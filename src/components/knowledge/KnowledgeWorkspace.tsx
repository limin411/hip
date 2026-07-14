import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Download,
  FilePlus,
  FileText,
  FolderPlus,
  MoreHorizontal,
  Plus,
  Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { filterTreeVisible, getPath } from '@/domain/knowledge/tree'
import { isSpaceNameTaken, normalizeSpaceName } from '@/domain/knowledge/spaceName'
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
import { pickSavePath } from '@/ipc/dialog'
import {
  knowledgeErrorMessage,
  knowledgeExportDoc,
  knowledgeExportSpaceZip,
  knowledgeRevealDoc,
} from '@/ipc/knowledge'
import { SpaceTree } from './SpaceTree'
import { DocReader } from './DocReader'
import { DocEditor, type DocEditorHandle } from './DocEditor'
import { InlineDocTitle } from './InlineDocTitle'
import { MarkdownToolbar } from './MarkdownToolbar'
import { KnowledgeDocCanvas } from './KnowledgeDocCanvas'

export function KnowledgeWorkspace() {
  const { t } = useTranslation()
  const spaces = useKnowledgeStore((s) => s.spaces)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const nodes = useKnowledgeStore((s) => s.nodes)
  const activeDocId = useKnowledgeStore((s) => s.activeDocId)
  const docBody = useKnowledgeStore((s) => s.docBody)
  const editing = useKnowledgeStore((s) => s.editing)
  const busy = useKnowledgeStore((s) => s.busy)
  const saveState = useKnowledgeStore((s) => s.saveState)
  const openHome = useKnowledgeStore((s) => s.openHome)
  const createDoc = useKnowledgeStore((s) => s.createDoc)
  const createFolder = useKnowledgeStore((s) => s.createFolder)
  const renameSpace = useKnowledgeStore((s) => s.renameSpace)
  const deleteSpace = useKnowledgeStore((s) => s.deleteSpace)
  const renameNode = useKnowledgeStore((s) => s.renameNode)
  const deleteNode = useKnowledgeStore((s) => s.deleteNode)
  const setEditing = useKnowledgeStore((s) => s.setEditing)
  const setDraftBody = useKnowledgeStore((s) => s.setDraftBody)
  const flushSave = useKnowledgeStore((s) => s.flushSave)
  const toggleFolder = useKnowledgeStore((s) => s.toggleFolder)
  const openDoc = useKnowledgeStore((s) => s.openDoc)

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
  useEffect(() => {
    const q = treeFilter.trim()
    if (!q) {
      lastFilterExpandQuery.current = ''
      if (filterExpandSnapshot) {
        useKnowledgeStore.setState({ expandedFolderIds: filterExpandSnapshot })
        setFilterExpandSnapshot(null)
      }
      return
    }
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

  // Toolbar create: siblings of open doc (or root). Context menu creates under folders.
  const parentForNew: string | null = activeNode?.parentId ?? null

  const mode: 'edit' | 'preview' = editing ? 'edit' : 'preview'

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
                  onClick={() => void createDoc(parentForNew, t('knowledge.doc.untitled'))}
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
            onNewDoc={(parentId) =>
              void createDoc(parentId, t('knowledge.doc.untitled'))
            }
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
                value={mode}
                onChange={(v) => void setEditing(v === 'edit')}
                options={[
                  { value: 'edit', label: t('knowledge.doc.edit') },
                  { value: 'preview', label: t('knowledge.doc.preview') },
                ]}
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
                onClick: () => void createDoc(null, t('knowledge.doc.untitled')),
              }}
            />
          </div>
        ) : editing ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <KnowledgeDocCanvas className="min-h-0 flex-1">
              <InlineDocTitle
                docId={activeDocId}
                title={activeNode?.title ?? t('knowledge.doc.untitled')}
                onCommit={(title) => void renameNode(activeDocId, title)}
              />
              <MarkdownToolbar
                getView={() => editorRef.current?.getView() ?? null}
                onAfterEdit={(text) => setDraftBody(text)}
              />
              <DocEditor
                ref={editorRef}
                key={`${activeDocId}-edit`}
                docId={activeDocId}
                initialValue={docBody}
                onDraftChange={setDraftBody}
                onBlur={() => void flushSave()}
                onSave={() => void flushSave()}
                placeholder={t('knowledge.doc.placeholder')}
              />
            </KnowledgeDocCanvas>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto pb-24">
            <KnowledgeDocCanvas>
              <InlineDocTitle
                docId={activeDocId}
                title={activeNode?.title ?? t('knowledge.doc.untitled')}
                readOnly
                onCommit={() => {}}
              />
              <DocReader
                content={docBody}
                onStartEdit={() => void setEditing(true)}
              />
            </KnowledgeDocCanvas>
          </div>
        )}
      </main>

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
                if (!activeSpaceId) return
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
        title={t('knowledge.space.deleteConfirm')}
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
        <p className="px-5 py-4 text-body leading-relaxed text-ink-secondary">
          {t('knowledge.space.deleteConfirm')}
        </p>
      </Modal>

      <Modal
        open={nodeEdit != null}
        onOpenChange={(o) => !o && setNodeEdit(null)}
        title={t('knowledge.tree.rename')}
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
                if (nodeEdit) void renameNode(nodeEdit.id, nodeTitle.trim())
                setNodeEdit(null)
              }}
            >
              {t('common.close')}
            </Button>
          </div>
        }
      >
        <Input
          data-testid="knowledge-rename-node-name"
          value={nodeTitle}
          onChange={(e) => setNodeTitle(e.target.value)}
          autoFocus
        />
      </Modal>

      <Modal
        open={nodeDelete != null}
        onOpenChange={(o) => !o && setNodeDelete(null)}
        title={t('knowledge.tree.delete')}
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
        <p className="text-body text-ink-secondary">{nodeDelete?.title}</p>
      </Modal>
    </div>
  )
}
