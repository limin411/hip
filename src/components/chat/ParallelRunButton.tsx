import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch } from 'lucide-react'
import { sessionService, useActiveSession } from '@/domain'
import { surfaceOf } from '@/lib/sessions'
import { suggestParallelCount } from '@/lib/parallelCount'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { toast } from 'sonner'

/**
 * Host fan-out entry: user provides goal; local heuristic suggests track count N.
 * Never use window.prompt — freezes Tauri/WKWebView.
 * Copy: chat.worktreeControl.* (honest host path — not agent-decided).
 * Spec: docs/design/2026-07-18-agent-decided-parallel-count-spec.md
 */
export function ParallelRunButton({ draftPrompt = '' }: { draftPrompt?: string }) {
  const { t } = useTranslation()
  const active = useActiveSession()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')

  const suggestion = useMemo(() => suggestParallelCount(prompt), [prompt])

  if (!active || surfaceOf(active.config) !== 'code' || !active.config.cwd) return null

  const openDialog = () => {
    if (busy) return
    setPrompt(draftPrompt.trim())
    setOpen(true)
  }

  const run = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    const { n } = suggestParallelCount(text)
    setBusy(true)
    try {
      toast.message(
        t('chat.worktreeControl.starting', {
          count: n,
        }),
      )
      const { runId, slotSessionIds } = await sessionService.startParallelRun({
        prompt: text,
        baseCwd: active.config.cwd!,
        count: n,
        permissionMode: active.config.permissionMode,
        hostSessionId: active.id,
        autoSend: false,
      })
      setOpen(false)
      if (slotSessionIds.length === 0) {
        toast.error(t('chat.worktreeControl.noneCreated'))
        return
      }
      toast.success(
        t('chat.worktreeControl.started', {
          count: slotSessionIds.length,
          runId: runId.slice(0, 6),
        }),
      )
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={busy}
        title={t('chat.worktreeControl.buttonTitle')}
        aria-label={t('chat.worktreeControl.buttonTitle')}
        data-testid="parallel-run-button"
        onClick={openDialog}
      >
        <GitBranch size={16} />
      </Button>

      <Modal
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next)
        }}
        title={t('chat.worktreeControl.dialogTitle')}
        footer={
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
              {t('common.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={busy || !prompt.trim()}
              data-testid="parallel-run-confirm"
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
        </div>
      </Modal>
    </>
  )
}
