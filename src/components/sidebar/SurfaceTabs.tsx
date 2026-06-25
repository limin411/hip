import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

interface SurfaceTabsProps {
  active: 'chat' | 'code'
  onChange: (view: 'chat' | 'code') => void
}

export function SurfaceTabs({ active, onChange }: SurfaceTabsProps) {
  const { t } = useTranslation()
  return (
    <div className="flex justify-center gap-1 p-1">
      {(['chat', 'code'] as const).map((view) => {
        const isActive = active === view
        return (
          <button
            key={view}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(view)}
            className={cn(
              'rounded-full px-4 py-1 text-sm font-medium transition',
              isActive ? 'bg-surface-muted text-ink' : 'text-ink-tertiary hover:text-ink',
            )}
          >
            {t(`nav.${view}`)}
          </button>
        )
      })}
    </div>
  )
}
