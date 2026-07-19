import { useTranslation } from 'react-i18next'
import type { PermissionOption } from '@hip/protocol'
import { sessionService, useActiveSessionId, useActivePendingPermission } from '@/domain'
import { useDomainStore } from '@/domain/sessionStore'
import { Button } from '@/components/ui/Button'
import { resolvePermissionOptionLabel } from '@/lib/worktreeHitlLabels'

const REJECT_PREFIX = 'reject'

/** Allow options first, then reject options, each preserving the agent's advertised order. */
function orderOptions(options: PermissionOption[]): PermissionOption[] {
  const allow = options.filter((o) => !o.kind.startsWith(REJECT_PREFIX))
  const reject = options.filter((o) => o.kind.startsWith(REJECT_PREFIX))
  return [...allow, ...reject]
}

/**
 * HITL tool-permission prompt (ACP agents). When the active session has a `pendingPermission`,
 * an inline panel above the composer shows the gated tool and one button per advertised option.
 * Non-modal: other sessions and chrome stay usable; only this session's turn waits on the choice.
 * Picking an option forwards it to the agent and clears the local queue so the blocked tool proceeds.
 *
 * For `parallel_worktrees`, button labels are rewritten from optionId (n1–n4, reject) via
 * `chat.worktreeControl.hitlOption.*` so EN/zh-TW are not stuck on sidecar CN fallbacks (D19).
 */
export function PermissionModal() {
  const { t } = useTranslation()
  const sessionId = useActiveSessionId()
  const pending = useActivePendingPermission()
  const clearPermission = useDomainStore((s) => s.clearPermission)

  if (!sessionId || !pending) return null
  const { requestId, tool, options, agentFrame } = pending

  const respond = (choice: { optionId: string } | { cancelled: true }) => {
    sessionService.respondPermission(sessionId, requestId, choice)
    clearPermission(requestId)
  }

  return (
    <div
      className="shrink-0 border-t border-border bg-surface px-4 py-3"
      data-testid="permission-prompt-slot"
    >
      <div
        className="flex flex-col gap-3 rounded-lg border border-accent/30 bg-accent-subtle px-4 py-3"
        data-testid="permission-modal"
        role="region"
        aria-label={t('chat.permission.title')}
      >
        <div className="flex flex-col gap-1">
          <p className="text-body font-medium text-ink">{t('chat.permission.title')}</p>
          <p className="text-meta text-ink-secondary">{t('chat.permission.intro')}</p>
          {agentFrame && (
            <p className="text-meta text-ink-tertiary" data-testid="permission-subagent">
              {t('chat.permission.fromSubagent', { name: agentFrame.name })}
            </p>
          )}
        </div>
        <div className="rounded-md border border-border bg-surface px-3 py-2">
          <p className="text-body font-medium text-ink">{tool.title}</p>
          <p className="mt-0.5 text-meta uppercase tracking-wide text-ink-tertiary">{tool.kind}</p>
        </div>
        {tool.diff && (
          <div className="rounded-md border border-border bg-surface">
            <p className="border-b border-border px-3 py-1.5 text-meta font-medium text-ink-secondary">{tool.diff.path}</p>
            <pre className="max-h-48 overflow-auto px-3 py-2 text-meta">
              <code>
                {tool.diff.oldText && <span className="text-danger">{tool.diff.oldText}</span>}
                {tool.diff.newText && <span className="text-success">{tool.diff.newText}</span>}
              </code>
            </pre>
          </div>
        )}
        {tool.content && !tool.diff && (
          <pre className="max-h-48 overflow-auto rounded-md border border-border bg-surface px-3 py-2 text-meta">
            <code>{tool.content}</code>
          </pre>
        )}
        <div className="flex flex-wrap gap-2">
          {orderOptions(options).map((o) => {
            const isReject = o.kind.startsWith(REJECT_PREFIX)
            const label = resolvePermissionOptionLabel(o, tool.kind, t)
            return (
              <Button
                key={o.optionId}
                size="sm"
                variant={isReject ? 'outline' : 'primary'}
                onClick={() => respond({ optionId: o.optionId })}
                data-testid={`permission-option-${o.optionId}`}
              >
                {label}
              </Button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
