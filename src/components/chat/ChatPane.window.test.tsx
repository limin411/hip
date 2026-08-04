// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import { useUiStore } from '@/store/uiStore'
import { ChatPane } from '@/components/chat/ChatPane'
import { jumpToTranscriptMessage } from '@/lib/transcriptJump'
import { TRANSCRIPT_WINDOW_SIZE } from '@/lib/transcriptWindow'
import type { Message } from '@hip/protocol'

// PR-7b windowing suite: exercise non-virtual path (virtual defaults on in product).
vi.mock('@/components/chat/feature', async () => {
  const actual = await vi.importActual<typeof import('@/components/chat/feature')>(
    '@/components/chat/feature',
  )
  return {
    ...actual,
    TRANSCRIPT_VIRTUALIZE: false,
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}))

vi.mock('@/components/chat/MessageBubble', () => ({
  MessageBubble: ({ message }: { message: { id: string; content: string } }) => (
    <div data-testid={`bubble-${message.id}`}>{message.content}</div>
  ),
  NoticeRow: ({ content }: { content: string }) => <div data-testid="notice">{content}</div>,
}))
vi.mock('@/components/chat/ThinkingBubble', () => ({ ThinkingBubble: () => null }))
vi.mock('@/components/chat/planApproval', () => ({
  hasPlanApproval: () => false,
  shouldHideInterruptForPlanApproval: () => false,
  isPlanApprovalInterrupt: () => false,
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

function makeMessages(n: number): Message[] {
  const out: Message[] = []
  for (let i = 0; i < n; i++) {
    out.push({
      id: `m${i}`,
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}`,
      timestamp: i + 1,
    })
  }
  return out
}

function seedSession(messages: Message[]) {
  useUiStore.setState({ scrollTargetMessageId: null })
  useDomainStore.setState({
    sessions: [
      {
        id: 's1',
        title: 'T',
        preview: '',
        updatedAtMs: Date.now(),
        config: { ...DEFAULT_CONFIG, surface: 'chat' },
        messages,
        status: 'idle',
        loaded: true,
      },
    ],
    activeSessionId: 's1',
  } as never)
}

function mockScrollerGeometry(container: HTMLElement, messageIds: string[]) {
  const scroll = container.querySelector('[data-transcript-scroll]') as HTMLElement
  let scrollTop = 0
  Object.defineProperty(scroll, 'clientHeight', { value: 200, configurable: true })
  Object.defineProperty(scroll, 'scrollHeight', {
    // Live DOM count so follow-bottom tests see the content grow with new rows.
    get: () => 40 * document.querySelectorAll('[data-message-id]').length + 200,
    configurable: true,
  })
  const setScrollTop = vi.fn((v: number) => {
    scrollTop = Math.max(0, Number(v) || 0)
  })
  Object.defineProperty(scroll, 'scrollTop', {
    get: () => scrollTop,
    set: setScrollTop,
    configurable: true,
  })
  scroll.getBoundingClientRect = () =>
    ({ top: 0, bottom: 200, left: 0, right: 300, width: 300, height: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

  for (const node of Array.from(scroll.querySelectorAll('[data-message-id]'))) {
    const el = node as HTMLElement
    const id = el.getAttribute('data-message-id') ?? ''
    const idx = messageIds.indexOf(id)
    el.getBoundingClientRect = () => {
      const top = (idx >= 0 ? idx * 40 : 0) - scrollTop
      return {
        top,
        bottom: top + 40,
        left: 0,
        right: 300,
        width: 300,
        height: 40,
        x: 0,
        y: top,
        toJSON: () => ({}),
      } as DOMRect
    }
  }
  return { scroll, getScrollTop: () => scrollTop, setScrollTop }
}

describe('ChatPane windowed transcript (PR-7b)', () => {
  afterEach(() => cleanup())

  it('mounts only the last N messages when total exceeds window', () => {
    const total = TRANSCRIPT_WINDOW_SIZE + 15
    seedSession(makeMessages(total))
    render(<ChatPane />)

    // Oldest unmounted
    expect(screen.queryByTestId('bubble-m0')).not.toBeInTheDocument()
    expect(document.querySelector('[data-message-id="m0"]')).toBeNull()

    // First mounted is total - N
    const firstMounted = total - TRANSCRIPT_WINDOW_SIZE
    expect(screen.getByTestId(`bubble-m${firstMounted}`)).toBeInTheDocument()
    expect(screen.getByTestId(`bubble-m${total - 1}`)).toBeInTheDocument()

    // Exactly N message nodes
    expect(document.querySelectorAll('[data-message-id]')).toHaveLength(TRANSCRIPT_WINDOW_SIZE)
    expect(screen.getByTestId('load-earlier')).toBeInTheDocument()
  })

  it('does not show Load earlier when total ≤ N', () => {
    seedSession(makeMessages(10))
    render(<ChatPane />)
    expect(screen.queryByTestId('load-earlier')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-message-id]')).toHaveLength(10)
  })

  it('Load earlier expands the mounted window', () => {
    const total = TRANSCRIPT_WINDOW_SIZE + 20
    seedSession(makeMessages(total))
    render(<ChatPane />)

    expect(document.querySelectorAll('[data-message-id]')).toHaveLength(TRANSCRIPT_WINDOW_SIZE)
    fireEvent.click(screen.getByTestId('load-earlier'))

    // +30 more (capped by remaining 20 earlier) → all 50
    expect(document.querySelectorAll('[data-message-id]')).toHaveLength(total)
    expect(screen.getByTestId('bubble-m0')).toBeInTheDocument()
    expect(screen.queryByTestId('load-earlier')).not.toBeInTheDocument()
  })

  it('jump to unmounted message expands window then highlights', async () => {
    const total = TRANSCRIPT_WINDOW_SIZE + 10
    seedSession(makeMessages(total))
    const { container } = render(<ChatPane />)

    // m0 is outside the initial window
    expect(document.querySelector('[data-message-id="m0"]')).toBeNull()

    act(() => {
      jumpToTranscriptMessage('m0')
    })
    await act(async () => {})

    // Ensure-mount: now in DOM
    const target = container.querySelector('[data-message-id="m0"]') as HTMLElement
    expect(target).toBeTruthy()
    expect(target.className).toMatch(/bg-accent-subtle/)
    expect(useUiStore.getState().scrollTargetMessageId).toBeNull()
  })

  it('end sentinel stays mounted for follow-bottom', () => {
    seedSession(makeMessages(TRANSCRIPT_WINDOW_SIZE + 5))
    render(<ChatPane />)
    expect(screen.getByTestId('transcript-end-sentinel')).toBeInTheDocument()
  })

  it('follow-bottom still scrolls when pinned and activity changes', async () => {
    const msgs = makeMessages(5)
    seedSession(msgs)
    const { container } = render(<ChatPane />)
    const { scroll, getScrollTop, setScrollTop } = mockScrollerGeometry(
      container,
      msgs.map((m) => m.id),
    )
    // Simulate the user pinned at the bottom (5 rows → max scrollTop 200).
    act(() => {
      scroll.scrollTop = 200
    })
    setScrollTop.mockClear()

    // Simulate new assistant content while at bottom
    act(() => {
      useDomainStore.setState({
        sessions: [
          {
            id: 's1',
            title: 'T',
            preview: '',
            updatedAtMs: Date.now(),
            config: { ...DEFAULT_CONFIG, surface: 'chat' },
            messages: [
              ...msgs,
              { id: 'm5', role: 'assistant', content: 'more', timestamp: 99 },
            ],
            status: 'running',
            loaded: true,
          },
        ],
        activeSessionId: 's1',
      } as never)
    })
    await act(async () => {})

    // 6 mounted rows → scrollHeight 440, clientHeight 200 → pinned to 240
    expect(setScrollTop).toHaveBeenCalledWith(240)
    expect(getScrollTop()).toBe(240)
  })

  it('does not autoscroll when at bottom and activity changes without height growth', async () => {
    const msgs = makeMessages(5)
    seedSession(msgs)
    const { container } = render(<ChatPane />)
    const { scroll, getScrollTop, setScrollTop } = mockScrollerGeometry(
      container,
      msgs.map((m) => m.id),
    )
    act(() => {
      scroll.scrollTop = 200
    })
    setScrollTop.mockClear()

    // lastActivity changes (timeline grows) but no new row mounts → scrollHeight unchanged.
    act(() => {
      useDomainStore.setState({
        sessions: [
          {
            id: 's1',
            title: 'T',
            preview: '',
            updatedAtMs: Date.now(),
            config: { ...DEFAULT_CONFIG, surface: 'chat' },
            messages: msgs.map((m) =>
              m.id === 'm3'
                ? {
                    ...m,
                    timeline: [
                      {
                        kind: 'reasoning',
                        stepSeq: 1,
                        agentId: 'a1',
                        role: 'assistant',
                        content: 'thinking',
                      },
                    ],
                  }
                : m,
            ),
            status: 'running',
            loaded: true,
          },
        ],
        activeSessionId: 's1',
      } as never)
    })
    await act(async () => {})

    expect(setScrollTop).not.toHaveBeenCalled()
    expect(getScrollTop()).toBe(200)
  })
})

describe('outline jump still works within window', () => {
  beforeEach(() => {
    seedSession([
      { id: 'u1', role: 'user', content: 'First', timestamp: 1 },
      { id: 'a1', role: 'assistant', content: 'A1', timestamp: 2 },
      { id: 'u2', role: 'user', content: 'Second', timestamp: 3 },
      { id: 'a2', role: 'assistant', content: 'A2', timestamp: 4 },
    ])
  })
  afterEach(() => cleanup())

  it('highlights in-window target', async () => {
    const { container } = render(<ChatPane />)
    mockScrollerGeometry(container, ['u1', 'a1', 'u2', 'a2'])

    act(() => {
      jumpToTranscriptMessage('u1')
    })
    await act(async () => {})

    const target = container.querySelector('[data-message-id="u1"]') as HTMLElement
    expect(target.className).toMatch(/bg-accent-subtle/)
    expect(useUiStore.getState().scrollTargetMessageId).toBeNull()
  })
})
