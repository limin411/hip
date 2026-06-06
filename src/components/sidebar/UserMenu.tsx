import { useContext, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Settings, LogOut, ChevronsUpDown } from 'lucide-react'
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
// TODO: replace with real authenticated user once auth flow is implemented
const currentUser = { name: '用户', email: 'user@example.com', avatarUrl: undefined }

type PageKey = 'settings'

const PAGES: { key: PageKey; icon: typeof Settings; label: string }[] = [
  { key: 'settings', icon: Settings, label: '设置' },
]

const PANELS: Record<PageKey, () => JSX.Element> = {
  settings: SettingsPanel,
}

export function UserMenu() {
  const navigate = useNavigate()
  const peekLock = useContext(SidebarPeekLockContext)
  const [openKey, setOpenKey] = useState<PageKey | null>(null)

  const active = PAGES.find((p) => p.key === openKey)
  const ActivePanel = openKey ? PANELS[openKey] : null

  return (
    <>
      {/* modal={false}: 避免与下方 Modal(Dialog) 同时锁定 body 的 pointer-events，
          否则二者 DismissableLayer 叠加会在关闭弹窗后把 body 残留为 pointer-events:none，
          导致整个界面无法再点击。下拉菜单本身无需模态化。 */}
      <DropdownMenu modal={false} onOpenChange={(open) => (open ? peekLock?.lock() : peekLock?.unlock())}>
        <DropdownMenuTrigger asChild>
          <button className="flex w-full items-center gap-2.5 rounded-md p-1.5 transition-colors hover:bg-surface-muted">
            <Avatar name={currentUser.name} src={currentUser.avatarUrl} size={28} />
            <div className="flex min-w-0 flex-1 flex-col items-start">
              <span className="truncate text-[13px] font-medium text-ink">{currentUser.name}</span>
              <span className="truncate text-[11px] text-ink-tertiary">{currentUser.email}</span>
            </div>
            <ChevronsUpDown size={14} className="shrink-0 text-ink-tertiary" />
          </button>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="top" align="start" className="w-[240px]">
          <DropdownMenuLabel>{currentUser.email}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {PAGES.map((page) => (
            <DropdownMenuItem key={page.key} onSelect={() => setOpenKey(page.key)}>
              <page.icon size={15} className="text-ink-secondary" />
              {page.label}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-danger focus:bg-danger/10" onSelect={() => navigate('/login')}>
            <LogOut size={15} />
            退出登录
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Modal
        open={openKey !== null}
        onOpenChange={(open) => !open && setOpenKey(null)}
        title={active?.label ?? ''}
      >
        {ActivePanel && <ActivePanel />}
      </Modal>
    </>
  )
}
