import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Check,
  FilePlus,
  FolderPlus,
  MoreHorizontal,
  Pencil,
} from 'lucide-react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { getPathTitles } from '@/domain/knowledge/tree'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/DropdownMenu'
import { SpaceTree } from './SpaceTree'
import { DocReader } from './DocReader'
import { DocEditor } from './DocEditor'

export function KnowledgeWorkspace() {
  const { t } = useTranslation()
  const spaces = useKnowledgeStore((s) => s.spaces)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const nodes = useKnowledgeStore((s) => s.nodes)
  const activeDocId = useKnowledgeStore((s) => s.activeDocId)
  const docBody = useKnowledgeStore((s) => s.docBody)
  const draftBody = useKnowledgeStore((s) => s.draftBody)
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

  const space = spaces.find((s) => s.id === activeSpaceId)
  const activeNode = nodes.find((n) => n.id === activeDocId)
  const crumbs = useMemo(
    () => (activeDocId ? getPathTitles(nodes, activeDocId) : []),
    [nodes, activeDocId],
  )

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
                {space?.icon ? `${space.icon} ` : ''}
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
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              data-testid="knowledge-new-doc"
              onClick={() => void createDoc(parentForNew, t('knowledge.doc.untitled'))}
            >
              <FilePlus size={14} />
              {t('knowledge.tree.newDoc')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              data-testid="knowledge-new-folder"
              onClick={() => void createFolder(parentForNew)}
            >
              <FolderPlus size={14} />
              {t('knowledge.tree.newFolder')}
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          <SpaceTree
            onRename={(node) => {
              setNodeEdit(node)
              setNodeTitle(node.title)
            }}
            onDelete={(node) => setNodeDelete(node)}
          />
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-4">
          <div className="min-w-0 flex-1 truncate text-meta text-ink-tertiary">
            {space?.name}
            {crumbs.map((c) => (
              <span key={c}>
                {' / '}
                <span className="text-ink">{c}</span>
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
            <Button
              size="sm"
              variant={editing ? 'primary' : 'secondary'}
              data-testid="knowledge-edit-toggle"
              onClick={() => void setEditing(!editing)}
            >
              {editing ? (
                <>
                  <Check size={14} />
                  {t('knowledge.doc.done')}
                </>
              ) : (
                <>
                  <Pencil size={14} />
                  {t('knowledge.doc.edit')}
                </>
              )}
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          {!activeDocId ? (
            <p className="text-body text-ink-tertiary">{t('knowledge.tree.empty')}</p>
          ) : editing ? (
            <DocEditor
              value={draftBody}
              onChange={setDraftBody}
              onBlur={() => void flushSave()}
            />
          ) : (
            <DocReader content={docBody} />
          )}
        </div>
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
        <p className="text-body text-ink-secondary">
          {nodeDelete?.title}
        </p>
      </Modal>
    </div>
  )
}
