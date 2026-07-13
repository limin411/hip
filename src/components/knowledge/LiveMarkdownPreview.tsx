import { useEffect, useState } from 'react'
import { DocReader } from './DocReader'

const DEBOUNCE_MS = 180

/**
 * Debounced markdown preview for split layout.
 * Avoids re-parsing MarkdownBody on every keystroke.
 */
export function LiveMarkdownPreview({ body }: { body: string }) {
  const [preview, setPreview] = useState(body)

  useEffect(() => {
    const t = window.setTimeout(() => setPreview(body), DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [body])

  return (
    <div
      className="h-full min-h-0 overflow-y-auto px-6 py-6"
      data-testid="knowledge-live-preview"
    >
      <DocReader content={preview} />
    </div>
  )
}
