/**
 * Callout custom block — MD carrier: `> [!type] title`.
 */
import { useCallback, useState } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import { CALLOUT_TYPES, type CalloutType } from '../callout'

const TYPE_SET = new Set<string>(CALLOUT_TYPES)

function normalizeType(raw: string): CalloutType {
  const t = raw.toLowerCase()
  return (TYPE_SET.has(t) ? t : 'note') as CalloutType
}

export const calloutBlockSpec = createReactBlockSpec(
  {
    type: 'callout' as const,
    propSchema: {
      type: { default: 'note' },
      title: { default: '' },
      body: { default: '' },
    },
    content: 'none' as const,
  },
  {
    parse: (el) => {
      if (el.getAttribute('data-hip-block') !== 'callout') return undefined
      return {
        type: normalizeType(el.getAttribute('data-type') ?? 'note'),
        title: el.getAttribute('data-title') ?? '',
        body: el.textContent ?? '',
      }
    },
    toExternalHTML: ({ block }) => (
      <div
        data-hip-block="callout"
        data-type={normalizeType(String(block.props.type ?? 'note'))}
        data-title={String(block.props.title ?? '')}
        data-callout={normalizeType(String(block.props.type ?? 'note'))}
      >
        {String(block.props.body ?? '')}
      </div>
    ),
    render: ({ block, editor }) => (
      <CalloutView
        type={normalizeType(String(block.props.type ?? 'note'))}
        title={String(block.props.title ?? '')}
        body={String(block.props.body ?? '')}
        editable={editor.isEditable}
        onChangeType={(next) => {
          editor.updateBlock(block, {
            props: { ...block.props, type: next },
          })
        }}
        onChangeTitle={(next) => {
          editor.updateBlock(block, {
            props: { ...block.props, title: next },
          })
        }}
        onChangeBody={(next) => {
          editor.updateBlock(block, {
            props: { ...block.props, body: next },
          })
        }}
      />
    ),
  },
)

function CalloutView({
  type,
  title,
  body,
  editable,
  onChangeType,
  onChangeTitle,
  onChangeBody,
}: {
  type: CalloutType
  title: string
  body: string
  editable: boolean
  onChangeType: (t: CalloutType) => void
  onChangeTitle: (t: string) => void
  onChangeBody: (t: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const onSelect = useCallback(
    (t: CalloutType) => {
      onChangeType(t)
      setMenuOpen(false)
    },
    [onChangeType],
  )

  return (
    <div
      className="kb-callout"
      data-callout={type}
      data-testid="knowledge-callout-block"
      contentEditable={false}
    >
      <div className="kb-callout-bar" aria-hidden />
      <div className="kb-callout-inner">
        <div className="kb-callout-head">
          <button
            type="button"
            className="kb-callout-type"
            data-testid="knowledge-callout-type"
            disabled={!editable}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {type}
          </button>
          {menuOpen ? (
            <div className="kb-callout-menu" role="listbox">
              {CALLOUT_TYPES.map((t) => (
                <button
                  key={t}
                  type="button"
                  role="option"
                  className="kb-callout-menu-item"
                  data-testid={`knowledge-callout-type-${t}`}
                  onClick={() => onSelect(t)}
                >
                  {t}
                </button>
              ))}
            </div>
          ) : null}
          {editable ? (
            <input
              className="kb-callout-title"
              data-testid="knowledge-callout-title"
              value={title}
              placeholder="Title"
              onChange={(e) => onChangeTitle(e.target.value)}
            />
          ) : (
            <span className="kb-callout-title">{title}</span>
          )}
        </div>
        {editable ? (
          <textarea
            className="kb-callout-text"
            data-testid="knowledge-callout-body"
            value={body}
            rows={Math.min(8, Math.max(2, body.split('\n').length + 1))}
            onChange={(e) => onChangeBody(e.target.value)}
          />
        ) : (
          <div className="kb-callout-text whitespace-pre-wrap">{body}</div>
        )}
      </div>
    </div>
  )
}
