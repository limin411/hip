import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Settings, LogOut } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/DropdownMenu'

// TODO: replace with real authenticated user once auth flow is implemented
const currentUser = { name: 'User', email: 'user@example.com', avatarUrl: undefined }

export function AccountFooter() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const [confirmLogout, setConfirmLogout] = useState(false)

  return (
    <>
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-3 border-t border-border pt-3 text-left transition hover:bg-surface-muted"
          >
            <Avatar name={currentUser.name} src={currentUser.avatarUrl} size={28} />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-body font-medium text-ink">{currentUser.name}</span>
              <span className="truncate text-caption text-ink-tertiary">{currentUser.email}</span>
            </div>
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="top" align="start" className="w-[220px]">
          <DropdownMenuLabel>{currentUser.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setActiveView('settings')}>
            <Settings size={15} className="text-ink-secondary" />
            {t('nav.settings')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-danger focus:bg-danger/10"
            onSelect={() => setConfirmLogout(true)}
          >
            <LogOut size={15} />
            {t('common.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Modal open={confirmLogout} onOpenChange={setConfirmLogout} title={t('common.logoutConfirmTitle')}>
        <div className="flex flex-col gap-5 p-5">
          <p className="text-body text-ink-secondary">{t('common.logoutConfirmDesc')}</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmLogout(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              className="bg-danger text-white hover:bg-danger/90"
              onClick={() => {
                setConfirmLogout(false)
                logout()
                navigate('/login')
              }}
            >
              {t('common.logout')}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  )
}
