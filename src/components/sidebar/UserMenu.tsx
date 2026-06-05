import { useContext } from 'react'
import { useNavigate } from 'react-router-dom'
import { User, Settings, CreditCard, HelpCircle, LogOut, ChevronsUpDown } from 'lucide-react'
import { Avatar } from '@/components/ui/Avatar'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from '@/components/ui/DropdownMenu'
import { SidebarPeekLockContext } from './sidebarPeekContext'
import { mockUser } from '@/mock/user'

const PAGES = [
  { icon: User, label: '个人资料', path: '/profile' },
  { icon: Settings, label: '设置', path: '/settings' },
  { icon: CreditCard, label: '账单与用量', path: '/billing' },
  { icon: HelpCircle, label: '帮助与支持', path: '/help' },
]

export function UserMenu() {
  const navigate = useNavigate()
  const peekLock = useContext(SidebarPeekLockContext)

  return (
    <DropdownMenu onOpenChange={(open) => (open ? peekLock?.lock() : peekLock?.unlock())}>
      <DropdownMenuTrigger asChild>
        <button className="flex w-full items-center gap-2.5 rounded-md p-1.5 transition-colors hover:bg-surface-muted">
          <Avatar name={mockUser.name} src={mockUser.avatarUrl} size={28} />
          <div className="flex min-w-0 flex-1 flex-col items-start">
            <span className="truncate text-[13px] font-medium text-ink">{mockUser.name}</span>
            <span className="truncate text-[11px] text-ink-tertiary">{mockUser.email}</span>
          </div>
          <ChevronsUpDown size={14} className="shrink-0 text-ink-tertiary" />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-[240px]">
        <DropdownMenuLabel>{mockUser.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PAGES.map((page) => (
          <DropdownMenuItem key={page.label} onSelect={() => navigate(page.path)}>
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
  )
}
