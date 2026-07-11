import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AuthButtonProps {
  icon: LucideIcon
  label: string
  onClick: () => void
  variant?: 'solid' | 'outline'
  onPointerEnter?: () => void
  onPointerLeave?: () => void
}

/**
 * Login-only elevated stack (design D):
 * - solid: white fill + near-black hairline border (primary CTA, not brand sage)
 * - outline: soft gray fill + light border
 */
export function AuthButton({
  icon: Icon,
  label,
  onClick,
  variant = 'outline',
  onPointerEnter,
  onPointerLeave,
}: AuthButtonProps) {
  const isPrimary = variant === 'solid'
  return (
    <button
      type="button"
      onClick={onClick}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
      className={cn(
        'inline-flex h-11 w-full items-center justify-center gap-2.5 rounded-xl text-body font-medium',
        'transition active:scale-[0.98] duration-100',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
        isPrimary
          ? 'border border-ink bg-surface text-ink font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06)] hover:bg-surface-subtle'
          : 'border border-border bg-[#fafafa] text-ink hover:bg-surface-subtle dark:bg-surface-subtle dark:hover:bg-surface-muted',
      )}
    >
      <Icon size={18} strokeWidth={2} />
      {label}
    </button>
  )
}
