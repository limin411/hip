import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { KnowledgeNode } from '@/domain/knowledge/types'
import type { KnowledgeDocMeta } from '@/domain/knowledge/frontmatter'
import type { SpaceSchemaV1 } from '@/domain/knowledge/schema'
import { propDefByKey } from '@/domain/knowledge/schema'
import {
  boardColumns,
  collectDocRows,
  filterDocRows,
  getMetaProp,
  sortDocRows,
  type CollectionView,
} from '@/domain/knowledge/views'
import { propFieldLabel, propOptionLabel } from '@/domain/knowledge/propDisplay'
import { cn } from '@/lib/utils'

export interface KnowledgeCollectionViewProps {
  view: CollectionView
  nodes: KnowledgeNode[]
  /** docId → meta (from bodies / index). */
  metaByDocId: Map<string, KnowledgeDocMeta>
  schema: SpaceSchemaV1
  onOpenDoc: (docId: string) => void
  /** Patch a field on a doc (board DnD / table edit). */
  onPatchField: (docId: string, key: string, value: string | null) => void
}

export function KnowledgeCollectionView({
  view,
  nodes,
  metaByDocId,
  schema,
  onOpenDoc,
  onPatchField,
}: KnowledgeCollectionViewProps) {
  const rows = useMemo(() => {
    const all = collectDocRows(nodes, metaByDocId)
    const filtered = filterDocRows(all, nodes, view.filter)
    return sortDocRows(filtered, view.sort)
  }, [nodes, metaByDocId, view])

  if (view.layout === 'board') {
    return (
      <BoardView
        view={view}
        rows={rows}
        schema={schema}
        onOpenDoc={onOpenDoc}
        onPatchField={onPatchField}
      />
    )
  }
  return (
    <TableView
      view={view}
      rows={rows}
      schema={schema}
      onOpenDoc={onOpenDoc}
      onPatchField={onPatchField}
    />
  )
}

function TableView({
  view,
  rows,
  schema,
  onOpenDoc,
  onPatchField,
}: {
  view: CollectionView
  rows: ReturnType<typeof collectDocRows>
  schema: SpaceSchemaV1
  onOpenDoc: (docId: string) => void
  onPatchField: (docId: string, key: string, value: string | null) => void
}) {
  const { t } = useTranslation()
  const columns = view.columns?.length
    ? view.columns
    : ['status', 'tags', 'date', 'priority']

  return (
    <div className="min-h-0 flex-1 overflow-auto p-3" data-testid="knowledge-view-table">
      <table className="w-full border-collapse text-left text-meta">
        <thead>
          <tr className="border-b border-border text-ink-tertiary">
            <th className="sticky top-0 bg-surface px-2 py-1.5 font-medium">
              {t('knowledge.views.colTitle')}
            </th>
            {columns.map((c) => (
              <th key={c} className="sticky top-0 bg-surface px-2 py-1.5 font-medium">
                {propFieldLabel(t, c, propDefByKey(schema, c)?.label)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length + 1}
                className="px-2 py-8 text-center text-ink-tertiary"
              >
                {t('knowledge.views.empty')}
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <tr
                key={r.id}
                className="border-b border-border/60 hover:bg-state-hover"
                data-testid="knowledge-view-table-row"
                data-doc-id={r.id}
              >
                <td className="px-2 py-1.5">
                  <button
                    type="button"
                    className="font-medium text-accent-strong hover:underline"
                    onClick={() => onOpenDoc(r.id)}
                  >
                    {r.title}
                  </button>
                </td>
                {columns.map((c) => (
                  <td key={c} className="px-2 py-1.5 text-ink-secondary">
                    <CellEditor
                      docId={r.id}
                      col={c}
                      meta={r.meta}
                      schema={schema}
                      onPatchField={onPatchField}
                    />
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function CellEditor({
  docId,
  col,
  meta,
  schema,
  onPatchField,
}: {
  docId: string
  col: string
  meta: KnowledgeDocMeta
  schema: SpaceSchemaV1
  onPatchField: (docId: string, key: string, value: string | null) => void
}) {
  const { t } = useTranslation()
  const def = propDefByKey(schema, col)
  const raw = getMetaProp(meta, col)

  if (col === 'tags' || def?.type === 'multi-select') {
    const tags = Array.isArray(raw) ? raw : []
    return <span className="text-ink-tertiary">{tags.join(', ') || '—'}</span>
  }

  if (def?.type === 'select' || col === 'status' || col === 'priority') {
    const options = def?.options ?? []
    const val = raw == null ? '' : String(raw)
    return (
      <select
        className="max-w-[8rem] rounded border border-border bg-surface px-1 py-0.5"
        value={val}
        data-testid={`knowledge-view-cell-${col}`}
        onChange={(e) => onPatchField(docId, col, e.target.value || null)}
      >
        <option value="">—</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {propOptionLabel(t, o)}
          </option>
        ))}
        {val && !options.includes(val) ? (
          <option value={val}>{propOptionLabel(t, val)}</option>
        ) : null}
      </select>
    )
  }

  if (def?.type === 'date' || col === 'date') {
    const v =
      typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : ''
    return (
      <input
        type="date"
        className="rounded border border-border bg-surface px-1 py-0.5"
        value={v}
        data-testid="knowledge-view-cell-date"
        onChange={(e) => onPatchField(docId, col, e.target.value || null)}
      />
    )
  }

  const display = raw == null || raw === '' ? '—' : Array.isArray(raw) ? raw.join(', ') : String(raw)
  return <span>{display}</span>
}

function BoardView({
  view,
  rows,
  schema,
  onOpenDoc,
  onPatchField,
}: {
  view: CollectionView
  rows: ReturnType<typeof collectDocRows>
  schema: SpaceSchemaV1
  onOpenDoc: (docId: string) => void
  onPatchField: (docId: string, key: string, value: string | null) => void
}) {
  const { t } = useTranslation()
  const groupKey = view.boardGroupKey ?? 'status'
  const def = propDefByKey(schema, groupKey)
  const order =
    view.boardColumnOrder ??
    def?.options ??
    ['draft', 'active', 'done']

  const cols = useMemo(
    () => boardColumns(rows, groupKey, order),
    [rows, groupKey, order],
  )

  const [dragId, setDragId] = useState<string | null>(null)

  return (
    <div
      className="flex min-h-0 flex-1 gap-3 overflow-x-auto p-3"
      data-testid="knowledge-view-board"
    >
      {cols.map((col) => (
        <div
          key={col.key || '__empty'}
          className="flex w-56 shrink-0 flex-col rounded-lg border border-border bg-surface-muted/30"
          data-testid="knowledge-view-board-col"
          data-col={col.key || '__empty'}
          onDragOver={(e) => e.preventDefault()}
          onDrop={() => {
            if (!dragId) return
            onPatchField(dragId, groupKey, col.key || null)
            setDragId(null)
          }}
        >
          <div className="border-b border-border px-2 py-1.5 text-meta font-medium text-ink">
            {col.key === ''
              ? t('knowledge.views.emptyCol')
              : propOptionLabel(t, col.key)}
            <span className="ml-1 text-ink-tertiary">({col.rows.length})</span>
          </div>
          <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto p-1.5">
            {col.rows.map((r) => (
              <button
                key={r.id}
                type="button"
                draggable
                onDragStart={() => setDragId(r.id)}
                onDragEnd={() => setDragId(null)}
                onClick={() => onOpenDoc(r.id)}
                className={cn(
                  'rounded-md border border-border bg-surface px-2 py-2 text-left text-meta',
                  'hover:border-accent/50',
                  dragId === r.id && 'opacity-60',
                )}
                data-testid="knowledge-view-board-card"
                data-doc-id={r.id}
              >
                <span className="font-medium text-ink">{r.title}</span>
                {r.meta.tags.length > 0 ? (
                  <span className="mt-1 block truncate text-ink-tertiary">
                    {r.meta.tags.join(', ')}
                  </span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
