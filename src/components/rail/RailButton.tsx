import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface RailButtonProps {
  icon: LucideIcon
  label: string
  active?: boolean
  danger?: boolean
  onClick: () => void
}

export function RailButton({ icon: Icon, label, active = false, danger = false, onClick }: RailButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
      data-tauri-drag-region="false"
      className={cn(
        'flex h-12 w-12 flex-col items-center justify-center gap-0.5 rounded-lg transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        active
          ? 'bg-accent text-white'
          : danger
            ? 'text-ink-tertiary hover:bg-danger/10 hover:text-danger'
            : 'text-ink-tertiary hover:bg-accent-subtle/50 hover:text-ink',
      )}
    >
      <Icon size={18} />
      <span className="text-caption">{label}</span>
    </button>
  )
}
