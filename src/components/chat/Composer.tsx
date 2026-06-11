import { useTranslation } from 'react-i18next'
import { ArrowUp, Brain, Square } from 'lucide-react'
import { Textarea } from '@/components/ui/Textarea'
import { ComposerChip } from './ComposerChip'

export function Composer({
  value,
  onChange,
  onSubmit,
  autoFocus,
  running,
  onStop,
  thinking = true,
  onToggleThinking,
  thinkingDisabled,
  reconnecting,
  leftSlot,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  autoFocus?: boolean
  running?: boolean
  onStop?: () => void
  thinking?: boolean
  onToggleThinking?: (next: boolean) => void
  thinkingDisabled?: boolean
  reconnecting?: boolean
  leftSlot?: React.ReactNode
}) {
  const { t } = useTranslation()
  const toggleDisabled = thinkingDisabled || !onToggleThinking
  return (
    <div className="rounded-xl border border-border bg-surface p-2 focus-within:ring-2 focus-within:ring-accent/60">
      <Textarea
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (!running) onSubmit()
          }
        }}
        rows={2}
        placeholder={t('chat.inputPlaceholder')}
        className="border-0 px-2 py-1 focus-visible:ring-0"
      />
      <div className="flex items-center justify-between px-1 pt-1">
        <div className="flex items-center gap-1">
          <ComposerChip
            onClick={() => onToggleThinking?.(!thinking)}
            disabled={toggleDisabled}
            active={thinking}
            aria-pressed={thinking}
            title={t('chat.thinkingModeHint')}
            data-testid="thinking-toggle"
          >
            <Brain size={13} className="shrink-0" aria-hidden />
            <span>{t('chat.thinkingMode')}</span>
          </ComposerChip>
          {leftSlot}
        </div>
        {running && onStop ? (
          <div className="flex items-center gap-2">
            {reconnecting && <span className="text-meta text-ink-tertiary">{t('chat.reconnecting')}</span>}
            <button
              type="button"
              onClick={onStop}
              disabled={reconnecting}
              data-testid="composer-stop"
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              title={t('chat.stop')}
            >
              <Square size={15} />
            </button>
          </div>
        ) : (
          <button
            onClick={onSubmit}
            disabled={!value.trim()}
            data-testid="composer-send"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            title={t('chat.send')}
          >
            <ArrowUp size={17} />
          </button>
        )}
      </div>
    </div>
  )
}
