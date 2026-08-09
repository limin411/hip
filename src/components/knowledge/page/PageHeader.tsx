import type { ReactNode } from 'react'
import { InlineDocTitle } from '../InlineDocTitle'
import { cn } from '@/lib/utils'

export interface PageHeaderProps {
  docId: string
  title: string
  onTitleCommit: (title: string) => void
  onTitleEnter?: () => void
  /** 页面级 ⋯ 菜单（标题 hover 显示）。 */
  menu?: ReactNode
  className?: string
}

/**
 * 文档页头部：大标题（hover 显示页面 ⋯ 菜单）。
 * 路径展示由主内容区顶部 MainToolbar 承担（`目录 › 文件名`），
 * 文档内容区不再重复渲染面包屑。
 */
export function PageHeader({
  docId,
  title,
  onTitleCommit,
  onTitleEnter,
  menu,
  className,
}: PageHeaderProps) {
  return (
    <header
      className={cn('group shrink-0', className)}
      data-testid="knowledge-page-header"
    >
      <div className="knowledge-doc-inline-pad">
        <div className="knowledge-doc-measure pt-2.5 sm:pt-3">
          {/* 标题行：hover 标题区显示页面 ⋯ 菜单（组内 hover + 焦点态，位于标题右侧）。 */}
          <div className="flex items-start gap-1 pt-1">
            <InlineDocTitle
              docId={docId}
              title={title}
              onCommit={onTitleCommit}
              onEnterCommit={onTitleEnter}
              embedded
              className="!pt-0"
            />
            {menu ? (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100">
                {menu}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  )
}
