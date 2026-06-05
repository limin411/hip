import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AuthButtonProps {
  icon: LucideIcon
  label: string
  onClick: () => void
  variant?: 'solid' | 'outline'
}

export function AuthButton({ icon: Icon, label, onClick, variant = 'outline' }: AuthButtonProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border text-sm font-medium transition-colors',
        variant === 'solid'
          ? 'border-accent bg-accent text-white hover:bg-accent-hover'
          : 'border-border bg-surface text-ink hover:bg-surface-muted',
      )}
    >
      <Icon size={18} strokeWidth={2} />
      {label}
    </button>
  )
}
