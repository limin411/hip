import { forwardRef, useImperativeHandle } from 'react'
import { useTranslation } from 'react-i18next'
import { PencilRuler } from 'lucide-react'

/** flushToStore modes (KD-13). Full Excalidraw wiring lands in PR-4. */
export type BoardFlushMode = 'snapshot' | 'leave'

export type FlushToStoreOpts = {
  /**
   * snapshot (default): stay on this board after the structural op.
   * leave: active leaf will change or be destroyed after flush.
   */
  mode?: BoardFlushMode
}

export type KnowledgeBoardCanvasHandle = {
  /**
   * 100% synchronous. mode 'leave' drops pending imports + toast (PR-4);
   * mode 'snapshot' (default) keeps queue. Always setDraftBody dehydrated persist none.
   */
  flushToStore: (opts?: FlushToStoreOpts) => void
  exportPngBlob: () => Promise<Blob | null>
}

export type KnowledgeBoardCanvasProps = {
  boardId: string
  spaceId: string
  /** Dehydrated scene JSON from store (draftBody || docBody). */
  initialJson: string
}

/**
 * PR-3 placeholder shell for whiteboard leaves.
 * Does NOT load @excalidraw/excalidraw — real engine mounts in PR-4.
 * Exposes flushToStore so Workspace dispatcher (KD-9) can route board flushes.
 */
export const KnowledgeBoardCanvas = forwardRef<
  KnowledgeBoardCanvasHandle,
  KnowledgeBoardCanvasProps
>(function KnowledgeBoardCanvas({ boardId, spaceId, initialJson }, ref) {
  const { t } = useTranslation()

  useImperativeHandle(
    ref,
    () => ({
      // Placeholder: draft already holds dehydrated JSON from openDoc; no engine buffer yet.
      flushToStore: (_opts?: FlushToStoreOpts) => {
        // no-op until PR-4 wires elements/appState refs → setDraftBody
      },
      exportPngBlob: async () => null,
    }),
    [],
  )

  const preview =
    initialJson.trim().length > 0
      ? initialJson.length > 2400
        ? `${initialJson.slice(0, 2400)}\n…`
        : initialJson
      : ''

  return (
    <div
      className="flex h-full min-h-0 w-full flex-1 flex-col bg-surface"
      data-testid="knowledge-board-canvas"
      data-board-id={boardId}
      data-space-id={spaceId}
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-surface-muted text-ink-tertiary">
          <PencilRuler size={22} strokeWidth={1.75} />
        </span>
        <div className="text-body font-medium tracking-tight text-ink">
          {t('knowledge.board.placeholderTitle')}
        </div>
        <p className="max-w-sm text-meta leading-relaxed text-ink-secondary">
          {t('knowledge.board.placeholderHint')}
        </p>
        {preview ? (
          <pre
            className="mt-2 max-h-48 w-full max-w-lg overflow-auto rounded-lg border border-border/70 bg-surface-muted/50 p-3 text-left font-mono text-caption text-ink-tertiary"
            data-testid="knowledge-board-json-preview"
          >
            {preview}
          </pre>
        ) : null}
      </div>
    </div>
  )
})
