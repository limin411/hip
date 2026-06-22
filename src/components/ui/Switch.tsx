import { cn } from '@/lib/utils'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
  ariaDisabled?: boolean
  id?: string
  ariaLabel?: string
  className?: string
}

/** Controlled on/off toggle. Native <button role="switch"> → Space/Enter toggle for free. */
export function Switch({ checked, onCheckedChange, disabled, ariaDisabled, id, ariaLabel, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-disabled={ariaDisabled}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors',
        'hover:shadow-[0_0_0_3px_rgba(0,98,173,0.1)]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-border',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-4 w-4 rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-all duration-200',
          'ease-[cubic-bezier(0.34,1.56,0.64,1)] active:scale-90',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
