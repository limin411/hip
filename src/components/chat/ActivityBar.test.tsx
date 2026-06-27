// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { render, screen, fireEvent } from '@testing-library/react'
import { ActivityBar } from './ActivityBar'
import { TurnTimeline } from './TurnTimeline'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => {
    if (key === 'chat.activity.completed') return `已完成 · ${params?.finished}/${params?.total} 个工具 · ${params?.agents} 个子 Agent`
    if (key === 'chat.activity.runningTool') return `正在 ${params?.name}`
    if (key === 'chat.activity.runningReasoning') return '正在思考'
    if (key === 'artifact.roles.planner') return '规划员'
    return key
  } }),
}))

vi.mock('./TurnTimeline', () => ({
  TurnTimeline: vi.fn(() => null),
  AgentBadge: ({ role }: { role: string }) => `<AgentBadge role="${role}" />`,
}))

const baseSteps = [
  { kind: 'reasoning' as const, stepSeq: 1, agentId: 'planner-1', role: 'planner' as const, content: '先分析需求' },
  { kind: 'tool' as const, stepSeq: 2, agentId: 'planner-1', role: 'planner' as const, callId: 'call-1' },
]

const baseTools = [
  { callId: 'call-1', agentId: 'planner-1', name: 'read_file', input: '{}', status: 'finished' as const, seq: 1 },
]

const baseRuns = [
  { agentId: 'planner-1', role: 'planner' as const, output: '', startedAt: 1, finishedAt: 2, seq: 1 },
]

describe('ActivityBar', () => {
  it('renders collapsed summary for completed activity', () => {
    const html = renderToStaticMarkup(
      <ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={baseRuns} />,
    )
    expect(html).toContain('data-testid="activity-bar"')
    expect(html).toContain('已完成 · 1/1 个工具 · 1 个子 Agent')
    expect(html).toContain('aria-expanded="false"')
  })

  it('shows running state with expand chevron when streaming', () => {
    const html = renderToStaticMarkup(
      <ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={baseRuns} streaming />,
    )
    expect(html).toContain('正在 read_file')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('lucide-chevron-right')
    expect(html).toContain('animate-pulse')
  })

  it('hides when there is no activity', () => {
    const html = renderToStaticMarkup(<ActivityBar />)
    expect(html).toBe('')
  })

  it('renders initializing placeholder while streaming with no activity', () => {
    const html = renderToStaticMarkup(<ActivityBar streaming />)
    expect(html).toContain('data-testid="activity-bar"')
    expect(html).toContain('chat.activity.initializing')
  })

  it('renders expand button in collapsed state', () => {
    const html = renderToStaticMarkup(
      <ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={baseRuns} />,
    )
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('lucide-chevron-right')
    expect(html).not.toContain('rotate-90')
    expect(html).not.toContain('TurnTimeline')
  })

  it('shows error icon when a tool call failed', () => {
    const html = renderToStaticMarkup(
      <ActivityBar
        steps={baseSteps}
        toolCalls={[{ ...baseTools[0], status: 'error' as const }]}
        agentRuns={baseRuns}
      />,
    )
    expect(html).toContain('lucide-circle-x')
  })

  it('shows thinking text while streaming a reasoning step', () => {
    const html = renderToStaticMarkup(
      <ActivityBar
        steps={[{ kind: 'reasoning' as const, stepSeq: 1, agentId: 'planner-1', role: 'planner' as const, content: '思考中' }]}
        streaming
      />,
    )
    expect(html).toContain('正在思考')
  })

  it('falls back to thinking text when streaming a tool step with missing tool call', () => {
    const html = renderToStaticMarkup(
      <ActivityBar
        steps={[{ kind: 'tool' as const, stepSeq: 1, agentId: 'planner-1', role: 'planner' as const, callId: 'missing-call' }]}
        toolCalls={baseTools}
        streaming
      />,
    )
    expect(html).toContain('正在思考')
  })

  it('toggles the activity drawer on click', () => {
    vi.mocked(TurnTimeline).mockReturnValue(<div data-testid="turn-timeline">TurnTimeline content</div>)

    render(<ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={baseRuns} />)

    const button = screen.getByTestId('activity-bar').querySelector('button')!

    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByTestId('turn-timeline')).not.toBeInTheDocument()

    fireEvent.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('turn-timeline')).toBeInTheDocument()
    expect(screen.getByTestId('turn-timeline')).toHaveTextContent('TurnTimeline content')

    vi.mocked(TurnTimeline).mockReturnValue(null)
  })

  it('toggles the activity drawer on click while streaming', () => {
    vi.mocked(TurnTimeline).mockReturnValue(<div data-testid="turn-timeline">TurnTimeline content</div>)

    const { container } = render(<ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={baseRuns} streaming />)

    const button = container.querySelector('[data-testid="activity-bar"] button')!

    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(container.querySelector('[data-testid="turn-timeline"]')).not.toBeInTheDocument()

    fireEvent.click(button)

    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(container.querySelector('[data-testid="turn-timeline"]')).toBeInTheDocument()

    vi.mocked(TurnTimeline).mockReturnValue(null)
  })
})
