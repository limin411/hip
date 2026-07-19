import { useTranslation } from 'react-i18next'
import { ShieldCheck, Check } from 'lucide-react'
import type { PermissionMode } from '@hip/protocol'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/DropdownMenu'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useActiveSession, useActiveSessionId, sessionService } from '@/domain'
import { cn } from '@/lib/utils'

/** Pure: the three modes in display order. */
export const PERMISSION_MODES: readonly PermissionMode[] = ['chat', 'edit', 'full'] as const

/** Pure: normalize a stored/draft value to one of the three modes. undefined / dirty ⇒ 'edit'. */
export function resolvePermissionMode(mode: PermissionMode | undefined): PermissionMode {
  return mode === 'chat' || mode === 'edit' || mode === 'full' ? mode : 'edit'
}

export function PermissionModePicker() {
  const { t } = useTranslation()
  // Separate selectors (matching ModelPicker) avoid a new object each render / useShallow.
  const draftMode = useDraftStore((s) => s.draft?.permissionMode)
  const setDraftMode = useDraftStore((s) => s.setPermissionMode)
  const activeId = useActiveSessionId()
  const session = useActiveSession()

  // Committed session reads its config; a new-conversation draft reads the draft.
  // Both are editable here (unlike ModelPicker, which locks the model in a committed session).
  const current = activeId && session
    ? resolvePermissionMode(session.config.permissionMode)
    : resolvePermissionMode(draftMode)

  const choose = (mode: PermissionMode) => {
    if (activeId && session) sessionService.setPermissionMode(activeId, mode)
    else setDraftMode(mode)
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <ComposerChip active={current !== 'edit'} title={t('chat.permission.label')} data-testid="permission-chip">
          <ShieldCheck size={13} strokeWidth={1.75} className="shrink-0 opacity-80" aria-hidden />
          <span className="max-w-[140px] truncate">{t(`chat.permission.modes.${current}`)}</span>
        </ComposerChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {PERMISSION_MODES.map((mode) => (
          <DropdownMenuItem
            key={mode}
            onSelect={() => choose(mode)}
            className="flex-col items-start gap-0.5"
            data-testid={`permission-mode-${mode}`}
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
