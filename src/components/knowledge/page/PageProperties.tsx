import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { KnowledgeDocMeta } from '@/domain/knowledge/frontmatter'

export interface PagePropertiesProps {
  meta: KnowledgeDocMeta
  onChange: (patch: Partial<KnowledgeDocMeta>) => void
  disabled?: boolean
  className?: string
}

const MAX_TAGS = 5

export function PageProperties({
  meta,
  onChange,
  disabled,
  className,
}: PagePropertiesProps) {
  const { t } = useTranslation()
  const [tagDraft, setTagDraft] = useState('')
  const [aliasDraft, setAliasDraft] = useState('')

  const addTag = () => {
    const v = tagDraft.trim()
    if (!v) return
    if (meta.tags.length >= MAX_TAGS) return
    if (meta.tags.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setTagDraft('')
      return
    }
    onChange({ tags: [...meta.tags, v] })
    setTagDraft('')
  }

  const addAlias = () => {
    const v = aliasDraft.trim()
    if (!v) return
    if (meta.aliases.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setAliasDraft('')
      return
    }
    onChange({ aliases: [...meta.aliases, v] })
    setAliasDraft('')
  }

  return (
    <div
      className={cn(
        'knowledge-doc-measure flex flex-wrap items-center gap-1.5 pb-3',
        className,
      )}
      data-testid="knowledge-page-properties"
    >
      {/* starred */}
      <button
        type="button"
        disabled={disabled}
        aria-pressed={meta.starred}
        data-testid="knowledge-prop-star"
        title={t('knowledge.doc.propStar')}
        onClick={() => onChange({ starred: !meta.starred })}
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-sm transition-colors',
          meta.starred
            ? 'text-accent-strong hover:bg-accent/10'
            : 'text-ink-tertiary hover:bg-state-hover hover:text-ink-secondary',
          disabled && 'pointer-events-none opacity-50',
        )}
      >
        <Star
          size={14}
          strokeWidth={1.75}
          fill={meta.starred ? 'currentColor' : 'none'}
        />
      </button>
      {/* tags */}
      {meta.tags.map((tag) => (
        <span
          key={tag}
          className="inline-flex items-center gap-0.5 rounded-full border border-border bg-surface-muted px-2 py-0.5 text-meta text-ink"
          data-testid="knowledge-prop-tag"
        >
          #{tag}
          {!disabled ? (
            <button
              type="button"
              className="text-ink-tertiary hover:text-ink"
              aria-label={t('common.clear')}
              onClick={() =>
                onChange({ tags: meta.tags.filter((x) => x !== tag) })
              }
            >
              <X size={12} />
            </button>
          ) : null}
        </span>
      ))}
      {!disabled && meta.tags.length < MAX_TAGS ? (
        <input
          className="h-6 w-24 rounded-sm border border-transparent bg-transparent px-1 text-meta text-ink placeholder:text-ink-tertiary focus:border-border focus:outline-none"
          data-testid="knowledge-prop-tag-input"
          placeholder={t('knowledge.doc.propTags')}
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addTag()
            }
          }}
          onBlur={addTag}
        />
      ) : null}

      {/* status */}
      <label className="inline-flex items-center gap-1 text-meta text-ink-secondary">
        <span className="text-ink-tertiary">{t('knowledge.doc.propStatus')}</span>
        <input
          className="h-6 w-24 rounded-sm border border-border bg-surface px-1.5 text-meta text-ink focus:outline-none focus:ring-1 focus:ring-accent/30"
          data-testid="knowledge-prop-status"
          disabled={disabled}
          value={meta.status ?? ''}
          placeholder="—"
          onChange={(e) =>
            onChange({ status: e.target.value.trim() || null })
          }
        />
      </label>

      {/* date */}
      <label className="inline-flex items-center gap-1 text-meta text-ink-secondary">
        <span className="text-ink-tertiary">{t('knowledge.doc.propDate')}</span>
        <input
          type="date"
          className="h-6 rounded-sm border border-border bg-surface px-1.5 text-meta text-ink focus:outline-none focus:ring-1 focus:ring-accent/30"
          data-testid="knowledge-prop-date"
          disabled={disabled}
          value={meta.date && /^\d{4}-\d{2}-\d{2}$/.test(meta.date) ? meta.date : ''}
          onChange={(e) => onChange({ date: e.target.value || null })}
        />
      </label>

      {/* priority */}
      <label className="inline-flex items-center gap-1 text-meta text-ink-secondary">
        <span className="text-ink-tertiary">{t('knowledge.doc.propPriority')}</span>
        <select
          className="h-6 rounded-sm border border-border bg-surface px-1 text-meta text-ink focus:outline-none"
          data-testid="knowledge-prop-priority"
          disabled={disabled}
          value={meta.priority ?? ''}
          onChange={(e) => onChange({ priority: e.target.value || null })}
        >
          <option value="">—</option>
          <option value="low">low</option>
          <option value="medium">medium</option>
          <option value="high">high</option>
        </select>
      </label>

      {/* aliases */}
      {meta.aliases.map((a) => (
        <span
          key={a}
          className="inline-flex items-center gap-0.5 rounded-full border border-border px-2 py-0.5 text-meta text-ink-secondary"
          data-testid="knowledge-prop-alias"
        >
          {a}
          {!disabled ? (
            <button
              type="button"
              className="text-ink-tertiary hover:text-ink"
              onClick={() =>
                onChange({ aliases: meta.aliases.filter((x) => x !== a) })
              }
            >
              <X size={12} />
            </button>
          ) : null}
        </span>
      ))}
      {!disabled ? (
        <input
          className="h-6 w-28 rounded-sm border border-transparent bg-transparent px-1 text-meta text-ink placeholder:text-ink-tertiary focus:border-border focus:outline-none"
          data-testid="knowledge-prop-alias-input"
          placeholder={t('knowledge.doc.propAliases')}
          value={aliasDraft}
          onChange={(e) => setAliasDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addAlias()
            }
          }}
          onBlur={addAlias}
        />
      ) : null}
    </div>
  )
}
