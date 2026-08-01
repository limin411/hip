import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, MessagesSquare, ShieldAlert, Users } from 'lucide-react'
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
 * - Control permission: toggleable now (high-risk — lifts the chat sandbox to
 *   full machine access for the first committed session).
 * Visibility: parent only mounts on chat NewConversation when ROUNDTABLE_STARTER.
 */
export function RoundtableStarter({ disabled = false }: RoundtableStarterProps) {
  const { t } = useTranslation()
  const active = useDraftStore((s) => !!s.draft?.roundtable)
  const setRoundtable = useDraftStore((s) => s.setRoundtable)
  const controlPermission = useDraftStore((s) => !!s.draft?.controlPermission)
  const setControlPermission = useDraftStore((s) => s.setControlPermission)

  // Mutual exclusion with slash / skill: drop armed state when entry is disabled.
  useEffect(() => {
    if (disabled && active) setRoundtable(false)
  }, [disabled, active, setRoundtable])
  useEffect(() => {
    if (disabled && controlPermission) setControlPermission(false)
  }, [disabled, controlPermission, setControlPermission])

  // High-risk mode wins the chip face when armed.
  const danger = controlPermission
  const chipLabel = danger ? t('chat.roundtable.controlPermission') : t('chat.roundtable.chip')

  return (
    <div className="flex min-w-0 items-center" data-testid="roundtable-starter">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <ComposerChip
            type="button"
            disabled={disabled}
            active={active || controlPermission}
            size="sm"
            data-testid="roundtable-chip"
            title={disabled ? t('chat.roundtable.disabledHint') : danger ? t('chat.roundtable.controlPermissionHint') : t('chat.roundtable.chipHint')}
            aria-haspopup="menu"
            className={cn(
              danger && 'border border-danger/60 bg-danger/10 text-danger',
              active && !danger && 'border border-effort-max bg-state-active text-ink',
            )}
          >
            {danger ? (
              <ShieldAlert size={11} strokeWidth={1.75} className="shrink-0" aria-hidden />
            ) : (
              <Users size={11} strokeWidth={1.75} className={cn('shrink-0', active && 'text-effort-max')} aria-hidden />
            )}
            <span className="max-w-[120px] truncate">{chipLabel}</span>
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
          <DropdownMenuItem
            data-testid="control-permission-option"
            onSelect={() => setControlPermission(!controlPermission)}
            title={t('chat.roundtable.controlPermissionHint')}
            className="justify-between"
          >
            <span className="flex items-center gap-2.5">
              <ShieldAlert
                size={14}
                className={cn('shrink-0', controlPermission ? 'text-danger' : 'text-ink-tertiary')}
                aria-hidden
              />
              {t('chat.roundtable.controlPermission')}
            </span>
            <Check
              size={14}
              className={cn('shrink-0 text-danger', controlPermission ? 'opacity-100' : 'opacity-0')}
              aria-hidden
            />
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
