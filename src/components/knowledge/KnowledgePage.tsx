import { useEffect } from 'react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton'
import { KnowledgeWorkspace } from './KnowledgeWorkspace'

export function KnowledgePage() {
  const error = useKnowledgeStore((s) => s.error)
  const loaded = useKnowledgeStore((s) => s.loaded)
  const loadSpaces = useKnowledgeStore((s) => s.loadSpaces)

  useEffect(() => {
    if (!loaded) void loadSpaces()
  }, [loaded, loadSpaces])

  // Prefetch Live (BlockNote) chunk while on knowledge surface (idle).
  useEffect(() => {
    const run = () => {
      void import('./DocBlockNoteEditor').catch(() => {})
    }
    if (typeof requestIdleCallback === 'function') {
      const id = requestIdleCallback(run, { timeout: 2000 })
      return () => cancelIdleCallback(id)
    }
    const t = window.setTimeout(run, 200)
    return () => window.clearTimeout(t)
  }, [])

  // Tier B: best-effort flush when leaving knowledge surface entirely.
  useEffect(() => {
    return () => {
      void useKnowledgeStore.getState().flushSave()
    }
  }, [])

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="knowledge-page">
      {error && (
        <div
          className="shrink-0 border-b border-danger/30 bg-danger/10 px-4 py-2 text-body text-danger"
          data-testid="knowledge-error"
        >
          {error}
        </div>
      )}
      {loaded ? (
        <KnowledgeWorkspace />
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center bg-surface-content px-8"
          data-testid="knowledge-loading"
        >
          <div className="w-full max-w-sm space-y-3">
            <Skeleton className="mx-auto h-8 w-8 rounded-lg" />
            <SkeletonText lines={3} className="items-center" />
          </div>
        </div>
      )}
    </div>
  )
}
