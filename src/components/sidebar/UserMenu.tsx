import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Settings, LogOut, ChevronsUpDown } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { Avatar } from '@/components/ui/Avatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/DropdownMenu'
import { Modal } from '@/components/ui/Modal'
import { SettingsPanel } from '@/components/account/SettingsPanel'
import { SidebarPeekLockContext } from './sidebarPeekContext'
import { useAuthStore } from '@/store/authStore'
// TODO: replace with real authenticated user once auth flow is implemented
const currentUser = { name: 'User', email: 'user@example.com', avatarUrl: undefined }

const SETTINGS_DEFAULT_SIZE = { width: 960, height: 700 }
const SETTINGS_MIN_SIZE = { width: 600, height: 440 }

export function UserMenu() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const peekLock = useContext(SidebarPeekLockContext)
  const settingsOpen = useUiStore((s) => s.settingsOpen)
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)

  return (
    <>
      {/* modal={false}: 避免与下方 Modal(Dialog) 同时锁定 body 的 pointer-events，
          否则二者 DismissableLayer 叠加会在关闭弹窗后把 body 残留为 pointer-events:none，
          导致整个界面无法再点击。下拉菜单本身无需模态化。 */}
      <DropdownMenu modal={false} onOpenChange={(open) => (open ? peekLock?.lock() : peekLock?.unlock())}>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-2.5 rounded-md p-2 transition-colors hover:bg-surface-muted">
            <Avatar name={currentUser.name} src={currentUser.avatarUrl} size={28} />
            <div className="flex min-w-0 flex-1 flex-col items-start">
              <span className="truncate text-body font-medium text-ink">{currentUser.name}</span>
              <span className="truncate text-caption text-ink-tertiary">{currentUser.email}</span>
            </div>
            <ChevronsUpDown size={14} className="shrink-0 text-ink-tertiary" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="top" align="start" className="w-[240px]">
          <DropdownMenuLabel>{currentUser.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSettingsOpen(true)}>
            <Settings size={15} className="text-ink-secondary" />
            {t('settings.title')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-danger focus:bg-danger/10" onSelect={() => { logout(); navigate('/login') }}>
            <LogOut size={15} />
            {t('common.logout')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Modal
        open={settingsOpen}
        onOpenChange={(open) => !open && setSettingsOpen(false)}
        title={t('settings.title')}
        resizable
        defaultSize={SETTINGS_DEFAULT_SIZE}
        minSize={SETTINGS_MIN_SIZE}
        storageKey="hip.ui.settingsModalSize"
      >
        <SettingsPanel />
      </Modal>
    </>
  )
}
