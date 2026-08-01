import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import { SPACE_ICON_PRESETS, normalizeSpaceIcon } from '@/domain/knowledge/spaceIcons'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/Input'

type Props = {
  value: string
  onChange: (icon: string) => void
  /** Prefix for data-testid (create vs rename). */
  testIdPrefix?: string
}

/**
 * Compact icon chooser: none + preset grid + optional custom emoji paste.
 */
export function SpaceIconPicker({
  value,
  onChange,
  testIdPrefix = 'knowledge-space-icon',
}: Props) {
  const { t } = useTranslation()
  const selected = normalizeSpaceIcon(value) ?? ''

  return (
    <div className="flex flex-col gap-2" data-testid={testIdPrefix}>
      <span className="text-body text-ink-secondary">{t('knowledge.space.iconLabel')}</span>
      <div className="flex items-center gap-2">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-lg leading-none"
          data-testid={`${testIdPrefix}-preview`}
          aria-hidden
        >
          {selected ? (
            selected
          ) : (
            <BookOpen size={18} className="text-accent-strong" strokeWidth={1.75} />
          )}
        </span>
        <Input
          data-testid={`${testIdPrefix}-custom`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('knowledge.space.iconCustomPlaceholder')}
          maxLength={16}
          aria-label={t('knowledge.space.iconCustomPlaceholder')}
          className="min-w-0 flex-1"
        />
      </div>
      <div
        className="grid grid-cols-8 gap-1"
        role="listbox"
        aria-label={t('knowledge.space.iconLabel')}
      >
        <button
          type="button"
          role="option"
          aria-selected={!selected}
          data-testid={`${testIdPrefix}-none`}
          title={t('knowledge.space.iconNone')}
          onClick={() => onChange('')}
          className={cn(
            'flex h-8 w-full items-center justify-center rounded-md text-meta text-ink-tertiary transition-colors',
            'hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
            !selected && 'bg-accent/10 text-accent-strong ring-1 ring-accent/30',
          )}
        >
          —
        </button>
        {SPACE_ICON_PRESETS.map((emoji) => {
          const active = selected === emoji
          return (
            <button
              key={emoji}
              type="button"
              role="option"
              aria-selected={active}
              data-testid={`${testIdPrefix}-preset-${emoji}`}
              title={emoji}
              onClick={() => onChange(emoji)}
              className={cn(
                'flex h-8 w-full items-center justify-center rounded-md text-base leading-none transition-colors',
                'hover:bg-state-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/20',
                active && 'bg-accent/10 ring-1 ring-accent/30',
              )}
            >
              {emoji}
            </button>
          )
        })}
      </div>
    </div>
  )
}
