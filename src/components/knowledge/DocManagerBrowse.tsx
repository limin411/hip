/**
 * 文档管理 — 主区浏览模式（v3）。
 *
 * doc-notion-polish/PR-5：默认紧凑列表（Notion 页面列表心智）——40px 行 =
 * 类型图标 + 标题 + 上次编辑 + hover 行尾 ⋯（与右键菜单共用同一 provider）；
 * 网格保留可切换（tile 缩为 40px 图标）；工具栏瘦身（↑ 返回移除，面包屑承担；
 * 新建改为实底主按钮）；空态大标题。
 * 与侧边栏 DirNavList 共用同一导航状态（knowledgeStore.currentFolderId）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { FileText, Folder, Grid3X3, List, MoreHorizontal, Plus } from 'lucide-react'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { buildContextMenuItems } from '@/components/context-menu/registry'
import { createContextMenuBuildContext } from '@/components/context-menu/buildContext'
import type { ContextMenuItemDef, ContextRequest } from '@/components/context-menu/types'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu'
import { knowledgeRevealDoc } from '@/ipc/knowledge'
import { getPath, listChildren } from '@/domain/knowledge/tree'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { cn } from '@/lib/utils'
import { useKnowledgeStore } from '@/store/knowledgeStore'

function sortLevel(a: KnowledgeNode, b: KnowledgeNode): number {
  if (a.kind === 'folder' && b.kind !== 'folder') return -1
  if (a.kind !== 'folder' && b.kind === 'folder') return 1
  return a.title.localeCompare(b.title)
}

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

/** 行尾 ⋯ 菜单：与右键菜单共用 knowledgeNode provider（单一数据源）。 */
function NodeRowMenu({
  node,
  payload,
}: {
  node: KnowledgeNode
  payload: {
    nodeId: string
    kind: KnowledgeNode['kind']
    spaceId: string
    onNewDoc: () => void
    onNewFolder: () => void
    onRename: () => void
    onDelete: () => void
    onReveal?: () => void
    onCopyPath: () => void
  }
}) {
  const { t } = useTranslation()
  const [items, setItems] = useState<ContextMenuItemDef[]>([])
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu
      modal={false}
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          const ctx = createContextMenuBuildContext(t, {})
          setItems(
            buildContextMenuItems(
              { kind: 'knowledgeNode', payload } as ContextRequest,
              ctx,
            ),
          )
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          data-testid={`browse-row-menu-${node.id}`}
          aria-label={t('knowledge.tree.rename')}
          onClick={(e) => e.stopPropagation()}
          className="flex h-6 w-6 items-center justify-center rounded-md text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink"
        >
          <MoreHorizontal size={14} aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {items.map((item, i) => (
          <div key={item.id}>
            {i > 0 && items[i - 1].group !== item.group ? (
              <DropdownMenuSeparator />
            ) : null}
            <DropdownMenuItem
              className={item.danger ? 'text-danger' : undefined}
              onSelect={() => item.run()}
            >
              {item.label}
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
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
  const [newKind, setNewKind] = useState<'folder' | 'doc' | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [jumpOpen, setJumpOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const menuRef = useRef<HTMLDivElement>(null)

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
    const children = listChildren(nodes, currentFolderId)
    const q = query.trim().toLowerCase()
    if (!q) return [...children].sort(sortLevel)
    return children.filter((n) => n.title.toLowerCase().includes(q)).sort(sortLevel)
  }, [nodes, currentFolderId, query])

  const atRoot = currentFolderId == null
  const noChildren = level.length === 0 && !newKind
  const searchNoMatch = level.length === 0 && query.trim() !== ''

  const nav = () => useKnowledgeStore.getState()
  const startNew = (kind: 'folder' | 'doc') => {
    setMenuOpen(false)
    setNewKind(kind)
    setNewTitle('')
  }
  const confirmNew = () => {
    if (!newKind) return
    const title = newTitle.trim()
    if (newKind === 'folder') {
      void nav().createFolder(currentFolderId, title || t('knowledge.tree.newFolder'))
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
  const newIn = (node: KnowledgeNode): string | null =>
    node.kind === 'folder' ? node.id : node.parentId

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
    onNewDoc: () => {
      void nav().requestCreateDoc(newIn(node), t('knowledge.doc.untitled'))
    },
    onNewFolder: () => {
      void nav().createFolder(newIn(node), t('knowledge.tree.newFolder'))
    },
    onRename: () => startRename(node),
    onDelete: () => deleteNode(node),
    onReveal: node.kind === 'doc' ? () => reveal(node) : undefined,
    onCopyPath: () => copyPath(node),
  })

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-content"
      data-testid="doc-manager-browse"
    >
      {/* 工具栏（PR-5 瘦身：面包屑小字 + 搜索 + 视图切换 + 新建主按钮） */}
      <div
        className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-4"
        data-testid="browse-toolbar"
      >
        {/* 面包屑（>3 段折叠 …，可跳任意祖先） */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden text-meta">
          <span
            data-testid="browse-crumb-root"
            className={cn(
              'shrink-0 cursor-pointer whitespace-nowrap rounded-sm px-1 py-0.5',
              atRoot
                ? 'font-medium text-ink'
                : 'text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink',
            )}
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
                className="min-w-0 cursor-pointer truncate whitespace-nowrap rounded-sm px-1 py-0.5 text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink"
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
            </div>
          ) : null}
        </div>
      </div>

      {/* 内容 */}
      <div className="min-h-0 flex-1 overflow-y-auto" data-testid="browse-content">
        <DeclarativeContextMenu
          kind="knowledgeTree"
          payload={{
            onNewDoc: () => startNew('doc'),
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
              <button
                type="button"
                data-no-drag
                onClick={() => startNew('doc')}
                className="mt-2 flex items-center gap-1.5 rounded-md bg-btn-primary px-3.5 py-1.5 text-body font-medium text-on-btn-primary transition-colors hover:bg-btn-primary-hover"
              >
                <Plus size={14} strokeWidth={2} aria-hidden />
                {t('knowledge.tree.newDoc')}
              </button>
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
                      onClick={() => {
                        if (node.kind === 'folder') void nav().enterFolder(node.id)
                        else void nav().openDoc(node.id)
                      }}
                      className={cn(
                        'group flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-transparent p-3 text-center transition-colors',
                        'hover:border-border hover:bg-surface-muted/60',
                        activeDocId === node.id && 'border-border bg-surface-muted/60',
                      )}
                    >
                      <div className="relative flex h-10 w-10 items-center justify-center rounded-lg bg-surface-muted">
                        {node.kind === 'folder' ? (
                          <Folder size={20} className="text-accent" strokeWidth={1.6} aria-hidden />
                        ) : (
                          <FileText size={20} className="text-ink-tertiary" strokeWidth={1.6} aria-hidden />
                        )}
                        <span className="absolute -right-1 -top-1 flex opacity-0 transition-opacity group-hover:opacity-100">
                          <NodeRowMenu node={node} payload={rowMenuPayload(node)} />
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
                      onClick={() => {
                        if (node.kind === 'folder') void nav().enterFolder(node.id)
                        else void nav().openDoc(node.id)
                      }}
                      className={cn(
                        'group flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2 transition-colors',
                        activeDocId === node.id ? 'bg-state-hover' : 'hover:bg-state-hover',
                      )}
                    >
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
                        <NodeRowMenu node={node} payload={rowMenuPayload(node)} />
                      </span>
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
                    : t('knowledge.doc.untitled')
                }
                onChange={(e) => setNewTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.stopPropagation()
                    confirmNew()
                  } else if (e.key === 'Escape') {
                    e.stopPropagation()
                    setNewKind(null)
                  }
                }}
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 rounded-sm border border-accent/50 bg-surface px-1.5 py-0.5 text-body text-ink outline-none"
              />
            </div>
          ) : null}
        </DeclarativeContextMenu>
      </div>
    </div>
  )
}
