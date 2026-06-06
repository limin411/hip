import { X } from 'lucide-react'
import type { SessionVM } from '@/domain'
import { cn } from '@/lib/utils'

interface SessionItemProps {
  session: SessionVM
  active: boolean
  onSelect: () => void
  onDelete: () => void
}

export function SessionItem({ session, active, onSelect, onDelete }: SessionItemProps) {
  return (
    <div
      onClick={onSelect}
      className={cn(
        'group flex cursor-pointer flex-col gap-0.5 rounded-md px-2.5 py-2 transition-colors',
        active ? 'bg-accent-subtle' : 'hover:bg-surface-muted',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className={cn('truncate text-[13px] text-ink', active ? 'font-semibold' : 'font-medium')}>
          {session.title}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="hidden shrink-0 text-ink-tertiary hover:text-danger group-hover:block"
          title="删除会话"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[12px] text-ink-tertiary">{session.preview}</span>
        <span className="shrink-0 text-[11px] text-ink-tertiary">{session.updatedAt}</span>
      </div>
    </div>
  )
}
