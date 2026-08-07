/**
 * Inline math — `$…$` chip with KaTeX rendering.
 *
 * Round-trip strategy (probe-verified against BN 0.52.1):
 * `toExternalHTML` emits the literal `$src$` text, and BN's markdown exporter
 * passes that text through verbatim → disk keeps the `$…$` dialect (L3).
 */
import { useEffect, useRef, useState } from 'react'
import { createReactInlineContentSpec } from '@blocknote/react'
import type { BlockNoteEditor } from '@blocknote/core'
import katex from 'katex'

export const mathInlineSpec = createReactInlineContentSpec(
  {
    type: 'mathInline' as const,
    propSchema: {
      src: { default: '' },
    },
    content: 'none' as const,
  },
  {
    parse: (el) => {
      if (el.getAttribute('data-hip-inline') !== 'math') return undefined
      const raw = el.textContent ?? ''
      const src = raw.replace(/^\$/, '').replace(/\$$/, '').trim()
      return { src }
    },
    toExternalHTML: ({ inlineContent }) => (
      <span data-hip-inline="math">{`$${String(inlineContent.props.src ?? '')}$`}</span>
    ),
    render: ({ inlineContent, editor }) => (
      <MathChip
        src={String(inlineContent.props.src ?? '')}
        onRevertToText={() => revertInlineMathToText(editor, String(inlineContent.props.src ?? ''))}
      />
    ),
  },
)

function revertInlineMathToText(
  editor: BlockNoteEditor<any, any, any> | null,
  src: string,
): void {
  if (!editor) return
  try {
    for (const block of editor.document) {
      const content = block.content
      if (!Array.isArray(content)) continue
      const idx = content.findIndex(
        (c) =>
          typeof c === 'object' &&
          c !== null &&
          (c as { type?: string }).type === 'mathInline' &&
          String((c as { props?: { src?: string } }).props?.src ?? '') === src,
      )
      if (idx >= 0) {
        const rebuilt = content.map((c, i) =>
          i === idx
            ? { type: 'text' as const, text: `$${src}$`, styles: {} }
            : c,
        )
        editor.updateBlock(block, { content: rebuilt })
        return
      }
    }
  } catch {
    // ignore — revert is a convenience, not critical
  }
}

function MathChip({ src, onRevertToText }: { src: string; onRevertToText: () => void }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    try {
      katex.render(src.trim() || '\\;', el, {
        throwOnError: true,
        displayMode: false,
      })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'KaTeX error')
      el.textContent = `$${src}$`
    }
  }, [src])

  return (
    <span
      className={error ? 'kb-math-inline kb-math-inline-error' : 'kb-math-inline'}
      data-testid="knowledge-inline-math"
      title={error ? `KaTeX: ${error}` : src}
      contentEditable={false}
      onDoubleClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onRevertToText()
      }}
    >
      <span ref={ref} />
    </span>
  )
}
