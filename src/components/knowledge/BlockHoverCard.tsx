/**
 * 块引用 / wiki 链接悬停预览卡（V2-E1 T4.6 / V2-L1 T5.5 共用）。
 * 内容：目标标题 + 块内容摘要 + 来源路径 + 入链数；位置跟随鼠标，防右缘溢出。
 */
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Link2 } from 'lucide-react'

function clampViewport(x: number, y: number, w: number, h: number) {
  const pad = 8
  const left = Math.min(x + 12, window.innerWidth - w - pad)
  const top = Math.min(y + 12, window.innerHeight - h - pad)
  return {
    left: Math.max(pad, left),
    top: Math.max(pad, top),
  }
}

export function BlockHoverCard({
  spaceId,
  nodeId,
  title,
  fragment,
  anchor,
  onClose,
}: {
  spaceId: string
  nodeId: string
  title: string
  fragment: string | null
  anchor: { x: number; y: number }
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<string>('')
  const [inlinkCount, setInlinkCount] = useState<number | null>(null)
  const [path, setPath] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    void import('@/ipc/knowledge')
      .then(async ({ knowledgeReadDoc, knowledgeLinkIndexBacklinks }) => {
        const [md, backlinks] = await Promise.all([
          knowledgeReadDoc(spaceId, nodeId).catch(() => null),
          knowledgeLinkIndexBacklinks(spaceId, nodeId).catch(() => []),
        ])
        if (cancelled) return
        if (Array.isArray(backlinks)) setInlinkCount(backlinks.length)
        if (md == null) return
        // Strip frontmatter.
        const body = md.replace(/^---[\s\S]*?---\n?/, '')
        // 块级摘要：fragment 命中（块 id / 标题 / 文本）优先，否则文档开头。
        let snippet = ''
        if (fragment) {
          const lines = body.split('\n')
          const hit = lines.findIndex(
            (l) => l.includes(fragment) || l.replace(/^#+\s*/, '').trim() === fragment,
          )
          if (hit >= 0) {
            snippet = lines
              .slice(hit, Math.min(lines.length, hit + 3))
              .join('\n')
              .slice(0, 240)
          }
        }
        if (!snippet) {
          snippet = body
            .split('\n')
            .filter((l) => l.trim())
            .slice(0, 4)
            .join('\n')
            .slice(0, 240)
        }
        setSnapshot(snippet)
        const fm = md.match(/^---\n([\s\S]*?)\n---/)
        if (fm) {
          const m = fm[1]?.match(/^path:\s*(.+)$/m)
          if (m) setPath(m[1]!.trim())
        }
      })
      .catch(() => {
        if (!cancelled) setSnapshot('')
      })
    return () => {
      cancelled = true
    }
  }, [spaceId, nodeId, fragment])

  const pos = useMemo(() => clampViewport(anchor.x, anchor.y, 280, 140), [anchor])

  return (
    <div
      className="fixed z-[120] w-[280px] overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
      style={{ left: pos.left, top: pos.top }}
      data-testid="kb-block-hover-card"
      onMouseEnter={() => {
        // Entering the card keeps it alive (grace for move-to-card).
        void onClose
      }}
      onMouseLeave={onClose}
      role="tooltip"
    >
      <div className="flex items-center gap-1.5 border-b border-border px-2.5 py-1.5">
        <FileText size={12} className="shrink-0 text-ink-tertiary" aria-hidden />
        <span className="min-w-0 flex-1 truncate text-body font-medium text-ink">
          {title}
        </span>
        {inlinkCount != null ? (
          <span className="flex shrink-0 items-center gap-0.5 text-caption text-ink-tertiary">
            <Link2 size={10} aria-hidden />
            {inlinkCount}
          </span>
        ) : null}
      </div>
      <div className="max-h-[120px] overflow-hidden px-2.5 py-1.5">
        <p className="whitespace-pre-wrap break-words text-caption text-ink-secondary">
          {snapshot || t('knowledge.blockRef.noPreview')}
        </p>
      </div>
      {path ? (
        <div className="border-t border-border px-2.5 py-1 text-caption text-ink-tertiary">
          {path}
        </div>
      ) : null}
    </div>
  )
}
