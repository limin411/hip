import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ListChecks, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { cn } from '@/lib/utils'
import type { LivePlanView } from '@/lib/todos'
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

  const awaiting = view.phase === 'awaiting_approval'
  const { done, total, current } = view.progress

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

  return (
    <div
      className={cn(
        'rounded-lg border px-4 py-3',
        awaiting ? 'border-accent/30 bg-accent-subtle' : 'border-border bg-surface-muted/40',
      )}
      data-testid="plan-progress-panel"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2 text-body font-medium text-ink">
        <ListChecks size={16} className="shrink-0 text-accent" aria-hidden />
        <span>{t('chat.todos.plan')}</span>
        <span className="text-meta font-normal text-ink-secondary">{phaseLabel}</span>
        {total > 0 && (
          <span className="text-meta font-normal text-ink-tertiary" data-testid="plan-progress-count">
            {t('chat.planPanel.progress', { done, total })}
          </span>
        )}
        {(view.phase === 'planning' || view.phase === 'executing') && (
          <Loader2 size={14} className="ml-auto shrink-0 animate-spin text-accent-strong" aria-hidden />
        )}
      </div>

      {current && view.phase !== 'planning' && (
        <p className="mt-1 truncate text-meta text-ink-tertiary" data-testid="plan-progress-current">
          {current}
        </p>
      )}

      {view.phase === 'planning' && view.items.length === 0 ? (
        <p className="mt-2 text-meta text-ink-secondary" data-testid="plan-progress-empty">
          {t('chat.planPanel.emptyPlanning')}
        </p>
      ) : view.items.length > 0 ? (
        <div className="mt-2">
          <TodoChecklist todos={view.items} showHeading={false} />
        </div>
      ) : null}

      {awaiting && (
        <div className="mt-3" data-testid="plan-approval-card">
          <p className="text-meta text-ink-secondary">{t('chat.planApproval.hint')}</p>
          {!amendMode ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
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
            <div className="mt-3 space-y-2">
              <Textarea
                value={amendContent}
                onChange={(e) => setAmendContent(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    handleAmendSubmit()
                  }
                }}
                rows={3}
                placeholder={t('chat.planApproval.amendPlaceholder')}
                disabled={responded}
                aria-label={t('chat.planApproval.amendPlaceholder')}
                className="border-0 bg-surface"
              />
              <div className="flex items-center gap-2">
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
