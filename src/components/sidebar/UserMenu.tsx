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
import { mockUser } from '@/mock/user'
import { cn } from '@/lib/utils'

const PAGES = [
  { icon: User, label: '个人资料' },
  { icon: Settings, label: '设置' },
  { icon: CreditCard, label: '账单与用量' },
  { icon: HelpCircle, label: '帮助与支持' },
]

export function UserMenu({ collapsed }: { collapsed: boolean }) {
  const navigate = useNavigate()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={cn(
            'flex items-center gap-2.5 rounded-md p-1.5 transition-colors hover:bg-surface-muted',
            collapsed ? 'w-9 justify-center' : 'w-full',
          )}
        >
          <Avatar name={mockUser.name} src={mockUser.avatarUrl} size={28} />
          {!collapsed && (
            <>
              <div className="flex min-w-0 flex-1 flex-col items-start">
                <span className="truncate text-[13px] font-medium text-ink">{mockUser.name}</span>
                <span className="truncate text-[11px] text-ink-tertiary">{mockUser.email}</span>
              </div>
              <ChevronsUpDown size={14} className="shrink-0 text-ink-tertiary" />
            </>
          )}
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent side="top" align="start" className="w-[240px]">
        <DropdownMenuLabel>{mockUser.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {PAGES.map((page) => (
          <DropdownMenuItem key={page.label}>
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
