import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import {
  sessionService,
  useActiveSessionId,
  useActiveMessages,
  useActiveChatPlanSlice,
  useActiveSessionError,
  useActiveSessionStatus,
  useActiveInterrupt,
  useDomainStore,
} from '@/domain'
import { isCurrentTurnAssistant, isStreamingAssistant, lastAssistantIndex, lastNonNotice } from '@/domain/sessionStore'
import { useUiStore } from '@/store/uiStore'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/Button'
import { exportSessionDebugBundle } from '@/lib/exportSessionDebug'
import { sessionDebugBundleJson } from '@/lib/sessionDebugBundle'
import { selectLivePlan } from '@/lib/todos'
import { toast } from 'sonner'
import { scrollTranscriptToMessage } from '@/lib/transcriptJump'
import {
  TRANSCRIPT_WINDOW_SIZE,
  growWindowSize,
  transcriptWindowStart,
  windowSizeToInclude,
} from '@/lib/transcriptWindow'
import { MessageBubble, NoticeRow } from './MessageBubble'
import { ThinkingBubble } from './ThinkingBubble'

export function ChatPane() {
  const { t } = useTranslation()
  // Isolated slices: messages / status / plan — not the whole SessionVM — so title,
  // planDeltaDraft, permission, and other session noise do not re-render the transcript list.
  const activeSessionId = useActiveSessionId()
  const messages = useActiveMessages()
  const error = useActiveSessionError()
  const status = useActiveSessionStatus()
  const interrupt = useActiveInterrupt()
  const planSlice = useActiveChatPlanSlice()
  const showPlanApproval =
    planSlice.planApprovalPending && (planSlice.activeTurnPlan?.length ?? 0) > 0
  const setActiveView = useUiStore((s) => s.setActiveView)
  const scrollTargetMessageId = useUiStore((s) => s.scrollTargetMessageId)
  const setScrollTarget = useUiStore((s) => s.setScrollTarget)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // Sync pin flag so autoscroll cannot re-stick to bottom in the same frame a jump clears
  // scrollTarget (React state for atBottom is one paint behind).
  const followBottomRef = useRef(true)
  // Preserve scroll position when prepending via "Load earlier" (not used for jump expand).
  const pendingScrollAdjustRef = useRef<number | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  // PR-7b / KD-15: mount last N messages; grow via "Load earlier" or jump ensure-mount.
  const [windowSize, setWindowSize] = useState(TRANSCRIPT_WINDOW_SIZE)

  // Only animate genuinely NEW messages (appended after the session loaded) — not the whole
  // transcript on every session switch. Capture a per-session baseline count at switch time;
  // messages at index >= baseline are the ones that arrived live and get the enter animation.
  const animSessionRef = useRef<string | null>(null)
  const animBaselineRef = useRef(0)
  if (animSessionRef.current !== (activeSessionId ?? null)) {
    animSessionRef.current = activeSessionId ?? null
    animBaselineRef.current = messages.length
  }

  // Reset window when switching sessions (render-time adjust so jump layout effect sees N=30,
  // not a stale expanded size from the previous session).
  const windowSessionRef = useRef<string | null>(activeSessionId ?? null)
  if (windowSessionRef.current !== (activeSessionId ?? null)) {
    windowSessionRef.current = activeSessionId ?? null
    setWindowSize(TRANSCRIPT_WINDOW_SIZE)
  }

  const startIndex = transcriptWindowStart(messages.length, windowSize)
  const visibleMessages = useMemo(
    () => (startIndex === 0 ? messages : messages.slice(startIndex)),
    [messages, startIndex],
  )
  const hasEarlier = startIndex > 0

  const showAgentRestart =
    !!planSlice.agentId &&
    planSlice.agentId !== 'builtin' &&
    messages.some((m) => m.role === 'assistant')

  const last = messages[messages.length - 1]
  const lastAsstIdx = lastAssistantIndex(messages)
  const lastAssistant = lastAsstIdx >= 0 ? messages[lastAsstIdx] : null
  const lastActivity =
    lastAssistant
      ? lastAssistant.content.length + (lastAssistant.timeline?.length ?? 0) + (lastAssistant.toolCalls?.length ?? 0)
      : last?.role === 'notice'
        ? last.content.length
        : 0

  // On session switch, follow the latest — UNLESS a search jump is pending, in which case the
  // target effect positions the view and we stay unpinned until the user scrolls back down.
  // Read the target via getState (not a subscription) so clearing it later does not re-arm autoscroll.
  useEffect(() => {
    const pendingJump = Boolean(useUiStore.getState().scrollTargetMessageId)
    followBottomRef.current = !pendingJump
    setAtBottom(!pendingJump)
  }, [activeSessionId])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80
    followBottomRef.current = nearBottom
    setAtBottom(nearBottom)
  }

  useEffect(() => {
    if (!followBottomRef.current || !atBottom || scrollTargetMessageId) return
    // Spec A4: pinned-to-bottom uses instant scroll — smooth + high-frequency tokens fights.
    // End sentinel (bottomRef) stays mounted outside the window slice.
    bottomRef.current?.scrollIntoView({ behavior: 'auto' })
  }, [messages.length, error, lastActivity, atBottom, scrollTargetMessageId])

  // After "Load earlier" prepends DOM, restore viewport so content does not jump.
  useLayoutEffect(() => {
    const prevHeight = pendingScrollAdjustRef.current
    if (prevHeight == null) return
    pendingScrollAdjustRef.current = null
    const el = scrollRef.current
    if (!el) return
    el.scrollTop += el.scrollHeight - prevHeight
  }, [windowSize, startIndex])

  // Search / outline jump: ensure target is mounted (expand window if needed), then pin + highlight.
  // Do not rely only on querySelector — unmounted messages are not in the DOM (PR-7b).
  useLayoutEffect(() => {
    if (!scrollTargetMessageId) return

    const targetIdx = messages.findIndex((m) => m.id === scrollTargetMessageId)
    if (targetIdx < 0) {
      // Messages present but id missing → stale target (deleted/regenerated).
      if (messages.length > 0) setScrollTarget(null)
      return
    }

    const needSize = windowSizeToInclude(messages.length, targetIdx)
    if (needSize > windowSize) {
      // Expand first; keep target so this effect re-runs after mount.
      setWindowSize(needSize)
      return
    }

    const el = scrollRef.current?.querySelector(
      `[data-message-id="${CSS.escape(scrollTargetMessageId)}"]`,
    )
    if (el instanceof HTMLElement) {
      // Unpin first so any concurrent autoscroll effect skips on the next paint.
      followBottomRef.current = false
      setAtBottom(false)
      scrollTranscriptToMessage(scrollTargetMessageId)
      setHighlightedId(scrollTargetMessageId)
      setScrollTarget(null)
      return
    }

    // In window range but node not yet in DOM (rare); keep target for a later paint.
  }, [scrollTargetMessageId, messages, windowSize, setScrollTarget])

  // Fade the landing highlight ~2s after it is set. Kept in its own effect (keyed on highlightedId)
  // so that clearing the scroll target above — which re-runs the jump effect — cannot cancel this
  // timer before it fires.
  useEffect(() => {
    if (!highlightedId) return
    const timer = setTimeout(() => setHighlightedId(null), 2000)
    return () => clearTimeout(timer)
  }, [highlightedId])

  // Notices are transparent for turn boundary: [user, notice] while waiting still shows thinking.
  const showThinking = status === 'running' && lastNonNotice(messages)?.role === 'user'

  const livePlan = useMemo(
    () =>
      activeSessionId
        ? selectLivePlan({
            messages,
            status,
            forcePlan: planSlice.forcePlan,
            planApprovalPending: planSlice.planApprovalPending,
            activeTurnPlan: planSlice.activeTurnPlan,
          })
        : null,
    [
      activeSessionId,
      messages,
      status,
      planSlice.forcePlan,
      planSlice.planApprovalPending,
      planSlice.activeTurnPlan,
    ],
  )
  const hideBubblePlan = livePlan !== null

  const loadEarlier = () => {
    const el = scrollRef.current
    if (el) pendingScrollAdjustRef.current = el.scrollHeight
    setWindowSize((w) => growWindowSize(messages.length, w))
  }

  const exportDebugInfo = async () => {
    if (!activeSessionId) return
    // Read full session snapshot only when exporting (avoid subscribing ChatPane to whole VM).
    const session = useDomainStore.getState().sessions.find((x) => x.id === activeSessionId)
    if (!session) return
    const text = sessionDebugBundleJson({
      sessionId: activeSessionId,
      title: session.title,
      config: session.config,
      messages,
      recentErrors: error
        ? [{ code: error.code, message: error.message, at: Date.now() }]
        : undefined,
      ui: {
        status,
        planApprovalPending: Boolean(session.planApprovalPending),
        interrupt: interrupt ?? null,
        activeTurnPlan: session.activeTurnPlan ?? null,
        forcePlan: Boolean(session.config.forcePlan),
      },
    })
    const result = await exportSessionDebugBundle(text, activeSessionId)
    if (result === 'saved') {
      toast.success(t('chat.exportDebugDone'))
    } else if (result === 'failed') {
      toast.error(t('chat.exportDebugFailed'))
    }
  }

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full min-h-0 overflow-y-auto"
        data-transcript-scroll=""
        data-testid="chat-transcript-scroll"
      >
        {/* CLI-style transcript: full-width left-aligned, no centered chat column */}
        <div className="flex w-full flex-col gap-5 px-4 py-4">
          {hasEarlier && (
            <div className="flex justify-center">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                data-testid="load-earlier"
                onClick={loadEarlier}
              >
                {t('chat.loadEarlier')}
              </Button>
            </div>
          )}
          {showAgentRestart && (
            <div className="my-1 w-fit bg-surface-muted px-2 py-0.5 text-meta text-ink-tertiary">
              {t('chat.agentRestarted')}
            </div>
          )}
          {visibleMessages.map((m, localI) => {
            const i = startIndex + localI
            const isNew = i >= animBaselineRef.current
            const streaming = isStreamingAssistant(messages, i, status)
            // Same “no user after” guard as streaming — do not offer regenerate on a prior
            // completed assistant while a newer user turn is pending provisional.
            const isLastAsst = isCurrentTurnAssistant(messages, i)
            return (
              <div
                key={`${activeSessionId ?? 'none'}-${m.id}`}
                data-message-id={m.id}
                // Transition lives on the always-present base classes so the highlight fades on the
                // way OUT too (when the color/ring classes are removed), not just on the way in.
                className={cn(
                  'transition-[background-color,box-shadow] duration-700',
                  isNew && 'animate-msg-enter-left',
                  highlightedId === m.id && 'bg-accent-subtle ring-1 ring-accent/40',
                )}
              >
                {m.role === 'notice' ? (
                  <NoticeRow content={m.content} />
                ) : (
                  <MessageBubble
                    message={m}
                    streaming={streaming}
                    isLastAssistant={isLastAsst}
                    hidePlan={hideBubblePlan && isLastAsst}
                  />
                )}
              </div>
            )
          })}
          {showThinking && <ThinkingBubble />}
          {interrupt && !showPlanApproval && (
            <div className="border border-accent/30 bg-accent-subtle px-3 py-2.5 text-body text-ink" data-testid="chat-interrupt">
              <p className="flex items-start gap-2"><span aria-hidden>⏸</span><span>{interrupt.question}</span></p>
              <p className="mt-1 text-meta text-ink-secondary">{t('chat.interruptHint')}</p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  data-testid="chat-interrupt-continue"
                  onClick={() => sessionService.sendMessage(t('chat.interruptContinueMessage'))}
                >
                  {t('chat.interruptContinue')}
                </Button>
              </div>
            </div>
          )}
          {error && (
            <div
              className={`border px-3 py-2.5 text-body ${
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
              <div className="mt-2 flex flex-wrap gap-2">
                {error.code === 'NO_API_KEY' ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setActiveView('settings')}
                  >
                    {t('chat.openSettings')}
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => sessionService.regenerate()}
                    data-testid="chat-error-retry"
                  >
                    {t('chat.retry')}
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void exportDebugInfo()}
                  data-testid="chat-export-debug"
                  title={t('chat.exportDebugHint')}
                >
                  {t('chat.exportDebug')}
                </Button>
              </div>
            </div>
          )}
          <div ref={bottomRef} data-testid="transcript-end-sentinel" />
        </div>
      </div>
      {!atBottom && (
        <button
          onClick={() => {
            followBottomRef.current = true
            setAtBottom(true)
            bottomRef.current?.scrollIntoView({ behavior: 'auto' })
          }}
          data-testid="jump-to-latest"
          title={t('chat.jumpToLatest')}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-meta text-ink-secondary transition-colors hover:bg-surface-muted"
        >
          <ChevronDown size={14} />
          {t('chat.jumpToLatest')}
        </button>
      )}
    </div>
  )
}
