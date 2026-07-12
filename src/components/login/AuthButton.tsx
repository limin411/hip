import type { LucideIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/Button'
import { cn } from '@/lib/utils'

interface AuthButtonProps {
  icon: LucideIcon
  label: string
  onClick: () => void
  variant?: 'solid' | 'outline'
}

/**
 * Login auth row — consumes global buttonVariants (neutral elevated primary).
 * solid → primary, outline → secondary.
 */
export function AuthButton({
  icon: Icon,
  label,
  onClick,
  variant = 'outline',
}: AuthButtonProps) {
  const isPrimary = variant === 'solid'
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        buttonVariants({
          variant: isPrimary ? 'primary' : 'secondary',
          size: 'lg',
        }),
        'h-11 w-full gap-2.5 rounded-xl',
      )}
    >
      <Icon size={18} strokeWidth={2} />
      {label}
    </button>
  )
}
