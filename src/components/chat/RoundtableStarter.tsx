import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, MessagesSquare, Users } from 'lucide-react'
import { useDraftStore } from '@/store/draftStore'
import { ComposerChip } from './ComposerChip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { cn } from '@/lib/utils'

interface RoundtableStarterProps {
  /** Slash skill / skill-arg active — mutually exclusive with roundtable. */
  disabled?: boolean
}

/**
 * Chat empty-state one-shot starter for roundtable framing, rendered as a mode
 * dropdown in the composer footer strip:
 * - Roundtable: toggleable now (arms the first-message framing).
 * - Discussion mode: placeholder item, disabled until shipped.
 * Visibility: parent only mounts on chat NewConversation when ROUNDTABLE_STARTER.
 */
export function RoundtableStarter({ disabled = false }: RoundtableStarterProps) {
  const { t } = useTranslation()
  const active = useDraftStore((s) => !!s.draft?.roundtable)
  const setRoundtable = useDraftStore((s) => s.setRoundtable)

  // Mutual exclusion with slash / skill: drop armed state when entry is disabled.
  useEffect(() => {
    if (disabled && active) setRoundtable(false)
  }, [disabled, active, setRoundtable])

  return (
    <div className="flex min-w-0 items-center" data-testid="roundtable-starter">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <ComposerChip
            type="button"
            disabled={disabled}
            active={active}
            size="sm"
            data-testid="roundtable-chip"
            title={disabled ? t('chat.roundtable.disabledHint') : t('chat.roundtable.chipHint')}
            aria-haspopup="menu"
            className={cn(
              active && 'border border-effort-max bg-state-active text-ink shadow-sm',
            )}
          >
            <Users size={11} strokeWidth={1.75} className={cn('shrink-0', active && 'text-effort-max')} aria-hidden />
            <span className="max-w-[120px] truncate">{t('chat.roundtable.chip')}</span>
            <ChevronDown size={11} strokeWidth={1.75} className="shrink-0 opacity-60" aria-hidden />
          </ComposerChip>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          data-testid="roundtable-menu"
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DropdownMenuItem
            data-testid="roundtable-option"
            onSelect={() => setRoundtable(!active)}
            className="justify-between"
          >
            <span className="flex items-center gap-2.5">
              <Users size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
              {t('chat.roundtable.chip')}
            </span>
            <Check
              size={14}
              className={cn('shrink-0 text-accent', active ? 'opacity-100' : 'opacity-0')}
              aria-hidden
            />
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled
            data-testid="discussion-option"
            title={t('chat.roundtable.comingSoon')}
            className="justify-between"
          >
            <span className="flex items-center gap-2.5">
              <MessagesSquare size={14} className="shrink-0 text-ink-tertiary" aria-hidden />
              {t('chat.roundtable.discussion')}
            </span>
            <span
              className="rounded bg-surface-muted px-1.5 py-px text-caption font-medium text-ink-tertiary"
              data-testid="discussion-coming-soon"
            >
              {t('chat.roundtable.comingSoon')}
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
