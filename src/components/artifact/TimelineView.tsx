import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { GitCommit, Loader2, RotateCcw, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { useUiStore } from '@/store/uiStore'
import { formatRelativeTime } from '@/lib/datetime'
import { checkpointModeOptions } from '@/lib/checkpointMode'
import { DiffDisplay, Empty } from './DiffDisplay'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'

const MODE_KEY = { 'this-turn': 'artifact.timelineView.modeThisTurn', 'since-then': 'artifact.timelineView.modeSinceThen', 'since-start': 'artifact.timelineView.modeSinceStart' } as const

export function TimelineView() {
  const { t, i18n } = useTranslation()
  const sessionId = useDomainStore((s) => s.activeSessionId)
  const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF
  const diffViewMode = useUiStore((s) => s.diffViewMode)
  const mode = useUiStore((s) => s.checkpointMode)
  const setMode = useUiStore((s) => s.setCheckpointMode)

  const [revertTarget, setRevertTarget] = useState<string | null>(null) // checkpointId awaiting confirm
  const [reverting, setReverting] = useState(false)
  // Clear the modal once a revert round-trips (the checkpoint list refreshes with a new safety checkpoint).
  useEffect(() => { if (reverting) { setReverting(false); setRevertTarget(null) } }, [diff.checkpoints.length]) // eslint-disable-line react-hooks/exhaustive-deps

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
            <div key={c.id} data-testid="timeline-row" className={cn('flex w-full items-center gap-1 px-3 py-1.5 hover:bg-surface-muted', c.id === activeId && 'bg-accent/10')}>
              <button
                onClick={() => useDiffStore.getState().setActiveCheckpoint(sessionId, c.id)}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left text-meta"
              >
                <span className="min-w-0 truncate text-ink">{label}</span>
                <span className="shrink-0 text-caption text-ink-tertiary">{formatRelativeTime(c.createdAt, i18n.language)}</span>
              </button>
              <button
                data-testid="timeline-revert"
                title={t('artifact.timelineView.revert')}
                onClick={() => setRevertTarget(c.id)}
                className="shrink-0 rounded p-1 text-ink-tertiary hover:bg-surface hover:text-ink"
              >
                <RotateCcw size={13} />
              </button>
            </div>
          )
        })}
      </div>
      {/* mode toggle */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border px-2">
        <div className="inline-flex overflow-hidden rounded border border-border text-caption" data-testid="timeline-mode-toggle">
          {options.map((m) => (
            <button key={m} onClick={() => setMode(m)}
              className={cn('px-2 py-0.5', m === effectiveMode ? 'bg-accent/15 text-accent' : 'text-ink-tertiary hover:text-ink')}>
              {t(MODE_KEY[m])}
            </button>
          ))}
        </div>
      </div>
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
            onToggleCollapse={() => {}}
          />
        )}
      </div>

      {/* revert confirm */}
      {(() => {
        const target = diff.checkpoints.find((c) => c.id === revertTarget)
        const crossBranch = !!target && !!target.branch && !!diff.currentBranch && target.branch !== diff.currentBranch
        return (
          <Modal open={!!revertTarget} onOpenChange={(o) => { if (!o && !reverting) setRevertTarget(null) }} title={t('artifact.timelineView.revertConfirmTitle')}>
            <div className="flex flex-col gap-4 p-5">
              <p className="text-body text-ink-secondary">{t('artifact.timelineView.revertConfirmBody')}</p>
              {crossBranch && (
                <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2 text-meta text-ink">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
                  <span>{t('artifact.timelineView.crossBranchWarn', { branch: target!.branch ?? '' })}</span>
                </div>
              )}
              <div className="flex justify-end gap-2">
                <Button variant="secondary" size="sm" disabled={reverting} onClick={() => setRevertTarget(null)}>{t('common.cancel')}</Button>
                <Button
                  size="sm"
                  disabled={reverting}
                  data-testid="timeline-revert-confirm"
                  onClick={() => { if (revertTarget) { setReverting(true); sessionService.revertCheckpoint(sessionId, revertTarget) } }}
                >
                  {reverting && <Loader2 size={13} className="mr-1.5 animate-spin" />}
                  {reverting ? t('artifact.timelineView.reverting') : t('artifact.timelineView.revertConfirmAction')}
                </Button>
              </div>
            </div>
          </Modal>
        )
      })()}
    </div>
  )
}
