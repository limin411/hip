import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  GripVertical,
  Library,
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

/** Horizontal indent per nesting level (px). */
const DEPTH_STEP = 12
/**
 * Base left padding for row content (active rail + tight inset).
 * Drag grip is absolutely positioned and does not reserve a column.
 */
const BASE_PAD = 4
/** Pointer move distance before a press becomes a drag (px). */
const DRAG_THRESHOLD_PX = 5
/**
 * Soft accent wash + left rail for the active document row (local; not SIDEBAR_ACTIVE_RAIL).
 * Exported so visual guardrail tests can assert against the canonical class string.
 */
export const TREE_ACTIVE_DOC =
  'relative bg-accent/10 font-medium text-ink ' +
  'before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent'

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

/**
 * Sibling insert index for moveNode (`toIndex` is among siblings *after* the
 * dragged node is removed from its old position).
 */
export function siblingInsertIndex(
  siblings: KnowledgeNode[],
  dragId: string,
  targetId: string,
  mode: 'before' | 'after',
): number {
  const withoutDrag = siblings.filter((s) => s.id !== dragId)
  const idx = withoutDrag.findIndex((s) => s.id === targetId)
  if (idx < 0) return withoutDrag.length
  return mode === 'before' ? idx : idx + 1
}

/** Depth-first list of currently visible rows (respect expand + filter). */
export function listVisibleTreeNodes(
  nodes: KnowledgeNode[],
  expanded: Record<string, boolean>,
  visibleIds?: Set<string> | null,
  parentId: string | null = null,
): KnowledgeNode[] {
  const out: KnowledgeNode[] = []
  for (const n of listChildren(nodes, parentId)) {
    if (visibleIds && !visibleIds.has(n.id)) continue
    out.push(n)
    if (n.kind === 'folder' && expanded[n.id]) {
      out.push(...listVisibleTreeNodes(nodes, expanded, visibleIds, n.id))
    }
  }
  return out
}

type DragSession = {
  id: string
  startX: number
  startY: number
  pointerId: number
  active: boolean
}

/**
 * Pointer-based tree DnD (not HTML5).
 * Tauri's default native file-drop layer intercepts HTML5 drag events; pointer
 * drag works regardless of `dragDropEnabled`.
 */
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
  const treeFocusId = useKnowledgeStore((s) => s.treeFocusId)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const expanded = useKnowledgeStore((s) => s.expandedFolderIds)
  const busy = useKnowledgeStore((s) => s.busy)
  const openDoc = useKnowledgeStore((s) => s.openDoc)
  const toggleFolder = useKnowledgeStore((s) => s.toggleFolder)
  const moveNode = useKnowledgeStore((s) => s.moveNode)
  const setTreeFocusId = useKnowledgeStore((s) => s.setTreeFocusId)

  const [dropHint, setDropHint] = useState<DropHint>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<DragSession | null>(null)
  // Live snapshots for document-level pointer handlers (avoid stale closures).
  const nodesRef = useRef(nodes)
  const busyRef = useRef(busy)
  const moveNodeRef = useRef(moveNode)
  nodesRef.current = nodes
  busyRef.current = busy
  moveNodeRef.current = moveNode

  const roots = listChildren(nodes, null)
  const visibleRows = listVisibleTreeNodes(nodes, expanded, visibleIds)

  // Roving focus: move DOM focus onto the focused row when treeFocusId changes.
  useEffect(() => {
    if (!treeFocusId || !treeRef.current) return
    if (!treeRef.current.contains(document.activeElement)) return
    const el = treeRef.current.querySelector<HTMLElement>(
      `[data-tree-node-id="${treeFocusId.replace(/"/g, '')}"]`,
    )
    el?.focus({ preventScroll: false })
  }, [treeFocusId])

  const clearDragUi = () => {
    sessionRef.current = null
    setDraggingId(null)
    setDropHint(null)
  }

  const applyDrop = (target: KnowledgeNode, dragId: string, mode: DropMode) => {
    const liveNodes = nodesRef.current
    if (busyRef.current || isIllegalDrop(liveNodes, dragId, target, mode)) {
      clearDragUi()
      return
    }
    if (mode === 'into' && target.kind === 'folder') {
      const kids = listChildren(liveNodes, target.id)
      void moveNodeRef.current(dragId, target.id, kids.length)
    } else {
      const siblings = listChildren(liveNodes, target.parentId)
      const toIndex = siblingInsertIndex(
        siblings,
        dragId,
        target.id,
        mode === 'before' ? 'before' : 'after',
      )
      void moveNodeRef.current(dragId, target.parentId, toIndex)
    }
    clearDragUi()
  }

  const resolveTargetAtPoint = (
    clientX: number,
    clientY: number,
    dragId: string,
  ): { target: KnowledgeNode; mode: DropMode } | null => {
    const el = document.elementFromPoint(clientX, clientY)
    if (!(el instanceof Element)) return null
    const row = el.closest('[data-tree-node-id]') as HTMLElement | null
    if (!row) {
      // Empty area inside tree → drop as last root sibling.
      const tree = treeRef.current
      if (tree && tree.contains(el)) {
        return null // handled as root append by caller via dropHint null + root flag
      }
      return null
    }
    const targetId = row.getAttribute('data-tree-node-id')
    if (!targetId || targetId === dragId) return null
    const target = nodesRef.current.find((n) => n.id === targetId)
    if (!target) return null
    const rect = row.getBoundingClientRect()
    const mode = dropModeFor(target, clientY, rect)
    if (isIllegalDrop(nodesRef.current, dragId, target, mode)) return null
    return { target, mode }
  }

  // Document-level pointer tracking while a row press is active.
  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      const session = sessionRef.current
      if (!session || e.pointerId !== session.pointerId) return

      const dx = e.clientX - session.startX
      const dy = e.clientY - session.startY
      if (!session.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
        if (busyRef.current) {
          clearDragUi()
          return
        }
        session.active = true
        setDraggingId(session.id)
      }

      e.preventDefault()
      const hit = resolveTargetAtPoint(e.clientX, e.clientY, session.id)
      if (hit) {
        setDropHint({ targetId: hit.target.id, mode: hit.mode })
      } else {
        setDropHint(null)
      }
    }

    const onPointerUp = (e: PointerEvent) => {
      const session = sessionRef.current
      if (!session || e.pointerId !== session.pointerId) return

      if (session.active) {
        const hit = resolveTargetAtPoint(e.clientX, e.clientY, session.id)
        if (hit) {
          applyDrop(hit.target, session.id, hit.mode)
          return
        }
        // Drop on tree chrome (not a row) → append as last root child.
        const el = document.elementFromPoint(e.clientX, e.clientY)
        const tree = treeRef.current
        if (tree && el instanceof Element && tree.contains(el) && !busyRef.current) {
          const kids = listChildren(nodesRef.current, null)
          void moveNodeRef.current(session.id, null, kids.length)
        }
      }
      clearDragUi()
    }

    const onPointerCancel = (e: PointerEvent) => {
      const session = sessionRef.current
      if (!session || e.pointerId !== session.pointerId) return
      clearDragUi()
    }

    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerCancel)
    return () => {
      document.removeEventListener('pointermove', onPointerMove)
      document.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('pointercancel', onPointerCancel)
    }
  }, [])

  /** Drag starts only from the grip handle — not the title/open hit target. */
  const onGripPointerDown = (nodeId: string, e: ReactPointerEvent) => {
    if (busy || e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    sessionRef.current = {
      id: nodeId,
      startX: e.clientX,
      startY: e.clientY,
      pointerId: e.pointerId,
      active: false,
    }
  }

  if (roots.length === 0) {
    return (
      <div
        className="flex flex-col items-center gap-2.5 px-3 py-10 text-center"
        data-testid="knowledge-tree-empty"
      >
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-surface-muted text-ink-tertiary">
          <Library size={18} strokeWidth={1.75} />
        </span>
        <p className="max-w-[11rem] text-meta leading-relaxed text-ink-tertiary">
          {t('knowledge.tree.empty')}
        </p>
      </div>
    )
  }

  const focusIndex = treeFocusId
    ? visibleRows.findIndex((n) => n.id === treeFocusId)
    : -1
  const focusInVisible = focusIndex >= 0

  const moveFocus = (delta: number) => {
    if (visibleRows.length === 0) return
    let next: number
    if (focusIndex < 0) {
      next = delta > 0 ? 0 : visibleRows.length - 1
    } else {
      next = Math.max(0, Math.min(visibleRows.length - 1, focusIndex + delta))
    }
    setTreeFocusId(visibleRows[next].id)
  }

  const onTreeKeyDown = (e: KeyboardEvent) => {
    if (busy) return
    const key = e.key
    if (
      key !== 'ArrowDown' &&
      key !== 'ArrowUp' &&
      key !== 'ArrowLeft' &&
      key !== 'ArrowRight' &&
      key !== 'Enter'
    ) {
      return
    }
    e.preventDefault()
    e.stopPropagation()

    if (key === 'ArrowDown') {
      moveFocus(1)
      return
    }
    if (key === 'ArrowUp') {
      moveFocus(-1)
      return
    }

    // Only act on currently visible rows (filter + expand aware).
    const focused =
      (focusInVisible ? visibleRows[focusIndex] : null) || visibleRows[0] || null
    if (!focused) return
    if (treeFocusId !== focused.id) setTreeFocusId(focused.id)

    if (key === 'Enter') {
      if (focused.kind === 'folder') toggleFolder(focused.id)
      else void openDoc(focused.id)
      return
    }

    if (key === 'ArrowLeft') {
      if (focused.kind === 'folder' && expanded[focused.id]) {
        toggleFolder(focused.id)
        return
      }
      if (
        focused.parentId &&
        visibleRows.some((n) => n.id === focused.parentId)
      ) {
        setTreeFocusId(focused.parentId)
      }
      return
    }

    if (key === 'ArrowRight') {
      if (focused.kind === 'folder') {
        if (!expanded[focused.id]) {
          toggleFolder(focused.id)
          return
        }
        const kids = listVisibleTreeNodes(
          nodes,
          { ...expanded, [focused.id]: true },
          visibleIds,
          focused.id,
        )
        // First child among visible rows under this folder
        if (kids[0]) setTreeFocusId(kids[0].id)
      }
    }
  }

  const renderNode = (node: KnowledgeNode, depth: number) => {
    if (visibleIds && !visibleIds.has(node.id)) return null

    const spaceId = activeSpaceId ?? ''
    const parentForNew = node.kind === 'folder' ? node.id : node.parentId
    const isActiveDoc = node.kind === 'doc' && activeDocId === node.id
    const isFocused = treeFocusId === node.id
    // Roving target: focused visible row, or first root when focus is missing/hidden.
    const isRovingTarget =
      (focusInVisible && isFocused) || (!focusInVisible && node === roots[0])
    const isFolder = node.kind === 'folder'
    const isOpen = isFolder && expanded[node.id] === true

    const row = (
      <div
        key={node.id}
        data-testid={
          node.kind === 'doc' ? `knowledge-tree-doc-${node.id}` : `knowledge-tree-folder-${node.id}`
        }
        data-tree-node-id={node.id}
        role="treeitem"
        aria-expanded={isFolder ? isOpen : undefined}
        aria-selected={isActiveDoc}
        tabIndex={isRovingTarget ? 0 : -1}
        onFocus={() => {
          if (treeFocusId !== node.id) setTreeFocusId(node.id)
        }}
        className={cn(
          'group relative flex w-full min-h-[32px] items-center gap-0.5 rounded-lg py-1 pr-1.5 text-body transition-[background-color,color,box-shadow,opacity] duration-100 outline-none select-none',
          isActiveDoc ? TREE_ACTIVE_DOC : 'text-ink hover:bg-state-hover',
          // Keyboard focus: fill only (Chrome ring omitted — row uses roving tabindex)
          isFocused && !isActiveDoc && 'bg-state-hover',
          draggingId === node.id && 'opacity-45',
          dropHint?.targetId === node.id &&
            dropHint.mode === 'into' &&
            'ring-1 ring-accent/40 bg-accent/5',
          dropHint?.targetId === node.id &&
            dropHint.mode === 'before' &&
            'border-t-2 border-accent',
          dropHint?.targetId === node.id &&
            dropHint.mode === 'after' &&
            'border-b-2 border-accent',
        )}
        style={{ paddingLeft: depth * DEPTH_STEP + BASE_PAD }}
      >
        {/* Nesting guide — soft vertical rails for depth > 0 */}
        {depth > 0 &&
          Array.from({ length: depth }, (_, i) => (
            <span
              key={i}
              aria-hidden
              className="pointer-events-none absolute top-0 bottom-0 w-px bg-border/40"
              style={{ left: i * DEPTH_STEP + BASE_PAD + 6 }}
            />
          ))}

        {/* Drag handle overlays the left edge — not a permanent flex column. */}
        <button
          type="button"
          tabIndex={-1}
          data-testid={`knowledge-tree-drag-${node.id}`}
          data-tree-drag-handle=""
          disabled={busy}
          aria-label={t('knowledge.tree.dragHandle')}
          title={t('knowledge.tree.dragHandle')}
          onPointerDown={(e) => onGripPointerDown(node.id, e)}
          style={{ left: depth * DEPTH_STEP + 1 }}
          className={cn(
            'absolute top-1/2 z-[1] flex h-6 w-3.5 -translate-y-1/2 cursor-grab items-center justify-center rounded-md text-ink-tertiary/80 transition-[opacity,background-color,color] touch-none active:cursor-grabbing',
            'hover:bg-state-hover hover:text-ink-secondary',
            'disabled:pointer-events-none disabled:opacity-40',
            // Invisible at rest and not hit-target so chevron/title keep full row.
            draggingId === node.id
              ? 'pointer-events-auto opacity-100 text-ink-secondary'
              : 'pointer-events-none opacity-0 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
          )}
        >
          <GripVertical size={12} strokeWidth={1.75} />
        </button>

        {isFolder ? (
          <div
            role="presentation"
            className={cn(
              'flex min-w-0 flex-1 cursor-default items-center gap-1.5 text-left',
              busy && 'pointer-events-none opacity-60',
            )}
            onClick={() => {
              if (busy) return
              setTreeFocusId(node.id)
              toggleFolder(node.id)
            }}
          >
            <span className="flex h-5 w-4 shrink-0 items-center justify-center text-ink-tertiary">
              {isOpen ? (
                <ChevronDown size={14} strokeWidth={1.75} />
              ) : (
                <ChevronRight size={14} strokeWidth={1.75} />
              )}
            </span>
            <span
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-md',
                isOpen ? 'bg-accent-strong/10 text-accent-strong' : 'text-accent-strong',
              )}
            >
              {isOpen ? (
                <FolderOpen size={14} strokeWidth={1.75} />
              ) : (
                <Folder size={14} strokeWidth={1.75} />
              )}
            </span>
            <span className="truncate font-medium leading-snug tracking-tight">
              {node.title}
            </span>
          </div>
        ) : (
          <div
            role="presentation"
            className={cn(
              'flex min-w-0 flex-1 cursor-default items-center gap-1.5 text-left',
              busy && 'pointer-events-none opacity-60',
            )}
            onClick={() => {
              if (busy) return
              setTreeFocusId(node.id)
              void openDoc(node.id)
            }}
          >
            {/* Align docs with folder titles (chevron column reserved) */}
            <span className="w-4 shrink-0" aria-hidden />
            <span
              className={cn(
                'flex h-5 w-5 shrink-0 items-center justify-center rounded-md',
                isActiveDoc
                  ? 'bg-accent-strong/12 text-accent-strong'
                  : 'text-ink-tertiary group-hover:text-ink-secondary',
              )}
            >
              <FileText size={14} strokeWidth={1.75} />
            </span>
            <span
              className={cn(
                'truncate leading-snug tracking-tight',
                isActiveDoc ? 'font-medium text-ink' : 'font-normal text-ink',
              )}
            >
              {node.title}
            </span>
          </div>
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

    if (isFolder) {
      const kids = listChildren(nodes, node.id)
      return (
        <div key={node.id} role="group" className="flex flex-col gap-px">
          {wrapped}
          {isOpen && kids.map((c) => renderNode(c, depth + 1))}
        </div>
      )
    }

    return wrapped
  }

  return (
    <div
      ref={treeRef}
      role="tree"
      tabIndex={-1}
      data-testid="knowledge-tree"
      className="flex flex-col gap-px"
      onKeyDown={onTreeKeyDown}
    >
      {roots.map((n) => renderNode(n, 0))}
    </div>
  )
}
