import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings, LogOut } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'

interface FloatingAvatarButtonProps {
  onOpenSettings: () => void
  onLogout: () => void
}

export function FloatingAvatarButton({ onOpenSettings, onLogout }: FloatingAvatarButtonProps) {
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

  return (
    <div ref={ref} className="absolute bottom-4 left-4 z-50">
      <button
        type="button"
        data-testid="account-menu-button"
        onClick={() => setOpen(!open)}
        className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-subtle text-accent-strong ring-1 ring-transparent transition-all hover:scale-105 hover:ring-border"
        aria-label={t('account.menu')}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <Avatar name="User" size={32} />
      </button>

      {open && (
        <div
          className="absolute bottom-11 left-0 w-44 rounded-xl border border-border bg-surface p-1.5 shadow-menu animate-menu-in"
          role="menu"
          aria-label={t('account.menu')}
        >
          <button
            type="button"
            data-testid="account-settings-menu-item"
            onClick={() => { setOpen(false); onOpenSettings() }}
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-body text-ink transition-colors hover:bg-surface-muted"
            role="menuitem"
          >
            <Settings size={14} className="text-ink-secondary" />
            {t('nav.settings')}
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            type="button"
            onClick={() => { setOpen(false); onLogout() }}
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
