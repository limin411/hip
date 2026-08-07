import { useEffect, useState } from 'react'
import { useKnowledgeStore } from '@/store/knowledgeStore'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import { DocReader } from './DocReader'

const DEBOUNCE_MS = 180

/**
 * Debounced live Markdown preview for the Source split layout (实时写入预览).
 * Subscribes to `draftBody` itself so per-keystroke updates re-render only the
 * preview pane (the workspace deliberately does not subscribe to draftBody),
 * and DocReader only re-parses after the debounce window.
 */
export function LiveMarkdownPreview({
  nodes,
  onWikiNavigate,
  onWikiBroken,
}: {
  /** Current space tree — enables `[[title]]` resolution in the preview. */
  nodes?: KnowledgeNode[]
  /** Navigate to a resolved wiki target (same handler as the Live editor). */
  onWikiNavigate?: (docId: string, fragment?: string | null) => void
  /** Broken wiki click → parent shows confirm-create modal. */
  onWikiBroken?: (title: string) => void
}) {
  const draftBody = useKnowledgeStore((s) => s.draftBody)
  const [preview, setPreview] = useState(draftBody)

  useEffect(() => {
    const t = window.setTimeout(() => setPreview(draftBody), DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [draftBody])

  return (
    <div
      className="h-full min-h-0 overflow-y-auto px-6 py-6"
      data-testid="knowledge-live-preview"
    >
      <DocReader
        content={preview}
        nodes={nodes}
        onWikiNavigate={onWikiNavigate}
        onWikiBroken={onWikiBroken}
      />
    </div>
  )
}
