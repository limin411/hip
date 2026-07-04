import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { Surface } from '@/store/uiStore'

interface SurfaceToggleProps {
  active: Surface
  onChange: (surface: Surface) => void
}

export function SurfaceToggle({ active, onChange }: SurfaceToggleProps) {
  const { t } = useTranslation()
  return (
    <div className="inline-flex w-[200px] gap-0.5 rounded-lg bg-surface-subtle p-0.5">
      {(['chat', 'code'] as const).map((s) => (
        <button
          key={s}
          type="button"
          data-testid={`surface-toggle-${s}`}
          aria-pressed={active === s}
          onClick={() => onChange(s)}
          className={cn(
            'flex-1 rounded-md py-1.5 text-sm font-medium transition-all',
            active === s
              ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
              : 'text-ink-tertiary hover:text-ink',
          )}
        >
          {t(`nav.${s}`)}
        </button>
      ))}
    </div>
  )
}
