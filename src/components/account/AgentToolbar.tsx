import { useTranslation } from 'react-i18next'
import { Plus, Search, X } from 'lucide-react'
import type { AgentConfig } from '@hip/protocol'
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from '@/components/ui/DropdownMenu'

export function AgentToolbar({
  search,
  onSearchChange,
  onAdd,
}: {
  search: string
  onSearchChange: (value: string) => void
  onAdd: (kind: AgentConfig['kind']) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-1 items-center justify-end gap-3 min-w-0">
      <div className="relative max-w-md flex-1">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-tertiary" />
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('settings.agents.searchPlaceholder')}
          className="h-9 w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-8 text-body text-ink placeholder:text-ink-tertiary focus:outline-none focus:ring-2 focus:ring-accent/60"
        />
        {search && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute right-2 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded text-ink-tertiary transition-colors hover:bg-surface-muted hover:text-ink"
            aria-label={t('common.close')}
          >
            <X size={14} />
          </button>
        )}
      </div>
      {/* modal={false}: the menu opens a Modal; stacking two pointer-events locks freezes the app. */}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-body font-medium text-white transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
          >
            <Plus size={16} />
            {t('settings.agents.addAgent')}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => onAdd('internal')}>
            {t('settings.agents.addInternal')}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => onAdd('acp')}>
            {t('settings.agents.addAcp')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
