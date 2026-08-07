import { useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'

export const toggleBlockSpec = createReactBlockSpec(
  {
    type: 'toggle' as const,
    propSchema: {
      summary: { default: '' },
      body: { default: '' },
    },
    content: 'none' as const,
  },
  {
    parse: (el) => {
      if (el.getAttribute('data-hip-block') === 'toggle') {
        return {
          summary: el.getAttribute('data-summary') ?? '',
          body: el.textContent ?? '',
        }
      }
      if (el.tagName === 'DETAILS') {
        const sum = el.querySelector('summary')
        const clone = el.cloneNode(true) as HTMLElement
        clone.querySelector('summary')?.remove()
        return {
          summary: sum?.textContent?.trim() ?? '',
          body: clone.textContent?.trim() ?? '',
        }
      }
      return undefined
    },
    toExternalHTML: ({ block }) => (
      <div
        data-hip-block="toggle"
        data-summary={String(block.props.summary ?? '')}
      >
        {String(block.props.body ?? '')}
      </div>
    ),
    render: ({ block, editor }) => {
      const summary = String(block.props.summary ?? '')
      const body = String(block.props.body ?? '')
      return (
        <ToggleView
          summary={summary}
          body={body}
          editable={editor.isEditable}
          onChangeSummary={(s) =>
            editor.updateBlock(block, { props: { ...block.props, summary: s } })
          }
          onChangeBody={(b) =>
            editor.updateBlock(block, { props: { ...block.props, body: b } })
          }
        />
      )
    },
  },
)

function ToggleView({
  summary,
  body,
  editable,
  onChangeSummary,
  onChangeBody,
}: {
  summary: string
  body: string
  editable: boolean
  onChangeSummary: (s: string) => void
  onChangeBody: (b: string) => void
}) {
  const [open, setOpen] = useState(true)
  return (
    <div className="kb-toggle" data-testid="knowledge-toggle-block" contentEditable={false}>
      <button
        type="button"
        className="kb-toggle-summary"
        data-testid="knowledge-toggle-summary"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="kb-toggle-chevron" aria-hidden>
          {open ? '▼' : '▶'}
        </span>
        {editable ? (
          <input
            className="kb-toggle-summary-input"
            value={summary}
            placeholder="Toggle"
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => onChangeSummary(e.target.value)}
          />
        ) : (
          <span>{summary || 'Details'}</span>
        )}
      </button>
      {open ? (
        editable ? (
          <textarea
            className="kb-toggle-body"
            data-testid="knowledge-toggle-body"
            value={body}
            rows={3}
            onChange={(e) => onChangeBody(e.target.value)}
          />
        ) : (
          <div className="kb-toggle-body">{body}</div>
        )
      ) : null}
    </div>
  )
}
