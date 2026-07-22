import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitCommit, Loader2, RotateCcw, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { useUiStore } from '@/store/uiStore'
import { formatRelativeTime } from '@/lib/datetime'
import { checkpointModeOptions } from '@/lib/checkpointMode'
import { DiffDisplay, Empty } from './DiffDisplay'
import { bindCheckpointRevertOpener } from './checkpointRevertUi'
import { DeclarativeContextMenu } from '@/components/context-menu'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { SegmentedControl } from '@/components/ui/SegmentedControl'

const MODE_KEY = { 'this-turn': 'artifact.timelineView.modeThisTurn', 'since-then': 'artifact.timelineView.modeSinceThen', 'since-start': 'artifact.timelineView.modeSinceStart' } as const

export function TimelineView() {
  const { t, i18n } = useTranslation()
  const sessionId = useDomainStore((s) => s.activeSessionId)
  const sessionStatus = useDomainStore((s) => {
    if (!s.activeSessionId) return 'idle' as const
    return s.sessions.find((x) => x.id === s.activeSessionId)?.status ?? 'idle'
  })
  const cwd = useDomainStore((s) => {
    if (!s.activeSessionId) return null
    return s.sessions.find((x) => x.id === s.activeSessionId)?.config.cwd ?? null
  })
  const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF
  const diffViewMode = useUiStore((s) => s.diffViewMode)
  const mode = useUiStore((s) => s.checkpointMode)
  const setMode = useUiStore((s) => s.setCheckpointMode)

  const [revertTarget, setRevertTarget] = useState<string | null>(null) // checkpointId awaiting confirm
  const [reverting, setReverting] = useState(false)

  // Close on successful git:revert:result (not on checkpoints.length — length can stay the same).
  useEffect(() => {
    if (!reverting || !revertTarget || !diff.lastRevertResult) return
    if (diff.lastRevertResult.checkpointId !== revertTarget) return
    if (diff.lastRevertResult.ok) {
      setReverting(false)
      setRevertTarget(null)
      toast.message(t('artifact.timelineView.revertSuccess'))
    }
  }, [reverting, revertTarget, diff.lastRevertResult, t])

  // On a FAILED revert the service records revertError → clear the spinner so the modal is no longer
  // stuck; the error stays visible until the user dismisses or retries.
  useEffect(() => {
    if (reverting && diff.revertError) setReverting(false)
  }, [reverting, diff.revertError])

  // Reset all transient confirm state. ALWAYS reachable (Cancel / ESC / overlay / X) so a failed or
  // hung revert can never brick the modal.
  const closeRevert = useCallback(() => {
    setRevertTarget(null)
    setReverting(false)
    if (sessionId) {
      useDiffStore.getState().setRevertError(sessionId, null)
      useDiffStore.getState().setLastRevertResult(sessionId, null)
    }
  }, [sessionId])

  const openRevert = useCallback((checkpointId: string) => {
    if (sessionStatus === 'running') {
      toast.message(t('artifact.timelineView.revertBlockedRunning'))
      return
    }
    if (sessionId) {
      useDiffStore.getState().setRevertError(sessionId, null)
      useDiffStore.getState().setLastRevertResult(sessionId, null)
    }
    setRevertTarget(checkpointId)
  }, [sessionId, sessionStatus, t])

  // Context-menu Revert… reuses this modal (no second domain path).
  useEffect(() => {
    bindCheckpointRevertOpener(openRevert)
    return () => bindCheckpointRevertOpener(null)
  }, [openRevert])

  // Mount === tab activation (Radix unmounts inactive tabs). Pull the list.
  useEffect(() => { if (sessionId) sessionService.requestCheckpoints(sessionId) }, [sessionId])

  const active = diff.checkpoints.find((c) => c.id === diff.activeCheckpointId) ?? diff.checkpoints[0]
  const activeId = active?.id ?? null

  // The active checkpoint may not offer the current mode (#0 has no 'this-turn') → fall back.
  const options = active ? checkpointModeOptions(active) : []
  const effectiveMode = active && options.includes(mode) ? mode : options[0]

  // Fetch the active checkpoint's diff for the effective mode (cache-aware: only when missing).
  useEffect(() => {
    if (!sessionId || !activeId || !effectiveMode) return
    const key = `${activeId}|${effectiveMode}`
    if (!diff.checkpointDiff[key]) sessionService.requestCheckpointDiff(sessionId, activeId, effectiveMode)
  }, [sessionId, activeId, effectiveMode, diff.checkpointDiff])

  if (!sessionId) return <Empty title={t('artifact.diffView.noSession')} desc={t('artifact.diffView.noSessionDesc')} />
  if (diff.checkpoints.length === 0) return <Empty icon={<GitCommit size={24} />} title={t('artifact.timelineView.empty')} desc={t('artifact.timelineView.emptyDesc')} />

  const key = activeId && effectiveMode ? `${activeId}|${effectiveMode}` : ''
  const cur = key ? diff.checkpointDiff[key] : undefined

  return (
    <div className="flex h-full flex-col" data-testid="timeline-view">
      {/* checkpoint list */}
      <div className="max-h-[40%] shrink-0 overflow-y-auto border-b border-border">
        {diff.checkpoints.map((c, idx) => {
          const turnNo = diff.checkpoints.length - 1 - idx // oldest = #0; list is newest-first
          const label = c.kind === 'start' ? t('artifact.timelineView.sessionStart') : (c.label || t('artifact.timelineView.turn', { n: turnNo }))
          return (
            <DeclarativeContextMenu
              key={c.id}
              kind="checkpoint"
              payload={{ checkpointId: c.id, sessionId }}
              className={cn('flex w-full items-center gap-1 px-3 py-1.5 hover:bg-state-hover', c.id === activeId && 'bg-accent/10')}
              data-testid="timeline-row"
            >
              <button
                onClick={() => useDiffStore.getState().setActiveCheckpoint(sessionId, c.id)}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-meta"
              >
                <span className="min-w-0 truncate text-ink">{label}</span>
                <span className="shrink-0 text-caption text-ink-tertiary">{formatRelativeTime(c.createdAt, i18n.language)}</span>
              </button>
              <button
                data-testid="timeline-revert"
                title={sessionStatus === 'running' ? t('artifact.timelineView.revertBlockedRunning') : t('artifact.timelineView.revert')}
                onClick={() => openRevert(c.id)}
                className="shrink-0 rounded p-1 text-ink-tertiary hover:bg-surface hover:text-ink"
              >
                <RotateCcw size={13} />
              </button>
            </DeclarativeContextMenu>
          )
        })}
      </div>
      {/* mode toggle */}
      {options.length > 0 && effectiveMode && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
          <SegmentedControl
            data-testid="timeline-mode-toggle"
            aria-label={t('artifact.timelineView.modeThisTurn')}
            size="sm"
            value={effectiveMode}
            onChange={setMode}
            options={options.map((m) => ({ value: m, label: t(MODE_KEY[m]) }))}
          />
        </div>
      )}
      {/* diff */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!cur || cur.status === 'loading' ? (
          <div className="flex h-full items-center justify-center text-ink-tertiary"><Loader2 size={16} className="animate-spin" /></div>
        ) : (cur.files?.length ?? 0) === 0 ? (
          <Empty title={t('artifact.timelineView.noChange')} />
        ) : (
          <DiffDisplay
            files={cur.files!}
            summary={cur.summary}
            viewMode={diffViewMode}
            collapsed={diff.collapsed}
            sessionId={sessionId}
            cwd={cwd}
            onToggleCollapse={(p) => useDiffStore.getState().toggleCollapsed(sessionId, p)}
          />
        )}
      </div>

      {/* revert confirm */}
      {(() => {
        const target = diff.checkpoints.find((c) => c.id === revertTarget)
        const crossBranch = !!target && !!target.branch && !!diff.currentBranch && target.branch !== diff.currentBranch
        return (
          <Modal open={!!revertTarget} onOpenChange={(o) => { if (!o) closeRevert() }} title={t('artifact.timelineView.revertConfirmTitle')}>
            <div className="flex flex-col gap-4 p-5">
              <p className="text-body text-ink-secondary">{t('artifact.timelineView.revertConfirmBody')}</p>
              {crossBranch && (
                <div data-testid="timeline-revert-cross-branch" className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-meta text-ink">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
                  <span>{t('artifact.timelineView.crossBranchWarn', { branch: target!.branch ?? '' })}</span>
                </div>
              )}
              {diff.revertError && (
                <div data-testid="timeline-revert-error" className="flex items-start gap-2 rounded border border-danger/40 bg-danger/10 p-2 text-meta text-ink">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" />
                  <span className="min-w-0 break-words">{t('artifact.timelineView.revertFailed')}{diff.revertError ? `: ${diff.revertError}` : ''}</span>
                </div>
              )}
              <div className="flex justify-end gap-2">
                {/* Cancel is ALWAYS enabled so a failed/hung revert can be backed out of. */}
                <Button variant="ghost" size="sm" data-testid="timeline-revert-cancel" onClick={closeRevert}>{t('common.cancel')}</Button>
                <Button
                  size="sm"
                  disabled={reverting || sessionStatus === 'running'}
                  data-testid="timeline-revert-confirm"
                  onClick={() => {
                    if (!revertTarget || !sessionId) return
                    useDiffStore.getState().setRevertError(sessionId, null)
                    useDiffStore.getState().setLastRevertResult(sessionId, null)
                    setReverting(true)
                    sessionService.revertCheckpoint(sessionId, revertTarget)
                  }}
                >
                  {reverting && <Loader2 size={13} className="mr-1.5 animate-spin" />}
                  {reverting ? t('artifact.timelineView.reverting') : (diff.revertError ? t('artifact.timelineView.revertRetry') : t('artifact.timelineView.revertConfirmAction'))}
                </Button>
              </div>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}
