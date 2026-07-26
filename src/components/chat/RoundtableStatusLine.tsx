import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'
import {
  deriveRoundtableRoundNumber,
  deriveRoundtableStatusKey,
} from '@/lib/roundtableSections'
import { cn } from '@/lib/utils'

interface RoundtableStatusLineProps {
  content: string
  streaming?: boolean
  className?: string
}

/** Quiet status under a streaming roundtable turn. */
export function RoundtableStatusLine({ content, streaming, className }: RoundtableStatusLineProps) {
  const { t } = useTranslation()
  if (!streaming) return null
  const key = deriveRoundtableStatusKey(content, true)
  if (!key) return null
  const round = deriveRoundtableRoundNumber(content)
  const label =
    key === 'round' && round != null
      ? t('chat.roundtable.status.roundN', { n: round })
      : t(`chat.roundtable.status.${key}`)

  return (
    <div
      className={cn(
        'mt-1 flex min-h-[var(--trail-min-h)] items-center gap-1.5 text-meta text-ink-tertiary',
        className,
      )}
      data-testid="roundtable-status"
    >
      <Loader2 size={14} className="animate-spin text-accent-strong" aria-hidden />
      <span>{label}</span>
    </div>
  )
}
