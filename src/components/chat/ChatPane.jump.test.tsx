// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDomainStore } from '@/domain'
import { DEFAULT_CONFIG } from '@/domain/sessionStore'
import { useUiStore } from '@/store/uiStore'
import { ChatPane } from '@/components/chat/ChatPane'
import { ConversationOutline } from '@/components/artifact/ConversationOutline'
import { jumpToTranscriptMessage } from '@/lib/transcriptJump'

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

function seedSession() {
  useUiStore.setState({ scrollTargetMessageId: null })
  useDomainStore.setState({
    sessions: [
      {
        id: 's1',
        title: 'T',
        preview: '',
        updatedAtMs: Date.now(),
        config: { ...DEFAULT_CONFIG, surface: 'chat' },
        messages: [
          { id: 'u1', role: 'user', content: 'First question', timestamp: 1 },
          { id: 'a1', role: 'assistant', content: 'Answer one\n'.repeat(20), timestamp: 2 },
          { id: 'u2', role: 'user', content: 'Follow up', timestamp: 3 },
          { id: 'a2', role: 'assistant', content: 'Answer two\n'.repeat(20), timestamp: 4 },
        ],
        status: 'idle',
        loaded: true,
      },
    ],
    activeSessionId: 's1',
  } as never)
}

function mockScrollerGeometry(container: HTMLElement) {
  const scroll = container.querySelector('[data-transcript-scroll]') as HTMLElement
  let scrollTop = 800
  // Document-space Y of each message (independent of scrollTop).
  const docY: Record<string, number> = { u1: 20, a1: 80, u2: 400, a2: 460 }
  Object.defineProperty(scroll, 'clientHeight', { value: 200, configurable: true })
  Object.defineProperty(scroll, 'scrollHeight', { value: 2000, configurable: true })
  Object.defineProperty(scroll, 'scrollTop', {
    get: () => scrollTop,
    set: (v: number) => {
      scrollTop = v
    },
    configurable: true,
  })
  // Scroller viewport always sits at y=0 in the mock window.
  scroll.getBoundingClientRect = () =>
    ({ top: 0, bottom: 200, left: 0, right: 300, width: 300, height: 200, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect

  for (const node of Array.from(scroll.querySelectorAll('[data-message-id]'))) {
    const el = node as HTMLElement
    const id = el.getAttribute('data-message-id') ?? ''
    el.getBoundingClientRect = () => {
      // Viewport Y shifts opposite to scrollTop (same as a real scrollport).
      const top = (docY[id] ?? 100) - scrollTop
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
  return { scroll, getScrollTop: () => scrollTop }
}

describe('outline jump → ChatPane', () => {
  beforeEach(seedSession)
  afterEach(() => cleanup())

  it('ChatPane finds target, scrolls scroller, and highlights', async () => {
    const { container } = render(
      <div style={{ height: 200, display: 'flex', flexDirection: 'column' }}>
        <ChatPane />
      </div>,
    )
    const { scroll, getScrollTop } = mockScrollerGeometry(container)
    const before = getScrollTop()

    act(() => {
      jumpToTranscriptMessage('u1')
    })
    await act(async () => {})

    expect(getScrollTop()).toBeLessThan(before)
    expect(useUiStore.getState().scrollTargetMessageId).toBeNull()
    const target = scroll.querySelector('[data-message-id="u1"]') as HTMLElement
    expect(target.className).toMatch(/bg-accent-subtle/)
  })

  it('outline click jumps and highlights the transcript turn', async () => {
    const { container } = render(
      <div style={{ height: 200 }}>
        <ChatPane />
        <ConversationOutline />
      </div>,
    )
    mockScrollerGeometry(container)

    fireEvent.click(screen.getByTestId('conversation-outline-item-u1'))
    await act(async () => {})

    const target = container.querySelector('[data-message-id="u1"]') as HTMLElement
    expect(target.className).toMatch(/bg-accent-subtle/)
    expect(useUiStore.getState().scrollTargetMessageId).toBeNull()
  })
})
