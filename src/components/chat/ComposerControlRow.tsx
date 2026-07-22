import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import { ComposerChip } from './ComposerChip'
import { cn } from '@/lib/utils'

/**
 * Composer toolbar:
 * - Primary: always visible (agent / model / attach)
 * - Pinned secondary: non-default chips kept outside (permission / plan / effort)
 * - Tune popover: full secondary control list (density without losing e2e pickers)
 */
export function ComposerControlRow({
  primary,
  pinnedSecondary,
  secondary,
  className,
}: {
  primary: React.ReactNode
  /** Non-default secondary chips kept visible outside the Tune menu. */
  pinnedSecondary?: React.ReactNode
  /** Full secondary control list (rendered in Tune popover). */
  secondary?: React.ReactNode
  className?: string
}) {
  const { t } = useTranslation()
  const hasSecondary = secondary != null && secondary !== false
  const hasPinned = pinnedSecondary != null && pinnedSecondary !== false

  return (
    <div
      className={cn('flex min-w-0 flex-wrap items-center gap-x-0.5 gap-y-1', className)}
      data-testid="composer-control-row"
    >
      <div className="flex flex-wrap items-center gap-0.5" data-testid="composer-controls-primary">
        {primary}
      </div>
      {hasPinned && (
        <div
          className="flex flex-wrap items-center gap-0.5"
          data-testid="composer-controls-pinned"
        >
          {pinnedSecondary}
        </div>
      )}
      {hasSecondary && (
        <Popover>
          <PopoverTrigger asChild>
            <ComposerChip
              type="button"
              active={false}
              data-testid="composer-tune"
              title={t('chat.composer.tuneTitle')}
              aria-label={t('chat.composer.tune')}
            >
              <SlidersHorizontal size={13} strokeWidth={1.75} className="shrink-0 opacity-80" aria-hidden />
              <span className="max-w-[80px] truncate">{t('chat.composer.tune')}</span>
            </ComposerChip>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="top"
            className="w-auto min-w-[200px] max-w-[min(360px,calc(100vw-2rem))] p-2"
            data-testid="composer-tune-panel"
          >
            <div className="mb-1.5 px-1 text-caption font-medium text-ink-tertiary">
              {t('chat.composer.tuneTitle')}
            </div>
            <div
              className="flex flex-col gap-0.5"
              data-testid="composer-controls-secondary"
            >
              {secondary}
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
