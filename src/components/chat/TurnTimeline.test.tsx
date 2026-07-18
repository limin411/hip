// @vitest-environment happy-dom
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { TurnTimeline } from './TurnTimeline'
import { sampleToolCalls } from '@/lib/__fixtures__/zuolinActivitySample'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>()
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, params?: Record<string, unknown>) => {
        if (key.startsWith('chat.activity.groups.')) return key.split('.').pop()!
        if (key === 'chat.todos.plan') return 'Plan'
        if (key === 'chat.todos.pending') return 'pending'
        if (key === 'chat.todos.in_progress') return 'in_progress'
        if (key === 'chat.todos.completed') return 'completed'
        if (key === 'chat.tool.truncated') return 'truncated'
        if (key === 'chat.tool.showRaw') return 'raw'
        if (key === 'chat.tool.hideRaw') return 'hide'
        if (key === 'artifact.output') return 'output'
        if (key === 'artifact.arguments') return 'args'
        if (key === 'artifact.failed') return 'failed'
        if (key === 'artifact.truncated') return 'truncated'
        if (key === 'chat.tool.error.enotdir') return `enotdir:${params?.path}`
        if (key === 'chat.subagent.noSummary') return 'no summary'
        return key
      },
    }),
  }
})

vi.mock('@tauri-apps/plugin-shell', () => ({ open: vi.fn() }))

describe('TurnTimeline', () => {
  beforeEach(() => cleanup())
  afterEach(() => cleanup())

  it('falls back to toolCalls when timeline is empty', () => {
    render(<TurnTimeline toolCalls={sampleToolCalls.slice(0, 3)} />)
    expect(screen.getByTestId('turn-timeline')).toBeInTheDocument()
    // task suppressed; grep should show with pattern
    const rows = screen.getAllByTestId('tool-row')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.textContent?.includes('zuolin'))).toBe(true)
  })

  it('groups when tool count ≥ 8', () => {
    render(<TurnTimeline toolCalls={sampleToolCalls} />)
    expect(screen.getByTestId('turn-timeline')).toBeInTheDocument()
    const groups = screen.getAllByTestId('tool-call-group')
    expect(groups.length).toBeGreaterThan(0)
  })

  it('renders per-agent sections in start order for multi-agent turns', () => {
    render(
      <TurnTimeline
        agentRuns={[
          {
            agentId: 'supervisor',
            role: 'supervisor',
            output: 'summary',
            startedAt: 1000,
            finishedAt: 5000,
            seq: 0,
          },
          {
            agentId: 'subagent-1',
            role: 'subagent',
            output: 'a',
            startedAt: 1100,
            finishedAt: 2000,
            seq: 1,
            taskInput: 'check module A',
            parentAgentId: 'supervisor',
          },
          {
            agentId: 'subagent-2',
            role: 'subagent',
            output: 'b',
            startedAt: 1200,
            finishedAt: 3000,
            seq: 2,
            taskInput: 'check module B',
            parentAgentId: 'supervisor',
          },
        ]}
        toolCalls={[
          {
            callId: 'c1',
            agentId: 'subagent-1',
            name: 'grep',
            input: '{"pattern":"A"}',
            status: 'finished',
            seq: 2,
            output: 'hitA',
          },
          {
            callId: 'c2',
            agentId: 'subagent-2',
            name: 'grep',
            input: '{"pattern":"B"}',
            status: 'finished',
            seq: 3,
            output: 'hitB',
          },
        ]}
      />,
    )
    const sections = screen.getAllByTestId('agent-timeline-section')
    expect(sections.length).toBeGreaterThanOrEqual(2)
    const ids = sections.map((s) => s.getAttribute('data-agent-id'))
    expect(ids).toContain('subagent-1')
    expect(ids).toContain('subagent-2')
    // tools stay under their agent section
    const s1 = sections.find((s) => s.getAttribute('data-agent-id') === 'subagent-1')!
    const s2 = sections.find((s) => s.getAttribute('data-agent-id') === 'subagent-2')!
    expect(s1.textContent).toMatch(/A|hitA|grep/)
    expect(s2.textContent).toMatch(/B|hitB|grep/)
  })

  it('applies role-colored left rails on all multi-agent sections including supervisor', () => {
    render(
      <TurnTimeline
        agentRuns={[
          {
            agentId: 'supervisor',
            role: 'supervisor',
            output: 'summary',
            startedAt: 1000,
            finishedAt: 5000,
            seq: 0,
          },
          {
            agentId: 'subagent-1',
            role: 'subagent',
            output: 'a',
            startedAt: 1100,
            finishedAt: 2000,
            seq: 1,
            taskInput: 'check module A',
            parentAgentId: 'supervisor',
          },
        ]}
        toolCalls={[
          {
            callId: 'c1',
            agentId: 'subagent-1',
            name: 'grep',
            input: '{"pattern":"A"}',
            status: 'finished',
            seq: 2,
            output: 'hitA',
          },
        ]}
      />,
    )
    const sections = screen.getAllByTestId('agent-timeline-section')
    expect(sections.length).toBeGreaterThanOrEqual(2)
    const supervisor = sections.find((s) => s.getAttribute('data-agent-id') === 'supervisor')!
    const child = sections.find((s) => s.getAttribute('data-agent-id') === 'subagent-1')!
    // Both multi-agent sections get border-l-2 rails colored by ROLE_COLOR
    expect(supervisor.className).toContain('border-l-2')
    expect(child.className).toContain('border-l-2')
    expect(supervisor.style.borderLeftColor).toBe('var(--role-supervisor)')
    // subagent maps to worker color
    expect(child.style.borderLeftColor).toBe('var(--role-worker)')
    // non-supervisor keeps extra top margin; supervisor omits mt-1
    expect(child.className).toContain('mt-1')
    expect(supervisor.className.split(/\s+/)).not.toContain('mt-1')
  })
})
