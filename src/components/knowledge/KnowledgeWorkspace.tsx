import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  FilePlus,
  FileText,
  FolderPlus,
  MoreHorizontal,
  Search,
} from 'lucide-react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { filterTreeVisible, getPath } from '@/domain/knowledge/tree'
import type { KnowledgeNode } from '@/domain/knowledge/types'
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
} from '@/components/ui/DropdownMenu'
import { SpaceTree } from './SpaceTree'
import { DocReader } from './DocReader'
import { DocEditor, type DocEditorHandle } from './DocEditor'
import { InlineDocTitle } from './InlineDocTitle'
import { MarkdownToolbar } from './MarkdownToolbar'

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

  const visibleIds = useMemo(
    () => filterTreeVisible(nodes, treeFilter),
    [nodes, treeFilter],
  )

  // Force-expand ancestors while filtering; restore on clear.
  useEffect(() => {
    const q = treeFilter.trim()
    if (q && visibleIds) {
      if (!filterExpandSnapshot) {
        setFilterExpandSnapshot(useKnowledgeStore.getState().expandedFolderIds)
      }
      const expand: Record<string, boolean> = {
        ...useKnowledgeStore.getState().expandedFolderIds,
      }
      for (const id of visibleIds) {
        const n = nodes.find((x) => x.id === id)
        if (n?.kind === 'folder') expand[id] = true
        // also expand ancestors
        let cur = n
        while (cur?.parentId) {
          expand[cur.parentId] = true
          cur = nodes.find((x) => x.id === cur?.parentId)
        }
      }
      useKnowledgeStore.setState({ expandedFolderIds: expand })
    } else if (!q && filterExpandSnapshot) {
      useKnowledgeStore.setState({ expandedFolderIds: filterExpandSnapshot })
      setFilterExpandSnapshot(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- snapshot only on filter edge
  }, [treeFilter, visibleIds, nodes])

  const [renameSpaceOpen, setRenameSpaceOpen] = useState(false)
  const [spaceName, setSpaceName] = useState('')
  const [deleteSpaceOpen, setDeleteSpaceOpen] = useState(false)
  const [nodeEdit, setNodeEdit] = useState<KnowledgeNode | null>(null)
  const [nodeTitle, setNodeTitle] = useState('')
  const [nodeDelete, setNodeDelete] = useState<KnowledgeNode | null>(null)

  const parentForNew: string | null =
    activeNode?.kind === 'folder'
      ? activeNode.id
      : activeNode?.parentId ?? null

  const mode: 'edit' | 'preview' = editing ? 'edit' : 'preview'

  const onCrumbClick = (node: KnowledgeNode) => {
    if (node.kind === 'folder') {
      toggleFolder(node.id)
      // keep active doc; only expand
    } else {
      void openDoc(node.id)
    }
  }

  return (
    <div className="flex min-h-0 flex-1" data-testid="knowledge-workspace">
      <aside className="flex w-[260px] shrink-0 flex-col border-r border-border bg-surface-subtle">
        <div className="flex flex-col gap-2 border-b border-border p-3">
          <button
            type="button"
            className="flex items-center gap-1 text-meta text-ink-secondary hover:text-ink"
            onClick={() => void openHome()}
          >
            <ArrowLeft size={14} />
            {t('knowledge.home.mySpaces')}
          </button>
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <div className="truncate text-body font-semibold text-ink">
                {space?.name ?? t('tabs.knowledge')}
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="knowledge-space-menu"
                  className="rounded-md p-1 text-ink-tertiary hover:bg-state-hover"
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
                  data-testid="knowledge-space-delete"
                  onClick={() => setDeleteSpaceOpen(true)}
                >
                  {t('knowledge.tree.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <div className="flex items-center gap-1">
            <Button
              size="icon"
              variant="secondary"
              disabled={busy}
              data-testid="knowledge-new-doc"
              title={t('knowledge.tree.newDoc')}
              aria-label={t('knowledge.tree.newDoc')}
              onClick={() => void createDoc(parentForNew, t('knowledge.doc.untitled'))}
            >
              <FilePlus size={15} />
            </Button>
            <Button
              size="icon"
              variant="secondary"
              disabled={busy}
              data-testid="knowledge-new-folder"
              title={t('knowledge.tree.newFolder')}
              aria-label={t('knowledge.tree.newFolder')}
              onClick={() =>
                void createFolder(parentForNew, t('knowledge.folder.untitled'))
              }
            >
              <FolderPlus size={15} />
            </Button>
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
              className="h-8 pl-7 text-meta"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <SpaceTree
            visibleIds={visibleIds}
            onRename={(node) => {
              setNodeEdit(node)
              setNodeTitle(node.title)
            }}
            onDelete={(node) => setNodeDelete(node)}
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
          <div className="min-w-0 flex-1 truncate text-meta text-ink-tertiary">
            {space?.name}
            {pathNodes.map((n, i) => (
              <span key={n.id}>
                {' / '}
                {i < pathNodes.length - 1 ? (
                  <button
                    type="button"
                    className="text-ink-secondary hover:text-ink hover:underline"
                    onClick={() => onCrumbClick(n)}
                  >
                    {n.title}
                  </button>
                ) : (
                  <span className="text-ink">{n.title}</span>
                )}
              </span>
            ))}
          </div>
          {saveState === 'saving' && (
            <span className="text-meta text-ink-tertiary">{t('knowledge.doc.saving')}</span>
          )}
          {saveState === 'saved' && (
            <span className="text-meta text-ink-tertiary">{t('knowledge.doc.saved')}</span>
          )}
          {activeDocId && (
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
          )}
        </div>
        {!activeDocId ? (
          <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-6">
            <EmptyState
              icon={FileText}
              title={t('knowledge.workspace.noDocTitle')}
              description={t('knowledge.workspace.noDocHint')}
              className="w-full max-w-md border-0"
            />
          </div>
        ) : editing ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-8">
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
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-8">
            <div className="mx-auto w-full max-w-3xl">
              <InlineDocTitle
                docId={activeDocId}
                title={activeNode?.title ?? t('knowledge.doc.untitled')}
                readOnly
                onCommit={() => {}}
              />
              <DocReader content={docBody} />
            </div>
          </div>
        )}
      </main>

      <Modal
        open={renameSpaceOpen}
        onOpenChange={setRenameSpaceOpen}
        title={t('knowledge.tree.rename')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setRenameSpaceOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={!spaceName.trim() || busy || !activeSpaceId}
              onClick={() => {
                if (activeSpaceId) void renameSpace(activeSpaceId, spaceName.trim())
                setRenameSpaceOpen(false)
              }}
            >
              {t('common.close')}
            </Button>
          </div>
        }
      >
        <Input value={spaceName} onChange={(e) => setSpaceName(e.target.value)} autoFocus />
      </Modal>

      <Modal
        open={deleteSpaceOpen}
        onOpenChange={setDeleteSpaceOpen}
        title={t('knowledge.space.deleteConfirm')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeleteSpaceOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              disabled={busy || !activeSpaceId}
              onClick={() => {
                if (activeSpaceId) void deleteSpace(activeSpaceId)
                setDeleteSpaceOpen(false)
              }}
            >
              {t('knowledge.tree.delete')}
            </Button>
          </div>
        }
      >
        <p className="text-body text-ink-secondary">{t('knowledge.space.deleteConfirm')}</p>
      </Modal>

      <Modal
        open={nodeEdit != null}
        onOpenChange={(o) => !o && setNodeEdit(null)}
        title={t('knowledge.tree.rename')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNodeEdit(null)}>
              {t('common.cancel')}
            </Button>
            <Button
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
        <Input value={nodeTitle} onChange={(e) => setNodeTitle(e.target.value)} autoFocus />
      </Modal>

      <Modal
        open={nodeDelete != null}
        onOpenChange={(o) => !o && setNodeDelete(null)}
        title={t('knowledge.tree.delete')}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setNodeDelete(null)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
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
