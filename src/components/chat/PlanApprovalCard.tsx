import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, Circle, ListChecks, Loader2 } from 'lucide-react'
import type { PlanItem } from '@hip/protocol'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { cn } from '@/lib/utils'

interface PlanApprovalCardProps {
  plan: PlanItem[]
  onApprove: () => void
  onReject: () => void
  onAmend: (content: string) => void
  /**
   * When true (plan still awaiting after a failed respond), reset local `responded`
   * so actions re-enable (KD-16). Parent can pass planApprovalPending.
   */
  awaitingApproval?: boolean
}

function StatusIcon({ status }: { status: PlanItem['status'] }) {
  switch (status) {
    case 'completed':
      return <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden />
    case 'in_progress':
      return <Loader2 size={16} className="mt-0.5 shrink-0 animate-spin text-accent" aria-hidden />
    case 'pending':
    default:
      return <Circle size={16} className="mt-0.5 shrink-0 text-ink-tertiary" aria-hidden />
  }
}

export function PlanApprovalCard({
  plan,
  onApprove,
  onReject,
  onAmend,
  awaitingApproval = true,
}: PlanApprovalCardProps) {
  const { t } = useTranslation()
  const [amendMode, setAmendMode] = useState(false)
  const [amendContent, setAmendContent] = useState('')
  const [responded, setResponded] = useState(false)

  // KD-16: re-enable actions when approval is restored after ok:false.
  useEffect(() => {
    if (awaitingApproval) {
      setResponded(false)
      setAmendMode(false)
      setAmendContent('')
    }
  }, [awaitingApproval])

  const handleApprove = () => {
    setResponded(true)
    try {
      onApprove()
    } catch {
      setResponded(false)
    }
  }

  const handleReject = () => {
    setResponded(true)
    try {
      onReject()
    } catch {
      setResponded(false)
    }
  }

  const handleAmendSubmit = () => {
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
      className="rounded-lg border border-accent/30 bg-accent-subtle px-4 py-3"
      data-testid="plan-approval-card"
    >
      <div className="flex items-center gap-2 text-body font-medium text-ink">
        <ListChecks size={16} className="text-accent" aria-hidden />
        <span>{t('chat.planApproval.title')}</span>
      </div>
      <p className="mt-1 text-meta text-ink-secondary">{t('chat.planApproval.hint')}</p>

      <ul className="mt-3 space-y-2" aria-label={t('chat.planApproval.title')}>
        {(plan ?? []).map((item, index) => (
          <li key={`${index}-${item.content}`} className="flex items-start gap-2 text-body text-ink">
            <StatusIcon status={item.status} />
            <span className={cn(item.status === 'completed' && 'line-through text-ink-secondary')}>
              {item.content}
            </span>
          </li>
        ))}
      </ul>

      {!amendMode ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
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
        <div className="mt-4 space-y-2">
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
              onClick={() => { setAmendMode(false); setAmendContent('') }}
              disabled={responded}
              data-testid="plan-amend-cancel"
            >
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
