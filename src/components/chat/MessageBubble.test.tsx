// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import i18n from '@/i18n'
import { MessageBubble } from './MessageBubble'

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }))
vi.mock('@/ipc/clipboard', () => ({ copyText: vi.fn() }))

// Mutable flag so tests can toggle PR-5 TurnBlocks without reloading modules.
const featureState = { interleaved: false }
vi.mock('./feature', () => ({
  get TRANSCRIPT_INTERLEAVED_BLOCKS() {
    return featureState.interleaved
  },
}))

const textTimelineMessage = {
  id: 'm-text',
  role: 'assistant' as const,
  content: 'First I will search\n\nHere is the answer',
  timestamp: Date.now(),
  timeline: [
    {
      kind: 'text' as const,
      stepSeq: 0,
      agentId: 'supervisor',
      role: 'supervisor' as const,
      content: 'First I will search',
    },
    {
      kind: 'tool' as const,
      stepSeq: 1,
      agentId: 'supervisor',
      role: 'supervisor' as const,
      callId: 'c1',
    },
    {
      kind: 'text' as const,
      stepSeq: 2,
      agentId: 'supervisor',
      role: 'supervisor' as const,
      content: 'Here is the answer',
    },
  ],
  toolCalls: [
    {
      callId: 'c1',
      agentId: 'supervisor',
      name: 'grep',
      input: '{"pattern":"x"}',
      status: 'finished' as const,
      seq: 1,
    },
  ],
}

describe('MessageBubble', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('zh-CN')
  })

  beforeEach(() => {
    cleanup()
    featureState.interleaved = false
  })
  it('renders a user message with content', () => {
    render(
      <MessageBubble
        message={{
          id: 'm1',
          role: 'user',
          content: 'hello',
          timestamp: Date.now(),
        } as any}
      />,
    )
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.getByText('你')).toBeInTheDocument()
  })

  it('renders an assistant message', () => {
    render(
      <MessageBubble
        message={{
          id: 'm2',
          role: 'assistant',
          content: 'hi there',
          timestamp: Date.now(),
        } as any}
      />,
    )
    expect(screen.getByText('hi there')).toBeInTheDocument()
    expect(screen.getByText('hip')).toBeInTheDocument()
  })

  it('renders user attachments', () => {
    render(
      <MessageBubble
        message={{
          id: 'm3',
          role: 'user',
          content: '',
          timestamp: Date.now(),
          attachments: [{ id: 'a1', name: 'pic.png', mimeType: 'image/png', size: 1024 }],
        } as any}
      />,
    )
    const chip = screen.getByTestId('message-attachment')
    expect(chip).toHaveTextContent('pic.png')
    expect(chip).toHaveTextContent('1.0 KB')
  })

  it('shows message usage for assistant messages', () => {
    render(
      <MessageBubble
        message={{
          id: 'm4',
          role: 'assistant',
          content: 'ok',
          timestamp: Date.now(),
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        } as any}
        isLastAssistant
      />,
    )
    expect(screen.getByTestId('message-usage')).toHaveTextContent('15')
  })

  it('shows message timestamp when available', () => {
    const now = Date.now()
    render(
      <MessageBubble
        message={{
          id: 'm5',
          role: 'user',
          content: 'time',
          timestamp: now,
        } as any}
      />,
    )
    expect(screen.getByTestId('message-time')).toBeInTheDocument()
  })

  it('shows memory citations chip when memoryCitations is non-empty', () => {
    render(
      <MessageBubble
        message={{
          id: 'm6',
          role: 'assistant',
          content: 'ok',
          timestamp: Date.now(),
          memoryCitations: [
            { memoryId: 'a', title: 'A' },
            { memoryId: 'b', title: 'B' },
          ],
        } as any}
      />,
    )
    const chip = screen.getByTestId('memory-citations-chip')
    expect(chip).toBeInTheDocument()
    fireEvent.pointerDown(chip)
    fireEvent.click(chip)
    const list = screen.getByTestId('memory-citations-list')
    expect(list).toHaveTextContent('A')
    expect(list).toHaveTextContent('B')
  })

  it('hides memory citations chip when empty or missing', () => {
    render(
      <MessageBubble
        message={{
          id: 'm7',
          role: 'assistant',
          content: 'ok',
          timestamp: Date.now(),
          memoryCitations: [],
        } as any}
      />,
    )
    expect(screen.queryByTestId('memory-citations-chip')).not.toBeInTheDocument()
  })

  it('flag off + text steps: content body only, no timeline text blocks (no dual render)', () => {
    featureState.interleaved = false
    render(<MessageBubble message={textTimelineMessage as any} />)
    // Legacy answer body shows joined content
    expect(screen.getByTestId('message-answer')).toHaveTextContent('First I will search')
    expect(screen.getByTestId('message-answer')).toHaveTextContent('Here is the answer')
    // Text steps are not rendered in the process trail
    expect(screen.queryByTestId('turn-text-block')).not.toBeInTheDocument()
    // Tools still appear in ActivityBar / TurnTimeline
    expect(screen.getByTestId('message-process')).toBeInTheDocument()
    expect(screen.getByTestId('tool-row')).toBeInTheDocument()
  })

  it('flag on + text steps: interleaved text blocks, no bottom answer body', () => {
    featureState.interleaved = true
    render(<MessageBubble message={textTimelineMessage as any} />)
    // Answer body suppressed to avoid dual render
    expect(screen.queryByTestId('message-answer')).not.toBeInTheDocument()
    // Text segments live in the process trail
    const blocks = screen.getAllByTestId('turn-text-block')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toHaveTextContent('First I will search')
    expect(blocks[1]).toHaveTextContent('Here is the answer')
    expect(screen.getByTestId('turn-timeline').getAttribute('data-interleaved')).toBe('true')
  })

  it('flag on without text steps still shows content body (legacy fallback)', () => {
    featureState.interleaved = true
    render(
      <MessageBubble
        message={{
          id: 'm-legacy',
          role: 'assistant',
          content: 'ACP style answer',
          timestamp: Date.now(),
          timeline: [
            {
              kind: 'tool',
              stepSeq: 1,
              agentId: 'supervisor',
              role: 'supervisor',
              callId: 'c1',
            },
          ],
          toolCalls: [
            {
              callId: 'c1',
              agentId: 'supervisor',
              name: 'read_file',
              input: '{"path":"a.ts"}',
              status: 'finished',
              seq: 1,
            },
          ],
        } as any}
      />,
    )
    expect(screen.getByTestId('message-answer')).toHaveTextContent('ACP style answer')
    expect(screen.queryByTestId('turn-text-block')).not.toBeInTheDocument()
  })
})
