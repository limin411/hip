import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ChevronDown } from 'lucide-react'
import {
  sessionService,
  useActiveSession,
  useActiveSessionId,
  useActiveMessages,
  useActiveChatPlanSlice,
  useActiveSessionError,
  useActiveSessionStatus,
  useActiveInterrupt,
  useDomainStore,
} from '@/domain'
import { surfaceOf } from '@/lib/sessions'
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
import * as chatFeature from './feature'
import { shouldHideInterruptForPlanApproval } from './planApproval'
import { MessageBubble, NoticeRow } from './MessageBubble'
import { ThinkingBubble } from './ThinkingBubble'
import type { Message } from '@hip/protocol'

export function ChatPane() {
  const { t } = useTranslation()
  // Isolated slices: messages / status / plan — not the whole SessionVM — so title,
  // planDeltaDraft, permission, and other session noise do not re-render the transcript list.
  const activeSessionId = useActiveSessionId()
  const activeSession = useActiveSession()
  const isChatSurface = activeSession ? surfaceOf(activeSession.config) === 'chat' : false
  const messages = useActiveMessages()
  const error = useActiveSessionError()
  const status = useActiveSessionStatus()
  const interrupt = useActiveInterrupt()
  const planSlice = useActiveChatPlanSlice()
  // D5.2 / KD-PA-3 / KD-PA-6: hide interrupt for any planApprovalPending (empty checklist too)
  // or defensive plan_approval context/token — sticky panel owns CTA.
  const showPlanApproval = shouldHideInterruptForPlanApproval(
    planSlice.planApprovalPending,
    interrupt,
  )
  const setActiveView = useUiStore((s) => s.setActiveView)
  const scrollTargetMessageId = useUiStore((s) => s.scrollTargetMessageId)
  const setScrollTarget = useUiStore((s) => s.setScrollTarget)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualListRef = useRef<HTMLDivElement>(null)
  // Sync pin flag so autoscroll cannot re-stick to bottom in the same frame a jump clears
  // scrollTarget (React state for atBottom is one paint behind).
  const followBottomRef = useRef(true)
  // Preserve scroll position when prepending via "Load earlier" (not used for jump expand).
  const pendingScrollAdjustRef = useRef<number | null>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  // PR-7b / KD-15: mount last N messages; grow via "Load earlier" or jump ensure-mount.
  const [windowSize, setWindowSize] = useState(TRANSCRIPT_WINDOW_SIZE)
  // Offset of the virtual list within the scroll content (header chrome above messages).
  const [scrollMargin, setScrollMargin] = useState(0)
  // O1: after scrollToIndex the row may not be in DOM yet (virtual overscan lag / no flushSync
  // from layout). Bump this via rAF so the jump effect re-runs and completes highlight.
  const [jumpPaintTick, setJumpPaintTick] = useState(0)
  const jumpRetryCountRef = useRef(0)
  const jumpRetryTargetRef = useRef<string | null>(null)

  // Namespace read so tests can mock a live getter (named import freezes the value).
  const virtualize = chatFeature.TRANSCRIPT_VIRTUALIZE

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

  // Virtualizer over the *mounted window* only (PR-7c on top of 7b). Hooks must be unconditional.
  const rowVirtualizer = useVirtualizer({
    count: virtualize ? visibleMessages.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => chatFeature.TRANSCRIPT_ROW_ESTIMATE_PX,
    overscan: 4,
    gap: chatFeature.TRANSCRIPT_ROW_GAP_PX,
    scrollMargin,
    getItemKey: (index) => visibleMessages[index]?.id ?? index,
    enabled: virtualize,
  })

  // Measure list offset inside the scroller so absolute item positions account for chrome above.
  useLayoutEffect(() => {
    if (!virtualize) return
    const scrollEl = scrollRef.current
    const listEl = virtualListRef.current
    if (!scrollEl || !listEl) return
    const next =
      listEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop
    setScrollMargin((prev) => (Math.abs(prev - next) < 0.5 ? prev : next))
  }, [virtualize, hasEarlier, showAgentRestart, windowSize, activeSessionId, visibleMessages.length])

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
    // End sentinel (bottomRef) stays mounted outside the window slice and virtual range.
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

  // Streaming / last-item growth: remeasure last row (ResizeObserver also runs via measureElement).
  useLayoutEffect(() => {
    if (!virtualize || visibleMessages.length === 0) return
    const lastLocal = visibleMessages.length - 1
    const el = scrollRef.current?.querySelector(
      `[data-index="${lastLocal}"]`,
    )
    if (el instanceof HTMLElement) {
      rowVirtualizer.measureElement(el)
    }
  }, [virtualize, lastActivity, visibleMessages.length, rowVirtualizer])

  // Search / outline jump: messageId → index; expand window if needed; scroll + highlight.
  // Virtual path uses scrollToIndex (item may not be in DOM until virtualizer mounts it).
  // Do not rely only on querySelector — unmounted messages are not in the DOM (PR-7b/7c).
  // O1: when the node is still missing after scrollToIndex, schedule rAF retries via
  // jumpPaintTick — deps do not change from virtualizer alone, so without this the highlight
  // and scrollTarget clear never complete (stuck autoscroll gate).
  const JUMP_RETRY_MAX = 16
  useLayoutEffect(() => {
    if (!scrollTargetMessageId) {
      jumpRetryCountRef.current = 0
      jumpRetryTargetRef.current = null
      return
    }

    if (jumpRetryTargetRef.current !== scrollTargetMessageId) {
      jumpRetryTargetRef.current = scrollTargetMessageId
      jumpRetryCountRef.current = 0
    }

    const targetIdx = messages.findIndex((m) => m.id === scrollTargetMessageId)
    if (targetIdx < 0) {
      // Messages present but id missing → stale target (deleted/regenerated).
      if (messages.length > 0) setScrollTarget(null)
      jumpRetryCountRef.current = 0
      jumpRetryTargetRef.current = null
      return
    }

    const needSize = windowSizeToInclude(messages.length, targetIdx)
    if (needSize > windowSize) {
      // Expand first; keep target so this effect re-runs after mount.
      setWindowSize(needSize)
      return
    }

    // Unpin first so any concurrent autoscroll effect skips on the next paint.
    followBottomRef.current = false
    setAtBottom(false)

    const localIndex = targetIdx - startIndex

    const finishJump = (id: string) => {
      scrollTranscriptToMessage(id)
      setHighlightedId(id)
      setScrollTarget(null)
      jumpRetryCountRef.current = 0
      jumpRetryTargetRef.current = null
    }

    const el = scrollRef.current?.querySelector(
      `[data-message-id="${CSS.escape(scrollTargetMessageId)}"]`,
    )
    if (el instanceof HTMLElement) {
      finishJump(scrollTargetMessageId)
      return
    }

    // In window range but node not yet in DOM (virtual overscan lag).
    // Do NOT call scrollToIndex inside this layout effect — tanstack may flushSync and React
    // warns / skips the sync render. Defer scroll + retry via rAF (O1).
    if (jumpRetryCountRef.current < JUMP_RETRY_MAX) {
      jumpRetryCountRef.current += 1
      const targetId = scrollTargetMessageId
      let cancelled = false
      const frame = requestAnimationFrame(() => {
        if (cancelled) return
        if (virtualize && localIndex >= 0 && localIndex < visibleMessages.length) {
          rowVirtualizer.scrollToIndex(localIndex, { align: 'start' })
        }
        // Second frame: allow virtualizer + React to commit newly mounted rows, then re-enter.
        requestAnimationFrame(() => {
          if (cancelled) return
          // Target may have been cleared or replaced while we waited.
          if (useUiStore.getState().scrollTargetMessageId !== targetId) return
          setJumpPaintTick((n) => n + 1)
        })
      })
      return () => {
        cancelled = true
        cancelAnimationFrame(frame)
      }
    }

    // Give up so follow-bottom is not gated forever on a stuck scrollTarget.
    setScrollTarget(null)
    jumpRetryCountRef.current = 0
    jumpRetryTargetRef.current = null
  }, [
    scrollTargetMessageId,
    messages,
    windowSize,
    startIndex,
    virtualize,
    visibleMessages.length,
    rowVirtualizer,
    jumpPaintTick,
    setScrollTarget,
  ])

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

  const renderMessageShell = (m: Message, globalIndex: number, extra?: {
    ref?: (el: HTMLElement | null) => void
    dataIndex?: number
    style?: CSSProperties
  }) => {
    const isNew = globalIndex >= animBaselineRef.current
    const streaming = isStreamingAssistant(messages, globalIndex, status)
    // Same “no user after” guard as streaming — do not offer regenerate on a prior
    // completed assistant while a newer user turn is pending provisional.
    const isLastAsst = isCurrentTurnAssistant(messages, globalIndex)
    return (
      <div
        key={`${activeSessionId ?? 'none'}-${m.id}`}
        ref={extra?.ref}
        data-index={extra?.dataIndex}
        data-message-id={m.id}
        style={extra?.style}
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
  }

  const virtualItems = virtualize ? rowVirtualizer.getVirtualItems() : null

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="h-full min-h-0 overflow-y-auto"
        data-transcript-scroll=""
        data-testid="chat-transcript-scroll"
        data-transcript-virtual={virtualize ? 'true' : undefined}
      >
        {/* CLI-style transcript: full-width left-aligned, no centered chat column */}
        <div
          className={cn(
            'flex w-full flex-col px-4 py-4',
            // Chat surface: slightly looser vertical rhythm (reading room vs code bench).
            isChatSurface ? 'gap-6' : 'gap-5',
          )}
          data-surface={isChatSurface ? 'chat' : 'code'}
        >
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
          {virtualize ? (
            <div
              ref={virtualListRef}
              data-testid="transcript-virtual-list"
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative',
              }}
            >
              {virtualItems!.map((virtualRow) => {
                const m = visibleMessages[virtualRow.index]
                if (!m) return null
                const globalIndex = startIndex + virtualRow.index
                return renderMessageShell(m, globalIndex, {
                  dataIndex: virtualRow.index,
                  ref: rowVirtualizer.measureElement,
                  style: {
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start - scrollMargin}px)`,
                  },
                })
              })}
            </div>
          ) : (
            visibleMessages.map((m, localI) => renderMessageShell(m, startIndex + localI))
          )}
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
              className={`rounded-lg border px-3 py-2.5 text-body ${
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
          {/* End sentinel always outside virtual range — follow-bottom anchor (D3b). */}
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
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface px-3 py-1.5 text-meta text-ink-secondary transition-colors hover:bg-state-hover"
        >
          <ChevronDown size={14} strokeWidth={1.75} />
          {t('chat.jumpToLatest')}
        </button>
      )}
    </div>
  )
}
