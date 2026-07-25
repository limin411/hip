import { useTranslation } from 'react-i18next'
import { ListTree, Check } from 'lucide-react'
import type { ExecutionMode } from '@hip/protocol'
import {
  canSelectAutopilot,
  EXECUTION_MODES,
  resolveExecutionMode,
} from '@hip/protocol'
import { toast } from 'sonner'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/DropdownMenu'
import { ComposerChip } from './ComposerChip'
import { useDraftStore } from '@/store/draftStore'
import { useActiveSession, useActiveSessionId, useActiveSessionStatus } from '@/domain'
import { runAutopilot, runInteractive, runPlanOn } from '@/domain/commands'
import { cn } from '@/lib/utils'

/**
 * Collaboration mode picker: Interactive | Plan | Autopilot.
 * Replaces the binary Plan chip. Autopilot requires permissionMode === 'full'.
 * Orthogonal to PermissionMode except the Autopilot gate (spec §4.0b).
 */
export function ExecutionModePicker() {
  const { t } = useTranslation()
  const draft = useDraftStore((s) => s.draft)
  const activeId = useActiveSessionId()
  const session = useActiveSession()
  const status = useActiveSessionStatus()

  const permissionMode =
    activeId && session ? session.config.permissionMode : draft?.permissionMode
  const current =
    activeId && session
      ? resolveExecutionMode(session.config)
      : resolveExecutionMode({
          executionMode: draft?.executionMode,
          forcePlan: draft?.forcePlan,
          permissionMode: draft?.permissionMode,
        })
  const busy = status === 'running'
  const autopilotOk = canSelectAutopilot(permissionMode)

  const choose = (mode: ExecutionMode) => {
    if (busy) {
      toast.message(t('chat.executionMode.busyTitle'))
      return
    }
    if (mode === current) return
    const sessionId = activeId && session ? activeId : null
    if (mode === 'plan') {
      runPlanOn(sessionId)
      return
    }
    if (mode === 'autopilot') {
      runAutopilot(sessionId)
      return
    }
    runInteractive(sessionId)
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <ComposerChip
          type="button"
          active={current !== 'interactive'}
          title={busy ? t('chat.executionMode.busyTitle') : t('chat.executionMode.label')}
          data-testid="execution-mode-chip"
          // Alias for e2e/harness that still query plan-mode-chip
          data-plan-mode-chip="true"
          aria-pressed={current !== 'interactive'}
          aria-disabled={busy || undefined}
          className={busy ? 'cursor-not-allowed opacity-50' : undefined}
          onClick={(e) => {
            if (busy) {
              e.preventDefault()
              toast.message(t('chat.executionMode.busyTitle'))
            }
          }}
        >
          <ListTree size={13} strokeWidth={1.75} className="shrink-0 opacity-80" aria-hidden />
          <span className="max-w-[100px] truncate">
            {t(`chat.executionMode.modes.${current}`)}
          </span>
        </ComposerChip>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" data-testid="execution-mode-menu">
        <div className="px-2 py-1.5 text-meta font-medium text-ink-tertiary">
          {t('chat.executionMode.menuTitle')}
        </div>
        {EXECUTION_MODES.map((mode) => {
          const disabled = mode === 'autopilot' && !autopilotOk
          return (
            <DropdownMenuItem
              key={mode}
              disabled={disabled || busy}
              onSelect={() => choose(mode)}
              className="flex-col items-start gap-0.5"
              data-testid={`execution-mode-${mode}`}
            >
              <div className="flex items-center gap-2">
                <Check
                  size={14}
                  className={cn('shrink-0', current === mode ? 'opacity-100' : 'opacity-0')}
                />
                <span>{t(`chat.executionMode.modes.${mode}`)}</span>
              </div>
              <span className="pl-6 text-meta text-ink-tertiary">
                {disabled
                  ? t('chat.executionMode.desc.autopilotLocked')
                  : t(`chat.executionMode.desc.${mode}`)}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** @deprecated Alias for imports still named PlanModeChip */
export { ExecutionModePicker as PlanModeChip }
