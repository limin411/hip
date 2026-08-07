import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { KnowledgeVersionEntry } from '@/domain/knowledge/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { formatAbsolute } from '@/lib/datetime'

export interface VersionTimelineProps {
  versions: KnowledgeVersionEntry[]
  loading?: boolean
  selectedId?: string | null
  onSelect: (v: KnowledgeVersionEntry) => void
  onDiff: (v: KnowledgeVersionEntry) => void
  onRestore: (v: KnowledgeVersionEntry) => void
  largeByteThreshold?: number
  className?: string
}

function startOfTodayMs(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function VersionTimeline({
  versions,
  loading,
  selectedId,
  onSelect,
  onDiff,
  onRestore,
  largeByteThreshold = 512_000,
  className,
}: VersionTimelineProps) {
  const { t, i18n } = useTranslation()
  const todayStart = startOfTodayMs()

  const groups = useMemo(() => {
    const today: KnowledgeVersionEntry[] = []
    const earlier: KnowledgeVersionEntry[] = []
    for (const v of versions) {
      if (v.createdAt >= todayStart) today.push(v)
      else earlier.push(v)
    }
    return { today, earlier }
  }, [versions, todayStart])

  if (loading) {
    return (
      <p className="px-1 text-meta text-ink-tertiary" data-testid="knowledge-versions-loading">
        {t('knowledge.doc.saving')}
      </p>
    )
  }

  if (versions.length === 0) {
    return (
      <p className="text-body text-ink-secondary" data-testid="knowledge-versions-empty">
        {t('knowledge.versions.empty')}
      </p>
    )
  }

  const renderGroup = (label: string, items: KnowledgeVersionEntry[], testId: string) => {
    if (!items.length) return null
    return (
      <div data-testid={testId} className="flex flex-col gap-2">
        <h4 className="px-0.5 text-caption font-medium uppercase tracking-wide text-ink-tertiary">
          {label}
        </h4>
        {items.map((v) => {
          const large = v.byteLength > largeByteThreshold
          const selected = selectedId === v.id
          return (
            <div
              key={v.id}
              className={cn(
                'flex items-center gap-2 rounded-lg border bg-surface px-3 py-2.5',
                selected ? 'border-accent' : 'border-border',
              )}
              data-testid="knowledge-version-row"
              data-version-id={v.id}
              role="button"
              tabIndex={0}
              onClick={() => onSelect(v)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelect(v)
                }
              }}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-body font-medium text-ink">
                  {formatAbsolute(v.createdAt, i18n.language)}
                </div>
                <div className="text-meta text-ink-tertiary">
                  {v.kind === 'daily'
                    ? t('knowledge.versions.kindDaily')
                    : t('knowledge.versions.kindManual')}
                  {large
                    ? ` · ${t('knowledge.versions.largeHint', {
                        kb: Math.round(v.byteLength / 1024),
                      })}`
                    : null}
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                data-testid="knowledge-version-diff"
                onClick={(e) => {
                  e.stopPropagation()
                  onDiff(v)
                }}
              >
                {t('knowledge.versions.diff')}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                data-testid="knowledge-version-restore"
                onClick={(e) => {
                  e.stopPropagation()
                  onRestore(v)
                }}
              >
                {t('knowledge.versions.restore')}
              </Button>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div
      className={cn('flex flex-col gap-4', className)}
      data-testid="knowledge-version-timeline"
    >
      {renderGroup(t('knowledge.versions.groupToday'), groups.today, 'knowledge-versions-today')}
      {renderGroup(
        t('knowledge.versions.groupEarlier'),
        groups.earlier,
        'knowledge-versions-earlier',
      )}
    </div>
  )
}
