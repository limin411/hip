import { useTranslation } from 'react-i18next'
import type { PermissionOption } from '@hip/protocol'
import { sessionService, useActiveSessionId, useActivePendingPermission } from '@/domain'
import { useDomainStore } from '@/domain/sessionStore'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

const REJECT_PREFIX = 'reject'

/** Allow options first, then reject options, each preserving the agent's advertised order. */
function orderOptions(options: PermissionOption[]): PermissionOption[] {
  const allow = options.filter((o) => !o.kind.startsWith(REJECT_PREFIX))
  const reject = options.filter((o) => o.kind.startsWith(REJECT_PREFIX))
  return [...allow, ...reject]
}

/**
 * HITL tool-permission modal (ACP agents). When the active session has a `pendingPermission`,
 * a standalone modal (mounted at the chat root — no Radix menu wrapper, so no `modal={false}`
 * pointer-events footgun) shows the gated tool and one button per advertised option. Picking an
 * option forwards the choice to the agent and clears the local queue so the blocked tool proceeds;
 * closing/dismissing the modal denies with a cancellation.
 */
export function PermissionModal() {
  const { t } = useTranslation()
  const sessionId = useActiveSessionId()
  const pending = useActivePendingPermission()
  const clearPermission = useDomainStore((s) => s.clearPermission)

  if (!sessionId || !pending) return null
  const { requestId, tool, options } = pending

  const respond = (choice: { optionId: string } | { cancelled: true }) => {
    sessionService.respondPermission(sessionId, requestId, choice)
    clearPermission(requestId)
  }

  return (
    <Modal
      open
      onOpenChange={(open) => { if (!open) respond({ cancelled: true }) }}
      title={t('chat.permission.title')}
    >
      <div className="flex flex-col gap-4 px-5 py-4" data-testid="permission-modal">
        <p className="text-body text-ink-secondary">{t('chat.permission.intro')}</p>
        <div className="rounded-md border border-border bg-surface-muted px-3 py-2">
          <p className="text-body font-medium text-ink">{tool.title}</p>
          <p className="mt-0.5 text-meta uppercase tracking-wide text-ink-tertiary">{tool.kind}</p>
        </div>
        {tool.diff && (
          <div className="rounded-md border border-border bg-surface">
            <p className="border-b border-border px-3 py-1.5 text-meta font-medium text-ink-secondary">{tool.diff.path}</p>
            <pre className="max-h-64 overflow-auto px-3 py-2 text-meta">
              <code>
                {tool.diff.oldText && <span className="text-danger">{tool.diff.oldText}</span>}
                {tool.diff.newText && <span className="text-success">{tool.diff.newText}</span>}
              </code>
            </pre>
          </div>
        )}
        {tool.content && !tool.diff && (
          <pre className="max-h-64 overflow-auto rounded-md border border-border bg-surface px-3 py-2 text-meta">
            <code>{tool.content}</code>
          </pre>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {orderOptions(options).map((o) => {
            const isReject = o.kind.startsWith(REJECT_PREFIX)
            return (
              <Button
                key={o.optionId}
                size="sm"
                variant={isReject ? 'outline' : 'primary'}
                onClick={() => respond({ optionId: o.optionId })}
                data-testid={`permission-option-${o.optionId}`}
              >
                {o.name}
              </Button>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
