import { useTranslation } from 'react-i18next'
import { ShieldCheck, Check } from 'lucide-react'
import type { PermissionMode } from '@hip/protocol'
import { toast } from 'sonner'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/DropdownMenu'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useDomainStore } from '@/domain/sessionStore'
import { useActiveSession, useActiveSessionStatus, sessionService } from '@/domain'
import { cn } from '@/lib/utils'

/** Pure: the three modes in display order. */
export const PERMISSION_MODES: readonly PermissionMode[] = ['chat', 'edit', 'full'] as const

/** Pure: normalize a stored/draft value to one of the three modes. undefined / dirty ⇒ 'edit'. */
export function resolvePermissionMode(mode: PermissionMode | undefined): PermissionMode {
  return mode === 'chat' || mode === 'edit' || mode === 'full' ? mode : 'edit'
}

/**
 * Chat/project composer permission-mode switcher. When `sessionId` is given
 * (terminal ops composer), the picker binds to that session instead of the
 * global active session / draft — same contract as ModelPicker. Switching
 * calls session:setPermissionMode on that session only; `onSelect` fires
 * alongside for caller side-effects (e.g. terminal new-chat default mode).
 */
export function PermissionModePicker({
  sessionId,
  disabled,
  onSelect,
}: {
  sessionId?: string
  /** Hard-disable the chip (e.g. plan-approval composer gate). */
  disabled?: boolean
  /** Extra callback after a mode is chosen (not fired when busy/no change). */
  onSelect?: (mode: PermissionMode) => void
}) {
  const { t } = useTranslation()
  // Separate selectors (matching ModelPicker) avoid a new object each render / useShallow.
  const draftMode = useDraftStore((s) => s.draft?.permissionMode)
  const setDraftMode = useDraftStore((s) => s.setPermissionMode)
  const activeSession = useActiveSession()
  const status = useActiveSessionStatus()
  const boundSession = useDomainStore((s) =>
    sessionId ? s.sessions.find((x) => x.id === sessionId) : undefined,
  )
  const session = sessionId ? boundSession : activeSession
  const busy = disabled === true || (sessionId ? boundSession?.status === 'running' : status === 'running')

  // Committed session reads its config; a new-conversation draft reads the draft.
  // Both are editable here (unlike ModelPicker, which locks the model in a committed session).
  // While a turn is running, mode cannot change (same lock as ExecutionModePicker).
  const current = session
    ? resolvePermissionMode(session.config.permissionMode)
    : resolvePermissionMode(draftMode)

  const choose = (mode: PermissionMode) => {
    if (busy) {
      toast.message(t('chat.permission.busyTitle'))
      return
    }
    if (mode === current) return
    onSelect?.(mode)
    if (session) sessionService.setPermissionMode(session.id, mode)
    else setDraftMode(mode)
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <ComposerChip
          type="button"
          active={current !== 'edit'}
          title={busy ? t('chat.permission.busyTitle') : t('chat.permission.label')}
          data-testid="permission-chip"
          disabled={disabled}
          aria-disabled={busy || undefined}
          className={busy ? 'cursor-not-allowed opacity-50' : undefined}
          onClick={(e) => {
            if (busy) {
              e.preventDefault()
              toast.message(t('chat.permission.busyTitle'))
            }
          }}
        >
          <ShieldCheck size={13} strokeWidth={1.75} className="shrink-0" aria-hidden />
          <span className="max-w-[140px] truncate">{t(`chat.permission.modes.${current}`)}</span>
        </ComposerChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="bg-surface-subtle" data-testid="permission-mode-menu">
        <div className="px-2 py-1.5 text-meta font-medium text-ink-tertiary">
          {t('chat.permission.menuTitle')}
        </div>
        {PERMISSION_MODES.map((mode) => (
          <DropdownMenuItem
            key={mode}
            disabled={busy}
            onSelect={() => choose(mode)}
            className="flex-col items-start gap-0.5"
            data-testid={`permission-mode-${mode}`}
            data-selected={current === mode ? 'true' : 'false'}
          >
            <div className="flex items-center gap-2">
              <Check size={14} className={cn('shrink-0', current === mode ? 'opacity-100' : 'opacity-0')} />
              <span>{t(`chat.permission.modes.${mode}`)}</span>
            </div>
            <span className="pl-6 text-meta text-ink-tertiary">{t(`chat.permission.desc.${mode}`)}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
