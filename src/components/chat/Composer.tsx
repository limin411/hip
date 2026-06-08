import { useTranslation } from 'react-i18next'
import { ArrowUp, Square } from 'lucide-react'
import { Textarea } from '@/components/ui/Textarea'

const ACTIVE_MODEL = 'deepseek-chat'

export function Composer({
  value,
  onChange,
  onSubmit,
  autoFocus,
  running,
  onStop,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  autoFocus?: boolean
  running?: boolean
  onStop?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-border bg-surface p-2 shadow-pop focus-within:ring-2 focus-within:ring-accent/30">
      <Textarea
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSubmit()
          }
        }}
        rows={2}
        placeholder={t('chat.inputPlaceholder')}
        className="border-0 px-2 py-1 focus-visible:ring-0"
      />
      <div className="flex items-center justify-between px-1 pt-1">
        <span className="text-[12px] text-ink-tertiary">{ACTIVE_MODEL}</span>
        {running && onStop ? (
          <button
            onClick={onStop}
            data-testid="composer-stop"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover"
            title={t('chat.stop')}
          >
            <Square size={15} />
          </button>
        ) : (
          <button
            onClick={onSubmit}
            disabled={!value.trim()}
            data-testid="composer-send"
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            title={t('chat.send')}
          >
            <ArrowUp size={17} />
          </button>
        )}
      </div>
    </div>
  )
}
