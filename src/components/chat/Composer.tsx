import { useTranslation } from 'react-i18next'
import { ArrowUp, Square } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import type { LocalAttachment } from './attachmentTypes'

/** Collapse whitespace for the one-line quote chip; CSS truncate handles overflow. */
function quotePreviewLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export function Composer({
  value,
  onChange,
  onSubmit,
  autoFocus,
  running,
  onStop,
  reconnecting,
  leftSlot,
  submitDisabled,
  attachments = [],
  onAttachmentsChange,
  quoteText,
  onQuoteClear,
  inputRef,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  autoFocus?: boolean
  running?: boolean
  onStop?: () => void
  reconnecting?: boolean
  leftSlot?: React.ReactNode
  submitDisabled?: boolean
  attachments?: LocalAttachment[]
  onAttachmentsChange?: (attachments: LocalAttachment[]) => void
  /** Pending quote shown as a compact chip above the input (full text used on send). */
  quoteText?: string | null
  onQuoteClear?: () => void
  inputRef?: React.RefObject<HTMLTextAreaElement>
}) {
  const { t } = useTranslation()
  const hasQuote = !!quoteText?.trim()
  return (
    <div className="rounded-xl border border-border bg-surface p-2 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/8 transition-shadow">
      {hasQuote && (
        <div
          className="mb-2 flex items-start gap-2 rounded-md border-l-2 border-accent bg-surface-muted px-2.5 py-1.5"
          data-testid="composer-quote"
        >
          <span
            className="min-w-0 flex-1 truncate text-meta text-ink-secondary"
            title={quoteText!}
          >
            {quotePreviewLine(quoteText!)}
          </span>
          <button
            type="button"
            className="shrink-0 text-ink-tertiary hover:text-ink"
            onClick={() => onQuoteClear?.()}
            aria-label={t('chat.removeQuote')}
            data-testid="composer-quote-remove"
          >
            ×
          </button>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 pb-2">
          {attachments.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-meta"
              data-testid="attachment-chip"
            >
              <span className="max-w-[120px] truncate">{a.name}</span>
              <button
                type="button"
                className="text-ink-tertiary hover:text-ink"
                onClick={() => onAttachmentsChange?.(attachments.filter((x) => x.id !== a.id))}
                aria-label={t('chat.removeAttachment', { name: a.name })}
                data-testid="attachment-remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <Textarea
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (!running && !submitDisabled) onSubmit()
          }
        }}
        rows={2}
        placeholder={t('chat.inputPlaceholder')}
        className="border-0 px-2 py-1 focus-visible:ring-0"
      />
      <div className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-1">
          {leftSlot}
        </div>
        {running && onStop ? (
          <div className="flex items-center gap-2">
            {reconnecting && <span className="text-meta text-ink-tertiary">{t('chat.reconnecting')}</span>}
            <Button
              type="button"
              variant="primary"
              size="icon"
              className="h-7 w-7 shrink-0 rounded-full"
              onClick={onStop}
              disabled={reconnecting}
              data-testid="composer-stop"
              title={t('chat.stop')}
            >
              <Square size={14} />
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            size="icon"
            className="h-7 w-7 shrink-0 rounded-full"
            onClick={onSubmit}
            disabled={(!value.trim() && attachments.length === 0) || submitDisabled}
            data-testid="composer-send"
            title={t('chat.send')}
          >
            <ArrowUp size={15} />
          </Button>
        )}
      </div>
    </div>
  )
}
