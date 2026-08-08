/**
 * 侧边栏「最近」区块（V2-N1）。
 *
 * 数据来自 `knowledgeStore.recent`（localStorage `hip-knowledge-recent` 已落盘）。
 * 点击直达（openRecent = revealPath 语义）；右键「从最近移除」。
 * 空列表隐藏整个区块；不提供置顶（v1.2 决策）。
 */
import { useTranslation } from 'react-i18next'
import { History } from 'lucide-react'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { formatRelativeTime } from '@/lib/datetime'
import { cn } from '@/lib/utils'
import { useKnowledgeStore } from '@/store/knowledgeStore'

/** 侧边栏显示条数上限（存储层 cap 为 KNOWLEDGE_RECENT_CAP=16）。 */
const SIDEBAR_RECENT_LIMIT = 8

export function KnowledgeRecentList() {
  const { t, i18n } = useTranslation()
  const recent = useKnowledgeStore((s) => s.recent)
  const activeDocId = useKnowledgeStore((s) => s.activeDocId)
  const activeSpaceId = useKnowledgeStore((s) => s.activeSpaceId)

  if (recent.length === 0) return null

  const remove = (spaceId: string, docId: string) => {
    useKnowledgeStore.getState().dropRecent(spaceId, docId)
  }

  return (
    <div
      className="mt-2 border-t border-border pt-1.5"
      data-testid="sidebar-knowledge-recent"
    >
      <div className="px-2 pb-1 text-caption font-medium text-ink-tertiary">
        {t('knowledge.recent.sidebarTitle')}
      </div>
      <ul className="m-0 list-none p-0" aria-label={t('knowledge.recent.sidebarTitle')}>
        {recent.slice(0, SIDEBAR_RECENT_LIMIT).map((r) => {
          const active = activeDocId === r.docId && activeSpaceId === r.spaceId
          return (
            <li key={`${r.spaceId}-${r.docId}`} className="mb-0.5">
              <DeclarativeContextMenu
                kind="knowledgeRecent"
                payload={{
                  spaceId: r.spaceId,
                  docId: r.docId,
                  onRemove: () => remove(r.spaceId, r.docId),
                }}
                className="block w-full"
              >
                <button
                  type="button"
                  data-testid={`sidebar-recent-${r.docId}`}
                  data-no-drag
                  aria-current={active ? 'true' : undefined}
                  title={r.title}
                  onClick={() => void useKnowledgeStore.getState().openRecent(r)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-2.5 py-[var(--row-pad-y-session)] text-left transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                    active
                      ? 'relative bg-accent/10 font-medium text-ink before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-full before:bg-accent'
                      : 'hover:bg-state-hover',
                  )}
                >
                  <History size={13} className="shrink-0 text-ink-tertiary" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-body text-ink">
                    {r.title}
                  </span>
                  <span className="shrink-0 text-caption text-ink-tertiary">
                    {r.at > 0 ? formatRelativeTime(r.at, i18n.language) : ''}
                  </span>
                </button>
              </DeclarativeContextMenu>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
