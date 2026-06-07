import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useActiveSessionId, useActiveMessages, useActiveSessionError } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import { MessageBubble } from './MessageBubble'

export function ChatPane() {
  const { t } = useTranslation()
  const activeSessionId = useActiveSessionId()
  const messages = useActiveMessages()
  const error = useActiveSessionError()
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = bottomRef.current
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages.length, error])

  if (messages.length === 0 && !error) {
    return (
      <div className="flex flex-1 items-center justify-center text-[13px] text-ink-tertiary">
        {t('chat.sendMessage')}
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-6">
        {messages.map((m, i) => (
          <MessageBubble
            key={`${activeSessionId ?? 'none'}-${m.id}-${i}`}
            message={m}
            streaming={m.role === 'assistant' && i === messages.length - 1}
          />
        ))}
        {error && (
          <div
            className={`border px-4 py-3 text-[13px] ${
              error.code === 'NO_API_KEY'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
                : 'border-danger/30 bg-danger/10 text-danger'
            }`}
          >
            <p>
              {error.code === 'NO_API_KEY'
                ? t('chat.errorNoApiKey')
                : t('chat.errorGeneric', { message: error.message })}
            </p>
            {error.code === 'NO_API_KEY' && (
              <button
                onClick={() => setSettingsOpen(true)}
                className="mt-2 bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover"
              >
                {t('chat.openSettings')}
              </button>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
