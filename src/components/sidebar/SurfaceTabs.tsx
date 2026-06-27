import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface SurfaceTabsProps {
  active: 'chat' | 'code'
  onChange: (view: 'chat' | 'code') => void
}

export function SurfaceTabs({ active, onChange }: SurfaceTabsProps) {
  const { t } = useTranslation()
  return (
    <div className="inline-flex rounded-lg bg-surface-subtle p-0.5">
      {(['chat', 'code'] as const).map((view) => {
        const isActive = active === view
        return (
          <button
            key={view}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(view)}
            className={cn(
              'rounded-md px-4 py-1 text-sm font-medium transition-all duration-150',
              isActive
                ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(0,0,0,0.06)]'
                : 'text-ink-tertiary hover:text-ink',
            )}
          >
            {t(`nav.${view}`)}
          </button>
        )
      })}
    </div>
  )
}
