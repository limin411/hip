import { useTranslation } from 'react-i18next'

export function ThinkingBubble() {
  const { t } = useTranslation()
  return (
    <div className="flex gap-3" data-testid="thinking-bubble">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-caption font-semibold text-white">
        AI
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1 text-meta font-medium text-ink-secondary">hip</div>
        <div className="text-prose leading-relaxed text-ink-tertiary">
          <span>
            {t('chat.thinking')}
            <span className="inline-flex gap-0.5 ml-0.5 align-middle">
              <span className="inline-block w-1 h-1 rounded-full bg-ink-tertiary animate-dot-bounce [animation-delay:0ms]" />
              <span className="inline-block w-1 h-1 rounded-full bg-ink-tertiary animate-dot-bounce [animation-delay:150ms]" />
              <span className="inline-block w-1 h-1 rounded-full bg-ink-tertiary animate-dot-bounce [animation-delay:300ms]" />
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}
