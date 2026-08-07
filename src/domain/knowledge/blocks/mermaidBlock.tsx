import { useEffect, useId, useRef, useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { KnowledgeMermaid } from '@/components/knowledge/KnowledgeMermaid'

export const mermaidBlockSpec = createReactBlockSpec(
  {
    type: 'mermaid' as const,
    propSchema: {
      src: { default: 'flowchart LR\n  A --> B' },
    },
    content: 'none' as const,
  },
  {
    parse: (el) => {
      if (el.getAttribute('data-hip-block') !== 'mermaid') return undefined
      // Prefer data-src: BN whitespace normalize collapses text-node newlines.
      const fromAttr = el.getAttribute('data-src')
      return { src: fromAttr != null && fromAttr !== '' ? fromAttr : (el.textContent ?? '') }
    },
    toExternalHTML: ({ block }) => (
      <div data-hip-block="mermaid" data-src={String(block.props.src ?? '')} />
    ),
    render: ({ block, editor }) => (
      <FencePreviewEdit
        kind="mermaid"
        src={String(block.props.src ?? '')}
        editable={editor.isEditable}
        onChange={(src) => {
          editor.updateBlock(block, { props: { ...block.props, src } })
        }}
      />
    ),
  },
)

export const svgBlockSpec = createReactBlockSpec(
  {
    type: 'svgBlock' as const,
    propSchema: {
      src: { default: '' },
    },
    content: 'none' as const,
  },
  {
    parse: (el) => {
      if (el.getAttribute('data-hip-block') !== 'svg') return undefined
      const fromAttr = el.getAttribute('data-src')
      return { src: fromAttr != null && fromAttr !== '' ? fromAttr : (el.textContent ?? '') }
    },
    toExternalHTML: ({ block }) => (
      <div data-hip-block="svg" data-src={String(block.props.src ?? '')} />
    ),
    render: ({ block, editor }) => (
      <FencePreviewEdit
        kind="svg"
        src={String(block.props.src ?? '')}
        editable={editor.isEditable}
        onChange={(src) => {
          editor.updateBlock(block, { props: { ...block.props, src } })
        }}
      />
    ),
  },
)

function FencePreviewEdit({
  kind,
  src,
  editable,
  onChange,
}: {
  kind: 'mermaid' | 'svg'
  src: string
  editable: boolean
  onChange: (src: string) => void
}) {
  const [editing, setEditing] = useState(!src.trim())
  const [inView, setInView] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)
  const reactId = useId()

  useEffect(() => {
    const el = rootRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry?.isIntersecting ?? true),
      { rootMargin: '100px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <div
      ref={rootRef}
      className={kind === 'mermaid' ? 'kb-mermaid' : 'kb-svg'}
      data-testid={kind === 'mermaid' ? 'knowledge-mermaid-block' : 'knowledge-svg-block'}
      contentEditable={false}
      onDoubleClick={() => editable && setEditing(true)}
    >
      {editing && editable ? (
        <div className="kb-fence-edit">
          <textarea
            className="kb-fence-src"
            data-testid={`knowledge-${kind}-src`}
            value={src}
            rows={6}
            onChange={(e) => onChange(e.target.value)}
          />
          <button type="button" className="kb-fence-done" onClick={() => setEditing(false)}>
            Done
          </button>
        </div>
      ) : inView ? (
        kind === 'mermaid' ? (
          <KnowledgeMermaid code={src} />
        ) : (
          <div
            className="kb-svg-preview"
            data-testid="knowledge-svg-preview"
            // SVG is sanitized at Reader path; Live edit trusts author local files.
            dangerouslySetInnerHTML={{ __html: src || `<span id="${reactId}"></span>` }}
          />
        )
      ) : (
        <div className="kb-fence-placeholder">…</div>
      )}
      {editable && !editing ? (
        <button
          type="button"
          className="kb-fence-edit-btn"
          data-testid={`knowledge-${kind}-edit`}
          onClick={() => setEditing(true)}
        >
          Edit
        </button>
      ) : null}
    </div>
  )
}
