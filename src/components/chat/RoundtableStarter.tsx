import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ShieldAlert, SlidersHorizontal, Users } from 'lucide-react'
import { useDraftStore } from '@/store/draftStore'
import { ComposerChip } from './ComposerChip'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/DropdownMenu'
import { cn } from '@/lib/utils'

interface RoundtableStarterProps {
  /** Slash skill / skill-arg active — mutually exclusive with roundtable. */
  disabled?: boolean
}

/**
 * Chat empty-state one-shot starter for roundtable framing, rendered as a mode
 * radio dropdown in the composer footer strip (single-select, one mode at a time):
 * - Roundtable: selectable now (arms the first-message framing).
 * - Control permission: selectable now (high-risk — lifts the chat sandbox to
 *   full machine access for the first committed session).
 * Re-selecting the armed mode deselects it; the chip falls back to a neutral
 * "Mode selection" label. The armed mode's short description is shown next to
 * the chip in the footer strip. Visibility: parent only mounts on chat
 * NewConversation when ROUNDTABLE_STARTER.
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
  const chipLabel = danger
    ? t('chat.roundtable.controlPermission')
    : active
      ? t('chat.roundtable.chip')
      : t('chat.roundtable.modeSelect')
  const radioValue = danger ? 'controlPermission' : active ? 'roundtable' : ''

  return (
    <div className="flex min-w-0 items-center gap-2" data-testid="roundtable-starter">
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
            ) : active ? (
              <Users size={11} strokeWidth={1.75} className="shrink-0 text-effort-max" aria-hidden />
            ) : (
              <SlidersHorizontal size={11} strokeWidth={1.75} className="shrink-0 opacity-70" aria-hidden />
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
          <DropdownMenuRadioGroup value={radioValue}>
            <DropdownMenuRadioItem
              value="roundtable"
              data-testid="roundtable-option"
              onSelect={() => setRoundtable(!active)}
              className="justify-between data-[state=checked]:bg-accent/10"
            >
              <span className="flex min-w-0 items-center gap-2.5">
                <Users
                  size={14}
                  className={cn('shrink-0', active ? 'text-accent' : 'text-ink-tertiary')}
                  aria-hidden
                />
                {t('chat.roundtable.chip')}
              </span>
              <Check
                size={14}
                className={cn('shrink-0 text-accent', active ? 'opacity-100' : 'opacity-0')}
                aria-hidden
              />
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem
              value="controlPermission"
              data-testid="control-permission-option"
              onSelect={() => setControlPermission(!controlPermission)}
              title={t('chat.roundtable.controlPermissionHint')}
              className="justify-between data-[state=checked]:bg-danger/10"
            >
              <span className="flex min-w-0 items-center gap-2.5">
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
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {/* Mode description sits next to the chip in the footer strip when armed. */}
      {danger ? (
        <span className="max-w-[200px] truncate text-caption text-danger" data-testid="control-permission-mode-desc">
          {t('chat.roundtable.controlPermissionDesc')}
        </span>
      ) : active ? (
        <span className="max-w-[200px] truncate text-caption text-ink-tertiary" data-testid="roundtable-mode-desc">
          {t('chat.roundtable.roundtableDesc')}
        </span>
      ) : null}
    </div>
  )
}
