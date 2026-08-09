import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { InlineDocTitle } from '../InlineDocTitle'
import { formatAbsolute, formatRelativeTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'

export interface PageHeaderProps {
  docId: string
  title: string
  onTitleCommit: (title: string) => void
  onTitleEnter?: () => void
  /** 文档创建/更新时间（ms）—— 渲染为标题下的小字元数据行。 */
  createdAt?: number
  updatedAt?: number
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
  createdAt,
  updatedAt,
  menu,
  className,
}: PageHeaderProps) {
  const { t, i18n } = useTranslation()
  const locale = i18n.language

  /** 元数据行：更新于 X · 创建于 Y（hover 显示绝对时间）。 */
  const meta = useMemo(() => {
    if (createdAt == null && updatedAt == null) return null
    const parts: string[] = []
    if (updatedAt != null) {
      parts.push(t('knowledge.doc.metaUpdated', { time: formatRelativeTime(updatedAt, locale) }))
    }
    if (createdAt != null) {
      parts.push(t('knowledge.doc.metaCreated', { time: formatRelativeTime(createdAt, locale) }))
    }
    return {
      text: parts.join(' · '),
      tooltip: [
        updatedAt != null ? t('knowledge.doc.metaUpdated', { time: formatAbsolute(updatedAt, locale) }) : '',
        createdAt != null ? t('knowledge.doc.metaCreated', { time: formatAbsolute(createdAt, locale) }) : '',
      ]
        .filter(Boolean)
        .join('\n'),
    }
  }, [createdAt, updatedAt, t, locale])

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
              className="!pt-0 !pb-1"
            />
            {menu ? (
              <div className="flex h-8 w-8 shrink-0 items-center justify-center opacity-0 transition-opacity duration-100 group-hover:opacity-100 focus-within:opacity-100">
                {menu}
              </div>
            ) : null}
          </div>
          {/* 元数据行：更新时间 / 创建时间（小字，hover 显示精确时间）。 */}
          {meta ? (
            <div
              className="pb-6 text-meta"
              title={meta.tooltip}
              data-testid="knowledge-doc-meta"
            >
              {meta.text}
            </div>
          ) : null}
        </div>
      </div>
    </header>
  )
}
