/**
 * 文档管理 — 主区浏览模式（v3）。
 *
 * doc-notion-polish/PR-5：默认紧凑列表（Notion 页面列表心智）——40px 行 =
 * 类型图标 + 标题 + 上次编辑 + hover 行尾 ⋯（与右键菜单共用同一 provider）；
 * 网格保留可切换（tile 缩为 40px 图标）；工具栏瘦身（↑ 返回移除，面包屑承担；
 * 新建改为实底主按钮）；空态大标题。
 * 与侧边栏 DirNavList 共用同一导航状态（knowledgeStore.currentFolderId）。
 */
import { useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FileText, Folder, Grid3X3, List, Plus, Table2 } from 'lucide-react'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { knowledgeRevealDoc } from '@/ipc/knowledge'
import { getPath, isUnderSubtree, listChildren } from '@/domain/knowledge/tree'
import { rangeBetween } from '@/domain/knowledge/blockDragSelect'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { NodeRowMenu } from './NodeRowMenu'

/**
 * doc-ux-polish-2 X3: 浏览行/网格 tile 同层拖拽排序（改 order）+
 * 拖入文件夹行 / 面包屑 = 移入（改 parentId）。native HTML5 DnD；
 * 行内交互元素保持 `data-no-drag`，行编辑态不可拖。
 */

type DropHint = { id: string; pos: 'before' | 'after' | 'into' }


const CRUMB_MAX = 3

function formatUpdated(ts: number): string {
  try {
    const d = new Date(ts)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return ''
  }
}

export function DocManagerBrowse() {
  const { t } = useTranslation()
  const nodes = useKnowledgeStore((s) => s.nodes)
  const currentFolderId = useKnowledgeStore((s) => s.currentFolderId)
  const activeDocId = useKnowledgeStore((s) => s.activeDocId)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const busy = useKnowledgeStore((s) => s.busy)

  const [query, setQuery] = useState('')
  const [view, setView] = useState<'grid' | 'list'>('list')
  const [newKind, setNewKind] = useState<'folder' | 'doc' | 'table' | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const cancelNewRef = useRef(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [jumpOpen, setJumpOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

  // X3: 拖拽排序/移动状态（native DnD）。
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropHint, setDropHint] = useState<DropHint | null>(null)

  // X4: 批量选择（Shift 连选 / ⌘ 点选）+ 批量条。
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [selectAnchor, setSelectAnchor] = useState<string | null>(null)
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [moveTarget, setMoveTarget] = useState<string | null>(null)

  const clearSelection = () => {
    setSelectedIds([])
    setSelectAnchor(null)
  }

  useEffect(() => {
    if (!menuOpen && !jumpOpen) return
    const onDown = (e: PointerEvent) => {
      const el = menuRef.current
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        setMenuOpen(false)
        setJumpOpen(false)
      }
    }
    window.addEventListener('pointerdown', onDown)
    return () => window.removeEventListener('pointerdown', onDown)
  }, [menuOpen, jumpOpen])

  const ancestors = useMemo(() => {
    if (!currentFolderId) return []
    return getPath(nodes, currentFolderId).slice(0, -1)
  }, [nodes, currentFolderId])

  const level = useMemo(() => {
    // X3: 展示顺序 = 树内 order（listChildren），拖拽排序直接可见。
    const children = listChildren(nodes, currentFolderId)
    const q = query.trim().toLowerCase()
    if (!q) return children
    return children.filter((n) => n.title.toLowerCase().includes(q))
  }, [nodes, currentFolderId, query])

  const atRoot = currentFolderId == null
  const noChildren = level.length === 0 && !newKind
  const searchNoMatch = level.length === 0 && query.trim() !== ''

  const nav = () => useKnowledgeStore.getState()
  const startNew = (kind: 'folder' | 'doc' | 'table') => {
    setMenuOpen(false)
    setNewKind(kind)
    setNewTitle('')
  }
  const confirmNew = () => {
    if (!newKind) return
    const title = newTitle.trim()
    if (newKind === 'folder') {
      void nav().createFolder(currentFolderId, title || t('knowledge.tree.newFolder'))
    } else if (newKind === 'table') {
      void nav().requestCreateTable(currentFolderId, title || t('knowledge.table.untitled'))
    } else {
      void nav().requestCreateDoc(currentFolderId, title || t('knowledge.doc.untitled'))
    }
    setNewKind(null)
    setNewTitle('')
  }
  const startRename = (node: KnowledgeNode) => {
    setEditingId(node.id)
    setEditTitle(node.title)
  }
  const confirmRename = (node: KnowledgeNode) => {
    if (editingId !== node.id) return
    void nav().renameNode(node.id, editTitle)
    setEditingId(null)
  }
  const deleteNode = (node: KnowledgeNode) => void nav().deleteNode(node.id)
  const reveal = (node: KnowledgeNode) => {
    if (node.kind === 'doc' && activeSpaceId) {
      void knowledgeRevealDoc(activeSpaceId, node.id).catch(() => {})
    }
  }
  /** 复制标题路径（深链直达用）。 */
  const copyPath = (node: KnowledgeNode) => {
    const chain = [
      t('knowledge.home.mySpaces'),
      ...getPath(nodes, node.id).map((n) => n.title),
    ]
    void navigator.clipboard
      .writeText(chain.join(' / '))
      .then(() => toast.success(t('knowledge.tree.pathCopied')))
      .catch(() => {})
  }

  const rowMenuPayload = (node: KnowledgeNode) => ({
    nodeId: node.id,
    kind: node.kind,
    spaceId: activeSpaceId ?? '',
    onRename: () => startRename(node),
    onDelete: () => deleteNode(node),
    onReveal: node.kind === 'doc' ? () => reveal(node) : undefined,
    onCopyPath: () => copyPath(node),
  })

  // ── X3 拖拽（行/tile/面包屑共用） ──────────────────────────────
  const endDrag = () => {
    setDragId(null)
    setDropHint(null)
  }

  const startDrag = (e: DragEvent, node: KnowledgeNode) => {
    // 行内交互元素（按钮/输入框）与编辑态不发起拖拽。
    if ((e.target as Element | null)?.closest?.('[data-no-drag]')) {
      e.preventDefault()
      return
    }
    if (editingId === node.id) {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData('text/plain', node.id)
    e.dataTransfer.effectAllowed = 'move'
    setDragId(node.id)
    setDropHint(null)
  }

  /** 目标位置：文件夹行 = 移入末尾；文档行 = 上/下半（before/after）。 */
  const hoverPos = (
    e: DragEvent,
    node: KnowledgeNode,
  ): DropHint['pos'] => {
    if (node.kind === 'folder') return 'into'
    const rect = e.currentTarget.getBoundingClientRect()
    return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
  }

  const overRow = (e: DragEvent, node: KnowledgeNode) => {
    if (!dragId || dragId === node.id) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const pos = hoverPos(e, node)
    setDropHint((prev) =>
      prev?.id === node.id && prev.pos === pos ? prev : { id: node.id, pos },
    )
  }

  const leaveRow = (e: DragEvent, node: KnowledgeNode) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
      setDropHint((prev) => (prev?.id === node.id ? null : prev))
    }
  }

  /**
   * toIndex 语义（moveNodePure）：插入目标在「移除被拖节点后的兄弟列表」中的位置。
   * 同层拖拽需按被拖节点相对位置修正；跨层（dragIdx<0）无需修正。
   */
  const toIndexFor = (node: KnowledgeNode, pos: DropHint['pos']): number => {
    const siblings = listChildren(nodes, currentFolderId)
    const idx = siblings.findIndex((n) => n.id === node.id)
    const dragIdx = siblings.findIndex((n) => n.id === dragId)
    if (dragIdx < 0) return pos === 'after' ? idx + 1 : idx
    return pos === 'after'
      ? dragIdx <= idx
        ? idx
        : idx + 1
      : dragIdx < idx
        ? idx - 1
        : idx
  }

  const dropOnRow = (e: DragEvent, node: KnowledgeNode) => {
    if (!dragId || dragId === node.id) return
    e.preventDefault()
    e.stopPropagation()
    if (node.kind === 'folder') {
      // 移入文件夹末尾；禁止移入自身/后代。
      if (!isUnderSubtree(nodes, dragId, node.id)) {
        void nav().moveNode(dragId, node.id)
      }
    } else {
      const pos = hoverPos(e, node)
      void nav().moveNode(dragId, currentFolderId, toIndexFor(node, pos))
    }
    endDrag()
  }

  const crumbKey = (crumbId: string | null) => `crumb:${crumbId ?? 'root'}`

  // ── X4 批量选择 ──────────────────────────────────────────────
  /** 行点击：⌘ 点选 / Shift 连选 / 普通点击（退出批量态并打开）。 */
  const openRow = (e: MouseEvent, node: KnowledgeNode) => {
    if (node.kind === 'folder') {
      if (selectedIds.length > 0) clearSelection()
      void nav().enterFolder(node.id)
      return
    }
    if (e.metaKey || e.ctrlKey) {
      e.stopPropagation()
      setSelectedIds((prev) =>
        prev.includes(node.id)
          ? prev.filter((x) => x !== node.id)
          : [...prev, node.id],
      )
      setSelectAnchor((prev) => prev ?? node.id)
      return
    }
    if (e.shiftKey) {
      e.stopPropagation()
      const docs = level.filter((n) => n.kind !== 'folder').map((n) => n.id)
      const anchor = selectAnchor ?? selectedIds[selectedIds.length - 1] ?? node.id
      setSelectAnchor(anchor)
      const range = rangeBetween(docs, anchor, node.id)
      if (range.length > 0) setSelectedIds(range)
      return
    }
    if (selectedIds.length > 0) clearSelection()
    if (node.kind === 'table') {
      void nav().openTable(node.id)
      return
    }
    void nav().openDoc(node.id)
  }

  // Esc 退出批量态。
  useEffect(() => {
    if (selectedIds.length === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedIds.length])

  // 点击内容空白退出批量态（行内点击已 stopPropagation）。
  const clearOnBlank = () => {
    if (selectedIds.length > 0) clearSelection()
  }

  /** 移动目标选择：全部文件夹（含根 = null）。 */
  const folders = useMemo(() => {
    const out: { id: string | null; title: string; depth: number }[] = []
    const walk = (parentId: string | null, depth: number) => {
      for (const ch of listChildren(nodes, parentId)) {
        if (ch.kind !== 'folder') continue
        out.push({ id: ch.id, title: ch.title, depth })
        walk(ch.id, depth + 1)
      }
    }
    walk(null, 0)
    return out
  }, [nodes])

  const confirmBatchDelete = () => {
    void nav().deleteNodes(selectedIds)
    setBatchDeleteOpen(false)
    clearSelection()
  }

  const confirmBatchMove = () => {
    if (moveOpen && moveTarget !== undefined) {
      void nav().moveNodes(selectedIds, moveTarget)
    }
    setMoveOpen(false)
    clearSelection()
  }

  const overCrumb = (e: DragEvent, crumbId: string | null) => {
    if (!dragId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDropHint((prev) => {
      const key = crumbKey(crumbId)
      return prev?.id === key ? prev : { id: key, pos: 'into' }
    })
  }

  const dropOnCrumb = (e: DragEvent, crumbId: string | null) => {
    if (!dragId) return
    e.preventDefault()
    e.stopPropagation()
    if (crumbId == null || !isUnderSubtree(nodes, dragId, crumbId)) {
      void nav().moveNode(dragId, crumbId)
    }
    endDrag()
  }

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-surface-content"
      data-testid="doc-manager-browse"
      data-dragging={dragId ? 'true' : undefined}
    >
      {/* 工具栏（PR-5 瘦身：面包屑小字 + 搜索 + 视图切换 + 新建主按钮） */}
      <div
        className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4"
        data-testid="browse-toolbar"
      >
        {/* 面包屑（>3 段折叠 …，可跳任意祖先；X3 可作 drop 目标 = 移入该祖先） */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-meta">
          <span
            data-testid="browse-crumb-root"
            data-dragging={dropHint?.id === crumbKey(null) ? 'true' : undefined}
            className={cn(
              'shrink-0 cursor-pointer whitespace-nowrap rounded-sm px-1 py-0.5',
              atRoot
                ? 'font-medium text-ink'
                : 'text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink',
              dropHint?.id === crumbKey(null) &&
                'bg-state-hover outline outline-1 outline-dashed outline-[color:var(--border-strong)]',
            )}
            onDragOver={(e) => overCrumb(e, null)}
            onDrop={(e) => dropOnCrumb(e, null)}
            onClick={() => void nav().navigateTo(null, null)}
          >
            {t('knowledge.home.mySpaces')}
          </span>
          {ancestors.length > CRUMB_MAX ? (
            <>
              <span className="shrink-0 text-ink-tertiary/60" aria-hidden>
                ›
              </span>
              <div className="relative shrink-0" ref={menuRef}>
                <button
                  type="button"
                  data-testid="browse-crumb-more"
                  data-no-drag
                  onClick={() => {
                    setJumpOpen((v) => !v)
                    setMenuOpen(false)
                  }}
                  className="rounded-sm px-1 py-0.5 text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink"
                >
                  …
                </button>
                {jumpOpen ? (
                  <div
                    className="absolute left-0 top-7 z-50 max-h-64 w-48 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
                    role="menu"
                    data-testid="browse-crumb-jump-menu"
                  >
                    <button
                      type="button"
                      role="menuitem"
                      data-no-drag
                      onClick={() => {
                        setJumpOpen(false)
                        void nav().navigateTo(null, null)
                      }}
                      className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-body text-ink transition-colors hover:bg-state-hover"
                    >
                      {t('knowledge.home.mySpaces')}
                    </button>
                    {ancestors.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        role="menuitem"
                        data-no-drag
                        data-testid={`browse-jump-${a.id}`}
                        onClick={() => {
                          setJumpOpen(false)
                          void nav().navigateTo(a.id, null)
                        }}
                        className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-body text-ink transition-colors hover:bg-state-hover"
                      >
                        <Folder size={13} className="shrink-0 text-accent" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{a.title}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </>
          ) : null}
          {ancestors.slice(-CRUMB_MAX).map((a) => (
            <span key={a.id} className="flex min-w-0 items-center gap-1">
              <span className="shrink-0 text-ink-tertiary/60" aria-hidden>
                ›
              </span>
              <span
                data-testid={`browse-crumb-${a.id}`}
                data-dragging={
                  dropHint?.id === crumbKey(a.id) ? 'true' : undefined
                }
                className={cn(
                  'min-w-0 cursor-pointer truncate whitespace-nowrap rounded-sm px-1 py-0.5 text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink',
                  dropHint?.id === crumbKey(a.id) &&
                    'bg-state-hover outline outline-1 outline-dashed outline-[color:var(--border-strong)]',
                )}
                onDragOver={(e) => overCrumb(e, a.id)}
                onDrop={(e) => dropOnCrumb(e, a.id)}
                onClick={() => void nav().navigateTo(a.id, null)}
              >
                {a.title}
              </span>
            </span>
          ))}
          {!atRoot && ancestors.length <= CRUMB_MAX ? (
            <span className="shrink-0 whitespace-nowrap rounded-sm px-1 py-0.5 font-medium text-ink">
              › {level.find((n) => n.id === currentFolderId)?.title ?? ''}
            </span>
          ) : null}
        </div>

        <input
          type="text"
          data-testid="browse-search"
          data-no-drag
          value={query}
          placeholder={t('knowledge.tree.filterPlaceholder')}
          onChange={(e) => setQuery(e.target.value)}
          className="h-7 w-40 shrink-0 rounded-md border border-border bg-surface px-2 text-caption text-ink outline-none transition-colors placeholder:text-ink-tertiary focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
        />

        {/* 视图切换 */}
        <div
          className="flex shrink-0 items-center rounded-md border border-border bg-surface-muted/70 p-0.5"
          role="group"
          aria-label={t('knowledge.browse.viewLabel')}
          data-testid="browse-view-toggle"
        >
          <button
            type="button"
            data-testid="browse-view-grid"
            data-no-drag
            title={t('knowledge.browse.viewGrid')}
            onClick={() => setView('grid')}
            className={cn(
              'rounded-sm p-1 text-ink-secondary transition-colors hover:text-ink',
              view === 'grid' && 'bg-surface font-medium text-ink shadow-sm',
            )}
          >
            <Grid3X3 size={13} aria-hidden />
          </button>
          <button
            type="button"
            data-testid="browse-view-list"
            data-no-drag
            title={t('knowledge.browse.viewList')}
            onClick={() => setView('list')}
            className={cn(
              'rounded-sm p-1 text-ink-secondary transition-colors hover:text-ink',
              view === 'list' && 'bg-surface font-medium text-ink shadow-sm',
            )}
          >
            <List size={13} aria-hidden />
          </button>
        </div>

        {/* 新建（实底主按钮 + 下拉） */}
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            data-testid="browse-new"
            data-no-drag
            disabled={busy}
            aria-label={t('sidebar.newSpace')}
            onClick={() => {
              setMenuOpen((v) => !v)
              setJumpOpen(false)
            }}
            className={cn(
              'flex h-7 items-center gap-1 rounded-md bg-btn-primary px-2.5 text-caption font-medium text-on-btn-primary transition-colors',
              'hover:bg-btn-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
              'disabled:pointer-events-none disabled:opacity-30',
            )}
          >
            <Plus size={13} strokeWidth={2} aria-hidden />
            {t('knowledge.workspace.new')}
          </button>
          {menuOpen ? (
            <div
              className="absolute right-0 top-8 z-50 w-40 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
              role="menu"
              data-testid="browse-new-menu"
            >
              <button
                type="button"
                role="menuitem"
                data-no-drag
                onClick={() => startNew('folder')}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body text-ink transition-colors hover:bg-state-hover"
              >
                <Folder size={13} className="shrink-0 text-accent" aria-hidden />
                {t('knowledge.tree.newFolder')}
              </button>
              <button
                type="button"
                role="menuitem"
                data-no-drag
                onClick={() => startNew('doc')}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body text-ink transition-colors hover:bg-state-hover"
              >
                <FileText size={13} className="shrink-0 text-ink-tertiary" aria-hidden />
                {t('knowledge.tree.newDoc')}
              </button>
              <button
                type="button"
                role="menuitem"
                data-no-drag
                onClick={() => startNew('table')}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-body text-ink transition-colors hover:bg-state-hover"
              >
                <Table2 size={13} className="shrink-0 text-ink-tertiary" aria-hidden />
                {t('knowledge.tree.newTable')}
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {/* 内容 */}
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        data-testid="browse-content"
        onClick={clearOnBlank}
      >
        <DeclarativeContextMenu
          kind="knowledgeTree"
          payload={{
            onNewDoc: () => startNew('doc'),
            onNewTable: () => startNew('table'),
            onNewFolder: () => startNew('folder'),
          }}
          className="block min-h-full p-4"
        >
          {searchNoMatch ? (
            <p
              className="px-4 py-10 text-center text-meta text-ink-tertiary"
              role="status"
              data-testid="browse-empty-search"
            >
              {t('sidebar.emptySearch')}
            </p>
          ) : noChildren ? (
            <div
              className="flex flex-col items-center gap-1.5 px-4 py-20 text-center"
              role="status"
              data-testid="browse-empty-folder"
            >
              <p className="text-display font-semibold text-ink">
                {t('knowledge.browse.emptyTitle')}
              </p>
              <p className="text-meta text-ink-tertiary">
                {t('knowledge.browse.emptyDesc')}
              </p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  data-no-drag
                  onClick={() => startNew('doc')}
                  className="flex items-center gap-1.5 rounded-md bg-btn-primary px-3.5 py-1.5 text-body font-medium text-on-btn-primary transition-colors hover:bg-btn-primary-hover"
                >
                  <Plus size={14} strokeWidth={2} aria-hidden />
                  {t('knowledge.tree.newDoc')}
                </button>
                <button
                  type="button"
                  data-no-drag
                  onClick={() => startNew('table')}
                  className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3.5 py-1.5 text-body font-medium text-ink transition-colors hover:bg-state-hover"
                >
                  <Table2 size={14} strokeWidth={2} aria-hidden />
                  {t('knowledge.tree.newTable')}
                </button>
              </div>
            </div>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
              {level.map((node) => {
                const editing = editingId === node.id
                return (
                  <DeclarativeContextMenu
                    key={node.id}
                    kind="knowledgeNode"
                    payload={rowMenuPayload(node)}
                    className="block"
                  >
                  <div
                    data-testid={`browse-tile-${node.id}`}
                    data-node-kind={node.kind}
                    draggable={editingId !== node.id}
                    onDragStart={(e) => startDrag(e, node)}
                    onDragEnd={endDrag}
                    onDragOver={(e) => overRow(e, node)}
                    onDragLeave={(e) => leaveRow(e, node)}
                    onDrop={(e) => dropOnRow(e, node)}
                    onClick={(e) => openRow(e, node)}
                    className={cn(
                      'group relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-transparent p-3 text-center transition-colors',
                      'hover:border-border hover:bg-surface-muted/60',
                      activeDocId === node.id && 'border-border bg-surface-muted/60',
                      selectedIds.includes(node.id) &&
                        'border-border bg-state-hover outline outline-1 outline-dashed outline-[color:var(--border-strong)]',
                      dragId === node.id && 'opacity-40',
                      dropHint?.id === node.id &&
                        dropHint.pos === 'into' &&
                        'border-[var(--border-strong)] bg-state-hover outline outline-1 outline-dashed outline-[color:var(--border-strong)]',
                    )}
                  >
                      {node.kind !== 'folder' && selectedIds.length > 0 ? (
                        <span
                          className={cn(
                            'absolute left-2 top-2 flex h-4 w-4 items-center justify-center rounded-[4px] border text-[10px] text-on-btn-primary',
                            selectedIds.includes(node.id)
                              ? 'border-[var(--border-strong)] bg-btn-primary'
                              : 'border-[var(--border-strong)] bg-surface',
                          )}
                          data-testid={`browse-check-${node.id}`}
                        >
                          {selectedIds.includes(node.id) ? '✓' : ''}
                        </span>
                      ) : null}
                      <div className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-surface-muted">
                        {node.kind === 'folder' ? (
                          <Folder size={20} className="text-accent" strokeWidth={1.6} aria-hidden />
                        ) : node.kind === 'table' ? (
                          <Table2 size={20} className="text-ink-tertiary" strokeWidth={1.6} aria-hidden />
                        ) : (
                          <FileText size={20} className="text-ink-tertiary" strokeWidth={1.6} aria-hidden />
                        )}
                        <span className="absolute -right-1 -top-1 flex opacity-0 transition-opacity group-hover:opacity-100">
                          <NodeRowMenu
                            nodeId={node.id}
                            payload={rowMenuPayload(node)}
                            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink"
                          />
                        </span>
                      </div>
                      {editing ? (
                        <input
                          autoFocus
                          data-testid={`browse-rename-${node.id}`}
                          data-no-drag
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation()
                              confirmRename(node)
                            } else if (e.key === 'Escape') {
                              e.stopPropagation()
                              setEditingId(null)
                            }
                          }}
                          onBlur={() => confirmRename(node)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full rounded-sm border border-accent/50 bg-surface px-1 py-0.5 text-center text-caption text-ink outline-none"
                        />
                      ) : (
                        <span className="line-clamp-2 w-full text-caption leading-snug text-ink">
                          {node.title}
                        </span>
                      )}
                      <span className="text-meta text-ink-tertiary">
                        {node.kind === 'folder'
                          ? t('knowledge.browse.folderKind')
                          : formatUpdated(node.updatedAt)}
                      </span>
                      {dropHint?.id === node.id && dropHint.pos !== 'into' ? (
                        <span
                          className={cn(
                            'pointer-events-none absolute inset-x-1.5 h-0.5 rounded-full bg-[var(--border-strong)]',
                            dropHint.pos === 'before' ? 'top-0' : 'bottom-0',
                          )}
                          data-testid={`browse-drop-line-${node.id}`}
                        />
                      ) : null}
                    </div>
                  </DeclarativeContextMenu>
                )
              })}
            </div>
          ) : (
            <div className="flex flex-col gap-0.5">
              {level.map((node) => {
                const editing = editingId === node.id
                return (
                  <DeclarativeContextMenu
                    key={node.id}
                    kind="knowledgeNode"
                    payload={rowMenuPayload(node)}
                    className="block"
                  >
                    <div
                      data-testid={`browse-row-${node.id}`}
                      data-node-kind={node.kind}
                      draggable={editingId !== node.id}
                      onDragStart={(e) => startDrag(e, node)}
                      onDragEnd={endDrag}
                      onDragOver={(e) => overRow(e, node)}
                      onDragLeave={(e) => leaveRow(e, node)}
                      onDrop={(e) => dropOnRow(e, node)}
                      onClick={(e) => openRow(e, node)}
                      className={cn(
                        'group relative flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2 transition-colors',
                        activeDocId === node.id ? 'bg-state-hover' : 'hover:bg-state-hover',
                        selectedIds.includes(node.id) &&
                          'bg-state-hover outline outline-1 outline-dashed outline-[color:var(--border-strong)]',
                        dragId === node.id && 'opacity-40',
                        dropHint?.id === node.id &&
                          dropHint.pos === 'into' &&
                          'bg-state-hover outline outline-1 outline-dashed outline-[color:var(--border-strong)]',
                      )}
                    >
                      {node.kind !== 'folder' && selectedIds.length > 0 ? (
                        <span
                          className={cn(
                            'flex h-4 w-4 flex-none items-center justify-center rounded-[4px] border text-[10px] text-on-btn-primary',
                            selectedIds.includes(node.id)
                              ? 'border-[var(--border-strong)] bg-btn-primary'
                              : 'border-[var(--border-strong)] bg-surface',
                          )}
                          data-testid={`browse-check-${node.id}`}
                        >
                          {selectedIds.includes(node.id) ? '✓' : ''}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          'flex h-6 w-6 flex-none items-center justify-center rounded-md',
                          node.kind === 'folder'
                            ? 'bg-accent-subtle text-accent'
                            : 'bg-surface-muted text-ink-tertiary',
                        )}
                      >
                        {node.kind === 'folder' ? (
                          <Folder size={14} aria-hidden />
                        ) : node.kind === 'table' ? (
                          <Table2 size={14} aria-hidden />
                        ) : (
                          <FileText size={14} aria-hidden />
                        )}
                      </span>
                      {editing ? (
                        <input
                          autoFocus
                          data-testid={`browse-rename-${node.id}`}
                          data-no-drag
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.stopPropagation()
                              confirmRename(node)
                            } else if (e.key === 'Escape') {
                              e.stopPropagation()
                              setEditingId(null)
                            }
                          }}
                          onBlur={() => confirmRename(node)}
                          onClick={(e) => e.stopPropagation()}
                          className="min-w-0 flex-1 rounded-sm border border-accent/50 bg-surface px-1 py-0.5 text-caption text-ink outline-none"
                        />
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-body text-ink">
                          {node.title}
                        </span>
                      )}
                      <span className="flex-none text-meta text-ink-tertiary">
                        {node.kind === 'folder'
                          ? t('knowledge.browse.folderKind')
                          : formatUpdated(node.updatedAt)}
                      </span>
                      <span className="flex-none opacity-0 transition-opacity group-hover:opacity-100">
                        <NodeRowMenu
                          nodeId={node.id}
                          payload={rowMenuPayload(node)}
                          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink"
                        />
                      </span>
                      {dropHint?.id === node.id && dropHint.pos !== 'into' ? (
                        <span
                          className={cn(
                            'pointer-events-none absolute inset-x-1.5 h-0.5 rounded-full bg-[var(--border-strong)]',
                            dropHint.pos === 'before' ? 'top-0' : 'bottom-0',
                          )}
                          data-testid={`browse-drop-line-${node.id}`}
                        />
                      ) : null}
                    </div>
                  </DeclarativeContextMenu>
                )
              })}
            </div>
          )}

          {/* 内联新建行 */}
          {newKind ? (
            <div
              className="mt-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-surface px-3 py-2"
              data-testid="browse-inline-new"
            >
              {newKind === 'folder' ? (
                <Folder size={14} className="shrink-0 text-accent" aria-hidden />
              ) : newKind === 'table' ? (
                <Table2 size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
              ) : (
                <FileText size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
              )}
              <input
                autoFocus
                data-no-drag
                value={newTitle}
                placeholder={
                  newKind === 'folder'
                    ? t('knowledge.tree.newFolder')
                    : newKind === 'table'
                      ? t('knowledge.table.untitled')
                      : t('knowledge.doc.untitled')
                }
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation()
                    confirmNew()
                  } else if (e.key === 'Escape') {
                    e.stopPropagation()
                    cancelNewRef.current = true
                    setNewKind(null)
                  }
                }}
                onBlur={() => {
                  // 鼠标点击他处即提交（与列重命名/Excel 一致）；Esc 取消后忽略随后的 blur。
                  if (cancelNewRef.current) {
                    cancelNewRef.current = false
                    return
                  }
                  confirmNew()
                }}
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 rounded-sm border border-accent/50 bg-surface px-1.5 py-0.5 text-body text-ink outline-none"
              />
            </div>
          ) : null}
        </DeclarativeContextMenu>
      </div>

      {/* X4 底部浮动批量条 */}
      {selectedIds.length > 0 ? (
        <div
          className="absolute inset-x-0 bottom-4 z-30 mx-auto flex w-fit items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-body shadow-overlay"
          data-testid="kb-browse-multiselect-bar"
        >
          <span
            className="mr-1 font-medium text-ink"
            data-testid="kb-browse-multiselect-count"
          >
            {t('knowledge.browse.multiSelectCount', { count: selectedIds.length })}
          </span>
          <button
            type="button"
            className="rounded-full px-2.5 py-1 text-ink-secondary transition-colors hover:bg-state-hover hover:text-ink"
            data-testid="kb-browse-multiselect-move"
            onClick={() => {
              setMoveTarget(null)
              setMoveOpen(true)
            }}
          >
            {t('knowledge.browse.multiSelectMove')}
          </button>
          <button
            type="button"
            className="rounded-full px-2.5 py-1 text-danger transition-colors hover:bg-danger/10"
            data-testid="kb-browse-multiselect-delete"
            onClick={() => setBatchDeleteOpen(true)}
          >
            {t('knowledge.browse.multiSelectDelete')}
          </button>
          <button
            type="button"
            className="rounded-full px-2 py-1 text-ink-tertiary transition-colors hover:bg-state-hover"
            data-testid="kb-browse-multiselect-clear"
            aria-label={t('common.clear')}
            onClick={clearSelection}
          >
            ✕
          </button>
        </div>
      ) : null}

      {/* X4 批量删除确认 */}
      <Modal
        open={batchDeleteOpen}
        onOpenChange={setBatchDeleteOpen}
        variant="confirm"
        title={t('knowledge.browse.multiSelectDeleteTitle', {
          count: selectedIds.length,
        })}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="kb-browse-delete-cancel"
              onClick={() => setBatchDeleteOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              data-testid="kb-browse-delete-confirm"
              onClick={confirmBatchDelete}
            >
              {t('knowledge.browse.multiSelectDelete')}
            </Button>
          </div>
        }
      >
        <div className="px-5 py-4">
          <p className="text-body leading-relaxed text-ink-secondary">
            {t('knowledge.browse.multiSelectDeleteBody', {
              count: selectedIds.length,
            })}
          </p>
        </div>
      </Modal>

      {/* X4 批量移动（目录选择） */}
      <Modal
        open={moveOpen}
        onOpenChange={setMoveOpen}
        variant="confirm"
        title={t('knowledge.browse.moveTitle')}
        className="max-w-sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              data-testid="kb-browse-move-cancel"
              onClick={() => setMoveOpen(false)}
            >
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              data-testid="kb-browse-move-confirm"
              onClick={confirmBatchMove}
            >
              {t('knowledge.browse.moveConfirm')}
            </Button>
          </div>
        }
      >
        <div className="flex max-h-72 flex-col overflow-y-auto px-5 py-4" role="listbox">
          <button
            type="button"
            role="option"
            aria-selected={moveTarget === null}
            data-testid="kb-browse-move-root"
            onClick={() => setMoveTarget(null)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body text-ink transition-colors hover:bg-state-hover',
              moveTarget === null && 'bg-state-hover',
            )}
          >
            <Folder size={13} className="shrink-0 text-accent" aria-hidden />
            {t('knowledge.home.mySpaces')}
          </button>
          {folders.map((f) => (
            <button
              key={f.id}
              type="button"
              role="option"
              aria-selected={moveTarget === f.id}
              data-testid={`kb-browse-move-folder-${f.id}`}
              onClick={() => setMoveTarget(f.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-body text-ink transition-colors hover:bg-state-hover',
                moveTarget === f.id && 'bg-state-hover',
              )}
              style={{ paddingLeft: 8 + f.depth * 14 }}
            >
              <Folder size={13} className="shrink-0 text-accent" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{f.title}</span>
            </button>
          ))}
        </div>
      </Modal>
    </div>
  )
}
