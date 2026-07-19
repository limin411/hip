import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { sessionService, useActiveSession } from '@/domain'
import { suggestParallelCount } from '@/lib/parallelCount'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { toast } from 'sonner'
import { useParallelStore } from '@/store/parallelStore'

export interface WorktreeParallelModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Composer draft — prefilled when the modal opens. */
  draftPrompt?: string
  /** Resolved host for git:worktree ops (never an isolated slot id). */
  hostSessionId: string
  /** Primary/main tree path used as fan-out baseCwd. */
  baseCwd: string
}

/**
 * Parallel explore form (PR5): host fan-out only.
 * - autoSend: false
 * - startParallelRun → waitCreateWorktree({ reveal: false }) per slot (D23/D26)
 * - One summary toast (Modal-owned); no N× effects toasts
 * - D14 focus first ready slot (sessionService.startParallelRun)
 * testids: parallel-run-prompt | parallel-run-suggestion | parallel-run-confirm
 */
export function WorktreeParallelModal({
  open,
  onOpenChange,
  draftPrompt = '',
  hostSessionId,
  baseCwd,
}: WorktreeParallelModalProps) {
  const { t } = useTranslation()
  const active = useActiveSession()
  const [busy, setBusy] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [slotErrors, setSlotErrors] = useState<Array<{ branch: string; error: string }>>([])

  // Prefill goal when modal opens — don't wipe user edits when draftPrompt changes while open.
  useEffect(() => {
    if (open) {
      setPrompt(draftPrompt.trim())
      setSlotErrors([])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: open only
  }, [open])

  const suggestion = useMemo(() => suggestParallelCount(prompt), [prompt])

  const run = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    if (!hostSessionId || !baseCwd) {
      toast.error(t('chat.worktreeControl.failed'))
      return
    }
    const { n } = suggestParallelCount(text)
    setBusy(true)
    setSlotErrors([])
    try {
      toast.message(
        t('chat.worktreeControl.starting', {
          count: n,
        }),
      )
      const { runId, slotSessionIds } = await sessionService.startParallelRun({
        prompt: text,
        baseCwd,
        count: n,
        permissionMode: active?.config.permissionMode,
        hostSessionId,
        autoSend: false,
      })

      const runRec = useParallelStore.getState().runs.find((r) => r.id === runId)
      const errors =
        runRec?.slots
          .filter((s) => s.status === 'error')
          .map((s) => ({
            branch: s.branch || `P${s.index}`,
            error: s.error?.trim() || t('chat.worktreeControl.failed'),
          })) ?? []

      if (slotSessionIds.length === 0) {
        setSlotErrors(errors)
        toast.error(t('chat.worktreeControl.noneCreated'))
        return
      }

      // One summary toast — successes kept; partial failures listed in footer (D23).
      if (errors.length > 0) {
        setSlotErrors(errors)
        toast.success(
          t('chat.worktreeControl.partialStarted', {
            count: slotSessionIds.length,
            failed: errors.length,
            runId: runId.slice(0, 6),
          }),
        )
        // Keep modal open so user can read per-slot errors.
        return
      }

      onOpenChange(false)
      toast.success(
        t('chat.worktreeControl.started', {
          count: slotSessionIds.length,
          runId: runId.slice(0, 6),
        }),
      )
    } catch (err) {
      const msg = (err instanceof Error ? err.message : String(err)).trim()
      toast.error(msg || t('chat.worktreeControl.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!busy) onOpenChange(next)
      }}
      title={t('chat.worktreeControl.dialogTitle')}
      footer={
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('common.cancel', { defaultValue: 'Cancel' })}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy || !prompt.trim() || !hostSessionId || !baseCwd}
            data-testid="parallel-run-confirm"
            aria-busy={busy}
            onClick={() => void run()}
          >
            {busy
              ? t('chat.worktreeControl.creating')
              : t('chat.worktreeControl.confirm', {
                  count: suggestion.n,
                })}
          </Button>
        </div>
      }
    >
      <div className="space-y-3 px-5 py-4">
        <p className="text-meta text-ink-secondary">{t('chat.worktreeControl.dialogHint')}</p>
        <Textarea
          data-testid="parallel-run-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={4}
          disabled={busy}
          placeholder={t('chat.worktreeControl.promptPlaceholder')}
          autoFocus
        />
        <div
          className="rounded-md border border-border bg-surface-muted/50 px-3 py-2 text-meta text-ink-secondary"
          data-testid="parallel-run-suggestion"
          data-suggest-n={suggestion.n}
        >
          <span className="font-medium text-ink">
            {t('chat.worktreeControl.suggests', {
              count: suggestion.n,
            })}
          </span>
          <span className="mt-0.5 block text-ink-tertiary">
            {t(`chat.worktreeControl.reason.${suggestion.reasonCode}`)}
          </span>
        </div>
        {slotErrors.length > 0 ? (
          <div
            className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-meta text-ink"
            data-testid="parallel-run-slot-errors"
            role="status"
          >
            <p className="font-medium text-danger">{t('chat.worktreeControl.partialFooter')}</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-ink-secondary">
              {slotErrors.map((e) => (
                <li key={e.branch}>
                  <span className="font-medium text-ink">{e.branch}</span>
                  {e.error ? ` — ${e.error}` : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </Modal>
  )
}
