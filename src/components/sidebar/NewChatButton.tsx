import { Plus } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'

export function NewChatButton({ collapsed }: { collapsed: boolean }) {
  const newSession = useUiStore((s) => s.newSession)
  return (
    <button
      onClick={newSession}
      className={cn(
        'flex h-9 items-center gap-2 rounded-md bg-accent text-sm font-medium text-white transition-colors hover:bg-accent-hover',
        collapsed ? 'w-9 shrink-0 justify-center px-0' : 'w-full px-3',
      )}
      title="新对话"
    >
      <Plus size={18} />
      {!collapsed && <span>新对话</span>}
    </button>
  )
}
