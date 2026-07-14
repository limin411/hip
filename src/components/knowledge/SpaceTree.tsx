import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  GripVertical,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { isUnderSubtree, listChildren } from '@/domain/knowledge/tree'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { DeclarativeContextMenu } from '@/components/context-menu'

interface SpaceTreeProps {
  onRename: (node: KnowledgeNode) => void
  onDelete: (node: KnowledgeNode) => void
  onNewDoc: (parentId: string | null) => void
  onNewFolder: (parentId: string | null) => void
  onReveal?: (node: KnowledgeNode) => void
  /** When set, only render nodes in this set (matches ∪ ancestors). */
  visibleIds?: Set<string> | null
}

type DropMode = 'before' | 'into' | 'after'
type DropHint = { targetId: string; mode: DropMode } | null

const DRAG_MIME = 'application/x-hip-knowledge-node'

function dropModeFor(node: KnowledgeNode, clientY: number, rect: DOMRect): DropMode {
  const ratio = (clientY - rect.top) / Math.max(rect.height, 1)
  if (node.kind === 'folder') {
    if (ratio < 0.25) return 'before'
    if (ratio > 0.75) return 'after'
    return 'into'
  }
  return ratio < 0.5 ? 'before' : 'after'
}

/** Whether dropping dragId onto target with mode would form an illegal reparent. */
function isIllegalDrop(
  nodes: KnowledgeNode[],
  dragId: string,
  target: KnowledgeNode,
  mode: DropMode,
): boolean {
  if (dragId === target.id) return true
  if (mode === 'into') {
    // reparent under target folder — illegal if target is under dragId
    return isUnderSubtree(nodes, dragId, target.id)
  }
  // before/after: parent is target.parentId — illegal if that parent is under dragId
  // (only when parent is a descendant of dragged folder)
  if (target.parentId != null && isUnderSubtree(nodes, dragId, target.parentId)) {
    return true
  }
  return false
}

export function SpaceTree({
  onRename,
  onDelete,
  onNewDoc,
  onNewFolder,
  onReveal,
  visibleIds,
}: SpaceTreeProps) {
  const { t } = useTranslation()
  const nodes = useKnowledgeStore((s) => s.nodes)
  const activeDocId = useKnowledgeStore((s) => s.activeDocId)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const expanded = useKnowledgeStore((s) => s.expandedFolderIds)
  const busy = useKnowledgeStore((s) => s.busy)
  const openDoc = useKnowledgeStore((s) => s.openDoc)
  const toggleFolder = useKnowledgeStore((s) => s.toggleFolder)
  const moveNode = useKnowledgeStore((s) => s.moveNode)

  const [dropHint, setDropHint] = useState<DropHint>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)

  const roots = listChildren(nodes, null)

  if (roots.length === 0) {
    return (
      <p className="px-2 py-3 text-meta text-ink-tertiary" data-testid="knowledge-tree-empty">
        {t('knowledge.tree.empty')}
      </p>
    )
  }

  const applyDrop = (target: KnowledgeNode, dragId: string, mode: DropMode) => {
    if (busy || isIllegalDrop(nodes, dragId, target, mode)) {
      setDropHint(null)
      setDraggingId(null)
      return
    }
    if (mode === 'into' && target.kind === 'folder') {
      const kids = listChildren(nodes, target.id)
      void moveNode(dragId, target.id, kids.length)
    } else {
      const siblings = listChildren(nodes, target.parentId)
      const idx = siblings.findIndex((s) => s.id === target.id)
      const base = idx < 0 ? siblings.length : idx
      const toIndex = mode === 'before' ? base : base + 1
      void moveNode(dragId, target.parentId, toIndex)
    }
    setDropHint(null)
    setDraggingId(null)
  }

  const renderNode = (node: KnowledgeNode, depth: number) => {
    if (visibleIds && !visibleIds.has(node.id)) return null

    const spaceId = activeSpaceId ?? ''
    const parentForNew = node.kind === 'folder' ? node.id : node.parentId

    const row = (
      <div
        key={node.id}
        data-testid={
          node.kind === 'doc' ? `knowledge-tree-doc-${node.id}` : `knowledge-tree-folder-${node.id}`
        }
        draggable={!busy}
        onDragStart={(e) => {
          if (busy) {
            e.preventDefault()
            return
          }
          e.dataTransfer.setData(DRAG_MIME, node.id)
          e.dataTransfer.effectAllowed = 'move'
          setDraggingId(node.id)
        }}
        onDragEnd={() => {
          setDraggingId(null)
          setDropHint(null)
        }}
        onDragOver={(e) => {
          if (!draggingId || draggingId === node.id) return
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const mode = dropModeFor(node, e.clientY, rect)
          if (isIllegalDrop(nodes, draggingId, node, mode)) {
            e.dataTransfer.dropEffect = 'none'
            setDropHint(null)
            return
          }
          e.preventDefault()
          e.dataTransfer.dropEffect = 'move'
          setDropHint({ targetId: node.id, mode })
        }}
        onDragLeave={() => {
          setDropHint((h) => (h?.targetId === node.id ? null : h))
        }}
        onDrop={(e) => {
          e.preventDefault()
          const id = e.dataTransfer.getData(DRAG_MIME) || draggingId
          if (!id) return
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          const mode = dropModeFor(node, e.clientY, rect)
          applyDrop(node, id, mode)
        }}
        className={cn(
          'group flex w-full items-center gap-0.5 rounded-md py-1.5 pr-1 text-body transition-colors',
          node.kind === 'doc' && activeDocId === node.id
            ? 'bg-accent-active font-medium text-accent-strong'
            : 'text-ink hover:bg-surface-muted',
          draggingId === node.id && 'opacity-50',
          dropHint?.targetId === node.id &&
            dropHint.mode === 'into' &&
            'ring-1 ring-accent/40 bg-state-hover',
          dropHint?.targetId === node.id &&
            dropHint.mode === 'before' &&
            'border-t-2 border-accent',
          dropHint?.targetId === node.id &&
            dropHint.mode === 'after' &&
            'border-b-2 border-accent',
        )}
        style={{ paddingLeft: depth * 14 + 4 }}
      >
        <span
          className={cn(
            'flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-ink-tertiary transition-opacity active:cursor-grabbing',
            draggingId === node.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100',
          )}
          aria-hidden
        >
          <GripVertical size={12} />
        </span>
        {node.kind === 'folder' ? (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            onClick={() => toggleFolder(node.id)}
            disabled={busy}
          >
            {expanded[node.id] ? (
              <ChevronDown size={14} className="shrink-0 text-ink-tertiary" />
            ) : (
              <ChevronRight size={14} className="shrink-0 text-ink-tertiary" />
            )}
            {expanded[node.id] ? (
              <FolderOpen size={15} className="shrink-0 text-accent-strong" />
            ) : (
              <Folder size={15} className="shrink-0 text-accent-strong" />
            )}
            <span className="truncate">{node.title}</span>
          </button>
        ) : (
          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
            onClick={() => void openDoc(node.id)}
            disabled={busy}
          >
            <span className="w-3.5 shrink-0" />
            <FileText size={15} className="shrink-0 text-ink-tertiary" />
            <span className="truncate">{node.title}</span>
          </button>
        )}
      </div>
    )

    const wrapped = (
      <DeclarativeContextMenu
        key={`ctx-${node.id}`}
        kind="knowledgeNode"
        className="block w-full"
        payload={{
          nodeId: node.id,
          kind: node.kind,
          spaceId,
          onNewDoc: () => onNewDoc(parentForNew),
          onNewFolder: () => onNewFolder(parentForNew),
          onRename: () => onRename(node),
          onDelete: () => onDelete(node),
          onReveal:
            node.kind === 'doc' && onReveal ? () => onReveal(node) : undefined,
        }}
      >
        {row}
      </DeclarativeContextMenu>
    )

    if (node.kind === 'folder') {
      const isOpen = expanded[node.id] === true
      const kids = listChildren(nodes, node.id)
      return (
        <div key={node.id}>
          {wrapped}
          {isOpen && kids.map((c) => renderNode(c, depth + 1))}
        </div>
      )
    }

    return wrapped
  }

  return (
    <div
      data-testid="knowledge-tree"
      onDragOver={(e) => {
        if (!draggingId) return
        e.preventDefault()
      }}
      onDrop={(e) => {
        if (!draggingId || busy) return
        if ((e.target as HTMLElement).closest('[data-testid^="knowledge-tree-"]')) return
        e.preventDefault()
        const kids = listChildren(nodes, null)
        void moveNode(draggingId, null, kids.length)
        setDraggingId(null)
        setDropHint(null)
      }}
    >
      {roots.map((n) => renderNode(n, 0))}
    </div>
  )
}
