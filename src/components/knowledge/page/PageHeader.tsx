import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { InlineDocTitle } from '../InlineDocTitle'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { cn } from '@/lib/utils'

/** 面包屑最多显示的分段数（超出折叠为 …）。 */
const CRUMB_MAX = 4

export interface PageHeaderProps {
  docId: string
  title: string
  onTitleCommit: (title: string) => void
  onTitleEnter?: () => void
  /** 活动文档路径 —— 渲染为标题上方的小字面包屑（T1）。 */
  pathNodes?: KnowledgeNode[]
  /** 面包屑点击：文件夹 = 展开侧边栏目录；文档 = 打开。 */
  onCrumbClick?: (node: KnowledgeNode) => void
  /** 面包屑根「我的空间」点击（跳浏览根）。 */
  onRootClick?: () => void
  /** 页面级 ⋯ 菜单（T1：标题 hover 显示）。 */
  menu?: ReactNode
  className?: string
}

/**
 * 文档页头部（T1/T2）：小字面包屑 + 大标题（hover 显示页面 ⋯ 菜单）。
 * 无 48px 工具栏 —— 页面顶部不再承载 chrome，对齐 Notion「一张纸」。
 */
export function PageHeader({
  docId,
  title,
  onTitleCommit,
  onTitleEnter,
  pathNodes = [],
  onCrumbClick,
  onRootClick,
  menu,
  className,
}: PageHeaderProps) {
  const { t } = useTranslation()

  /** Prefer first + last crumbs when the path is deep (max 4 visible nodes). */
  const crumbItems = useMemo(() => {
    if (pathNodes.length <= CRUMB_MAX) {
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

  /** 根目录文档（pathNodes 为空或仅自身）：目录 = 我的空间。 */
  const atRootDoc = pathNodes.length <= 1

  return (
    <header
      className={cn('group shrink-0', className)}
      data-testid="knowledge-page-header"
    >
      <div className="knowledge-doc-inline-pad">
        <div className="knowledge-doc-measure pt-2.5 sm:pt-3">
          {/* 小字路径（T1）：`目录 > 文件名`，hover 项才显灰底，对齐正文列。 */}
          <div className="flex min-w-0 items-center gap-1 truncate text-meta">
            {/* 根：全部文档（点击回浏览根；样式区分当前位置） */}
            <span
              className={cn(
                'shrink-0 cursor-pointer whitespace-nowrap rounded-sm px-1 py-0.5 text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink',
                atRootDoc && 'font-medium text-ink hover:bg-transparent hover:text-ink',
              )}
              onClick={() => onRootClick?.()}
            >
              {t('knowledge.home.mySpaces')}
            </span>
            <ChevronRight size={12} className="shrink-0 text-ink-tertiary" aria-hidden />
            {pathNodes.length === 0 ? (
              /* 节点未就绪（打开瞬间/异常态）：标题兜底 */
              <span className="truncate px-1 font-medium text-ink">{title}</span>
            ) : (
              crumbItems.map((item, i) => {
                if (item.kind === 'ellipsis') {
                  return (
                    <span key="crumb-ellipsis" className="flex min-w-0 items-center gap-1">
                      <ChevronRight
                        size={12}
                        className="shrink-0 text-ink-tertiary"
                        aria-hidden
                      />
                      <span className="shrink-0 text-ink-tertiary" aria-hidden>
                        …
                      </span>
                    </span>
                  )
                }
                const n = item.node
                const isLast = item.index === pathNodes.length - 1
                return (
                  <span key={n.id} className="flex min-w-0 items-center gap-1">
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
                        className="truncate rounded-sm px-1 py-0.5 text-ink-tertiary transition-colors hover:bg-state-hover hover:text-ink"
                        onClick={() => onCrumbClick?.(n)}
                      >
                        {n.title}
                      </button>
                    ) : (
                      <span className="truncate px-1 font-medium text-ink">{n.title}</span>
                    )}
                  </span>
                )
              })
            )}
          </div>

          {/* 标题行：hover 标题区显示页面 ⋯ 菜单（组内 hover + 焦点态）。 */}
          <div className="flex items-start gap-1 pt-1">
            {menu ? (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100">
                {menu}
              </div>
            ) : null}
            <InlineDocTitle
              docId={docId}
              title={title}
              onCommit={onTitleCommit}
              onEnterCommit={onTitleEnter}
              embedded
              className="!pt-0"
            />
          </div>
        </div>
      </div>
    </header>
  )
}
