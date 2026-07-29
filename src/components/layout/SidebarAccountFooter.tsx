import { useTranslation } from 'react-i18next'
import { History, Settings, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SIDEBAR_ACTIVE_RAIL } from './sidebarActiveRail'
import { formatTrashBadge, trashBadgeTotal, useTrashBadgeStore } from '@/store/trashBadgeStore'

interface SidebarAccountFooterProps {
  onOpenTrash: () => void
  onOpenHistory: () => void
  onOpenSettings: () => void
  /** Which footer destination is currently active. */
  active?: 'trash' | 'history' | 'settings' | null
  /** Active session catalog size (history badge; excludes nested worktrees when provided). */
  historyCount?: number
}

/**
 * Sidebar footer: Recycle Bin + History + Settings (icon + label).
 * Order: trash → history → settings.
 */
export function SidebarAccountFooter({
  onOpenTrash,
  onOpenHistory,
  onOpenSettings,
  active = null,
  historyCount = 0,
}: SidebarAccountFooterProps) {
  const { t } = useTranslation()
  const sessionCount = useTrashBadgeStore((s) => s.sessionCount)
  const knowledgeCount = useTrashBadgeStore((s) => s.knowledgeCount)
  const workItemCount = useTrashBadgeStore((s) => s.workItemCount)
  const automationCount = useTrashBadgeStore((s) => s.automationCount)
  const badge = formatTrashBadge(
    trashBadgeTotal(sessionCount, knowledgeCount, workItemCount, automationCount),
  )
  const historyBadge = formatTrashBadge(historyCount)

  return (
    <div
      className="relative flex shrink-0 flex-col gap-0.5 px-1.5 pb-2 pt-1"
      data-testid="sidebar-account-footer"
    >
      <FooterNavButton
        testId="account-trash-button"
        active={active === 'trash'}
        label={t('nav.trash')}
        icon={Trash2}
        onClick={onOpenTrash}
        badge={badge}
        badgeTestId="account-trash-badge"
      />
      <FooterNavButton
        testId="account-history-button"
        active={active === 'history'}
        label={t('nav.history')}
        icon={History}
        onClick={onOpenHistory}
        badge={historyBadge}
        badgeTestId="account-history-badge"
      />
      <FooterNavButton
        testId="account-settings-button"
        active={active === 'settings'}
        label={t('nav.settings')}
        icon={Settings}
        onClick={onOpenSettings}
      />
    </div>
  )
}

function FooterNavButton({
  testId,
  active,
  label,
  icon: Icon,
  onClick,
  badge,
  badgeTestId,
}: {
  testId: string
  active: boolean
  label: string
  icon: typeof Settings
  onClick: () => void
  badge?: string
  badgeTestId?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-no-drag
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-[var(--row-h-sidebar)] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-body font-medium transition-[background-color,color] duration-chrome ease-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
        active ? SIDEBAR_ACTIVE_RAIL : 'text-ink-secondary hover:bg-state-hover hover:text-ink',
      )}
    >
      <Icon
        size={16}
        strokeWidth={1.75}
        className={cn('shrink-0', active ? 'text-ink' : 'opacity-70')}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span
          className="shrink-0 rounded-full bg-surface-muted px-1.5 py-0.5 text-caption font-medium tabular-nums text-ink-tertiary"
          data-testid={badgeTestId ?? `${testId}-badge`}
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
}
