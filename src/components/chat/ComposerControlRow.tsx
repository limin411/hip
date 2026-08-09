import { useTranslation } from 'react-i18next'
import { Ellipsis } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/Popover'
import { ComposerChip } from './ComposerChip'
import { cn } from '@/lib/utils'

/**
 * Composer toolbar with progressive disclosure (craft upgrade PR-2).
 * - Primary: always visible
 * - Pinned secondary: non-default chips kept outside overflow
 * - Overflow "More": remaining secondaries as full-width rows (empty ⇒ no trigger)
 *
 * Naming intentionally avoids the reverted "Tune" surface (76570f2d).
 */
export function ComposerControlRow({
  primary,
  pinnedSecondary,
  secondary,
  className,
}: {
  primary: React.ReactNode
  pinnedSecondary?: React.ReactNode
  /** Full secondary list for overflow only — disjoint from primary∪pinned. */
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
              data-testid="composer-overflow"
              title={t('chat.composer.moreTitle')}
              aria-label={t('chat.composer.more')}
              aria-haspopup="dialog"
            >
              <Ellipsis size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />
              <span className="max-w-[80px] truncate">{t('chat.composer.more')}</span>
            </ComposerChip>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="top"
            className="w-[min(280px,calc(100vw-2rem))] p-0"
            data-testid="composer-overflow-panel"
            id="composer-overflow-panel"
          >
            <div className="border-b border-border px-3 py-2">
              <div className="text-meta font-medium text-ink">{t('chat.composer.moreTitle')}</div>
              <p className="mt-0.5 text-caption text-ink-tertiary">{t('chat.composer.moreHint')}</p>
            </div>
            <div
              className={cn(
                'flex flex-col gap-0.5 p-1.5',
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
