import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListTree } from 'lucide-react'
import {
  extractDocOutline,
  type DocOutlineItem,
} from '@/domain/knowledge/mdPreview'
import { cn } from '@/lib/utils'

export interface DocOutlineProps {
  /** Markdown body used to derive headings (prefer draft while editing). */
  content: string
  /** Jump to a heading — parent decides Source / Live / Preview strategy. */
  onSelect: (item: DocOutlineItem) => void
  /** Active heading id (scrollspy). */
  activeId?: string | null
  className?: string
}

/** 行高（28px 按钮 + 2px mb）——虚拟滚动按固定行高计算窗口。 */
const ROW_H = 30
/** 虚拟化阈值：超过该标题数启用窗口渲染（V2-P1 T6.1）。 */
const VIRTUALIZE_AT = 200
/** 视口上下 overscan 行数。 */
const OVERSCAN = 12

/**
 * Right-rail table of contents from ATX markdown headings.
 * Indentation reflects heading level; click jumps via parent handler.
 * 大文档（>200 标题）启用固定行高虚拟滚动，避免一次性渲染全部按钮。
 */
export function DocOutline({
  content,
  onSelect,
  activeId = null,
  className,
}: DocOutlineProps) {
  const { t } = useTranslation()
  const items = useMemo(() => extractDocOutline(content), [content])
  const activeRef = useRef<HTMLButtonElement | null>(null)
  const viewportRef = useRef<HTMLOListElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportH, setViewportH] = useState(0)

  const virtual = items.length > VIRTUALIZE_AT

  // 虚拟滚动视口尺寸跟踪。
  useEffect(() => {
    if (!virtual) return
    const el = viewportRef.current
    if (!el) return
    const update = () => setViewportH(el.clientHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [virtual])

  const onScroll = () => {
    const el = viewportRef.current
    if (el) setScrollTop(el.scrollTop)
  }

  // 自动滚动到当前激活项（scrollspy）。
  useEffect(() => {
    if (!activeId) return
    if (virtual) {
      const idx = items.findIndex((i) => i.id === activeId)
      if (idx >= 0) {
        const el = viewportRef.current
        if (el) {
          const target = idx * ROW_H
          if (target < el.scrollTop || target > el.scrollTop + el.clientHeight - ROW_H) {
            el.scrollTop = Math.max(0, target - ROW_H)
          }
        }
      }
      return
    }
    activeRef.current?.scrollIntoView({ block: 'nearest' })
  }, [activeId, virtual, items])

  if (items.length === 0) {
    return (
      <div
        className={cn(
          'flex flex-col items-center justify-center gap-2 px-2 py-6 text-center',
          className,
        )}
        data-testid="knowledge-doc-outline-empty"
        role="status"
      >
        <ListTree size={18} className="text-ink-tertiary" aria-hidden />
        <p className="text-meta text-ink-tertiary">{t('knowledge.outline.empty')}</p>
      </div>
    )
  }

  // 虚拟窗口：[start, end) 的 items 切片 + 顶部/底部 spacer。
  let start = 0
  let end = items.length
  let padTop = 0
  let padBottom = 0
  if (virtual) {
    start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
    end = Math.min(items.length, Math.ceil((scrollTop + viewportH) / ROW_H) + OVERSCAN)
    padTop = start * ROW_H
    padBottom = (items.length - end) * ROW_H
  }
  const visible = virtual ? items.slice(start, end) : items

  const renderItem = (item: DocOutlineItem) => {
    const label = item.text.trim() || t('knowledge.outline.untitled')
    const pad = Math.min(item.level - 1, 4)
    const isActive = activeId != null && item.id === activeId
    return (
      <li
        key={`${item.line}-${item.id}`}
        className="m-0 p-0"
        style={virtual ? { height: ROW_H } : undefined}
      >
        <button
          type="button"
          data-testid={`knowledge-doc-outline-item-${item.id}`}
          data-outline-level={item.level}
          data-outline-line={item.line}
          data-outline-active={isActive ? 'true' : undefined}
          aria-current={isActive ? 'location' : undefined}
          title={label}
          ref={isActive ? activeRef : undefined}
          onClick={() => onSelect(item)}
          className={cn(
            'mb-0.5 flex min-h-[28px] w-full items-center rounded-md py-1 pr-2 text-left transition-colors',
            'hover:bg-state-hover',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
            isActive
              ? 'bg-accent/10 font-medium text-ink'
              : item.level === 1
                ? 'text-meta font-medium text-ink'
                : 'text-meta text-ink-secondary',
          )}
          style={{ paddingLeft: `${8 + pad * 10}px` }}
        >
          {isActive ? (
            <span
              className="mr-1.5 h-3 w-0.5 shrink-0 rounded-full bg-accent"
              aria-hidden
            />
          ) : null}
          <span className="min-w-0 flex-1 truncate leading-snug">{label}</span>
        </button>
      </li>
    )
  }

  return (
    <nav
      className={cn('flex min-h-0 flex-col', className)}
      data-testid="knowledge-doc-outline"
      data-virtual={virtual ? 'true' : undefined}
      aria-label={t('knowledge.outline.title')}
    >
      <ol
        ref={viewportRef}
        className="m-0 min-h-0 flex-1 list-none overflow-y-auto px-0.5 pb-1"
        onScroll={virtual ? onScroll : undefined}
      >
        {padTop > 0 ? <li aria-hidden style={{ height: padTop }} /> : null}
        {visible.map(renderItem)}
        {padBottom > 0 ? <li aria-hidden style={{ height: padBottom }} /> : null}
      </ol>
    </nav>
  )
}
