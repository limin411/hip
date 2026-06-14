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
      className="flex h-full w-[52px] shrink-0 flex-col items-center border-r border-border bg-surface-subtle"
    >
      {/* 红绿灯偏移 + 品牌标志（drag region） */}
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

      {/* 账户簇：设置 / 头像 / 退出 */}
      <div className="mb-2 flex w-full flex-col items-center gap-1.5">
        <RailButton
          icon={Settings}
          label={t('nav.settings')}
          active={activeView === 'settings'}
          onClick={() => setActiveView('settings')}
        />
        <span title={currentUser.email} className="inline-flex" data-tauri-drag-region="false">
          <Avatar name={currentUser.name} src={currentUser.avatarUrl} size={28} />
        </span>
        <RailButton
          icon={LogOut}
          label={t('common.logout')}
          danger
          onClick={() => setConfirmLogout(true)}
        />
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
