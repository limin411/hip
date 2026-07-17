import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, History, LogOut, Settings } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'

interface SidebarAccountFooterProps {
  onOpenSettings: () => void
  onOpenHistory: () => void
  onLogout: () => void
}

/**
 * Account menu in the sidebar footer (Linear-style full-row trigger).
 * Menu structure + testids match the former FloatingAvatarButton.
 */
export function SidebarAccountFooter({
  onOpenSettings,
  onOpenHistory,
  onLogout,
}: SidebarAccountFooterProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  const handleLogout = () => {
    const confirmed = window.confirm(
      `${t('common.logoutConfirmTitle')}\n\n${t('common.logoutConfirmDesc')}`,
    )
    if (!confirmed) return
    setOpen(false)
    onLogout()
  }

  return (
    <div
      ref={ref}
      className="relative shrink-0 border-t border-border px-1.5 pb-2 pt-1.5"
      data-testid="sidebar-account-footer"
    >
      <button
        type="button"
        data-testid="account-menu-button"
        data-no-drag
        onClick={() => setOpen(!open)}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors',
          'hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring',
          open && 'bg-state-hover',
        )}
        aria-label={t('account.menu')}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Avatar name="H" size={28} gradient />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body font-medium text-ink">
            {t('account.userLabel')}
          </span>
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-ink-tertiary">
            <span className="size-1.5 shrink-0 rounded-full bg-success" aria-hidden />
            <span className="truncate">{t('account.statusLocal')}</span>
          </span>
        </span>
        <ChevronDown
          size={16}
          className={cn(
            'shrink-0 text-ink-tertiary transition-transform duration-150',
            open && 'rotate-180',
          )}
          aria-hidden
        />
      </button>

      {open && (
        <div
          className="absolute bottom-full left-1.5 right-1.5 z-20 mb-1.5 rounded-xl border border-border bg-surface p-1.5 shadow-menu animate-menu-in"
          role="menu"
          aria-label={t('account.menu')}
        >
          <button
            type="button"
            data-testid="account-history-menu-item"
            onClick={() => {
              setOpen(false)
              onOpenHistory()
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-body text-ink transition-colors hover:bg-surface-muted"
            role="menuitem"
          >
            <History size={14} className="text-ink-secondary" />
            {t('nav.history')}
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            data-testid="account-settings-menu-item"
            onClick={() => {
              setOpen(false)
              onOpenSettings()
            }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-body text-ink transition-colors hover:bg-surface-muted"
            role="menuitem"
          >
            <Settings size={14} className="text-ink-secondary" />
            {t('nav.settings')}
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            data-testid="account-logout-menu-item"
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-body text-danger transition-colors hover:bg-danger/10"
            role="menuitem"
          >
            <LogOut size={14} />
            {t('common.logout')}
          </button>
        </div>
      )}
    </div>
  )
}
