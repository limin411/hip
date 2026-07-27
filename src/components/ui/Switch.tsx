import { cn } from '@/lib/utils'
import { focusChrome } from './focusClasses'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
  ariaDisabled?: boolean
  id?: string
  ariaLabel?: string
  className?: string
  'data-testid'?: string
}

/** Controlled on/off toggle. Native <button role="switch"> → Space/Enter toggle for free. */
export function Switch({
  checked,
  onCheckedChange,
  disabled,
  ariaDisabled,
  id,
  ariaLabel,
  className,
  'data-testid': dataTestId,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-disabled={ariaDisabled}
      disabled={disabled}
      data-testid={dataTestId}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-chrome ease-out',
        focusChrome,
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-accent' : 'bg-border-strong',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          // Tokenized thumb: surface + light ring for separation on accent / border tracks
          'inline-block h-4 w-4 rounded-full bg-surface ring-1 ring-black/5 dark:ring-white/10',
          'shadow-[0_1px_2px_rgba(0,0,0,0.12)] transition-transform duration-chrome ease-out',
          'active:scale-90',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}
