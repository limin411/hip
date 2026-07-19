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
}

/**
 * Sidebar footer: Recycle Bin + History + Settings (icon + label).
 * Order: trash above history (product recycle bin).
 */
export function SidebarAccountFooter({
  onOpenTrash,
  onOpenHistory,
  onOpenSettings,
  active = null,
}: SidebarAccountFooterProps) {
  const { t } = useTranslation()
  const sessionCount = useTrashBadgeStore((s) => s.sessionCount)
  const knowledgeCount = useTrashBadgeStore((s) => s.knowledgeCount)
  const badge = formatTrashBadge(trashBadgeTotal(sessionCount, knowledgeCount))

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
      />
      <FooterNavButton
        testId="account-history-button"
        active={active === 'history'}
        label={t('nav.history')}
        icon={History}
        onClick={onOpenHistory}
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
}: {
  testId: string
  active: boolean
  label: string
  icon: typeof Settings
  onClick: () => void
  badge?: string
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-no-drag
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-[var(--row-h-sidebar)] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-body font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
        active ? SIDEBAR_ACTIVE_RAIL : 'text-ink-secondary hover:bg-state-hover hover:text-ink',
      )}
    >
      <Icon
        size={16}
        className={cn('shrink-0', active ? 'text-accent-strong' : 'opacity-85')}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {badge ? (
        <span
          className="shrink-0 rounded-full bg-state-hover px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-ink-secondary"
          data-testid="account-trash-badge"
        >
          {badge}
        </span>
      ) : null}
    </button>
  )
}
