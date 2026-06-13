import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { GitCommit, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useDomainStore } from '@/domain/sessionStore'
import { sessionService } from '@/domain/sessionService'
import { useDiffStore, EMPTY_DIFF } from '@/store/diffStore'
import { useUiStore } from '@/store/uiStore'
import { formatRelativeTime } from '@/lib/datetime'
import { checkpointModeOptions } from '@/lib/checkpointMode'
import { DiffDisplay, Empty } from './DiffDisplay'

const MODE_KEY = { 'this-turn': 'artifact.timelineView.modeThisTurn', 'since-then': 'artifact.timelineView.modeSinceThen', 'since-start': 'artifact.timelineView.modeSinceStart' } as const

export function TimelineView() {
  const { t, i18n } = useTranslation()
  const sessionId = useDomainStore((s) => s.activeSessionId)
  const diff = useDiffStore((s) => (sessionId ? s.bySession[sessionId] : undefined)) ?? EMPTY_DIFF
  const diffViewMode = useUiStore((s) => s.diffViewMode)
  const mode = useUiStore((s) => s.checkpointMode)
  const setMode = useUiStore((s) => s.setCheckpointMode)

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
            <button key={c.id} data-testid="timeline-row"
              onClick={() => useDiffStore.getState().setActiveCheckpoint(sessionId, c.id)}
              className={cn('flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-meta hover:bg-surface-muted', c.id === activeId && 'bg-accent/10')}>
              <span className="min-w-0 truncate text-ink">{label}</span>
              <span className="shrink-0 text-caption text-ink-tertiary">{formatRelativeTime(c.createdAt, i18n.language)}</span>
            </button>
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
    </div>
  )
}
