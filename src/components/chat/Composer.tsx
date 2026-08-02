import { useTranslation } from 'react-i18next'
import { ArrowUp, Square } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Textarea } from '@/components/ui/Textarea'
import { cn } from '@/lib/utils'
import type { LocalAttachment } from './attachmentTypes'
import { TokenUsageChip } from './TokenUsageChip'
import { VOICE_INPUT } from './voiceFeature'
import { VoiceMicButton } from './VoiceMicButton'

/** Collapse whitespace for the one-line quote chip; CSS truncate handles overflow. */
function quotePreviewLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

export type ComposerVariant = 'flat' | 'card'

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
  inputDisabled,
  placeholder,
  attachments = [],
  onAttachmentsChange,
  quoteText,
  onQuoteClear,
  annotationCount = 0,
  onAnnotationClear,
  inputRef,
  variant = 'flat',
  textareaHeight,
  footer,
  danger = false,
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
  /** When true, textarea is not editable (e.g. project folder required). */
  inputDisabled?: boolean
  placeholder?: string
  attachments?: LocalAttachment[]
  onAttachmentsChange?: (attachments: LocalAttachment[]) => void
  /** Pending quote shown as a compact chip above the input (full text used on send). */
  quoteText?: string | null
  onQuoteClear?: () => void
  /** Pending diff annotations chip count. */
  annotationCount?: number
  onAnnotationClear?: () => void
  inputRef?: React.RefObject<HTMLTextAreaElement>
  /**
   * `card` — rounded rectangle shell (new-conversation empty state + session InputBar).
   * `flat` — no chrome (legacy / tests).
   */
  variant?: ComposerVariant
  /** Fixed textarea height in px (session InputBar resize). When set, overrides rows. */
  textareaHeight?: number
  /**
   * Footer row below the input (Copilot / Cursor style status strip): rendered at the
   * bottom of the card, separated by a hairline from the toolbar row. Code surface
   * uses it for the branch switcher. Optional — hidden when absent.
   */
  footer?: React.ReactNode
  /**
   * Danger tone: swaps the card border to danger red (armed control-permission
   * mode). Only affects the `card` variant.
   */
  danger?: boolean
}) {
  const { t } = useTranslation()
  const hasQuote = !!quoteText?.trim()
  const hasAnns = annotationCount > 0
  const isCard = variant === 'card'
  const locked = !!inputDisabled
  return (
    <div
      className={cn(
        isCard
          ? cn(
              'rounded-lg border bg-surface-subtle p-2.5',
              danger ? 'border-danger-soft' : 'border-border',
            )
          // Flat dock: no focus chrome — InputBar already draws the top rule.
          : 'bg-surface-subtle',
      )}
      data-testid="composer"
      data-variant={variant}
    >
      {hasAnns && (
        <div
          className={cn(
            'mb-2 flex items-center gap-2 rounded-md border border-border bg-surface-muted px-2.5 py-1.5',
          )}
          data-testid="composer-diff-annotations"
        >
          <span className="min-w-0 flex-1 truncate text-meta text-ink-secondary">
            {t('chat.diffAnnotations.chip', { count: annotationCount })}
          </span>
          <button
            type="button"
            className="shrink-0 text-ink-tertiary hover:text-ink"
            onClick={() => onAnnotationClear?.()}
            aria-label={t('chat.diffAnnotations.clear')}
            data-testid="composer-diff-annotations-clear"
          >
            ×
          </button>
        </div>
      )}
      {hasQuote && (
        <div
          className={cn(
            'mb-2 flex items-start gap-2 rounded-md border-l-2 border-accent bg-surface-muted px-2.5 py-1.5',
          )}
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
        <div className={cn('flex flex-wrap gap-1 pb-2', isCard && 'px-2')}>
          {attachments.map((a) => (
            <div
              key={a.id}
              className={cn(
                'flex items-center gap-1 rounded-md bg-surface-muted px-2 py-1 text-meta',
              )}
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
        disabled={locked}
        readOnly={locked}
        onChange={(e) => {
          if (locked) return
          onChange(e.target.value)
        }}
        onKeyDown={(e) => {
          if (locked) {
            e.preventDefault()
            return
          }
          // IME: Enter confirms composition (pinyin etc.) — must not send.
          if (e.nativeEvent.isComposing || e.key === 'Process') return
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (!running && !submitDisabled) onSubmit()
          }
        }}
        rows={textareaHeight != null ? 1 : 2}
        placeholder={placeholder ?? t('chat.inputPlaceholder')}
        style={textareaHeight != null ? { height: textareaHeight } : undefined}
        className={cn(
          // Textarea defaults (bg-surface + rounded-md) would stack a white inset over the shell.
          'border-0 bg-transparent rounded-none focus-visible:ring-0',
          isCard ? 'px-2 py-1' : 'px-0 py-1',
          textareaHeight != null && 'min-h-0 overflow-y-auto',
          locked && 'cursor-not-allowed opacity-60',
        )}
      />
      <div className={cn('flex items-center justify-between pt-1.5', isCard && 'px-0.5')}>
        <div className={cn('flex items-center gap-0.5', locked && 'pointer-events-none opacity-50')}>
          {leftSlot}
        </div>
        <div className="flex items-center gap-1.5">
          <TokenUsageChip />
          {VOICE_INPUT ? (
            <VoiceMicButton
              value={value}
              onChange={onChange}
              disabled={locked}
              inputRef={inputRef}
            />
          ) : null}
          {running && onStop ? (
            <>
              {reconnecting && (
                <span className="text-meta text-ink-tertiary">{t('chat.reconnecting')}</span>
              )}
              <Button
                type="button"
                variant="primary"
                size="icon"
                className={cn('h-7 w-7 shrink-0 rounded-sm')}
                onClick={onStop}
                disabled={reconnecting}
                data-testid="composer-stop"
                title={t('chat.stop')}
              >
                <Square size={12} strokeWidth={1.75} />
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              size="icon"
              className={cn('h-7 w-7 shrink-0 rounded-sm')}
              onClick={onSubmit}
              disabled={locked || (!value.trim() && attachments.length === 0) || submitDisabled}
              data-testid="composer-send"
              title={t('chat.send')}
            >
              <ArrowUp size={15} strokeWidth={1.75} />
            </Button>
          )}
        </div>
      </div>
      {footer ? (
        <div
          className={cn(
            'mt-1 flex flex-wrap items-center gap-0.5 border-t border-border/60 pt-1',
            isCard && 'px-0.5',
          )}
          data-testid="composer-footer"
        >
          {footer}
        </div>
      ) : null}
    </div>
  )
}
