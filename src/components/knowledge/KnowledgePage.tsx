import { useEffect } from 'react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { KnowledgeHome } from './KnowledgeHome'
import { KnowledgeWorkspace } from './KnowledgeWorkspace'

export function KnowledgePage() {
  const mode = useKnowledgeStore((s) => s.mode)
  const error = useKnowledgeStore((s) => s.error)
  const loaded = useKnowledgeStore((s) => s.loaded)
  const loadSpaces = useKnowledgeStore((s) => s.loadSpaces)

  useEffect(() => {
    if (!loaded) void loadSpaces()
  }, [loaded, loadSpaces])

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
      {mode === 'workspace' ? <KnowledgeWorkspace /> : <KnowledgeHome />}
    </div>
  )
}
