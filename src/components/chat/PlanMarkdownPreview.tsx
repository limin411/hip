import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { MarkdownBody } from './MarkdownBody'

export interface PlanMarkdownPreviewProps {
  markdown: string
  planPath?: string | null
  truncated?: boolean
  /** Awaiting approval: expand by default; execute/done: collapse (D3.4). */
  defaultExpanded?: boolean
}

/** Collapsible plan.md body for sticky PlanProgressPanel (KD-PA-11: chat MarkdownBody). */
export function PlanMarkdownPreview({
  markdown,
  planPath,
  truncated,
  defaultExpanded = true,
}: PlanMarkdownPreviewProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(defaultExpanded)

  useEffect(() => {
    setExpanded(defaultExpanded)
  }, [defaultExpanded])

  const pathLabel = planPath ? shortPlanPath(planPath) : null

  return (
    <div className="mt-2 rounded-md border border-border/60 bg-surface/60" data-testid="plan-markdown-preview">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left text-meta text-ink-secondary transition-colors hover:text-ink"
        data-testid="plan-markdown-toggle"
      >
        <ChevronRight
          size={14}
          className={cn('block shrink-0 transition-transform', expanded && 'rotate-90')}
          aria-hidden
        />
        <FileText size={14} className="block shrink-0 text-accent" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium">
          {expanded ? t('chat.planPanel.collapseMarkdown') : t('chat.planPanel.expandMarkdown')}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border/50 px-2.5 pb-2 pt-1.5">
          <div
            className="max-h-64 overflow-y-auto overscroll-contain text-meta [&_h1]:text-body [&_h2]:text-body"
            data-testid="plan-markdown-body"
          >
            <MarkdownBody content={markdown} className="text-meta" />
          </div>
          {(pathLabel || truncated) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-ink-tertiary">
              {pathLabel && (
                <span className="truncate font-mono" data-testid="plan-markdown-path" title={planPath ?? undefined}>
                  {pathLabel}
                </span>
              )}
              {truncated && (
                <span data-testid="plan-markdown-truncated">{t('chat.planPanel.markdownTruncated')}</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** Truncate long absolute plan paths for meta footer (Q3). */
function shortPlanPath(path: string): string {
  // Prefer ~/.hip/plans/… when path ends with that segment.
  const hipPlans = path.match(/\/\.hip\/plans\/[^/]+$/)
  if (hipPlans) return `~${hipPlans[0]}`
  if (path.length <= 48) return path
  return `${path.slice(0, 18)}…${path.slice(-24)}`
}
