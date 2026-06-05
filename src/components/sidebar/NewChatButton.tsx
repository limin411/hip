import { Plus } from 'lucide-react'
import { useUiStore } from '@/store/uiStore'

export function NewChatButton() {
  const newSession = useUiStore((s) => s.newSession)
  return (
    <button
      onClick={newSession}
      className="flex h-9 w-full items-center gap-2 rounded-md bg-accent px-3 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
      title="新对话"
    >
      <Plus size={18} />
      <span>新对话</span>
    </button>
  )
}
