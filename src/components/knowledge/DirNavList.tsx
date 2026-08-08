/**
 * 文档管理（原知识库）— 侧边栏单层级目录导航。
 *
 * 与电脑文件管理器一致：每次只显示当前层级的文件夹与文档，
 * 点文件夹进入、↑ 返回上一层、面包屑任一段跳转。
 * 深目录（20+ 层）无递归渲染：任意深度只渲染当前 1 层。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowUp,
  FileText,
  Folder,
  Plus,
} from 'lucide-react'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { knowledgeRevealDoc } from '@/ipc/knowledge'
import { getPath, listChildren } from '@/domain/knowledge/tree'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { cn } from '@/lib/utils'
import { useKnowledgeStore } from '@/store/knowledgeStore'

/** 当前层级排序：文件夹优先，其次按名称排序。 */
function sortLevel(a: KnowledgeNode, b: KnowledgeNode): number {
  if (a.kind === 'folder' && b.kind !== 'folder') return -1
  if (a.kind !== 'folder' && b.kind === 'folder') return 1
  return a.title.localeCompare(b.title)
}

/** 迷你面包屑最多显示的祖先段数（超出折叠为 …）。 */
const CRUMB_MAX = 3

export function DirNavList() {
  const { t } = useTranslation()
  const nodes = useKnowledgeStore((s) => s.nodes)
  const currentFolderId = useKnowledgeStore((s) => s.currentFolderId)
  const activeDocId = useKnowledgeStore((s) => s.activeDocId)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)
  const busy = useKnowledgeStore((s) => s.busy)

  const [query, setQuery] = useState('')
  const [newKind, setNewKind] = useState<'folder' | 'doc' | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  /** 面包屑 … 弹出的祖先跳转菜单（复用简易弹层）。 */
  const [jumpOpen, setJumpOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭新建菜单 / 祖先跳转菜单
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
    return getPath(nodes, currentFolderId).slice(0, -1) // 不含当前目录
  }, [nodes, currentFolderId])

  const level = useMemo(() => {
    const children = listChildren(nodes, currentFolderId)
    const q = query.trim().toLowerCase()
    if (!q) return [...children].sort(sortLevel)
    return children.filter((n) => n.title.toLowerCase().includes(q)).sort(sortLevel)
  }, [nodes, currentFolderId, query])

  const atRoot = currentFolderId == null

  const enterFolder = (id: string) => {
    void useKnowledgeStore.getState().enterFolder(id)
  }
  const goUp = () => {
    void useKnowledgeStore.getState().goUp()
  }

  const startNew = (kind: 'folder' | 'doc') => {
    setMenuOpen(false)
    setNewKind(kind)
    setNewTitle('')
  }

  const confirmNew = () => {
    if (!newKind) return
    const title = newTitle.trim()
    if (newKind === 'folder') {
      void useKnowledgeStore.getState().createFolder(currentFolderId, title || t('knowledge.tree.newFolder'))
    } else {
      void useKnowledgeStore
        .getState()
        .requestCreateDoc(currentFolderId, title || t('knowledge.doc.untitled'))
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
    void useKnowledgeStore.getState().renameNode(node.id, editTitle)
    setEditingId(null)
  }

  const deleteNode = (node: KnowledgeNode) => {
    void useKnowledgeStore.getState().deleteNode(node.id)
  }

  const reveal = (node: KnowledgeNode) => {
    if (node.kind === 'doc' && activeSpaceId) {
      void knowledgeRevealDoc(activeSpaceId, node.id).catch(() => {})
    }
  }

  /** 复制标题路径（深链直达用，如：全部文档 / F1 / 文档）。 */
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

  const newIn = (node: KnowledgeNode): string | null =>
    node.kind === 'folder' ? node.id : node.parentId

  const noChildren = level.length === 0 && !newKind
  const searchNoMatch = level.length === 0 && query.trim() !== ''

  return (
    <div className="flex min-h-0 flex-col" data-testid="dir-nav-list">
      {/* 导航条：↑ 返回上一层 + 迷你面包屑 + 新建 */}
      <div className="mb-1 flex items-center gap-1 px-1">
        <button
          type="button"
          data-testid="dir-nav-up"
          data-no-drag
          disabled={atRoot}
          title={t('sidebar.list.up')}
          aria-label={t('sidebar.list.up')}
          onClick={goUp}
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ink-tertiary transition-colors',
            'hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
            'disabled:pointer-events-none disabled:opacity-30',
          )}
        >
          <ArrowUp size={14} strokeWidth={2} aria-hidden />
        </button>
        <div
          className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden text-caption"
          data-testid="dir-nav-crumbs"
          title={
            ancestors.length > CRUMB_MAX
              ? ['全部文档', ...ancestors.map((a) => a.title)].join(' › ')
              : undefined
          }
        >
          <span
            data-testid="dir-crumb-root"
            className={cn(
              'shrink-0 cursor-pointer whitespace-nowrap',
              atRoot
                ? 'font-medium text-ink'
                : 'text-ink-tertiary transition-colors hover:text-accent',
            )}
            onClick={() => void useKnowledgeStore.getState().navigateTo(null, null)}
          >
            {t('knowledge.home.mySpaces')}
          </span>
          {ancestors.length > CRUMB_MAX ? (
            <>
              <span className="shrink-0 text-ink-tertiary/60" aria-hidden>
                ›
              </span>
              <button
                type="button"
                data-testid="dir-crumb-more"
                data-no-drag
                onClick={() => {
                  setJumpOpen((v) => !v)
                  setMenuOpen(false)
                }}
                className={cn(
                  'shrink-0 rounded-sm px-0.5 text-ink-tertiary transition-colors hover:text-accent',
                  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink/20',
                )}
                title={t('sidebar.list.jump')}
              >
                …
              </button>
            </>
          ) : null}
          {ancestors.slice(-CRUMB_MAX).map((a) => (
            <span key={a.id} className="flex min-w-0 items-center gap-0.5">
              <span className="shrink-0 text-ink-tertiary/60" aria-hidden>
                ›
              </span>
              <span
                data-testid={`dir-crumb-${a.id}`}
                className="min-w-0 cursor-pointer truncate whitespace-nowrap text-ink-tertiary transition-colors hover:text-accent"
                onClick={() => void useKnowledgeStore.getState().navigateTo(a.id, null)}
              >
                {a.title}
              </span>
            </span>
          ))}
        </div>
        <div className="relative shrink-0" ref={menuRef}>
          <button
            type="button"
            data-testid="dir-nav-new"
            data-no-drag
            disabled={busy}
            title={t('sidebar.newSpace')}
            aria-label={t('sidebar.newSpace')}
            onClick={() => {
              setMenuOpen((v) => !v)
              setJumpOpen(false)
            }}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded-md text-ink-tertiary transition-colors',
              'hover:bg-state-hover hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
              'disabled:pointer-events-none disabled:opacity-30',
            )}
          >
            <Plus size={14} strokeWidth={2} aria-hidden />
          </button>
          {menuOpen ? (
            <div
              className="absolute right-0 top-7 z-50 w-40 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
              role="menu"
              data-testid="dir-nav-new-menu"
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

      {/* 祖先跳转菜单（面包屑 …） */}
      {jumpOpen ? (
        <div
          className="absolute z-50 max-h-64 w-44 overflow-y-auto rounded-lg border border-border bg-surface py-1 shadow-lg"
          style={{ left: 44 }}
          role="menu"
          data-testid="dir-crumb-jump-menu"
        >
          <button
            type="button"
            role="menuitem"
            data-no-drag
            onClick={() => {
              setJumpOpen(false)
              void useKnowledgeStore.getState().navigateTo(null, null)
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
              data-testid={`dir-jump-${a.id}`}
              onClick={() => {
                setJumpOpen(false)
                void useKnowledgeStore.getState().navigateTo(a.id, null)
              }}
              className="flex w-full items-center gap-2 px-2.5 py-1 text-left text-body text-ink transition-colors hover:bg-state-hover"
            >
              <Folder size={13} className="shrink-0 text-accent" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{a.title}</span>
            </button>
          ))}
        </div>
      ) : null}

      {/* 搜索：过滤当前层级 */}
      <div className="mb-1 px-1">
        <input
          type="text"
          data-testid="dir-nav-search"
          data-no-drag
          value={query}
          placeholder={t('knowledge.tree.filterPlaceholder')}
          onChange={(e) => setQuery(e.target.value)}
          className="h-7 w-full rounded-md border border-border bg-surface px-2 text-caption text-ink outline-none transition-colors placeholder:text-ink-tertiary focus:border-accent/50 focus:ring-1 focus:ring-accent/30"
        />
      </div>

      {/* 当前层级列表 */}
      <div
        className="relative min-h-0 flex-1 overflow-y-auto"
        data-testid="dir-nav-level"
      >
        <DeclarativeContextMenu
          kind="knowledgeTree"
          payload={{
            onNewDoc: () => startNew('doc'),
            onNewFolder: () => startNew('folder'),
          }}
          className="block min-h-full"
        >
          <ul className="m-0 list-none p-0" aria-label={t('sidebar.list.spaces')}>
            {level.map((node) => {
              const activeFolder = node.kind === 'folder' && node.id === currentFolderId
              const activeDoc = node.kind !== 'folder' && node.id === activeDocId
              const active = activeFolder || activeDoc
              const editing = editingId === node.id
              return (
                <li key={node.id} className="mb-0.5">
                  <DeclarativeContextMenu
                    kind="knowledgeNode"
                    payload={{
                      nodeId: node.id,
                      kind: node.kind,
                      spaceId: activeSpaceId ?? '',
                      onNewDoc: () => {
                        const parent = newIn(node)
                        void useKnowledgeStore
                          .getState()
                          .requestCreateDoc(parent, t('knowledge.doc.untitled'))
                      },
                      onNewFolder: () => {
                        const parent = newIn(node)
                        void useKnowledgeStore
                          .getState()
                          .createFolder(parent, t('knowledge.tree.newFolder'))
                      },
                      onRename: () => startRename(node),
                      onDelete: () => deleteNode(node),
                      onReveal: node.kind === 'doc' ? () => reveal(node) : undefined,
                      onCopyPath: () => copyPath(node),
                    }}
                    className="block w-full"
                  >
                    <button
                      type="button"
                      data-testid={`dir-row-${node.id}`}
                      data-node-kind={node.kind}
                      data-no-drag
                      aria-current={active ? 'true' : undefined}
                      onClick={() => {
                        if (node.kind === 'folder') enterFolder(node.id)
                        else void useKnowledgeStore.getState().openDoc(node.id)
                      }}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-lg px-2.5 py-[var(--row-pad-y-session)] text-left transition-colors',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                        active
                          ? 'relative bg-accent/10 font-medium text-ink before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent'
                          : 'hover:bg-state-hover',
                      )}
                    >
                      {node.kind === 'folder' ? (
                        <Folder size={14} className="shrink-0 text-accent" aria-hidden />
                      ) : (
                        <FileText size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
                      )}
                      {editing ? (
                        <input
                          autoFocus
                          data-testid={`dir-rename-${node.id}`}
                          data-no-drag
                          value={editTitle}
                          placeholder={node.title}
                          onFocus={(e) => e.target.select()}
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
                          className="min-w-0 flex-1 rounded-sm border border-accent/50 bg-surface px-1 py-0.5 text-body text-ink outline-none"
                        />
                      ) : (
                        <span className="min-w-0 flex-1 truncate text-body text-ink">
                          {node.title}
                        </span>
                      )}

                    </button>
                  </DeclarativeContextMenu>
                </li>
              )
            })}

            {/* 内联新建行 */}
            {newKind ? (
              <li className="mb-0.5">
                <div className="flex items-center gap-2 rounded-lg px-2.5 py-[var(--row-pad-y-session)]">
                  {newKind === 'folder' ? (
                    <Folder size={14} className="shrink-0 text-accent" aria-hidden />
                  ) : (
                    <FileText size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
                  )}
                  <input
                    autoFocus
                    data-testid="dir-inline-new"
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
                    className="min-w-0 flex-1 rounded-sm border border-accent/50 bg-surface px-1 py-0.5 text-body text-ink outline-none"
                  />
                </div>
              </li>
            ) : null}
          </ul>

          {/* 空态 */}
          {searchNoMatch ? (
            <p
              className="px-2 py-3 text-center text-meta text-ink-tertiary"
              role="status"
              data-testid="dir-empty-search"
            >
              {t('sidebar.emptySearch')}
            </p>
          ) : noChildren ? (
            <div
              className="flex flex-col items-center gap-1 px-2 py-4 text-center"
              role="status"
              data-testid="dir-empty-folder"
            >
              <p className="text-meta text-ink-tertiary">{t('sidebar.list.folderEmpty')}</p>
              <button
                type="button"
                data-no-drag
                onClick={() => startNew('folder')}
                className="rounded-md px-1.5 py-0.5 text-caption text-accent transition-colors hover:bg-accent/10"
              >
                {t('knowledge.tree.newFolder')}
              </button>
            </div>
          ) : null}
        </DeclarativeContextMenu>
      </div>
    </div>
  )
}
