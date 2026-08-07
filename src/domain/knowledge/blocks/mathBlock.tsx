import { useEffect, useRef, useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

export const mathBlockSpec = createReactBlockSpec(
  {
    type: 'math' as const,
    propSchema: {
      src: { default: '' },
    },
    content: 'none' as const,
  },
  {
    parse: (el) => {
      if (el.getAttribute('data-hip-block') !== 'math') return undefined
      const fromAttr = el.getAttribute('data-src')
      return { src: fromAttr != null && fromAttr !== '' ? fromAttr : (el.textContent ?? '') }
    },
    toExternalHTML: ({ block }) => (
      <div data-hip-block="math" data-src={String(block.props.src ?? '')} />
    ),
    render: ({ block, editor }) => (
      <MathView
        src={String(block.props.src ?? '')}
        editable={editor.isEditable}
        onChange={(src) => {
          editor.updateBlock(block, { props: { ...block.props, src } })
        }}
      />
    ),
  },
)

function MathView({
  src,
  editable,
  onChange,
}: {
  src: string
  editable: boolean
  onChange: (src: string) => void
}) {
  const [editing, setEditing] = useState(!src.trim())
  const [error, setError] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const visibleRef = useRef(true)

  useEffect(() => {
    const el = previewRef.current
    if (!el || editing) return
    if (!visibleRef.current) return
    try {
      katex.render(src.trim() || '\\;', el, {
        throwOnError: true,
        displayMode: true,
      })
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'KaTeX error')
      el.textContent = src
    }
  }, [src, editing])

  useEffect(() => {
    const root = previewRef.current?.parentElement
    if (!root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([entry]) => {
        visibleRef.current = entry?.isIntersecting ?? true
      },
      { rootMargin: '80px' },
    )
    io.observe(root)
    return () => io.disconnect()
  }, [])

  return (
    <div
      className="kb-math"
      data-testid="knowledge-math-block"
      contentEditable={false}
      onDoubleClick={() => editable && setEditing(true)}
    >
      {editing && editable ? (
        <div className="kb-math-edit">
          <textarea
            className="kb-math-src"
            data-testid="knowledge-math-src"
            value={src}
            rows={3}
            placeholder="\\sum_{i=1}^{n} i"
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setEditing(false)}
            autoFocus
          />
          <button
            type="button"
            className="kb-math-done"
            onClick={() => setEditing(false)}
          >
            Done
          </button>
        </div>
      ) : (
        <div
          ref={previewRef}
          className={error ? 'kb-math-preview kb-math-error' : 'kb-math-preview'}
          data-testid="knowledge-math-preview"
          title={error ?? undefined}
        />
      )}
    </div>
  )
}
