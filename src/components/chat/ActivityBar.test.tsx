// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { render, cleanup, within, fireEvent } from '@testing-library/react'
import { ActivityBar } from './ActivityBar'
import { TurnTimeline } from './TurnTimeline'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === 'chat.activity.completed') return '已完成'
      if (key === 'chat.activity.stopped') return '已停止'
      if (key === 'chat.activity.toolCount') return `${params?.finished}/${params?.total} 个工具`
      if (key === 'chat.activity.agentCount') return `${params?.agents} 个子 Agent`
      if (key === 'chat.activity.someFailed') return '部分失败'
      if (key === 'chat.activity.partialTools') return `${params?.count} 个工具未成功`
      if (key === 'chat.activity.catSearch') return `${params?.count} 次搜索`
      if (key === 'chat.activity.catRead') return `${params?.count} 次读取`
      if (key === 'chat.activity.catBrowse') return `${params?.count} 次浏览`
      if (key === 'chat.activity.runningTool') return `正在 ${params?.name}`
      if (key === 'chat.activity.runningReasoning') return '正在思考'
      if (key === 'chat.activity.initializing') return '准备中…'
      if (key === 'artifact.roles.planner') return '规划员'
      if (key === 'artifact.roles.supervisor') return '主管'
      return key
    },
  }),
}))

vi.mock('./TurnTimeline', () => ({
  TurnTimeline: vi.fn(() => <div data-testid="turn-timeline">TurnTimeline content</div>),
  AgentBadge: ({ role }: { role: string }) => <span data-role={role} />,
  TRAIL_ROW: 'flex min-h-5 w-full items-center gap-1.5 text-left text-meta leading-5',
}))

const baseSteps = [
  { kind: 'reasoning' as const, stepSeq: 1, agentId: 'planner-1', role: 'planner' as const, content: '先分析需求' },
  { kind: 'tool' as const, stepSeq: 2, agentId: 'planner-1', role: 'planner' as const, callId: 'call-1' },
]

const baseTools = [
  {
    callId: 'call-1',
    agentId: 'planner-1',
    name: 'read_file',
    input: '{"path":"src/a.ts"}',
    status: 'finished' as const,
    seq: 1,
  },
]

const baseRuns = [
  { agentId: 'planner-1', role: 'planner' as const, output: '', startedAt: 1, finishedAt: 2, seq: 1 },
]

describe('ActivityBar', () => {
  beforeEach(() => {
    cleanup()
    vi.mocked(TurnTimeline).mockClear()
  })

  it('renders collapsed summary by default for completed activity', () => {
    const html = renderToStaticMarkup(
      <ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={baseRuns} hasAssistantContent />,
    )
    expect(html).toContain('data-testid="activity-bar"')
    expect(html).toContain('已完成')
    expect(html).toContain('1/1 个工具')
    expect(html).toContain('1 个子 Agent')
    expect(html).toContain('data-testid="activity-status-success"')
    // Timeline hidden until expanded
    expect(html).not.toContain('data-testid="turn-timeline"')
    expect(html).toContain('aria-expanded="false"')
  })

  it('includes category summary when tools span categories', () => {
    const tools = [
      { ...baseTools[0], name: 'grep', input: '{"pattern":"x"}', callId: 'g1', seq: 1 },
      { ...baseTools[0], name: 'read_file', callId: 'r1', seq: 2 },
    ]
    const html = renderToStaticMarkup(
      <ActivityBar toolCalls={tools} hasAssistantContent />,
    )
    expect(html).toContain('次搜索')
    expect(html).toContain('次读取')
  })

  it('shows running state with tool title hint when streaming', () => {
    const html = renderToStaticMarkup(
      <ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={baseRuns} streaming />,
    )
    expect(html).toContain('正在')
    expect(html).toContain('a.ts')
    expect(html).toContain('animate-pulse')
    // Process trail stays collapsed while streaming; summary still shows live hint
    expect(html).not.toContain('data-testid="turn-timeline"')
  })

  it('running with activeRole: pulse on badge only — no Loader2 on summary', () => {
    const html = renderToStaticMarkup(
      <ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={baseRuns} streaming />,
    )
    // Summary uses pulse on AgentBadge; dual Loader2+pulse is forbidden.
    expect(html).toContain('animate-pulse')
    expect(html).toContain('data-role="planner"')
    // lucide Loader2 is absent from the summary path when role is present
    expect(html).not.toContain('animate-spin')
    expect(html).not.toContain('lucide-loader-circle')
  })

  it('running with activity but no activeRole: Loader2 only (no pulse, no Circle)', () => {
    // Tools only — no steps/runs means no lastStep.role / last agentRuns role.
    const html = renderToStaticMarkup(
      <ActivityBar
        toolCalls={[
          {
            callId: 'c-run',
            agentId: 'orphan',
            name: 'grep',
            input: '{"pattern":"x"}',
            status: 'running' as const,
            seq: 1,
          },
        ]}
        streaming
      />,
    )
    expect(html).toContain('data-testid="activity-bar-summary"')
    expect(html).toContain('animate-spin')
    expect(html).not.toContain('animate-pulse')
    expect(html).not.toContain('data-role=')
  })

  it('success status uses CheckCircle2 only — no completion flash classes', () => {
    const html = renderToStaticMarkup(
      <ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={baseRuns} hasAssistantContent />,
    )
    expect(html).toContain('data-testid="activity-status-success"')
    expect(html).not.toContain('animate-completion')
    expect(html).not.toContain('completion-rail')
    expect(html).not.toContain('animate-pulse')
  })

  it('hides when there is no activity', () => {
    const html = renderToStaticMarkup(<ActivityBar />)
    expect(html).toBe('')
  })

  it('renders initializing placeholder while streaming with no activity', () => {
    const html = renderToStaticMarkup(<ActivityBar streaming />)
    expect(html).toContain('data-testid="activity-bar"')
    expect(html).toContain('准备中…')
    // Loader2 only — no second pulse dot
    expect(html).toContain('animate-spin')
    expect(html).not.toContain('animate-pulse')
  })

  it('shows partial status (not error) when tools fail but content exists', () => {
    const html = renderToStaticMarkup(
      <ActivityBar
        steps={baseSteps}
        toolCalls={[{ ...baseTools[0], status: 'error' as const }]}
        agentRuns={baseRuns}
        hasAssistantContent
      />,
    )
    expect(html).toContain('data-testid="activity-status-partial"')
    expect(html).not.toContain('data-testid="activity-status-error"')
    expect(html).toContain('1 个工具未成功')
  })

  it('shows error status when tools fail and no assistant content', () => {
    const html = renderToStaticMarkup(
      <ActivityBar
        steps={baseSteps}
        toolCalls={[{ ...baseTools[0], status: 'error' as const }]}
        agentRuns={baseRuns}
        hasAssistantContent={false}
      />,
    )
    expect(html).toContain('data-testid="activity-status-error"')
    expect(html).toContain('lucide-circle-x')
  })

  it('omits tool count when there are no tool calls', () => {
    const html = renderToStaticMarkup(
      <ActivityBar steps={baseSteps} toolCalls={[]} agentRuns={baseRuns} />,
    )
    expect(html).toContain('已完成 · 1 个子 Agent')
    expect(html).not.toContain('个工具')
  })

  it('omits agent count when there are no sub-agent runs', () => {
    const html = renderToStaticMarkup(
      <ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={[]} hasAssistantContent />,
    )
    expect(html).toContain('1/1 个工具')
    expect(html).not.toContain('子 Agent')
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

  it('falls back to a known tool label when streaming a tool step with missing callId', () => {
    const html = renderToStaticMarkup(
      <ActivityBar
        steps={[{ kind: 'tool' as const, stepSeq: 1, agentId: 'planner-1', role: 'planner' as const, callId: 'missing-call' }]}
        toolCalls={baseTools}
        streaming
      />,
    )
    // Prefer any available tool hint over a blank "thinking" chip
    expect(html).toContain('正在')
    expect(html).toContain('a.ts')
  })

  it('expands timeline when summary is clicked', () => {
    const { container } = render(
      <ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={baseRuns} hasAssistantContent />,
    )
    const bar = within(container).getByTestId('activity-bar')
    const summary = within(bar).getByTestId('activity-bar-summary')

    expect(summary).toHaveAttribute('aria-expanded', 'false')
    expect(within(bar).queryByTestId('turn-timeline')).not.toBeInTheDocument()

    fireEvent.click(summary)
    expect(summary).toHaveAttribute('aria-expanded', 'true')
    expect(within(bar).getByTestId('turn-timeline')).toBeInTheDocument()

    fireEvent.click(summary)
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    expect(within(bar).queryByTestId('turn-timeline')).not.toBeInTheDocument()
  })

  it('keeps timeline collapsed while streaming until expanded', () => {
    const { container } = render(
      <ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={baseRuns} streaming />,
    )
    const bar = within(container).getByTestId('activity-bar')
    const summary = within(bar).getByTestId('activity-bar-summary')

    expect(within(bar).queryByTestId('turn-timeline')).not.toBeInTheDocument()
    fireEvent.click(summary)
    expect(within(bar).getByTestId('turn-timeline')).toBeInTheDocument()
  })

  it('interleaved: keeps answer timeline mounted while process starts collapsed', () => {
    const { container } = render(
      <ActivityBar
        steps={baseSteps}
        toolCalls={baseTools}
        agentRuns={baseRuns}
        hasAssistantContent
        interleaved
      />,
    )
    const bar = within(container).getByTestId('activity-bar')
    const summary = within(bar).getByTestId('activity-bar-summary')
    // Fold control always present so tools/sub-agents can be hidden
    expect(summary.tagName.toLowerCase()).toBe('button')
    expect(summary).toHaveAttribute('aria-expanded', 'false')
    // Answer shell still mounts (answerOnly) so supervisor text is not lost
    expect(within(bar).getByTestId('turn-timeline')).toBeInTheDocument()
    expect(vi.mocked(TurnTimeline)).toHaveBeenLastCalledWith(
      expect.objectContaining({ interleaved: true, answerOnly: true }),
      expect.anything(),
    )

    fireEvent.click(summary)
    expect(summary).toHaveAttribute('aria-expanded', 'true')
    expect(vi.mocked(TurnTimeline)).toHaveBeenLastCalledWith(
      expect.objectContaining({ interleaved: true, answerOnly: false }),
      expect.anything(),
    )
  })

  it('hides process children (e.g. SubAgentCards) until trail is expanded', () => {
    const { container } = render(
      <ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={baseRuns} hasAssistantContent>
        <div data-testid="subagent-slot">child</div>
      </ActivityBar>,
    )
    const bar = within(container).getByTestId('activity-bar')
    expect(within(bar).queryByTestId('subagent-slot')).not.toBeInTheDocument()

    fireEvent.click(within(bar).getByTestId('activity-bar-summary'))
    expect(within(bar).getByTestId('subagent-slot')).toBeInTheDocument()

    fireEvent.click(within(bar).getByTestId('activity-bar-summary'))
    expect(within(bar).queryByTestId('subagent-slot')).not.toBeInTheDocument()
  })

  it('does not break React hook rules when activity appears after initial render', () => {
    const { rerender, container } = render(<ActivityBar streaming />)
    expect(container.querySelector('[data-testid="activity-bar"]')).toBeInTheDocument()

    expect(() =>
      rerender(<ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={baseRuns} streaming />),
    ).not.toThrow()

    expect(container.querySelector('[data-testid="activity-bar"]')).toBeInTheDocument()
    // Still collapsed by default after activity appears
    expect(container.querySelector('[data-testid="turn-timeline"]')).not.toBeInTheDocument()
  })
})
