import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import { useActiveSession, useActiveSessionId, sessionService } from '@/domain'
import { useFsStore } from '@/store/fsStore'
import { pickProjectGuidanceName, projectGuidancePreview } from '@/lib/projectGuidance'
import { cn } from '@/lib/utils'

/**
 * Shows when the Code session cwd root listing includes AGENTS.md / CLAUDE.md (Sprint B).
 * Quiet when none — no empty chip.
 */
export function ProjectGuidanceChip() {
  const { t } = useTranslation()
  const session = useActiveSession()
  const sessionId = useActiveSessionId()
  const cwd = session?.config.cwd
  const surface = session?.config.surface
  const entries = useFsStore((s) =>
    sessionId ? s.bySession[sessionId]?.entriesByDir['/'] : undefined,
  )
  const previewState = useFsStore((s) =>
    sessionId ? s.bySession[sessionId]?.preview : undefined,
  )
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!sessionId || surface === 'chat' || !cwd) return
    if (!entries) sessionService.lsDir(sessionId, '/')
  }, [sessionId, surface, cwd, entries])

  if (!sessionId || surface === 'chat' || !cwd) return null

  const names = (entries ?? []).map((e) => e.name)
  const guidance = pickProjectGuidanceName(names)
  if (!guidance) return null

  const previewReady =
    previewState?.status === 'ready' &&
    previewState.path === `/${guidance}` &&
    previewState.content
      ? projectGuidancePreview(previewState.content)
      : null

  return (
    <div className="relative" data-testid="project-guidance-chip">
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-border bg-surface-muted px-2 py-0.5 text-caption text-ink-secondary hover:bg-border/60',
        )}
        title={t('chat.projectGuidanceLoaded', { name: guidance })}
        onClick={() => {
          setOpen((v) => !v)
          if (!previewReady) sessionService.readFile(sessionId, `/${guidance}`)
        }}
      >
        <BookOpen size={12} aria-hidden />
        {t('chat.projectGuidanceChip', { name: guidance })}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-md border border-border bg-surface p-2 text-meta text-ink-secondary shadow-md">
          <div className="font-medium text-ink">{guidance}</div>
          <p className="mt-1 text-ink-tertiary">{t('chat.projectGuidanceHint')}</p>
          {previewReady ? (
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-surface-muted p-2 text-caption">
              {previewReady}
            </pre>
          ) : (
            <p className="mt-2 text-caption text-ink-tertiary">{t('chat.projectGuidanceLoading')}</p>
          )}
        </div>
      )}
    </div>
  )
}
