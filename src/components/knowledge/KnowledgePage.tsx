import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen } from 'lucide-react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import { openCreateKnowledgeSpaceDialog } from './knowledgeSpaceDialogStore'
import { EmptyState } from '@/components/ui/EmptyState'
import { Skeleton, SkeletonText } from '@/components/ui/Skeleton'
import { KnowledgeWorkspace } from './KnowledgeWorkspace'

export function KnowledgePage() {
  const { t } = useTranslation()
  const mode = useKnowledgeStore((s) => s.mode)
  const error = useKnowledgeStore((s) => s.error)
  const loaded = useKnowledgeStore((s) => s.loaded)
  const spaces = useKnowledgeStore((s) => s.spaces)
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
      {mode === 'workspace' ? (
        <KnowledgeWorkspace />
      ) : !loaded ? (
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center bg-surface px-8"
          data-testid="knowledge-loading"
        >
          <div className="w-full max-w-sm space-y-3">
            <Skeleton className="mx-auto h-8 w-8 rounded-lg" />
            <SkeletonText lines={3} className="items-center" />
          </div>
        </div>
      ) : (
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center bg-surface px-8"
          data-testid="knowledge-empty"
        >
          <EmptyState
            tier="friendly"
            title={
              spaces.length === 0
                ? t('knowledge.home.emptyTitle')
                : t('knowledge.empty.selectTitle')
            }
            description={
              spaces.length === 0
                ? t('knowledge.home.emptyHint')
                : t('knowledge.empty.selectHint')
            }
            action={
              spaces.length === 0
                ? {
                    label: t('sidebar.newSpace'),
                    onClick: () => openCreateKnowledgeSpaceDialog(),
                  }
                : undefined
            }
            className="border-0 py-16"
          >
            <BookOpen size={32} className="text-accent-strong" strokeWidth={1.5} />
          </EmptyState>
        </div>
      )}
    </div>
  )
}
