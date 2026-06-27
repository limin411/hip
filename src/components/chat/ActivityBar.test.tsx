import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActivityBar } from './ActivityBar'

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
  TurnTimeline: () => null,
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

  it('shows running state without expand chevron when streaming', () => {
    const html = renderToStaticMarkup(
      <ActivityBar steps={baseSteps} toolCalls={baseTools} agentRuns={baseRuns} streaming />,
    )
    expect(html).toContain('正在 read_file')
    expect(html).not.toContain('aria-expanded')
  })

  it('hides when there is no activity', () => {
    const html = renderToStaticMarkup(<ActivityBar />)
    expect(html).toBe('')
  })
})
