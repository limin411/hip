// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import i18n from '@/i18n'
import {
  MessageBubble,
  NoticeRow,
  areMessageBubblePropsEqual,
  messageRenderEqual,
} from './MessageBubble'
import type { Message } from '@hip/protocol'

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

  it('shows bottom turn status after completion with duration', () => {
    render(
      <MessageBubble
        message={{
          id: 'm4b',
          role: 'assistant',
          content: 'done',
          timestamp: 1000,
          agentRuns: [
            {
              agentId: 'supervisor',
              role: 'supervisor',
              output: '',
              startedAt: 1000,
              finishedAt: 4500,
              seq: 0,
            },
          ],
        } as any}
      />,
    )
    const status = screen.getByTestId('turn-status-line')
    expect(status).toHaveAttribute('data-phase', 'settled')
    expect(status).toHaveTextContent('已完成')
    expect(status).toHaveTextContent('4s')
  })

  it('shows bottom turn status while streaming', () => {
    render(
      <MessageBubble
        message={{
          id: 'm4c',
          role: 'assistant',
          content: 'partial',
          timestamp: Date.now() - 2000,
        } as any}
        streaming
      />,
    )
    const status = screen.getByTestId('turn-status-line')
    expect(status).toHaveAttribute('data-phase', 'running')
    expect(screen.getByTestId('turn-status-spinner')).toBeInTheDocument()
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

  it('renders NoticeRow content', () => {
    render(<NoticeRow content="task done" />)
    expect(screen.getByTestId('chat-notice')).toHaveTextContent('task done')
  })
})

describe('messageRenderEqual / areMessageBubblePropsEqual', () => {
  const base: Message = {
    id: 'a1',
    role: 'assistant',
    content: 'hello',
    timestamp: 1,
    timeline: [{ kind: 'reasoning', stepSeq: 0, agentId: 'supervisor', role: 'supervisor', content: 'think' }],
    toolCalls: [{ callId: 'c1', agentId: 'supervisor', name: 'read', input: '{}', status: 'finished', seq: 1 }],
  }

  it('messageRenderEqual is true for same reference', () => {
    expect(messageRenderEqual(base, base)).toBe(true)
  })

  it('messageRenderEqual is true when render fields match by identity', () => {
    const twin: Message = { ...base }
    expect(messageRenderEqual(base, twin)).toBe(true)
  })

  it('messageRenderEqual is false when content changes', () => {
    expect(messageRenderEqual(base, { ...base, content: 'bye' })).toBe(false)
  })

  it('messageRenderEqual is false when timeline reference changes', () => {
    expect(messageRenderEqual(base, { ...base, timeline: [...(base.timeline ?? [])] })).toBe(false)
  })

  it('areMessageBubblePropsEqual ignores nothing for streaming flag', () => {
    expect(
      areMessageBubblePropsEqual(
        { message: base, streaming: true, isLastAssistant: true, hidePlan: false },
        { message: base, streaming: false, isLastAssistant: true, hidePlan: false },
      ),
    ).toBe(false)
  })

  it('areMessageBubblePropsEqual is true when only message object identity differs but fields match', () => {
    expect(
      areMessageBubblePropsEqual(
        { message: base, streaming: false, isLastAssistant: true, hidePlan: false },
        { message: { ...base }, streaming: false, isLastAssistant: true, hidePlan: false },
      ),
    ).toBe(true)
  })

  it('areMessageBubblePropsEqual is false when hidePlan differs', () => {
    expect(
      areMessageBubblePropsEqual(
        { message: base, hidePlan: true },
        { message: base, hidePlan: false },
      ),
    ).toBe(false)
  })
})

describe('interleaved TurnBlocks (flag)', () => {
  beforeEach(() => {
    cleanup()
    featureState.interleaved = false
  })

  it('flag off + text steps: content body only, no timeline text blocks (no dual render)', () => {
    featureState.interleaved = false
    render(<MessageBubble message={textTimelineMessage as any} />)
    // Legacy answer body shows joined content
    expect(screen.getByTestId('message-answer')).toHaveTextContent('First I will search')
    expect(screen.getByTestId('message-answer')).toHaveTextContent('Here is the answer')
    // Text steps are not rendered in the process trail
    expect(screen.queryByTestId('turn-text-block')).not.toBeInTheDocument()
    // Process trail is collapsed by default; expand to see tools
    expect(screen.getByTestId('message-process')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('activity-bar-summary'))
    expect(screen.getByTestId('tool-row')).toBeInTheDocument()
  })

  it('flag on + text steps: interleaved text blocks, no bottom answer body', () => {
    featureState.interleaved = true
    render(<MessageBubble message={textTimelineMessage as any} />)
    // Answer body suppressed to avoid dual render
    expect(screen.queryByTestId('message-answer')).not.toBeInTheDocument()
    // Process starts collapsed: answer text still visible, tools folded
    expect(screen.getByTestId('activity-bar-summary')).toHaveAttribute('aria-expanded', 'false')
    const blocks = screen.getAllByTestId('turn-text-block')
    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toHaveTextContent('First I will search')
    expect(blocks[1]).toHaveTextContent('Here is the answer')
    expect(screen.getByTestId('turn-timeline').getAttribute('data-interleaved')).toBe('true')
    expect(screen.getByTestId('turn-timeline').getAttribute('data-answer-only')).toBe('true')
    expect(screen.queryByTestId('tool-row')).not.toBeInTheDocument()

    // Expand process trail to inspect tools without losing answer text
    fireEvent.click(screen.getByTestId('activity-bar-summary'))
    expect(screen.getByTestId('activity-bar-summary')).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('turn-timeline').getAttribute('data-answer-only')).toBeNull()
    expect(screen.getByTestId('tool-row')).toBeInTheDocument()
    expect(screen.getAllByTestId('turn-text-block')).toHaveLength(2)
  })

  it('folds SubAgentCards with the process trail', () => {
    featureState.interleaved = false
    render(
      <MessageBubble
        message={{
          id: 'm-sub',
          role: 'assistant',
          content: 'done',
          timestamp: Date.now(),
          agentRuns: [
            {
              agentId: 'supervisor',
              role: 'supervisor',
              output: '',
              startedAt: 1000,
              finishedAt: 5000,
              seq: 0,
            },
            {
              agentId: 'subagent-1',
              role: 'subagent',
              output: 'child result',
              startedAt: 1100,
              finishedAt: 2000,
              seq: 1,
              taskInput: 'check A',
              parentAgentId: 'supervisor',
            },
          ],
          toolCalls: [
            {
              callId: 'c1',
              agentId: 'subagent-1',
              name: 'grep',
              input: '{"pattern":"A"}',
              status: 'finished',
              seq: 2,
            },
          ],
          timeline: [
            {
              kind: 'tool',
              stepSeq: 2,
              agentId: 'subagent-1',
              role: 'subagent',
              callId: 'c1',
            },
          ],
        } as any}
      />,
    )
    // Collapsed: sub-agent chrome must not leak outside the fold
    expect(screen.queryByTestId('subagent-card')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTestId('activity-bar-summary'))
    expect(screen.getByTestId('subagent-card')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('activity-bar-summary'))
    expect(screen.queryByTestId('subagent-card')).not.toBeInTheDocument()
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
    // O4: no text → do not force interleaved flatten
    expect(screen.getByTestId('message-process').getAttribute('data-interleaved')).toBeNull()
    fireEvent.click(screen.getByTestId('activity-bar-summary'))
    expect(screen.getByTestId('turn-timeline').getAttribute('data-interleaved')).toBeNull()
  })

  it('flag on + whitespace-only text steps keeps content body (O5)', () => {
    featureState.interleaved = true
    render(
      <MessageBubble
        message={{
          id: 'm-ws',
          role: 'assistant',
          content: 'Fallback answer body',
          timestamp: Date.now(),
          timeline: [
            {
              kind: 'text',
              stepSeq: 0,
              agentId: 'supervisor',
              role: 'supervisor',
              content: '   \n\t  ',
            },
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
    expect(screen.getByTestId('message-answer')).toHaveTextContent('Fallback answer body')
    expect(screen.queryByTestId('turn-text-block')).not.toBeInTheDocument()
    expect(screen.getByTestId('message-process').getAttribute('data-interleaved')).toBeNull()
  })

  it('flag on + multi-agent without text keeps agent sections (O4)', () => {
    featureState.interleaved = true
    render(
      <MessageBubble
        message={{
          id: 'm-multi',
          role: 'assistant',
          content: 'done',
          timestamp: Date.now(),
          agentRuns: [
            {
              agentId: 'supervisor',
              role: 'supervisor',
              output: '',
              startedAt: 1000,
              finishedAt: 5000,
              seq: 0,
            },
            {
              agentId: 'subagent-1',
              role: 'subagent',
              output: 'child',
              startedAt: 1100,
              finishedAt: 2000,
              seq: 1,
              taskInput: 'check A',
              parentAgentId: 'supervisor',
            },
          ],
          toolCalls: [
            {
              callId: 'c1',
              agentId: 'subagent-1',
              name: 'grep',
              input: '{"pattern":"A"}',
              status: 'finished',
              seq: 2,
            },
          ],
          timeline: [
            {
              kind: 'tool',
              stepSeq: 2,
              agentId: 'subagent-1',
              role: 'subagent',
              callId: 'c1',
            },
          ],
        } as any}
      />,
    )
    expect(screen.getByTestId('message-answer')).toHaveTextContent('done')
    fireEvent.click(screen.getByTestId('activity-bar-summary'))
    expect(screen.getAllByTestId('agent-timeline-section').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByTestId('turn-timeline').getAttribute('data-interleaved')).toBeNull()
  })
})
