// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TurnStatusLine } from './TurnStatusLine'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'chat.activity.completed') return '已完成'
      if (key === 'chat.activity.stopped') return '已停止'
      if (key === 'chat.activity.initializing') return '连接中…'
      if (key === 'chat.activity.writing') return '正在撰写回复…'
      if (key === 'chat.activity.runningReasoning') return '正在思考'
      if (key === 'chat.activity.runningTool') return `正在 ${params?.name}`
      if (key === 'chat.activity.partialTools') return `${params?.count} 个工具未成功`
      if (key === 'chat.activity.elapsed') return params?.time
      return key
    },
  }),
}))

vi.mock('./TurnTimeline', () => ({
  TRAIL_ROW: 'flex min-h-5 w-full items-center gap-1.5 text-left text-meta leading-5',
}))

describe('TurnStatusLine', () => {
  beforeEach(() => {
    cleanup()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:10.000Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows initializing phase while streaming with no activity yet', () => {
    render(<TurnStatusLine streaming startedAt={Date.now() - 3000} />)
    const line = screen.getByTestId('turn-status-line')
    expect(line).toHaveAttribute('data-phase', 'running')
    expect(screen.getByTestId('turn-status-spinner')).toBeInTheDocument()
    expect(screen.getByTestId('turn-status-text')).toHaveTextContent('连接中…')
    expect(screen.getByTestId('turn-status-text')).toHaveTextContent('3s')
  })

  it('shows writing phase when streaming with assistant text', () => {
    render(
      <TurnStatusLine
        streaming
        hasAssistantContent
        startedAt={Date.now() - 1000}
        steps={[
          {
            kind: 'text',
            stepSeq: 1,
            agentId: 'supervisor',
            role: 'supervisor',
            content: 'hello',
          },
        ]}
      />,
    )
    expect(screen.getByTestId('turn-status-text')).toHaveTextContent('正在撰写回复…')
  })

  it('shows running tool label while streaming a tool step', () => {
    render(
      <TurnStatusLine
        streaming
        steps={[
          {
            kind: 'tool',
            stepSeq: 1,
            agentId: 'supervisor',
            role: 'supervisor',
            callId: 'c1',
          },
        ]}
        toolCalls={[
          {
            callId: 'c1',
            agentId: 'supervisor',
            name: 'read_file',
            input: '{"path":"src/a.ts"}',
            status: 'running',
            seq: 1,
          },
        ]}
        agentRuns={[
          {
            agentId: 'supervisor',
            role: 'supervisor',
            output: '',
            startedAt: Date.now() - 5000,
            finishedAt: null,
            seq: 0,
          },
        ]}
      />,
    )
    expect(screen.getByTestId('turn-status-text')).toHaveTextContent('正在')
    expect(screen.getByTestId('turn-status-text')).toHaveTextContent('a.ts')
    expect(screen.getByTestId('turn-status-text')).toHaveTextContent('5s')
  })

  it('shows compact completed status and duration when settled', () => {
    render(
      <TurnStatusLine
        hasAssistantContent
        agentRuns={[
          {
            agentId: 'supervisor',
            role: 'supervisor',
            output: '',
            startedAt: 1000,
            finishedAt: 4000,
            seq: 0,
          },
        ]}
        toolCalls={[
          {
            callId: 'c1',
            agentId: 'supervisor',
            name: 'grep',
            input: '{}',
            status: 'finished',
            seq: 1,
          },
        ]}
      />,
    )
    const line = screen.getByTestId('turn-status-line')
    expect(line).toHaveAttribute('data-phase', 'settled')
    expect(line).toHaveAttribute('data-status', 'success')
    expect(screen.getByTestId('turn-status-success')).toBeInTheDocument()
    expect(screen.getByTestId('turn-status-text')).toHaveTextContent('已完成')
    expect(screen.getByTestId('turn-status-text')).toHaveTextContent('3s')
    // Settled line stays compact — no tool count spam
    expect(screen.getByTestId('turn-status-text')).not.toHaveTextContent('工具')
  })

  it('shows stopped status when the turn was cancelled', () => {
    render(
      <TurnStatusLine
        stopped
        hasAssistantContent
        agentRuns={[
          {
            agentId: 'supervisor',
            role: 'supervisor',
            output: '',
            startedAt: 0,
            finishedAt: 2000,
            seq: 0,
          },
        ]}
      />,
    )
    expect(screen.getByTestId('turn-status-line')).toHaveAttribute('data-status', 'stopped')
    expect(screen.getByTestId('turn-status-text')).toHaveTextContent('已停止')
    expect(screen.getByTestId('turn-status-text')).toHaveTextContent('2s')
  })
})
