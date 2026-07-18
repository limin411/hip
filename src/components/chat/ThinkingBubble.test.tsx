import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { ThinkingBubble } from './ThinkingBubble'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => {
    if (key === 'chat.activity.runningTool') return `正在 ${params?.name}`
    if (key === 'chat.activity.runningReasoning') return '正在思考'
    if (key === 'artifact.roles.planner') return '规划员'
    return key
  } }),
}))

vi.mock('./TurnTimeline', () => ({
  AgentBadge: ({ role }: { role: string }) => `<AgentBadge role="${role}" />`,
  TurnTimeline: () => null,
}))

describe('ThinkingBubble', () => {
  it('renders hip label without avatar badge', () => {
    const html = renderToStaticMarkup(<ThinkingBubble />)
    expect(html).toContain('hip')
    expect(html).not.toContain('>AI<')
    expect(html).not.toContain('text-on-accent')
  })

  it('does not render old bouncing dots', () => {
    const html = renderToStaticMarkup(<ThinkingBubble />)
    expect(html).not.toContain('animate-dot-bounce')
    expect(html).not.toContain('chat.thinking')
  })

  it('forwards activity data to ActivityBar', () => {
    const steps = [{ kind: 'tool' as const, stepSeq: 1, agentId: 'p1', role: 'planner' as const, callId: 'c1' }]
    const tools = [{ callId: 'c1', agentId: 'p1', name: 'read_file', input: '{}', status: 'running' as const, seq: 1 }]
    const runs = [{ agentId: 'p1', role: 'planner' as const, output: '', startedAt: 1, finishedAt: null as number | null, seq: 1 }]
    const html = renderToStaticMarkup(<ThinkingBubble steps={steps} toolCalls={tools} agentRuns={runs} />)
    expect(html).toContain('正在 read_file')
  })
})
