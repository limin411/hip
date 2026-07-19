import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import {
  knowledgeLinkIndexGraph,
  type KnowledgeGraphPayload,
} from '@/ipc/knowledge'
import {
  GRAPH_FULL_CONFIRM_THRESHOLD,
  layoutGraph,
  neighborhoodSubgraph,
} from '@/domain/knowledge/graphLayout'
import { cn } from '@/lib/utils'

const GraphCanvas = lazy(() =>
  import('./KnowledgeGraphCanvas').then((m) => ({ default: m.KnowledgeGraphCanvas })),
)

export interface KnowledgeGraphModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  spaceId: string
  focusDocId: string | null
  onOpenDoc: (docId: string) => void
}

export function KnowledgeGraphModal({
  open,
  onOpenChange,
  spaceId,
  focusDocId,
  onOpenDoc,
}: KnowledgeGraphModalProps) {
  const { t } = useTranslation()
  const [raw, setRaw] = useState<KnowledgeGraphPayload | null>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [mode, setMode] = useState<'neighborhood' | 'full'>('neighborhood')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !spaceId) return
    let cancelled = false
    setStatus('loading')
    setError(null)
    void knowledgeLinkIndexGraph(spaceId)
      .then((g) => {
        if (cancelled) return
        setRaw(g)
        setStatus('ready')
        // Auto neighborhood when large
        if (g.nodes.length > GRAPH_FULL_CONFIRM_THRESHOLD) {
          setMode('neighborhood')
        }
      })
      .catch((e) => {
        if (cancelled) return
        setError(e instanceof Error ? e.message : String(e))
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [open, spaceId])

  const view = useMemo(() => {
    if (!raw) return { nodes: [], edges: [] as KnowledgeGraphPayload['edges'] }
    if (mode === 'full' || !focusDocId) {
      return raw
    }
    return neighborhoodSubgraph(focusDocId, raw.nodes, raw.edges)
  }, [raw, mode, focusDocId])

  const laid = useMemo(
    () => layoutGraph(view.nodes, view.edges, focusDocId),
    [view, focusDocId],
  )

  const requestFull = useCallback(() => {
    const n = raw?.nodes.length ?? 0
    if (n > GRAPH_FULL_CONFIRM_THRESHOLD) {
      const ok = window.confirm(
        t('knowledge.graph.fullConfirm', { count: n, threshold: GRAPH_FULL_CONFIRM_THRESHOLD }),
      )
      if (!ok) return
    }
    setMode('full')
  }, [raw, t])

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('knowledge.graph.title')}
      className="max-w-4xl w-[min(96vw,56rem)]"
      resizable
      defaultSize={{ width: 900, height: 640 }}
      storageKey="hip-knowledge-graph-modal"
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={mode === 'neighborhood' ? 'primary' : 'outline'}
            data-testid="knowledge-graph-mode-neighborhood"
            onClick={() => setMode('neighborhood')}
            disabled={!focusDocId}
          >
            {t('knowledge.graph.neighborhood')}
          </Button>
          <Button
            size="sm"
            variant={mode === 'full' ? 'primary' : 'outline'}
            data-testid="knowledge-graph-mode-full"
            onClick={requestFull}
          >
            {t('knowledge.graph.full')}
          </Button>
          <span className="text-meta text-ink-tertiary">
            {t('knowledge.graph.stats', {
              nodes: view.nodes.length,
              edges: view.edges.length,
              total: raw?.nodes.length ?? 0,
            })}
          </span>
        </div>

        {status === 'loading' || status === 'idle' ? (
          <div
            className="flex h-[420px] items-center justify-center text-meta text-ink-tertiary"
            data-testid="knowledge-graph-loading"
          >
            {t('knowledge.graph.loading')}
          </div>
        ) : status === 'error' ? (
          <div className="text-meta text-danger" data-testid="knowledge-graph-error">
            {error ?? t('knowledge.graph.error')}
          </div>
        ) : view.nodes.length === 0 ? (
          <div
            className="flex h-[420px] items-center justify-center text-meta text-ink-tertiary"
            data-testid="knowledge-graph-empty"
          >
            {t('knowledge.graph.empty')}
          </div>
        ) : (
          <div
            className={cn('h-[420px] overflow-hidden rounded-lg border border-border')}
            data-testid="knowledge-graph-canvas-host"
          >
            <Suspense
              fallback={
                <div className="flex h-full items-center justify-center text-meta text-ink-tertiary">
                  {t('knowledge.graph.loading')}
                </div>
              }
            >
              <GraphCanvas
                nodes={laid.nodes}
                edges={laid.edges}
                focusDocId={focusDocId}
                onOpenDoc={(id) => {
                  onOpenDoc(id)
                  onOpenChange(false)
                }}
              />
            </Suspense>
          </div>
        )}
      </div>
    </Modal>
  )
}
