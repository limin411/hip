import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, ListChecks, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { cn } from '@/lib/utils'
import type { LivePlanView } from '@/lib/todos'
import { hasPlanMarkdown, planHalfEmptyKind } from '@/lib/todos'
import { PlanMarkdownPreview } from './PlanMarkdownPreview'
import { TodoChecklist } from './TodoChecklist'

interface PlanProgressPanelProps {
  view: LivePlanView
  onApprove?: () => void
  onReject?: () => void
  onAmend?: (content: string) => void
}

export function PlanProgressPanel({ view, onApprove, onReject, onAmend }: PlanProgressPanelProps) {
  const { t } = useTranslation()
  const [amendMode, setAmendMode] = useState(false)
  const [amendContent, setAmendContent] = useState('')
  const [responded, setResponded] = useState(false)
  // Compact by default while executing/done; expand for review (awaiting approval).
  const [expanded, setExpanded] = useState(() => view.phase === 'awaiting_approval')

  const awaiting = view.phase === 'awaiting_approval'
  const { done, total, current } = view.progress
  const showMarkdown = hasPlanMarkdown(view)
  const halfEmpty = planHalfEmptyKind(view)

  // KD-16 / D4e: after plan:respond:result ok:false the store restores planApprovalPending
  // while this panel stays mounted (activeTurnPlan kept). Re-entry to awaiting_approval
  // must clear local responded so Approve/Reject/Amend are clickable again.
  // Also auto-expand so the user can re-review the plan.
  useEffect(() => {
    if (view.phase === 'awaiting_approval') {
      setResponded(false)
      setAmendMode(false)
      setAmendContent('')
      setExpanded(true)
    }
  }, [view.phase])

  const phaseLabel =
    view.phase === 'planning'
      ? t('chat.planPanel.planning')
      : view.phase === 'awaiting_approval'
        ? t('chat.planPanel.awaitingApproval')
        : view.phase === 'executing'
          ? t('chat.planPanel.executing')
          : t('chat.planPanel.done')

  const handleApprove = () => {
    if (!onApprove) return
    setResponded(true)
    try {
      onApprove()
    } catch {
      setResponded(false)
    }
  }

  const handleReject = () => {
    if (!onReject) return
    setResponded(true)
    try {
      onReject()
    } catch {
      setResponded(false)
    }
  }

  const handleAmendSubmit = () => {
    if (!onAmend) return
    const text = amendContent.trim()
    if (!text) return
    setResponded(true)
    setAmendMode(false)
    setAmendContent('')
    try {
      onAmend(text)
    } catch {
      setResponded(false)
      setAmendMode(true)
      setAmendContent(text)
    }
  }

  const progressPct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0
  const toggleLabel = expanded ? t('chat.planPanel.collapse') : t('chat.planPanel.expand')

  return (
    <div
      className={cn(
        'rounded-md border px-3 py-2',
        awaiting
          ? 'border-accent/30 border-l-2 border-l-accent bg-accent-subtle'
          : 'border-border bg-surface-muted/40',
      )}
      data-testid="plan-progress-panel"
      data-phase={view.phase}
      data-expanded={expanded ? 'true' : 'false'}
      aria-live="polite"
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={toggleLabel}
        className="flex w-full min-w-0 items-center gap-1.5 text-left text-meta font-medium text-ink transition-colors hover:text-ink"
        data-testid="plan-progress-toggle"
      >
        <ChevronRight
          size={14}
          className={cn('block shrink-0 text-ink-tertiary transition-transform', expanded && 'rotate-90')}
          aria-hidden
        />
        <ListChecks size={14} className="shrink-0 text-accent" aria-hidden />
        <span className="shrink-0">{t('chat.todos.plan')}</span>
        <span className="shrink-0 font-normal text-ink-secondary">{phaseLabel}</span>
        {total > 0 && (
          <span className="shrink-0 font-normal text-ink-tertiary" data-testid="plan-progress-count">
            {t('chat.planPanel.progress', { done, total })}
          </span>
        )}
        {(view.phase === 'planning' || view.phase === 'executing') && (
          <Loader2 size={12} className="shrink-0 animate-spin text-accent-strong" aria-hidden />
        )}
        {!expanded && current && view.phase !== 'planning' && (
          <span
            className="min-w-0 flex-1 truncate font-normal text-ink-tertiary"
            data-testid="plan-progress-current"
            title={current}
          >
            {current}
          </span>
        )}
      </button>

      {total > 0 && view.phase !== 'planning' && (
        <div
          className="mt-1.5 h-0.5 w-full overflow-hidden rounded-full bg-border"
          data-testid="plan-progress-track"
          role="progressbar"
          aria-valuenow={done}
          aria-valuemin={0}
          aria-valuemax={total}
        >
          <div
            className={cn(
              'h-full rounded-full transition-[width] duration-content',
              awaiting ? 'bg-accent' : view.phase === 'done' ? 'bg-success' : 'bg-accent-strong',
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      )}

      {expanded && current && view.phase !== 'planning' && (
        <p className="mt-1 truncate text-caption text-ink-tertiary" data-testid="plan-progress-current">
          {current}
        </p>
      )}

      {expanded && (
        <div className="mt-1.5" data-testid="plan-progress-body">
          {/* Narrative plan.md above checklist (D2.6 / D3). Expand by default only while awaiting. */}
          {showMarkdown && view.markdown && (
            <PlanMarkdownPreview
              markdown={view.markdown}
              planPath={view.planPath}
              truncated={view.markdownTruncated}
              defaultExpanded={awaiting}
            />
          )}

          {/* Half-empty meta labels (D3.3 / D4.2) — only relevant while reviewing. */}
          {awaiting && halfEmpty === 'emptyMarkdown' && (
            <p className="mt-1.5 text-caption text-ink-secondary" data-testid="plan-progress-empty-markdown">
              {t('chat.planPanel.emptyMarkdown')}
            </p>
          )}
          {awaiting && halfEmpty === 'emptyChecklist' && (
            <p className="mt-1.5 text-caption text-ink-secondary" data-testid="plan-progress-empty-checklist">
              {t('chat.planPanel.emptyChecklist')}
            </p>
          )}

          {view.items.length > 0 ? (
            <div className={cn(showMarkdown && view.markdown ? 'mt-1.5' : undefined)}>
              <div className="max-h-36 overflow-y-auto overscroll-contain">
                <TodoChecklist todos={view.items} showHeading={false} compact />
              </div>
            </div>
          ) : view.phase === 'planning' ? (
            <p className="text-caption text-ink-secondary" data-testid="plan-progress-empty">
              {t('chat.planPanel.emptyPlanning')}
            </p>
          ) : view.phase === 'awaiting_approval' && halfEmpty === 'emptyBoth' ? (
            <p className="text-caption text-ink-secondary" data-testid="plan-progress-empty-awaiting">
              {t('chat.planPanel.emptyAwaiting')}
            </p>
          ) : null}
        </div>
      )}

      {/* Approval actions stay visible even when the body is folded — user must act. */}
      {awaiting && (
        <div className="mt-2" data-testid="plan-approval-card">
          <p className="text-caption text-ink-secondary">{t('chat.planApproval.hint')}</p>
          {!amendMode ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Button
                variant="primary"
                size="sm"
                onClick={handleApprove}
                disabled={responded}
                data-testid="plan-approve"
              >
                {t('chat.planApproval.approve')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setAmendMode(true)}
                disabled={responded}
                data-testid="plan-amend"
              >
                {t('chat.planApproval.amend')}
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleReject}
                disabled={responded}
                data-testid="plan-reject"
              >
                {t('chat.planApproval.reject')}
              </Button>
            </div>
          ) : (
            <div className="mt-2 space-y-1.5">
              <Textarea
                value={amendContent}
                onChange={(e) => setAmendContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    handleAmendSubmit()
                  }
                }}
                rows={2}
                placeholder={t('chat.planApproval.amendPlaceholder')}
                disabled={responded}
                aria-label={t('chat.planApproval.amendPlaceholder')}
                className="border-0 bg-surface"
              />
              <div className="flex items-center gap-1.5">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleAmendSubmit}
                  disabled={!amendContent.trim() || responded}
                  data-testid="plan-amend-submit"
                >
                  {t('chat.planApproval.submitAmend')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAmendMode(false)
                    setAmendContent('')
                  }}
                  disabled={responded}
                  data-testid="plan-amend-cancel"
                >
                  {t('common.cancel')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
