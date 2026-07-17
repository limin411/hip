import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitBranch, Loader2 } from 'lucide-react'
import { sessionService, useActiveSession, useActiveSessionId } from '@/domain'
import { useDraftStore } from '@/store/draftStore'
import { clampParallelCount } from '@/store/parallelStore'
import { surfaceOf } from '@/lib/sessions'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

/**
 * Code-surface control: fan out the composer prompt across N git worktrees.
 * Requires a project cwd (active code session or draft with folder).
 */
export function ParallelRunChip({
  prompt,
  onStarted,
}: {
  prompt: string
  onStarted?: () => void
}) {
  const { t } = useTranslation()
  const [n, setN] = useState(2)
  const [busy, setBusy] = useState(false)
  const active = useActiveSession()
  const activeId = useActiveSessionId()
  const draft = useDraftStore((s) => s.draft)

  const isCode = active
    ? surfaceOf(active.config) === 'code'
    : draft?.mode === 'project'
  const cwd =
    (active && surfaceOf(active.config) === 'code' ? active.config.cwd : undefined) ||
    (draft?.mode === 'project' ? draft.cwd : undefined)
  const permissionMode =
    (active && surfaceOf(active.config) === 'code' ? active.config.permissionMode : undefined) ||
    draft?.permissionMode ||
    'edit'

  if (!isCode) return null

  const disabled = busy || !cwd || !prompt.trim()

  const run = async () => {
    if (disabled || !cwd) return
    setBusy(true)
    try {
      const count = clampParallelCount(n)
      const { slotSessionIds } = await sessionService.startParallelRun({
        prompt,
        baseCwd: cwd,
        count,
        permissionMode: permissionMode === 'chat' || permissionMode === 'full' ? permissionMode : 'edit',
      })
      if (slotSessionIds.length === 0) {
        toast.error(t('chat.parallel.failed'))
      } else {
        toast.success(t('chat.parallel.started', { count: slotSessionIds.length }))
        onStarted?.()
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('chat.parallel.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md border border-border bg-surface-muted/40"
      data-testid="parallel-run-chip"
      title={cwd ? t('chat.parallel.tooltip') : t('chat.parallel.needCwd')}
    >
      <label className="sr-only" htmlFor="parallel-count">
        {t('chat.parallel.countLabel')}
      </label>
      <select
        id="parallel-count"
        data-testid="parallel-run-count"
        value={n}
        disabled={busy}
        onChange={(e) => setN(Number(e.target.value))}
        className="h-7 rounded-l-md border-0 bg-transparent pl-1.5 pr-0.5 text-caption text-ink focus:outline-none focus:ring-0"
      >
        {[2, 3, 4].map((v) => (
          <option key={v} value={v}>
            ×{v}
          </option>
        ))}
      </select>
      <button
        type="button"
        data-testid="parallel-run-go"
        disabled={disabled}
        onClick={() => void run()}
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-r-md px-2 text-caption font-medium transition-colors',
          disabled
            ? 'cursor-not-allowed text-ink-tertiary'
            : 'text-ink hover:bg-state-hover',
        )}
      >
        {busy ? <Loader2 size={12} className="animate-spin" /> : <GitBranch size={12} />}
        <span>{t('chat.parallel.action')}</span>
      </button>
      {/* keep activeId referenced so eslint/hooks don't warn when only draft is used */}
      <span className="hidden" aria-hidden>
        {activeId}
      </span>
    </div>
  )
}
