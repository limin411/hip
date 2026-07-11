import type { LucideIcon } from 'lucide-react'
import { buttonVariants } from '@/components/ui/Button'
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
        buttonVariants({
          variant: variant === 'solid' ? 'primary' : 'outline',
          size: 'lg',
        }),
        'h-11 w-full gap-2.5 rounded-lg',
      )}
    >
      <Icon size={18} strokeWidth={2} />
      {label}
    </button>
  )
}
