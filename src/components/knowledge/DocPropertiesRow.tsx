import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { parseFrontmatter, type KnowledgeDocMeta } from '@/domain/knowledge/frontmatter'
import { applyMetaToDocument } from '@/domain/knowledge/frontmatterWrite'
import { patchMetaField } from '@/domain/knowledge/views'
import type { SpaceSchemaV1 } from '@/domain/knowledge/schema'
import { DEFAULT_SPACE_SCHEMA, propDefByKey } from '@/domain/knowledge/schema'
import { cn } from '@/lib/utils'

export interface DocPropertiesRowProps {
  body: string
  /** When set, edits call this with full document text (FM + body). */
  onBodyChange?: (next: string) => void
  schema?: SpaceSchemaV1
  readOnly?: boolean
}

/**
 * Editable tags / status / date / priority chips from YAML frontmatter.
 */
export function DocPropertiesRow({
  body,
  onBodyChange,
  schema = DEFAULT_SPACE_SCHEMA,
  readOnly,
}: DocPropertiesRowProps) {
  const { t } = useTranslation()
  const meta = useMemo(() => parseFrontmatter(body).meta, [body])
  const [tagDraft, setTagDraft] = useState('')

  const editable = Boolean(onBodyChange) && !readOnly

  const commit = (next: KnowledgeDocMeta) => {
    if (!onBodyChange) return
    onBodyChange(applyMetaToDocument(body, next))
  }

  const statusDef = propDefByKey(schema, 'status')
  const priorityDef = propDefByKey(schema, 'priority')
  const statusOptions = statusDef?.options ?? ['draft', 'active', 'done']
  const priorityOptions = priorityDef?.options ?? ['low', 'medium', 'high']

  const hasAnything =
    meta.tags.length > 0 ||
    meta.status ||
    meta.date ||
    meta.priority ||
    editable

  if (!hasAnything) return null

  return (
    <div
      className="mt-1 flex flex-wrap items-center gap-1.5"
      data-testid="knowledge-doc-properties"
    >
      {/* Status */}
      {editable ? (
        <select
          className="h-7 rounded-full border border-border bg-surface-muted px-2 text-caption text-ink-secondary"
          data-testid="knowledge-doc-status-select"
          value={meta.status ?? ''}
          title={t('knowledge.wiki.propertyStatus')}
          onChange={(e) => {
            const v = e.target.value
            commit(patchMetaField(meta, 'status', v || null))
          }}
        >
          <option value="">{t('knowledge.props.none')}</option>
          {statusOptions.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : meta.status ? (
        <span
          className="rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-caption text-ink-secondary"
          data-testid="knowledge-doc-status"
        >
          {meta.status}
        </span>
      ) : null}

      {/* Priority */}
      {editable ? (
        <select
          className="h-7 rounded-full border border-border bg-surface-muted px-2 text-caption text-ink-secondary"
          data-testid="knowledge-doc-priority-select"
          value={meta.priority ?? ''}
          title={t('knowledge.props.priority')}
          onChange={(e) => {
            const v = e.target.value
            commit(patchMetaField(meta, 'priority', v || null))
          }}
        >
          <option value="">{t('knowledge.props.priorityNone')}</option>
          {priorityOptions.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      ) : meta.priority ? (
        <span
          className="rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-caption text-ink-secondary"
          data-testid="knowledge-doc-priority"
        >
          {meta.priority}
        </span>
      ) : null}

      {/* Date */}
      {editable ? (
        <input
          type="date"
          className="h-7 rounded-full border border-border bg-surface-muted px-2 text-caption text-ink-secondary"
          data-testid="knowledge-doc-date-input"
          value={meta.date && /^\d{4}-\d{2}-\d{2}/.test(meta.date) ? meta.date.slice(0, 10) : ''}
          title={t('knowledge.props.date')}
          onChange={(e) => {
            commit(patchMetaField(meta, 'date', e.target.value || null))
          }}
        />
      ) : meta.date ? (
        <span
          className="rounded-full border border-border bg-surface-muted px-2.5 py-0.5 text-caption text-ink-secondary"
          data-testid="knowledge-doc-date"
        >
          {meta.date}
        </span>
      ) : null}

      {/* Tags */}
      {meta.tags.map((tag) => (
        <span
          key={tag}
          className={cn(
            'inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-0.5 text-caption text-ink-secondary',
          )}
          data-testid="knowledge-doc-tag"
        >
          {tag}
          {editable ? (
            <button
              type="button"
              className="text-ink-tertiary hover:text-danger"
              aria-label={t('knowledge.props.removeTag', { tag })}
              data-testid="knowledge-doc-tag-remove"
              onClick={() => {
                commit(
                  patchMetaField(
                    meta,
                    'tags',
                    meta.tags.filter((x) => x !== tag),
                  ),
                )
              }}
            >
              ×
            </button>
          ) : null}
        </span>
      ))}
      {editable ? (
        <input
          className="h-7 min-w-[6rem] rounded-full border border-dashed border-border bg-transparent px-2 text-caption text-ink placeholder:text-ink-tertiary"
          data-testid="knowledge-doc-tag-input"
          placeholder={t('knowledge.props.addTag')}
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            e.preventDefault()
            const t0 = tagDraft.trim()
            if (!t0) return
            if (meta.tags.some((x) => x.toLowerCase() === t0.toLowerCase())) {
              setTagDraft('')
              return
            }
            commit(patchMetaField(meta, 'tags', [...meta.tags, t0]))
            setTagDraft('')
          }}
        />
      ) : null}
    </div>
  )
}
