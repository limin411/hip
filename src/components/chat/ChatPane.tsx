import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { sessionService, useActiveSession, useActiveSessionId, useActiveMessages, useActiveSessionError, useActiveSessionStatus, useActiveInterrupt } from '@/domain'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { MessageBubble } from './MessageBubble'
import { ThinkingBubble } from './ThinkingBubble'
import { PermissionModal } from './PermissionModal'
import { PlanApprovalCard } from './PlanApprovalCard'
import { hasPlanApproval } from './planApproval'

export function ChatPane() {
  const { t } = useTranslation()
  const session = useActiveSession()
  const showPlanApproval = hasPlanApproval(session)
  const activeSessionId = useActiveSessionId()
  const messages = useActiveMessages()
  const error = useActiveSessionError()
  const status = useActiveSessionStatus()
  const interrupt = useActiveInterrupt()
  const setActiveView = useUiStore((s) => s.setActiveView)
  const scrollTargetMessageId = useUiStore((s) => s.scrollTargetMessageId)
  const setScrollTarget = useUiStore((s) => s.setScrollTarget)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  // Only animate genuinely NEW messages (appended after the session loaded) — not the whole
  // transcript on every session switch. Capture a per-session baseline count at switch time;
  // messages at index >= baseline are the ones that arrived live and get the enter animation.
  const animSessionRef = useRef<string | null>(null)
  const animBaselineRef = useRef(0)
  if (animSessionRef.current !== (activeSessionId ?? null)) {
    animSessionRef.current = activeSessionId ?? null
    animBaselineRef.current = messages.length
  }

  const showAgentRestart =
    !!session &&
    !!session.config.agentId &&
    session.config.agentId !== 'builtin' &&
    messages.some((m) => m.role === 'assistant')

  const last = messages[messages.length - 1]
  const lastActivity =
    last?.role === 'assistant'
      ? last.content.length + (last.timeline?.length ?? 0) + (last.toolCalls?.length ?? 0)
      : 0

  // On session switch, follow the latest — UNLESS a search jump is pending, in which case the
  // target effect positions the view and we stay unpinned until the user scrolls back down.
  // Read the target via getState (not a subscription) so clearing it later does not re-arm autoscroll.
  useEffect(() => {
    setAtBottom(!useUiStore.getState().scrollTargetMessageId)
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
    const el = scrollRef.current?.querySelector(`[data-message-id="${CSS.escape(scrollTargetMessageId)}"]`)
    if (el) {
      el.scrollIntoView({ block: 'center' })
      setHighlightedId(scrollTargetMessageId)
      // Unpin from the bottom so that clearing the target below (which re-runs the autoscroll
      // effect) doesn't yank us to the latest message — covers a jump within the already-active
      // session, where the session-switch reset doesn't fire to do this for us.
      setAtBottom(false)
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
        <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-6">
          {showAgentRestart && (
            <div className="mx-auto my-2 w-fit rounded-full bg-surface-muted px-3 py-1 text-meta text-ink-tertiary">
              {t('chat.agentRestarted')}
            </div>
          )}
          {messages.map((m, i) => {
            const isLastMessage = i === messages.length - 1
            const isNew = i >= animBaselineRef.current
            return (
              <div
                key={`${activeSessionId ?? 'none'}-${m.id}`}
                data-message-id={m.id}
                // Transition lives on the always-present base classes so the highlight fades on the
                // way OUT too (when the color/ring classes are removed), not just on the way in.
                className={cn(
                  'transition-[background-color,box-shadow] duration-700',
                  isNew && (m.role === 'user' ? 'animate-msg-enter-right' : 'animate-msg-enter-left'),
                  highlightedId === m.id && 'bg-accent-subtle ring-2 ring-accent/50',
                )}
              >
                <MessageBubble
                  message={m}
                  streaming={status === 'running' && m.role === 'assistant' && isLastMessage}
                  isLastAssistant={m.role === 'assistant' && isLastMessage && status !== 'running' && !interrupt}
                />
              </div>
            )
          })}
          {showThinking && <ThinkingBubble />}
          {interrupt && !showPlanApproval && (
            <div className="rounded-lg border border-accent/30 bg-accent-subtle px-4 py-3 text-body text-ink" data-testid="chat-interrupt">
              <p className="flex items-start gap-2"><span aria-hidden>⏸</span><span>{interrupt.question}</span></p>
              <p className="mt-1 text-meta text-ink-secondary">{t('chat.interruptHint')}</p>
            </div>
          )}
          {showPlanApproval && session?.activeTurnPlan && (
            <PlanApprovalCard
              plan={session.activeTurnPlan}
              onApprove={() => sessionService.respondPlan('approve')}
              onReject={() => sessionService.respondPlan('reject')}
              onAmend={(content) => sessionService.respondPlan('amend', content)}
            />
          )}
          {error && (
            <div
              className={`rounded-lg border px-4 py-3 text-body ${
                error.code === 'NO_API_KEY'
                  ? 'border-warning/30 bg-warning/10 text-warning'
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
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => setActiveView('settings')}
                  className="mt-2"
                >
                  {t('chat.openSettings')}
                </Button>
              ) : (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => sessionService.regenerate()}
                  data-testid="chat-error-retry"
                  className="mt-2"
                >
                  {t('chat.retry')}
                </Button>
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
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-meta text-ink-secondary transition-colors hover:bg-surface-muted"
        >
          <ChevronDown size={14} />
          {t('chat.jumpToLatest')}
        </button>
      )}
      <PermissionModal />
    </div>
  )
}
