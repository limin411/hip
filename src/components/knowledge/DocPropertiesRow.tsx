import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { parseFrontmatter } from '@/domain/knowledge/frontmatter'

/**
 * Read-only tags / status chips from YAML frontmatter (P1.6).
 * Hidden when the active body has no known properties.
 */
export function DocPropertiesRow({ body }: { body: string }) {
  const { t } = useTranslation()
  const meta = useMemo(() => parseFrontmatter(body).meta, [body])
  const hasTags = meta.tags.length > 0
  const hasStatus = Boolean(meta.status)
  if (!hasTags && !hasStatus) return null

  return (
    <div
      className="mt-2 flex flex-wrap items-center gap-1.5"
      data-testid="knowledge-doc-properties"
    >
      {hasStatus && (
        <span
          className="rounded-md border border-border bg-surface-muted px-2 py-0.5 text-meta text-ink-secondary"
          data-testid="knowledge-doc-status"
          title={t('knowledge.doc.propertyStatus')}
        >
          {meta.status}
        </span>
      )}
      {meta.tags.map((tag) => (
        <span
          key={tag}
          className="rounded-full bg-surface-muted px-2 py-0.5 text-meta text-ink-secondary"
          data-testid="knowledge-doc-tag"
        >
          {tag}
        </span>
      ))}
    </div>
  )
}
