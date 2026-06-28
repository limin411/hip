import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

import type { Surface } from '@/store/uiStore'

interface SurfaceTabsProps {
  active: Surface
  onChange: (view: Surface) => void
}

export function SurfaceTabs({ active, onChange }: SurfaceTabsProps) {
  const { t } = useTranslation()
  return (
    <div className="flex rounded-lg bg-surface-subtle p-0.5">
      {(['chat', 'code', 'domain'] as const).map((view) => {
        const isActive = active === view
        return (
          <button
            key={view}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(view)}
            className={cn(
              'flex-1 rounded-md px-4 py-1 text-sm font-medium transition-all duration-150',
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
