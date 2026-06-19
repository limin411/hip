import { useTranslation } from 'react-i18next'
import { ArrowUp, Square } from 'lucide-react'
import { Textarea } from '@/components/ui/Textarea'

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
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-border bg-surface p-2 focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent/8 transition-shadow">
      <Textarea
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
            disabled={!value.trim() || submitDisabled}
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
