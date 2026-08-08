/**
 * Columns block — 2–4 列分栏（V2-E1）。
 * content: 'none' + `columns` prop（JSON 数组，每列一段 Markdown）——
 * BN 0.52 自定义块不支持嵌套块内容，与 callout/toggle 同手法。
 * 列宽仅存块属性（拖拽，会话级），不进入 Markdown（doc-storage-spec L-8）。
 */
import { useCallback, type PointerEvent as ReactPointerEvent } from 'react'
import { createReactBlockSpec } from '@blocknote/react'
import {
  COLUMNS_MAX,
  COLUMN_WIDTH_MAX_PX,
  COLUMN_WIDTH_MIN_PX,
} from './columns'

function clampWidth(v: number): number {
  return Math.min(COLUMN_WIDTH_MAX_PX, Math.max(COLUMN_WIDTH_MIN_PX, v))
}

function parseWidths(raw: string | null | undefined): number[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.map((w) => (typeof w === 'number' ? w : 0))
  } catch {
    return []
  }
}

export const columnsBlockSpec = createReactBlockSpec(
  {
    type: 'columns' as const,
    propSchema: {
      count: { default: '2' },
      /** JSON array of per-column Markdown. */
      columns: { default: '["",""]' },
      /** JSON array of session-only column widths (px); not persisted. */
      widths: { default: '' },
    },
    content: 'none' as const,
  },
  {
    parse: (el) => {
      if (el.getAttribute('data-hip-block') !== 'columns') return undefined
      return {
        count: el.getAttribute('data-count') ?? '2',
        columns: el.getAttribute('data-columns') ?? '["",""]',
        widths: el.getAttribute('data-widths') ?? '',
      }
    },
    toExternalHTML: ({ block }) => (
      <div
        data-hip-block="columns"
        data-count={String(block.props.count ?? '2')}
        data-columns={String(block.props.columns ?? '["",""]')}
      />
    ),
    render: ({ block, editor }) => {
      const count = Math.min(
        COLUMNS_MAX,
        Math.max(2, Number(block.props.count ?? '2') || 2),
      )
      const columns: string[] = (() => {
        try {
          const parsed = JSON.parse(String(block.props.columns ?? '[]')) as unknown
          return Array.isArray(parsed) ? parsed.map((c) => String(c)) : []
        } catch {
          return []
        }
      })()
      const widths = parseWidths(String(block.props.widths ?? ''))
      while (columns.length < count) columns.push('')
      while (widths.length < count) widths.push(0)

      const setColumn = (i: number, v: string) => {
        const next = [...columns]
        next[i] = v
        editor.updateBlock(block, {
          props: { ...block.props, columns: JSON.stringify(next) },
        })
      }

      const onResizeStart = useCallback(
        (e: ReactPointerEvent<HTMLDivElement>, i: number) => {
          e.preventDefault()
          e.stopPropagation()
          const startX = e.clientX
          const startWidth = widths[i] ?? 0
          const onMove = (ev: PointerEvent) => {
            const next = clampWidth(Math.round(startWidth + (ev.clientX - startX)))
            const ws = parseWidths(String(block.props.widths ?? ''))
            while (ws.length < count) ws.push(0)
            ws[i] = next
            editor.updateBlock(block, {
              props: { ...block.props, widths: JSON.stringify(ws) },
            })
          }
          const onUp = () => {
            window.removeEventListener('pointermove', onMove)
            window.removeEventListener('pointerup', onUp)
          }
          window.addEventListener('pointermove', onMove)
          window.addEventListener('pointerup', onUp)
        },
        [editor, block, count, widths],
      )

      return (
        <div
          className="kb-columns"
          data-testid="kb-columns"
          data-count={count}
          contentEditable={false}
        >
          {columns.slice(0, count).map((md, i) => (
            <div
              key={i}
              className="kb-column"
              data-testid="kb-column"
              data-col-index={i}
              style={widths[i] ? { flex: `0 0 ${widths[i]}px` } : { flex: '1 1 0%' }}
            >
              <textarea
                data-testid={`kb-column-input-${i}`}
                value={md}
                rows={Math.min(10, Math.max(3, md.split('\n').length + 1))}
                placeholder=""
                onChange={(e) => setColumn(i, e.target.value)}
                onKeyDown={(e) => e.stopPropagation()}
                className="kb-column-text"
              />
              {i < count - 1 ? (
                <div
                  className="kb-column-resizer"
                  data-testid="kb-column-resizer"
                  data-col-index={i}
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize column"
                  onPointerDown={(e) => onResizeStart(e, i)}
                />
              ) : null}
            </div>
          ))}
        </div>
      )
    },
  },
)
