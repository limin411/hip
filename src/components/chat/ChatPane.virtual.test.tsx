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

const featureState = { virtualize: true }

vi.mock('@/components/chat/feature', async () => {
  const actual = await vi.importActual<typeof import('@/components/chat/feature')>(
    '@/components/chat/feature',
  )
  return {
    ...actual,
    get TRANSCRIPT_VIRTUALIZE() {
      return featureState.virtualize
    },
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
    <div data-testid={`bubble-${message.id}`} style={{ height: 40 }}>
      {message.content}
    </div>
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

/** Minimal ResizeObserver so @tanstack/react-virtual measureElement works in happy-dom. */
class ROStub {
  private cb: ResizeObserverCallback
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb
  }
  observe(target: Element) {
    // Synchronous first measure so virtual rows get non-zero sizes.
    const entry = {
      target,
      contentRect: { width: 300, height: 40, top: 0, left: 0, bottom: 40, right: 300, x: 0, y: 0, toJSON: () => ({}) },
      borderBoxSize: [{ blockSize: 40, inlineSize: 300 }],
      contentBoxSize: [{ blockSize: 40, inlineSize: 300 }],
      devicePixelContentBoxSize: [{ blockSize: 40, inlineSize: 300 }],
    } as unknown as ResizeObserverEntry
    this.cb([entry], this as unknown as ResizeObserver)
  }
  unobserve() {}
  disconnect() {}
}

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

function mockScrollerGeometry(container: HTMLElement) {
  const scroll = container.querySelector('[data-transcript-scroll]') as HTMLElement
  let scrollTop = 0
  Object.defineProperty(scroll, 'clientHeight', { value: 200, configurable: true })
  Object.defineProperty(scroll, 'scrollHeight', {
    get: () => 8000,
    configurable: true,
  })
  Object.defineProperty(scroll, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      const next = Math.max(0, Number(v) || 0)
      if (next === scrollTop) return
      scrollTop = next
      // TanStack Virtual updates scrollOffset via the scroll observer — happy-dom does not
      // always emit 'scroll' on programmatic assignment; dispatch so scrollToIndex remounts rows.
      scroll.dispatchEvent(new Event('scroll'))
    },
    configurable: true,
  })
  scroll.getBoundingClientRect = () =>
    ({
      top: 0,
      bottom: 200,
      left: 0,
      right: 300,
      width: 300,
      height: 200,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect

  const list = container.querySelector('[data-testid="transcript-virtual-list"]') as HTMLElement | null
  if (list) {
    list.getBoundingClientRect = () =>
      ({
        top: 0,
        bottom: 8000,
        left: 0,
        right: 300,
        width: 300,
        height: 8000,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
  }
  return { scroll, getScrollTop: () => scrollTop }
}

describe('ChatPane virtualized transcript (PR-7c)', () => {
  beforeEach(() => {
    featureState.virtualize = true
    vi.stubGlobal('ResizeObserver', ROStub)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('marks scroller as virtual and mounts virtual list container', () => {
    seedSession(makeMessages(20))
    render(<ChatPane />)
    const scroll = screen.getByTestId('chat-transcript-scroll')
    expect(scroll.getAttribute('data-transcript-virtual')).toBe('true')
    expect(screen.getByTestId('transcript-virtual-list')).toBeInTheDocument()
    // End sentinel always outside virtual range
    expect(screen.getByTestId('transcript-end-sentinel')).toBeInTheDocument()
  })

  it('still window-mounts only last N when total exceeds window (window + virtual)', () => {
    const total = TRANSCRIPT_WINDOW_SIZE + 25
    seedSession(makeMessages(total))
    const { container } = render(<ChatPane />)
    mockScrollerGeometry(container)

    // Load earlier still available — windowing is primary
    expect(screen.getByTestId('load-earlier')).toBeInTheDocument()
    // Oldest outside window not in DOM
    expect(document.querySelector('[data-message-id="m0"]')).toBeNull()
  })

  it('Load earlier expands window under virtualization', async () => {
    const total = TRANSCRIPT_WINDOW_SIZE + 10
    seedSession(makeMessages(total))
    const { container } = render(<ChatPane />)
    mockScrollerGeometry(container)

    fireEvent.click(screen.getByTestId('load-earlier'))
    await act(async () => {})

    // After expand, all messages are in the window; virtualizer may overscan-mount a subset,
    // but m0 should become scrollable via jump (covered below) and load-earlier gone.
    expect(screen.queryByTestId('load-earlier')).not.toBeInTheDocument()
  })

  it('jump to unmounted message expands window then highlights (window + virtual)', async () => {
    const total = TRANSCRIPT_WINDOW_SIZE + 12
    seedSession(makeMessages(total))
    const { container } = render(<ChatPane />)
    mockScrollerGeometry(container)

    expect(document.querySelector('[data-message-id="m0"]')).toBeNull()

    act(() => {
      jumpToTranscriptMessage('m0')
    })
    // Allow expand + scrollToIndex + second paint for virtual mount
    await act(async () => {})
    await act(async () => {})

    const target = container.querySelector('[data-message-id="m0"]') as HTMLElement | null
    expect(target).toBeTruthy()
    expect(target!.className).toMatch(/bg-accent-subtle/)
    expect(useUiStore.getState().scrollTargetMessageId).toBeNull()
  })

  it('jump to in-window message highlights under virtualization', async () => {
    seedSession(makeMessages(8))
    const { container } = render(<ChatPane />)
    mockScrollerGeometry(container)

    act(() => {
      jumpToTranscriptMessage('m0')
    })
    await act(async () => {})
    await act(async () => {})

    const target = container.querySelector('[data-message-id="m0"]') as HTMLElement | null
    expect(target).toBeTruthy()
    expect(target!.className).toMatch(/bg-accent-subtle/)
  })

  it('O1: bottom-pinned far jump to m0 highlights after virtual mount (rAF retry)', async () => {
    // Full window of rows so expand is not needed — only virtual overscan can hide m0.
    const total = TRANSCRIPT_WINDOW_SIZE
    seedSession(makeMessages(total))
    const { container } = render(<ChatPane />)
    const { scroll } = mockScrollerGeometry(container)

    // Pin to bottom so the virtualizer's visible range is the tail (m0 out of overscan).
    // Item estimate ~120 + gap 20 → ~140px/row; bottom of 30 rows ≈ 4000+.
    await act(async () => {
      scroll.scrollTop = 5000
    })
    await act(async () => {})

    // Precondition: far jump from bottom should start with m0 unmounted (overscan of 4).
    expect(document.querySelector('[data-message-id="m0"]')).toBeNull()
    expect(document.querySelector(`[data-message-id="m${total - 1}"]`)).toBeTruthy()

    act(() => {
      jumpToTranscriptMessage('m0')
    })

    // O1 fix: rAF-driven jumpPaintTick retries until the row mounts and highlight applies.
    for (let i = 0; i < 24; i++) {
      await act(async () => {
        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => resolve())
        })
      })
      const node = container.querySelector('[data-message-id="m0"]') as HTMLElement | null
      if (
        node?.className.includes('bg-accent-subtle') &&
        useUiStore.getState().scrollTargetMessageId === null
      ) {
        break
      }
    }

    const target = container.querySelector('[data-message-id="m0"]') as HTMLElement | null
    expect(target).toBeTruthy()
    expect(target!.className).toMatch(/bg-accent-subtle/)
    expect(useUiStore.getState().scrollTargetMessageId).toBeNull()
  })

  it('follow-bottom still uses end sentinel when pinned', async () => {
    const msgs = makeMessages(5)
    seedSession(msgs)
    const { container } = render(<ChatPane />)
    mockScrollerGeometry(container)
    const intoView = vi.fn()
    const sentinel = screen.getByTestId('transcript-end-sentinel') as HTMLElement
    sentinel.scrollIntoView = intoView

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

    expect(intoView).toHaveBeenCalled()
  })

  it('flag off keeps non-virtual path (regression smoke)', () => {
    featureState.virtualize = false
    seedSession(makeMessages(15))
    render(<ChatPane />)
    expect(screen.getByTestId('chat-transcript-scroll').getAttribute('data-transcript-virtual')).toBeNull()
    expect(screen.queryByTestId('transcript-virtual-list')).not.toBeInTheDocument()
    expect(document.querySelectorAll('[data-message-id]')).toHaveLength(15)
  })
})
