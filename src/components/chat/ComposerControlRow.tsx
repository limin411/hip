import { useTranslation } from 'react-i18next'
import { SlidersHorizontal } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import { ComposerChip } from './ComposerChip'
import { cn } from '@/lib/utils'

/**
 * Composer toolbar:
 * - Primary: always visible (agent / model / attach)
 * - Pinned secondary: non-default chips kept outside (permission / plan / effort)
 * - Tune popover: full secondary control list as sectioned, full-width rows
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
            className="w-[min(280px,calc(100vw-2rem))] p-0"
            data-testid="composer-tune-panel"
          >
            <div className="border-b border-border px-3 py-2">
              <div className="text-meta font-medium text-ink">{t('chat.composer.tuneTitle')}</div>
              <p className="mt-0.5 text-caption text-ink-tertiary">{t('chat.composer.tuneHint')}</p>
            </div>
            <div
              className={cn(
                'flex flex-col gap-0.5 p-1.5',
                // Each chip/control stretches as a full-width row inside Tune.
                '[&_button]:w-full [&_button]:justify-start',
                '[&_[data-testid]]:w-full',
              )}
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
