import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch } from 'lucide-react'
import { sessionService, useActiveSession, useSessions } from '@/domain'
import { surfaceOf } from '@/lib/sessions'
import { suggestParallelCount } from '@/lib/parallelCount'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Textarea } from '@/components/ui/Textarea'
import { toast } from 'sonner'
import { resolveWorktreeHostContext } from '@/lib/worktreeHostContext'
import { useParallelStore } from '@/store/parallelStore'
import { useWorktreeStore } from '@/store/worktreeStore'

export interface ParallelRunButtonProps {
  draftPrompt?: string
  /** When set with onOpenChange, modal is controlled (WorktreeControl embeds the form). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Hide the standalone trigger (default when controlled). */
  hideTrigger?: boolean
  /** Override host resolution for fan-out (from WorktreeControl). */
  hostSessionId?: string
  baseCwd?: string
}

/**
 * Host fan-out entry: user provides goal; local heuristic suggests track count N.
 * Never use window.prompt — freezes Tauri/WKWebView.
 * Copy: chat.worktreeControl.* (honest host path — not agent-decided).
 *
 * Can be embedded by WorktreeControl (controlled open, no trigger) or used standalone.
 */
export function ParallelRunButton({
  draftPrompt = '',
  open: controlledOpen,
  onOpenChange,
  hideTrigger,
  hostSessionId: hostOverride,
  baseCwd: baseCwdOverride,
}: ParallelRunButtonProps) {
  const { t } = useTranslation()
  const active = useActiveSession()
  const sessions = useSessions()
  const runs = useParallelStore((s) => s.runs)
  const catalogById = useWorktreeStore((s) => s.byId)
  const [busy, setBusy] = useState(false)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false)
  const [prompt, setPrompt] = useState('')

  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : uncontrolledOpen
  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChange?.(next)
    else setUncontrolledOpen(next)
  }
  const showTrigger = hideTrigger === true ? false : !isControlled

  // Prefill goal when modal opens (standalone openDialog or controlled embed).
  useEffect(() => {
    if (open) setPrompt(draftPrompt.trim())
    // Only on open transition — don't wipe user edits when draftPrompt changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: open only
  }, [open])

  const suggestion = useMemo(() => suggestParallelCount(prompt), [prompt])

  const resolvedHost = useMemo(() => {
    // WorktreeControl embed: only use explicit host + primary base; never isolated cwd.
    if (hideTrigger || hostOverride !== undefined || baseCwdOverride !== undefined) {
      return {
        hostSessionId: hostOverride || '',
        baseCwd: baseCwdOverride || '',
        unresolved: !hostOverride || !baseCwdOverride,
      }
    }
    const catalog = Object.values(catalogById)
    const ctx = resolveWorktreeHostContext({
      activeSession: active
        ? { id: active.id, config: { cwd: active.config.cwd, surface: active.config.surface } }
        : null,
      sessions: sessions.map((s) => ({ id: s.id, title: s.title, config: { cwd: s.config.cwd } })),
      runs,
      catalog,
    })
    const host = sessions.find((s) => s.id === ctx.hostSessionId)
    // Prefer primaryPath / host session cwd only — never isolated active.cwd as fan-out base.
    const baseCwd =
      ctx.primaryPath ||
      (!ctx.isOnIsolated ? active?.config.cwd : undefined) ||
      host?.config.cwd ||
      ''
    return {
      hostSessionId: ctx.unresolved ? '' : ctx.hostSessionId || active?.id || '',
      baseCwd,
      unresolved: ctx.unresolved || !baseCwd,
    }
  }, [active, sessions, runs, catalogById, hostOverride, baseCwdOverride, hideTrigger])

  if (!active || surfaceOf(active.config) !== 'code' || !active.config.cwd) {
    if (!isControlled) return null
  }

  const openDialog = () => {
    if (busy) return
    setPrompt(draftPrompt.trim())
    setOpen(true)
  }

  const run = async () => {
    const text = prompt.trim()
    if (!text || busy) return
    const { n } = suggestParallelCount(text)
    const hostSessionId = resolvedHost.hostSessionId
    const baseCwd = resolvedHost.baseCwd
    if (!hostSessionId || !baseCwd) {
      toast.error(t('chat.worktreeControl.failed'))
      return
    }
    setBusy(true)
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
      const msg = (err instanceof Error ? err.message : String(err)).trim()
      toast.error(msg || t('chat.worktreeControl.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      {showTrigger ? (
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
      ) : null}

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
