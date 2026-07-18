import { useTranslation } from 'react-i18next'
import { History, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'
import { SIDEBAR_ACTIVE_RAIL } from './sidebarActiveRail'

interface SidebarAccountFooterProps {
  onOpenHistory: () => void
  onOpenSettings: () => void
  /** Which footer destination is currently active. */
  active?: 'history' | 'settings' | null
}

/**
 * Sidebar footer: History + Settings single-row entries (icon + label).
 */
export function SidebarAccountFooter({
  onOpenHistory,
  onOpenSettings,
  active = null,
}: SidebarAccountFooterProps) {
  const { t } = useTranslation()

  return (
    <div
      className="relative flex shrink-0 flex-col gap-0.5 px-1.5 pb-2 pt-1"
      data-testid="sidebar-account-footer"
    >
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
}: {
  testId: string
  active: boolean
  label: string
  icon: typeof Settings
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      data-no-drag
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-[34px] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-body font-medium transition-colors',
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
    </button>
  )
}
