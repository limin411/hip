import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Settings, LogOut } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { useAuthStore } from '@/store/authStore'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { HipLogo } from '@/components/login/HipLogo'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/DropdownMenu'
import { RailButton } from './RailButton'

// TODO: replace with real authenticated user once auth flow is implemented
const currentUser = { name: 'User', email: 'user@example.com', avatarUrl: undefined }

export function MenuRail() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const logout = useAuthStore((s) => s.logout)
  const activeView = useUiStore((s) => s.activeView)
  const setActiveView = useUiStore((s) => s.setActiveView)
  const [confirmLogout, setConfirmLogout] = useState(false)

  return (
    <div
      data-tauri-drag-region
      className="flex h-full w-[58px] shrink-0 flex-col items-center border-r border-border bg-surface-subtle"
    >
      {/* 红绿灯偏移 + 品牌标志（drag region）。macOS 窗口按钮停靠在本栏顶部，logo 在其下方。 */}
      <div
        className="flex w-full flex-col items-center"
        style={{ paddingTop: 'var(--traffic-lights-offset, 40px)' }}
      >
        <HipLogo variant="minimal" size={26} decorative />
      </div>

      {/* 主导航 */}
      <nav className="mt-3 flex w-full flex-col items-center gap-1">
        <RailButton
          icon={MessageSquare}
          label={t('nav.chat')}
          active={activeView === 'chat'}
          onClick={() => setActiveView('chat')}
        />
      </nav>

      <div className="flex-1" />

      {/* 账户：点击头像弹出「设置 / 退出登录」菜单 */}
      <div className="mb-2 flex w-full flex-col items-center" data-tauri-drag-region="false">
        {/* modal={false}：避免下拉菜单与退出确认 Modal 的 DismissableLayer 叠加，
            导致关闭后 body 残留 pointer-events:none（沿用旧 UserMenu 的处理）。 */}
        <DropdownMenu modal={false}>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={currentUser.name}
              title={currentUser.email}
              className="flex items-center justify-center rounded-full p-0.5 ring-1 ring-transparent transition-colors hover:ring-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
            >
              <Avatar name={currentUser.name} src={currentUser.avatarUrl} size={32} />
            </button>
          </DropdownMenuTrigger>

          <DropdownMenuContent side="right" align="end" className="w-[220px]">
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
      </div>

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
    </div>
  )
}
