import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { sessionService, useActiveSessionId, useActiveMessages, useActiveSessionError, useActiveSessionStatus } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import { MessageBubble } from './MessageBubble'
import { ThinkingBubble } from './ThinkingBubble'

export function ChatPane() {
  const { t } = useTranslation()
  const activeSessionId = useActiveSessionId()
  const messages = useActiveMessages()
  const error = useActiveSessionError()
  const status = useActiveSessionStatus()
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen)
  const scrollTargetMessageId = useUiStore((s) => s.scrollTargetMessageId)
  const setScrollTarget = useUiStore((s) => s.setScrollTarget)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  const last = messages[messages.length - 1]
  const lastActivity =
    last?.role === 'assistant'
      ? last.content.length + (last.timeline?.length ?? 0) + (last.toolCalls?.length ?? 0)
      : 0

  // On session switch, follow the latest — UNLESS a search jump is pending, in which case the
  // target effect positions the view and we stay unpinned until the user scrolls back down.
  // Read the target via getState (not a subscription) so clearing it later does not re-arm autoscroll.
  useEffect(() => {
    setAtBottom(useUiStore.getState().scrollTargetMessageId ? false : true)
  }, [activeSessionId])

  const onScroll = () => {
    const el = scrollRef.current
    if (el) setAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }

  useEffect(() => {
    if (!atBottom || scrollTargetMessageId) return
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, error, lastActivity, atBottom, scrollTargetMessageId])

  // Search jump: when a target message id is set, center it and flash a highlight, then clear the
  // target. If the session is still loading, `messages` is empty and the effect no-ops until they
  // arrive (it re-runs on `messages`). If messages are present but the anchor is gone (deleted/
  // regenerated since indexing), clear the stale target so it doesn't linger.
  useEffect(() => {
    if (!scrollTargetMessageId) return
    const el = scrollRef.current?.querySelector(`[data-message-id="${scrollTargetMessageId}"]`)
    if (el) {
      el.scrollIntoView({ block: 'center' })
      setHighlightedId(scrollTargetMessageId)
    }
    // Either way the target is consumed: found → highlighted; absent (and messages present) → stale, drop it.
    if (el || messages.length > 0) setScrollTarget(null)
  }, [scrollTargetMessageId, messages, setScrollTarget])

  // Fade the landing highlight ~2s after it is set. Kept in its own effect (keyed on highlightedId)
  // so that clearing the scroll target above — which re-runs the jump effect — cannot cancel this
  // timer before it fires.
  useEffect(() => {
    if (!highlightedId) return
    const timer = setTimeout(() => setHighlightedId(null), 2000)
    return () => clearTimeout(timer)
  }, [highlightedId])

  const showThinking = status === 'running' && last?.role === 'user'

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-6 px-5 py-6">
          {messages.map((m, i) => {
            const isLastMessage = i === messages.length - 1
            return (
              <div
                key={`${activeSessionId ?? 'none'}-${m.id}-${i}`}
                data-message-id={m.id}
                className={cn(
                  highlightedId === m.id &&
                    'rounded-lg ring-2 ring-accent/50 bg-accent-subtle transition-[background,box-shadow] duration-700',
                )}
              >
                <MessageBubble
                  message={m}
                  streaming={status === 'running' && m.role === 'assistant' && isLastMessage}
                  isLastAssistant={m.role === 'assistant' && isLastMessage && status !== 'running'}
                />
              </div>
            )
          })}
          {showThinking && <ThinkingBubble />}
          {error && (
            <div
              className={`border px-4 py-3 text-[13px] ${
                error.code === 'NO_API_KEY'
                  ? 'border-amber-500/30 bg-amber-500/10 text-amber-700'
                  : 'border-danger/30 bg-danger/10 text-danger'
              }`}
              data-testid="chat-error"
            >
              <p>
                {error.code === 'NO_API_KEY'
                  ? t('chat.errorNoApiKey')
                  : error.code === 'INTERRUPTED'
                    ? t('chat.errorInterrupted')
                    : error.code === 'TIMEOUT'
                      ? t('chat.errorTimeout')
                      : t('chat.errorGeneric', { message: error.message })}
              </p>
              {error.code === 'NO_API_KEY' ? (
                <button
                  onClick={() => setSettingsOpen(true)}
                  className="mt-2 bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  {t('chat.openSettings')}
                </button>
              ) : (
                <button
                  onClick={() => sessionService.regenerate()}
                  data-testid="chat-error-retry"
                  className="mt-2 bg-accent px-3 py-1.5 text-[12px] font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  {t('chat.retry')}
                </button>
              )}
            </div>
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      {!atBottom && (
        <button
          onClick={() => { setAtBottom(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }}
          data-testid="jump-to-latest"
          title={t('chat.jumpToLatest')}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-[12px] text-ink-secondary shadow-pop transition-colors hover:bg-surface-muted"
        >
          <ChevronDown size={14} />
          {t('chat.jumpToLatest')}
        </button>
      )}
    </div>
  )
}
